// QA Studio — all client logic.
// Static page: reads openapi.json live (feature tree + AJV validation), builds a Claude prompt,
// and validates pasted results against the OpenAPI request schema. No server code, no build step.

import Ajv2020 from "https://esm.sh/ajv@8.17.1/dist/2020";

// ----- config -----------------------------------------------------------------
const REGIONS = ["USA", "India", "Singapore"];
const OPT_PATH = "/optimization/v2";

// ----- state ------------------------------------------------------------------
let spec = null;          // parsed openapi.json
let requestSchema = null; // raw request-body schema (for the tree)
let locations = [];       // [{lat,lon,city,state}]
let validateFn = null;    // compiled AJV validator (sanitized schema)
let existingSuite = null; // [{...case}] loaded to generate MORE without duplicating (Phase 2)
let existingFileCount = 0; // how many files fed the current existingSuite (for the status line)
let lastRendered = [];    // [{tc, res}] currently shown in the results table — source for CSV export
let overlay = [];         // draft features from overlay.json (not-in-spec)
let draftPaths = new Set(); // dotted paths that are draft (e.g. "jobs.split", "jobs.split.can_be_split")
let draftObligations = {}; // path -> { pos, neg, interaction } for draft fields
let compiledFeatures = {}; // path -> compiled feature (enrichment merged) from data/compiled/features.json
let compiledRules = {};    // ruleId -> rule def from data/compiled/_graph.json (.rules)
let coverageConfig = null; // coverage-config.json — obligation vocabulary + count floors + globalSuites
let skillBlock = "";       // fetched authoring layer (skills/_base + skills/test-cases/*), prepended to the prompt
// Field ROLES. target = a test subject that receives dedicated cases; support = injected into request
// bodies as realistic context, never a subject on its own. Curated defaults come from
// coverage-config.json (data, not code); the per-field pill in the tree overrides them for this run.
let fieldRoles = {
  supportLeaves: [
    "id", "description",                    // identifiers (no test cases)
    "skills", "service", "setup",          // group/vehicle configuration (context only)
    "time_windows", "time_window",          // scheduling constraints (context)
    "location_index",                       // structural reference (context)
    "priority",                             // metadata (context)
    "start_index", "end_index",             // depot references (context)
    "capacity"                              // vehicle capacity (context, not tested separately)
  ],
  supportPaths: []
};
const roleOverrides = new Map(); // path -> "target" | "support"

// ----- tiny DOM helpers -------------------------------------------------------
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// =============================================================================
// 1. LOAD SPEC + LOCATIONS
// =============================================================================
async function loadSpec() {
  try {
    const res = await fetch("openapi.json?_=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    spec = await res.json();
  } catch (e) {
    $("load-banner").classList.remove("hidden");
    $("load-banner").textContent =
      "Could not read openapi.json (" + e.message + "). Launch the page via start.command " +
      "(a local server) — browsers block file:// pages from reading local files.";
    throw e;
  }
  const body = spec?.paths?.[OPT_PATH]?.post?.requestBody?.content?.["application/json"]?.schema;
  if (!body) throw new Error("Request schema not found at paths['" + OPT_PATH + "'].post.requestBody");
  requestSchema = body;
}

// load draft-feature overlay (not-in-spec features distilled from PDFs) and merge into the schema
async function loadOverlay() {
  overlay = [];
  draftPaths = new Set();
  draftObligations = {};
  try {
    const res = await fetch("overlay.json?_=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return;               // no overlay = no drafts, fine
    const data = await res.json();
    overlay = Array.isArray(data.features) ? data.features : [];
  } catch { return; }
  for (const feat of overlay) {
    if (feat.status && feat.status !== "draft") continue;
    const container = resolveSchemaContainer(feat.target); // e.g. jobs.items.properties object
    if (!container || !feat.fields) continue;
    // Extract obligations from draft feature's testingSuggestions and constraints
    const ob = draftFeatureObligations(feat);
    for (const [name, def] of Object.entries(feat.fields)) {
      container[name] = def;           // merge the draft field into the live schema
      const draftPath = collectDraftPaths(feat.target, name, def);
      // Store obligations for each draft path
      if (draftPath) draftObligations[draftPath] = ob;
    }
  }
}
// navigate the request schema by a dotted "target" like "jobs.items.properties" and return that object.
// The target is relative to the top-level field map (requestSchema.properties), so "jobs.items.properties"
// resolves to requestSchema.properties.jobs.items.properties.
function resolveSchemaContainer(target) {
  let node = requestSchema.properties;
  for (const seg of String(target).split(".")) {
    if (node && typeof node === "object" && seg in node) node = node[seg];
    else return null;
  }
  return node && typeof node === "object" ? node : null;
}
// record the tree-facing dotted paths a draft field introduces (target minus ".items.properties")
// Returns the top-level draft path (for obligation tracking)
function collectDraftPaths(target, name, def) {
  const featurePrefix = String(target).replace(/\.items\.properties$|\.properties$/,"");
  const topPath = featurePrefix + "." + name;
  const walk = (prefix, key, node) => {
    const path = prefix + "." + key;
    draftPaths.add(path);
    const kids = node?.type === "object" && node.properties ? node.properties
      : node?.type === "array" && node.items?.properties ? node.items.properties : null;
    if (kids) for (const [k, v] of Object.entries(kids)) walk(path, k, v);
  };
  walk(featurePrefix, name, def);
  return topPath;
}

// load the compiled knowledge base produced by compile.mjs (per-field enrichment + business rules).
// Selected features surface their enrichment/rules in the Claude prompt (see buildEnrichmentBlock).
// Missing KB (not compiled yet) is non-fatal — the prompt just falls back to spec + enums only.
async function loadKnowledge() {
  compiledFeatures = {};
  compiledRules = {};
  try {
    const [fRes, gRes, cRes] = await Promise.all([
      fetch("data/compiled/features.json?_=" + Date.now(), { cache: "no-store" }),
      fetch("data/compiled/_graph.json?_=" + Date.now(), { cache: "no-store" }),
      fetch("coverage-config.json?_=" + Date.now(), { cache: "no-store" }),
    ]);
    if (fRes.ok) compiledFeatures = await fRes.json();
    if (gRes.ok) { const g = await gRes.json(); compiledRules = (g && g.rules) || {}; }
    if (cRes.ok) {
      coverageConfig = await cRes.json();
      const fr = coverageConfig.fieldRoles || {};
      fieldRoles = {
        supportLeaves: Array.isArray(fr.supportLeaves) ? fr.supportLeaves : fieldRoles.supportLeaves,
        supportPaths: Array.isArray(fr.supportPaths) ? fr.supportPaths : [],
      };
    }
  } catch { /* no compiled KB — enrichment block stays empty, prompt still works */ }
  setKbStatus();
}

function setKbStatus() {
  const s = $("kb-status");
  if (!s) return;
  const nf = Object.keys(compiledFeatures).length;
  const nr = Object.keys(compiledRules).length;
  s.textContent = nf
    ? `Enrichment KB loaded: ${nf} features, ${nr} business rules — selected features inject their rules into the prompt.`
    : "Enrichment KB not loaded — prompt uses spec + enums only. Run `node compile.mjs` to enable per-feature rules.";
}

// Load the AUTHORING LAYER (skills/). These fragments hold NO product knowledge — they define how
// Claude reasons and shapes output. QA Studio prepends them to the prompt (the copy-paste workflow
// has no filesystem for Claude Code to auto-load a SKILL.md, so the skill IS injected as text).
// "Inheritance" = concatenating _base + the generator's files. Missing skills are non-fatal: the
// prompt falls back to a minimal inline contract (see FALLBACK_CONTRACT) so generation still works.
const SKILL_FILES = [
  "skills/_base/SKILL.md",
  "skills/test-cases/SKILL.md",
  "skills/test-cases/output-contract.md",
  "skills/test-cases/rubric.md",
  "skills/test-cases/checklist.md",
  "skills/test-cases/examples/exemplars.md",
];
async function loadSkill() {
  skillBlock = "";
  try {
    const parts = await Promise.all(
      SKILL_FILES.map((f) => fetch(f + "?_=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.text() : "")))
    );
    skillBlock = parts.filter(Boolean).join("\n\n---\n\n").trim();
  } catch { /* no skills served — FALLBACK_CONTRACT keeps the prompt valid */ }
  setSkillStatus();
}

function setSkillStatus() {
  const s = $("skill-status");
  if (!s) return;
  s.textContent = skillBlock
    ? "Authoring skill loaded — reasoning + output contract are prepended to the prompt."
    : "Authoring skill not loaded — using the built-in fallback contract (serve qa-studio/skills/ to enable).";
}

async function loadRegion(region) {
  try {
    const res = await fetch("data/locations/" + region + ".json");
    const data = await res.json();
    locations = data.locations || [];
  } catch {
    locations = [];
  }
  $("loc-count").textContent = locations.length + " coordinates in the " + region + " pool";
}

// =============================================================================
// 2. FEATURE TREE  (recurse the live schema → nested checkboxes; auto-syncs)
// =============================================================================
function stripTicks(s) {
  return String(s).replace(/`/g, "").trim();
}

// classify a schema node for tree rendering
function childrenOf(node) {
  if (!node || typeof node !== "object") return null;
  if (node.type === "object" && node.properties) return node.properties;
  if (node.type === "array" && node.items && node.items.type === "object" && node.items.properties)
    return node.items.properties;
  return null; // leaf (primitive, or array of primitives)
}

// cleaned enum values for a node (handles enum and array-of-enum, strips backtick artifacts)
function enumValues(node) {
  const arr = node?.enum || node?.items?.enum;
  if (!Array.isArray(arr)) return null;
  const vals = arr
    .map(stripTicks)
    .map((v) => (v === '""(empty string)' ? '""' : v))
    .filter((v) => v !== "");
  return vals.length ? vals : null;
}

function enumHint(node) {
  const vals = enumValues(node);
  return vals ? " — enum: " + vals.join(" | ") : "";
}

// resolve a dotted feature path (e.g. options.objective.travel_cost) to its schema node
function nodeAtPath(path) {
  const segs = path.split(".");
  let node = requestSchema;
  for (const seg of segs) {
    let props = null;
    if (node.type === "object" && node.properties) props = node.properties;
    else if (node.type === "array" && node.items && node.items.properties) props = node.items.properties;
    else if (node.properties) props = node.properties;
    if (!props || !props[seg]) return null;
    node = props[seg];
  }
  return node;
}

// render each allowed enum value as its own selectable checkbox (path encoded as "field=value")
function buildEnumChildren(path, vals) {
  const ul = el("ul", "ml-4 border-l border-slate-200 pl-3 space-y-1");
  vals.forEach((val) => {
    const li = el("li");
    const rowEl = el("div", "flex items-start gap-1");
    rowEl.appendChild(el("span", "w-4 shrink-0"));
    const cb = el("input");
    cb.type = "checkbox";
    cb.className = "feature-cb enum-val mt-1";
    cb.dataset.path = path + "=" + val;
    cb.addEventListener("change", onCheckboxChange);
    const label = el("label", "cursor-pointer select-none");
    label.innerHTML = '<span class="font-mono text-indigo-700 text-xs">' + esc(val) + "</span>";
    label.prepend(cb);
    rowEl.appendChild(label);
    li.appendChild(rowEl);
    ul.appendChild(li);
  });
  return ul;
}

function buildTree(props, parentPath, depth) {
  const wrap = el("ul", depth === 0 ? "space-y-1" : "ml-4 border-l border-slate-200 pl-3 space-y-1");
  for (const [key, node] of Object.entries(props)) {
    const path = parentPath ? parentPath + "." + key : key;
    const kids = childrenOf(node);
    const enums = kids ? null : enumValues(node); // a leaf/array with enum → expandable value list
    const li = el("li");
    const rowEl = el("div", "flex items-start gap-1");

    // expand/collapse toggle when the field has nested fields OR selectable enum values
    let childWrap = null;
    if (kids || enums) {
      const toggle = el("button", "tree-toggle w-4 shrink-0 text-slate-500 text-xs leading-5 hover:text-slate-800", "▸");
      childWrap = el("div", "tree-children hidden");
      childWrap.appendChild(kids ? buildTree(kids, path, depth + 1) : buildEnumChildren(path, enums));
      toggle.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const nowHidden = childWrap.classList.toggle("hidden");
        toggle.textContent = nowHidden ? "▸" : "▾";
      });
      rowEl.appendChild(toggle);
    } else {
      rowEl.appendChild(el("span", "w-4 shrink-0"));
    }

    const cb = el("input");
    cb.type = "checkbox";
    cb.className = "feature-cb mt-1";
    cb.dataset.path = path;
    cb.dataset.parent = parentPath || "";
    cb.addEventListener("change", onCheckboxChange);

    const label = el("label", "cursor-pointer select-none");
    const typeStr = node.type ? (node.type === "array" ? "array" : node.type) : "";
    const desc = node.description ? stripTicks(node.description).slice(0, 90) : "";
    const isDraft = draftPaths.has(path);
    label.innerHTML =
      '<span class="font-medium">' + esc(key) + "</span>" +
      (typeStr ? ' <span class="text-slate-400 text-xs">' + esc(typeStr) + "</span>" : "") +
      (isDraft ? ' <span class="text-amber-600 bg-amber-100 rounded px-1 text-[10px]">draft — not in spec</span>' : "") +
      (kids ? ' <span class="text-slate-300 text-xs">▸ nested</span>' : "") +
      (enums ? ' <span class="text-indigo-400 text-xs">▸ ' + enums.length + " values</span>" : "") +
      (desc ? '<div class="text-xs text-slate-400">' + esc(desc) + "</div>" : "");
    label.prepend(cb);

    rowEl.appendChild(label);

    // role pill — only meaningful once the field is selected, so it stays hidden until then.
    // Clicking it flips this field between "test subject" and "supporting field" for this run.
    const pill = el("button", "role-pill hidden");
    pill.dataset.path = path;
    pill.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      roleOverrides.set(path, roleOf(path) === "support" ? "target" : "support");
      paintRolePill(pill);
      renderPlan();
    });
    rowEl.appendChild(pill);

    li.appendChild(rowEl);
    if (childWrap) li.appendChild(childWrap);
    wrap.appendChild(li);
  }
  return wrap;
}

// paint one role pill from the field's effective role (override > curated default)
function paintRolePill(btn) {
  const r = roleOf(btn.dataset.path);
  const support = r === "support";
  btn.textContent = support ? "support" : "target";
  btn.className = "role-pill ml-2 mt-1 shrink-0 px-1.5 rounded border text-[10px] leading-4 " +
    (support ? "bg-slate-100 text-slate-500 border-slate-300 hover:bg-slate-200"
             : "bg-indigo-50 text-indigo-700 border-indigo-300 hover:bg-indigo-100");
  btn.title = support
    ? "Supporting field — injected into request bodies for realism, no dedicated test cases. Click to make it a test subject."
    : "Test subject — receives dedicated test cases sized by its authored coverage aspects. Click to make it a supporting field.";
}

// show a role pill only for fields that are actually selected, and keep its label current
function syncRolePills() {
  document.querySelectorAll("#tree .role-pill").forEach((btn) => {
    const row = btn.parentElement;
    const cb = row && row.querySelector(".feature-cb");
    const on = !!(cb && cb.checked);
    btn.classList.toggle("hidden", !on);
    if (on) paintRolePill(btn);
  });
}

// (re)render the tree from the current schema, collapsed
function renderTree() {
  $("tree").innerHTML = "";
  $("tree").appendChild(buildTree(requestSchema.properties, "", 0));
  syncRolePills();
  updateFeatureCount();
}

// expand/collapse every nested group and sync the arrows
function setAllTree(expand) {
  document.querySelectorAll("#tree .tree-children").forEach((c) => c.classList.toggle("hidden", !expand));
  document.querySelectorAll("#tree .tree-toggle").forEach((t) => (t.textContent = expand ? "▾" : "▸"));
}

// re-fetch openapi.json (reflect edits) and rebuild
async function refreshSpec() {
  $("tree").innerHTML = '<span class="text-slate-400">Reloading spec…</span>';
  try {
    await loadSpec();
    await loadOverlay();
    compileValidator();
    renderTree();
    $("feature-count").textContent = selectedFeatures().length + " fields selected · spec reloaded";
  } catch {
    /* loadSpec shows the banner */
  }
}

// parent checkbox toggles all descendants; keep counts fresh
function onCheckboxChange(e) {
  const cb = e.target;
  const li = cb.closest("li");
  li.querySelectorAll(".feature-cb").forEach((c) => { if (c !== cb) c.checked = cb.checked; });
  syncRolePills();
  updateFeatureCount();
  renderPlan();
}

function selectedFeatures() {
  return [...document.querySelectorAll(".feature-cb:checked")].map((c) => c.dataset.path);
}
function updateFeatureCount() {
  const draftFeatures = overlay.filter((f) => !f.status || f.status === "draft").length;
  const prov = draftFeatures
    ? ' · ' + draftFeatures + ' draft feature(s) from overlay.json (source PDFs in Knowledge/new_features_without_spec/)'
    : "";
  // split the selection by role so the header answers "what am I actually testing?"
  const sel = selectedFeatures().map(basePath);
  const nSupport = sel.filter((p) => !unitOf(p) || roleOf(p) === "support").length;
  const nTarget = sel.length - nSupport;
  const roles = sel.length ? ` · ${nTarget} test subject(s), ${nSupport} supporting` : "";
  $("feature-count").textContent = sel.length + " fields selected" + roles + prov;
}

// live allocation readout under the single count input
function renderPlan() {
  const box = $("plan-readout");
  if (!box) return;
  const cfg = collectConfig();
  if (!cfg.features.length) {
    box.innerHTML = '<span class="text-slate-400">Select features to see how the test cases will be allocated.</span>';
    renderCoverage(existingSuite || [], cfg);
    return;
  }
  const plan = buildPlan(cfg);
  const bar = (n, max) => {
    const w = max > 0 ? Math.max(1, Math.round((n / max) * 10)) : 0;
    return '<span class="text-indigo-400">' + "█".repeat(w) + "</span>";
  };
  const maxAlloc = Math.max(1, ...plan.perFeature.map((u) => u.allocated));
  const rows = plan.perFeature
    .filter((u) => u.allocated > 0)
    .map((u) =>
      `<li><span class="font-mono">${esc(u.unit)}</span> <b>${u.allocated}</b> ` +
      `<span class="text-slate-400">(${u.positive}P${u.negative ? "/" + u.negative + "N" : ""}, ${u.cap} authored)</span> ${bar(u.allocated, maxAlloc)}</li>`
    ).join("");

  const reserve = [];
  if (plan.combo) reserve.push(`<li>Combination scenarios <b>${plan.combo}</b> <span class="text-slate-400">(funded from positive share)</span></li>`);

  // capacity + degradation messages — never truncate silently
  const notes = [];
  if (plan.overflow > 0) {
    notes.push(`<div class="text-amber-700 mt-1">⚠ ${plan.requested} requested, but only <b>${plan.capacity}</b> authored aspects are available for this selection — generating ${plan.capacity}. Select more features or enrich the existing ones to go higher.</div>`);
  }
  if (plan.dropped.length) {
    notes.push(`<div class="text-amber-700 mt-1">⚠ Budget too small to cover every feature — <b>${plan.dropped.length}</b> got no cases: <span class="font-mono">${esc(plan.dropped.join(", "))}</span>. Raise the count to include them.</div>`);
  }
  if (plan.promoted) {
    notes.push('<div class="text-indigo-700 mt-1">Only supporting fields were selected, so they were promoted to test subjects for this run.</div>');
  }
  const support = plan.supportPaths.length
    ? `<div class="mt-2 text-slate-500">Supporting fields <span class="text-slate-400">(injected into bodies, no dedicated cases)</span>:<br>` +
      `<span class="font-mono text-[11px]">${esc(plan.supportPaths.join(" · "))}</span></div>`
    : "";

  box.innerHTML =
    `<div class="font-medium mb-1">Allocation — <b>${plan.total}</b> case(s) · Positive <b>${plan.positive}</b> · Negative <b>${plan.negative}</b></div>` +
    (rows ? '<ul class="list-disc ml-4">' + rows + "</ul>" : '<div class="text-slate-400">No test subjects — every selected field is supporting.</div>') +
    (reserve.length ? '<div class="mt-1 text-slate-600">Reserved:</div><ul class="list-disc ml-4">' + reserve.join("") + "</ul>" : "") +
    support + notes.join("");
  // keep the coverage matrix in sync with the current selection + any loaded suite
  renderCoverage(existingSuite || [], cfg);
}

// =============================================================================
// 3. CONFIG + PROMPT
// =============================================================================
function collectConfig() {
  return {
    region: $("region").value,
    vehicles: parseInt($("vehicles").value, 10) || 0,
    jobs: parseInt($("jobs").value, 10) || 0,
    features: selectedFeatures(),
    testTypes: [...document.querySelectorAll(".testtype:checked")].map((c) => c.value),
  };
}

// The single count the user supplies — the only number the Scenario section asks for.
const TOTAL_CASES_DEFAULT = 40;
function getTotalCases() {
  const v = parseInt(($("total-cases")?.value ?? ""), 10);
  return Number.isFinite(v) && v > 0 ? v : TOTAL_CASES_DEFAULT;
}

function sampleCoords(n) {
  const pool = [...locations];
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    const idx = Math.floor((i * 2654435761) % pool.length); // deterministic spread, no Math.random
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

// Compute vehicle/job counts for each scale tier (small/medium/large) given the UI's scenario input.
// Tier sizes auto-scale with cfg.vehicles/cfg.jobs; if the user asks for 1/1, all tiers collapse there.
function computeScaleTiers(cfg) {
  const v = cfg.vehicles || 0, j = cfg.jobs || 0;
  const small  = { vehicles: 1, jobs: Math.min(2, Math.max(1, j)) };
  const medium = { vehicles: Math.min(v, Math.max(2, Math.round(v * 0.4))),
                   jobs:     Math.min(j, Math.max(3, Math.round(j * 0.4))) };
  const large  = { vehicles: v, jobs: j };
  return { small, medium, large };
}

// =============================================================================
// 3b. ROLES + ALLOCATION PLANNER
// =============================================================================
// The user supplies ONE number: how many test cases they want. This planner distributes it
// top-down, deterministically:
//
//   role         target = a test subject (gets dedicated cases) | support = injected into request
//                bodies as realistic context, never a subject. Curated defaults live in
//                coverage-config.json; the per-field pill in the tree overrides them.
//   weight       a target unit's share is proportional to its COMPILED COVERAGE OBLIGATIONS
//                (the authored testingGuidance aspects), not to a hand-tuned knob.
//   cap          a unit never receives more cases than it has authored aspects — padding beyond
//                the knowledge base would force Claude to invent facts.
//   ratio        positiveShare is a GLOBAL 90/10 split applied to the whole suite; per-feature
//                obligation ratios no longer decide it. Combination cases are funded from inside
//                the positive share, not reserved separately.
//   ceiling      N is the MAX, not a target. The suite is sized once so both halves stay fully
//                backed by authored aspects; generating fewer than N is normal and expected.

// strip a trailing "=value" enum selection to the field path
const basePath = (f) => { const i = f.indexOf("="); return i > -1 ? f.slice(0, i) : f; };

// ---- roles -------------------------------------------------------------------
// Curated default for a path: leaf-name match, then prefix match, else "target".
function defaultRole(path) {
  const p = basePath(path);
  const leaf = p.split(".").slice(-1)[0];
  if ((fieldRoles.supportLeaves || []).includes(leaf)) return "support";
  for (const sp of fieldRoles.supportPaths || []) if (p === sp || p.startsWith(sp + ".")) return "support";
  return "target";
}
// Effective role: the user's per-field toggle wins over the curated default.
function roleOf(path) {
  const p = basePath(path);
  return roleOverrides.get(p) || defaultRole(p);
}

// The unit a path is counted by: top-level for extras (relations, zones, depots, matrices),
// object.subfield for vehicle/job/shipment fields, one level deeper for options.* so
// options.routing and options.objective are distinct. null = not a countable subject on its own.
function unitOf(f) {
  const path = basePath(f);
  const segs = path.split(".");
  const top = segs[0];
  const leaf = segs[segs.length - 1];
  if (leaf === "id" || leaf === "description") return null; // identity/label fields
  if (top === "locations") return null;                     // the coordinate array is scaffolding
  if (top === "vehicles" || top === "jobs" || top === "shipments") {
    return segs[1] ? top + "." + segs[1] : null;
  }
  return top === "options" && segs[1] ? top + "." + segs[1] : top;
}

// ---- obligations -------------------------------------------------------------
// Sum a unit's compiled coverage obligations across its selected leaf paths.
// {pos, neg} = distinct positive / negative aspects authored in the enrichment; interaction =
// documented cross-feature behaviour (a priority hint for combination cases, not a per-unit count).
function obligationsForUnit(paths) {
  let pos = 0, neg = 0, interaction = 0;
  for (const p of paths) {
    // Check both compiled features and draft obligations
    const o = (compiledFeatures[p] && compiledFeatures[p].obligations) || draftObligations[p];
    if (o) { pos += (o.pos || o.positiveTotal || 0); neg += (o.neg || o.negativeTotal || 0); interaction += (o.interaction || 0); }
  }
  return { pos, neg, interaction };
}
// Support paths whose compiled feature is backed by a business rule keep their negative aspects —
// this is what preserves e.g. location-index-range coverage when jobs.location_index is support.

// ---- draft feature obligations -----------------------------------------------
// Classify a testingSuggestion/constraint bullet the same way compile.mjs does,
// extracting coverage obligations from draft feature metadata.
function classifyGuidance(item) {
  const s = String(item || "").trim();
  if (/^negative[-\s]*validation\b/i.test(s)) return "negativeValidation";
  if (/^negative[-\s]*infeasible\b/i.test(s) || /^infeasible\b/i.test(s)) return "negativeInfeasible";
  if (/^negative\b/i.test(s)) return /\b(unassigned|422|infeasible|deferred|breach)\b/i.test(s) ? "negativeInfeasible" : "negativeValidation";
  if (/^interaction\b/i.test(s)) return "interaction";
  if (/^(positive|boundary|open route|multi[-\s]*dimension)\b/i.test(s)) return "positive";
  // fallback: no recognized tag -> infer from outcome keywords
  if (/\b(400|401|403|413|reject|invalid|out of range|malformed|type error|missing)\b/i.test(s)) return "negativeValidation";
  if (/\b(unassigned|422|infeasible|breach|deferred)\b/i.test(s)) return "negativeInfeasible";
  return "positive";
}

function draftFeatureObligations(feat) {
  let pos = 0, neg = 0, interaction = 0;
  if (Array.isArray(feat.testingSuggestions)) {
    for (const item of feat.testingSuggestions) {
      const type = classifyGuidance(item);
      if (type === "positive") pos++;
      else if (type === "negativeValidation" || type === "negativeInfeasible") neg++;
      else if (type === "interaction") interaction++;
    }
  }
  if (Array.isArray(feat.constraints)) {
    for (const item of feat.constraints) {
      const type = classifyGuidance(item);
      if (type === "negative" + "Validation" || type === "negativeInfeasible") neg++;
    }
  }
  return { pos, neg, interaction };
}

// ---- integer allocation ------------------------------------------------------
// Largest-remainder apportionment: split `total` across `weights` so the parts sum EXACTLY to
// total. Ties break by index, so the same selection always produces the same plan.
function largestRemainder(weights, total) {
  const n = weights.length;
  if (!n || total <= 0) return new Array(n).fill(0);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return largestRemainder(weights.map(() => 1), total); // all-zero weights → even split
  const raw = weights.map((w) => (w / sum) * total);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < left; k++) out[order[k % n].i]++;
  return out;
}

// Distribute `budget` across units proportional to weight, never exceeding each unit's cap,
// redistributing any capped surplus until the budget is placed or every unit is full.
// Guarantees a floor of 1 per unit (highest weight first) while the budget allows.
function allocateCapped(units, budget) {
  const n = units.length;
  const out = new Array(n).fill(0);
  if (!n || budget <= 0) return out;
  let remaining = Math.min(budget, units.reduce((s, u) => s + u.cap, 0));

  // floor of 1 for as many units as the budget covers, deepest-authored first
  const byWeight = units.map((u, i) => ({ i, w: u.weight })).sort((a, b) => b.w - a.w || a.i - b.i);
  for (const { i } of byWeight) {
    if (remaining <= 0) break;
    if (units[i].cap > 0) { out[i] = 1; remaining--; }
  }
  // proportional distribution of the rest, capped, iterating as caps bite
  let guard = 0;
  while (remaining > 0 && guard++ < 64) {
    const open = units.map((u, i) => i).filter((i) => out[i] < units[i].cap);
    if (!open.length) break;
    const share = largestRemainder(open.map((i) => units[i].weight || 1), remaining);
    let placed = 0;
    open.forEach((i, k) => {
      const give = Math.min(share[k], units[i].cap - out[i]);
      if (give > 0) { out[i] += give; remaining -= give; placed += give; }
    });
    if (!placed) { // rounding stalled — hand out one at a time
      for (const i of open) { if (remaining <= 0) break; out[i]++; remaining--; }
    }
  }
  return out;
}

// =============================================================================
// THE PLANNER — one ceiling in, a complete deterministic allocation out.
// =============================================================================
// N is a MAXIMUM, not a target. The suite is sized to the largest total <= N whose positive and
// negative halves are both fully backed by authored coverage aspects, then split by a GLOBAL
// 90/10 ratio (coverage-config.json -> ratio.positiveShare). Combination cases are funded from
// INSIDE the positive share. Nothing is ever invented to reach N.
function buildPlan(cfg, total = getTotalCases()) {
  const wantPos = cfg.testTypes.includes("Positive");
  const wantNeg = cfg.testTypes.includes("Negative");
  const cc = coverageConfig || {};
  const enumSel = collectEnumSelections(cfg.features);

  // ---- 1. group selected paths by role -------------------------------------
  const unitMap = new Map();   // unit -> { paths:Set }
  const supportPaths = [];     // raw paths injected into bodies, never a subject
  for (const f of cfg.features) {
    const p = basePath(f);
    const unit = unitOf(p);
    // A path is support if the user/curation says so, or if it has no countable unit at all
    // (ids, descriptions, locations.* — scaffolding that used to be silently dropped).
    if (!unit || roleOf(p) === "support") {
      if (!supportPaths.includes(p)) supportPaths.push(p);
      continue;
    }
    if (!unitMap.has(unit)) unitMap.set(unit, { paths: new Set() });
    unitMap.get(unit).paths.add(p);
  }

  // ---- 2. fallback: nothing to test → promote the support fields ------------
  let promoted = false;
  if (!unitMap.size && supportPaths.length) {
    promoted = true;
    for (const p of supportPaths) {
      const unit = unitOf(p) || p; // scaffolding with no unit becomes its own subject
      if (!unitMap.has(unit)) unitMap.set(unit, { paths: new Set() });
      unitMap.get(unit).paths.add(p);
    }
    supportPaths.length = 0;
  }

  // ---- 3. per-unit weight + cap --------------------------------------------
  const floors = cc.counts || {};
  const units = [...unitMap.entries()].map(([unit, info]) => {
    const paths = [...info.paths];
    const ob = obligationsForUnit(paths);
    // enum fields under this unit want one positive case per allowed value
    const enumCases = Object.entries(enumSel)
      .filter(([p]) => p === unit || p.startsWith(unit + "."))
      .reduce((s, [, v]) => s + v.length, 0);
    // shallow enrichment (no authored aspects) still deserves a minimum
    const pos = Math.max(wantPos ? ob.pos : 0, wantPos ? enumCases : 0, ob.pos ? 0 : (wantPos ? (floors.positive || 0) : 0));
    const neg = Math.max(wantNeg ? ob.neg : 0, ob.neg ? 0 : (wantNeg ? (floors.negative || 0) : 0));
    const cap = pos + neg;
    return { unit, paths, ob: { pos, neg, interaction: ob.interaction }, weight: cap, cap };
  }).sort((a, b) => b.weight - a.weight || a.unit.localeCompare(b.unit));

  // ---- 4. size positive and negative budgets to capacity --------------------
  // Total available aspects = sum of per-unit obligations
  const posCapacity = units.reduce((s, u) => s + u.ob.pos, 0);
  const negCapacity = units.reduce((s, u) => s + u.ob.neg, 0);
  const capacity = posCapacity + negCapacity;

  // Apply the global 90/10 split, capped by what the knowledge actually supports
  const ratioCfg = cfg.ratio || {};
  const posShare = ratioCfg.positiveShare !== undefined ? ratioCfg.positiveShare : 0.9;
  const comboShare = ratioCfg.combinationShare !== undefined ? ratioCfg.combinationShare : 0.15;

  // Size the suite ONCE, then derive both halves from it, so the 90/10 ratio always holds.
  // Capping the halves independently would let the negative half keep filling after positive
  // aspects run out, silently skewing the suite away from the configured ratio.
  // When only one test type is selected that type takes the whole suite and the ratio does not
  // apply — otherwise the unselected half's capacity would shrink the suite to nothing.
  let posEffective, negEffective;
  if (wantPos && wantNeg) {
    const negShare = 1 - posShare;
    const byPos = posShare > 0 ? Math.floor(posCapacity / posShare) : Infinity;
    const byNeg = negShare > 0 ? Math.floor(negCapacity / negShare) : Infinity;
    const sized = Math.max(0, Math.min(total, byPos, byNeg));
    posEffective = Math.min(Math.round(sized * posShare), posCapacity);
    negEffective = Math.min(sized - Math.round(sized * posShare), negCapacity);
  } else {
    posEffective = wantPos ? Math.min(total, posCapacity) : 0;
    negEffective = wantNeg ? Math.min(total, negCapacity) : 0;
  }
  const effective = posEffective + negEffective;
  const overflow = Math.max(0, total - effective);

  // ---- 5. reserve combination cases from the positive budget ----------------
  // Combination cases are funded from INSIDE the positive share, not as a separate reserve
  // Sized off the ACTUAL suite, not the requested ceiling — otherwise a large N lets combination
  // cases consume the whole positive half and starve per-feature coverage.
  const pairCap = units.length > 1 ? Math.floor(units.length * (units.length - 1) / 2) : 0;
  const comboTarget = Math.floor(effective * comboShare);
  const comboCases = wantPos && units.length > 1 ? Math.min(comboTarget, pairCap, posEffective) : 0;
  const posPerFeature = posEffective - comboCases;
  const negPerFeature = negEffective;

  // ---- 6. distribute per-feature budgets proportionally ---------------------
  // Positive and negative are allocated separately, each proportional to obligations
  const posWeights = units.map(u => u.ob.pos);
  const negWeights = units.map(u => u.ob.neg);
  const posAlloc = largestRemainder(posWeights, posPerFeature);
  const negAlloc = largestRemainder(negWeights, negPerFeature);

  const perFeature = units.map((u, i) => ({
    unit: u.unit,
    paths: u.paths,
    positive: wantPos ? posAlloc[i] : 0,
    negative: wantNeg ? negAlloc[i] : 0,
    allocated: (wantPos ? posAlloc[i] : 0) + (wantNeg ? negAlloc[i] : 0),
    obligations: u.ob,
    cap: u.cap,
  }));
  const dropped = perFeature.filter((u) => u.allocated === 0).map((u) => u.unit);

  // ---- 7. scale-tier allocation (only for scale-meaningful cases) ----
  // Determine which features are scale-sensitive: interaction obligations OR rules in the curated list
  const scaleSensitiveRuleSet = new Set(cc.scaleSensitiveRules || []);
  const scaleMix = cc.scaleMix || { small: 0.4, medium: 0.4, large: 0.2 };
  const scaleWeights = [scaleMix.small || 0.4, scaleMix.medium || 0.4, scaleMix.large || 0.2];

  // Enhance perFeature with scale-tier breakdown
  for (let i = 0; i < perFeature.length; i++) {
    const u = perFeature[i];
    const isScaleSensitive = u.obligations.interaction > 0 ||
      [...u.paths].some(p => {
        const f = compiledFeatures[p] || {};
        return (f.rules || []).some(r => scaleSensitiveRuleSet.has(r));
      });

    if (isScaleSensitive && u.allocated > 0) {
      // Split this unit's allocated cases across small/medium/large per the mix
      const tierAlloc = largestRemainder(scaleWeights, u.allocated);
      u.scaleTiers = { small: tierAlloc[0], medium: tierAlloc[1], large: tierAlloc[2] };
    } else {
      // Non-scale-sensitive or zero allocation: all cases stay small
      u.scaleTiers = { small: u.allocated };
    }
  }

  // Combination cases are always scale-sensitive (they span multiple subjects)
  let comboTiers = { small: comboCases };
  if (comboCases > 0) {
    const tierAlloc = largestRemainder(scaleWeights, comboCases);
    comboTiers = { small: tierAlloc[0], medium: tierAlloc[1], large: tierAlloc[2] };
  }

  // ---- 8. return the plan ---------------------------------------------------
  const positive = perFeature.reduce((s, u) => s + u.positive, 0) + comboCases;
  const negative = perFeature.reduce((s, u) => s + u.negative, 0);
  return {
    perFeature, combo: comboCases, comboTiers, supportPaths, promoted, dropped,
    positive, negative, total: positive + negative,
    requested: total, capacity, overflow,
    isCombination: units.length > 1,
  };
}

// enum selections shared by prompt + plan: field -> [values]
function collectEnumSelections(features) {
  const enumSel = {}; const plain = [];
  for (const f of features) {
    const eq = f.indexOf("=");
    if (eq > -1) { const p = f.slice(0, eq), v = f.slice(eq + 1); (enumSel[p] = enumSel[p] || []).push(v); }
    else plain.push(f);
  }
  for (const f of plain) {
    if (enumSel[f]) continue;
    const vals = enumValues(nodeAtPath(f) || {});
    if (vals) enumSel[f] = vals;
  }
  return enumSel;
}

// =============================================================================
// 3c. INCREMENTAL / DEDUP  (Phase 2)
// =============================================================================
// Structural fingerprint of a request body — order-independent, value-shape aware.
// Used to detect "the same test" across generations (not byte-identical JSON).
function fingerprintBody(td) {
  if (typeof td === "string") return "line:" + td.replace(/\s+/g, " ").trim().toLowerCase();
  if (!td || typeof td !== "object") return "none";
  const canon = (v) => {
    if (Array.isArray(v)) return v.map(canon).sort().join(",");
    if (v && typeof v === "object") {
      return Object.keys(v).sort().map((k) => k + ":" + canon(v[k])).join("|");
    }
    return String(v);
  };
  // fingerprint = which top-level keys + counts + the set of task shapes, not exact coords
  const parts = [];
  parts.push("keys=" + Object.keys(td).sort().join(","));
  parts.push("veh=" + (Array.isArray(td.vehicles) ? td.vehicles.length : 0));
  parts.push("job=" + (Array.isArray(td.jobs) ? td.jobs.length : 0));
  parts.push("shp=" + (Array.isArray(td.shipments) ? td.shipments.length : 0));
  parts.push("loc=" + (Array.isArray(td?.locations?.location) ? td.locations.location.length : 0));
  // shape of the first vehicle/job (field set), and options subtree — captures what's being tested
  if (Array.isArray(td.vehicles) && td.vehicles[0]) parts.push("vshape=" + Object.keys(td.vehicles[0]).sort().join(","));
  if (Array.isArray(td.jobs) && td.jobs[0]) parts.push("jshape=" + Object.keys(td.jobs[0]).sort().join(","));
  if (td.options) parts.push("opt=" + canon(td.options));
  return djb2(parts.join(";"));
}
function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
// identity of a case for dedup: type + feature + body fingerprint
function caseKey(tc) {
  return String(tc.type || "").toLowerCase() + "|" + String(tc.feature || "").toLowerCase() + "|" + fingerprintBody(tc.testData);
}
// highest numeric suffix per category (POS/NEG) so new IDs continue, not collide
function maxIdsByCat(cases) {
  const max = { POS: 0, NEG: 0 };
  for (const tc of cases || []) {
    const m = String(tc.testCaseId || "").match(/TC-RO-(POS|NEG)-(\d+)/i);
    if (m) { const cat = m[1].toUpperCase(); max[cat] = Math.max(max[cat], parseInt(m[2], 10)); }
  }
  return max;
}
// compact digest of an existing suite for the prompt (identify coverage, don't resend full bodies)
function buildDigest(cases) {
  return cases.map((tc) => {
    const feats = Array.isArray(tc.details?.features) ? tc.details.features.join(", ") : "";
    return `- ${tc.testCaseId} [${tc.type}] ${tc.feature}: ${tc.title || ""}` + (feats ? ` (features: ${feats})` : "");
  }).join("\n");
}

// =============================================================================
// 3d. COVERAGE MATRIX  (Phase 3)
// =============================================================================
// Archetype columns = the canonical scenario kinds a feature can be tested for.
const ARCHETYPES = [
  { key: "positive", label: "Positive (valid / at-limit)" },
  { key: "negative", label: "Negative (invalid / infeasible)" },
];
let coverageGaps = []; // [{unit, archetype}] — filled by renderCoverage, fed back into the prompt

// classify a generated case into an archetype (prefer explicit details.archetype, else infer)
function primaryArchetype(tc) {
  const a = String(tc.details?.archetype || "").toLowerCase();
  if (a === "positive" || a === "negative") return a;
  // legacy/fine-grained tags fold into the two canonical kinds
  if (["boundary"].includes(a)) return "positive";
  if (["invalid", "infeasible"].includes(a)) return "negative";
  const type = String(tc.type || "").toLowerCase();
  if (type === "negative") return "negative";
  if (type === "positive") return "positive";
  return "positive";
}

// which units a case exercises (from details.features), collapsed to feature-units
function unitsOfCase(tc) {
  const feats = Array.isArray(tc.details?.features) ? tc.details.features : [];
  const set = new Set();
  for (const f of feats) { const u = unitOf(f); if (u) set.add(u); }
  return [...set];
}

// Build the coverage matrix over a set of cases, seeded by the current plan.
// Rows are TEST SUBJECTS only. Supporting fields are reported separately — they are injected into
// bodies by design, so scoring them as uncovered would permanently depress the percentage.
function buildCoverage(cases, cfg) {
  const units = new Map(); // unit -> {cells:{arch:count}}
  const plan = cfg ? buildPlan(cfg) : null;
  for (const u of plan ? plan.perFeature : []) units.set(u.unit, { cells: {} });
  // also seed from any unit appearing in the cases
  for (const tc of cases) for (const u of unitsOfCase(tc)) if (!units.has(u)) units.set(u, { cells: {} });

  // supporting fields listed by their own path, for the "injected" row group. A support path whose
  // owning unit is already a test subject is skipped — that subject's row already represents it.
  const supportRows = [];
  for (const p of plan ? plan.supportPaths : []) {
    const owner = unitOf(p) || p.split(".")[0];
    if (units.has(owner)) continue;
    if (!supportRows.includes(p)) supportRows.push(p);
  }

  let comboCount = 0;
  for (const tc of cases) {
    const arch = primaryArchetype(tc);
    const us = unitsOfCase(tc);
    if (us.length > 1) comboCount++;
    for (const u of us) {
      if (!units.has(u)) units.set(u, { cells: {} });
      const cell = units.get(u).cells;
      cell[arch] = (cell[arch] || 0) + 1;
    }
  }
  // gaps = a test subject with no case for an archetype the run is producing
  const wantPos = !cfg || cfg.testTypes.includes("Positive");
  const wantNeg = !cfg || cfg.testTypes.includes("Negative");
  const active = { positive: wantPos, negative: wantNeg };
  const gaps = [];
  for (const [unit, info] of units) {
    for (const a of ARCHETYPES) {
      if (active[a.key] && !(info.cells[a.key] > 0)) gaps.push({ unit, archetype: a.key });
    }
  }
  return { units, supportRows, gaps, comboCount, hasCombo: units.size > 1, active };
}

// For the SELECTED features, surface their compiled enrichment (constraints, business/validation rules,
// testing guidance) + any business rules they map to. This is the knowledge that lets Claude author
// correct testData and assertions. Returns "" if no KB is loaded or no selected feature carries enrichment.
function buildEnrichmentBlock(cfg, plan) {
  if (!Object.keys(compiledFeatures).length) return "";
  const list = (arr) => (Array.isArray(arr) ? arr.filter(Boolean) : []);
  const paths = [...new Set(cfg.features.map(basePath))]; // strip enum "=value"; dedupe
  // Supporting fields get their facts (so they can be populated correctly) but NOT their testing
  // guidance — those bullets are case ideas, and handing them over invites cases we said not to write.
  const supportSet = new Set(plan ? plan.supportPaths : []);
  const featBlocks = [];
  const ruleIds = new Set();
  for (const p of paths) {
    const f = compiledFeatures[p];
    if (!f) continue;
    const isSupport = supportSet.has(p);
    list(f.rules).forEach((r) => ruleIds.add(r));
    const parts = [];
    if (f.summary) parts.push(`    ${f.summary}`);
    if (f.range) parts.push(`    Range: ${f.range}`);
    if (list(f.constraints).length)     parts.push(`    Constraints: ${f.constraints.join(" ")}`);
    if (list(f.businessRules).length)   parts.push(`    Business rules: ${f.businessRules.join(" ")}`);
    if (list(f.validationRules).length) parts.push(`    Validation: ${f.validationRules.join(" ")}`);
    if (!isSupport && list(f.testingGuidance).length) parts.push(`    Testing guidance:\n${f.testingGuidance.map((t) => "      - " + t).join("\n")}`);
    if (!parts.length) continue;
    featBlocks.push(`  - ${p}${isSupport ? " (supporting — populate, do not test)" : ""}:\n${parts.join("\n")}`);
  }
  const ruleBlocks = [...ruleIds].map((id) => {
    const r = compiledRules[id];
    if (!r) return null;
    return `  - ${id}: ${r.summary || ""}\n    ${r.rule || ""}` +
      (list(r.testingGuidance).length ? `\n    Testing: ${r.testingGuidance.join(" ")}` : "");
  }).filter(Boolean);

  if (!featBlocks.length && !ruleBlocks.length) return "";
  return `\n\n# Enrichment & rules for the selected features (obey these when building testData and assertions)\n` +
    (featBlocks.length ? `Per-field knowledge:\n${featBlocks.join("\n")}\n` : "") +
    (ruleBlocks.length ? `\nBusiness rules in effect (cross-field invariants — assert these):\n${ruleBlocks.join("\n")}\n` : "");
}

function buildPrompt(cfg) {
  const coords = sampleCoords(Math.min(locations.length, Math.max(cfg.jobs + cfg.vehicles, 8)));
  const coordLines = coords.map((c) => `"${c.lat}, ${c.lon}"  // ${c.city}, ${c.state}`).join("\n");
  const plan = buildPlan(cfg);

  // gather selected enum fields (shared helper): field -> [values]; explicit picks vs whole-field
  const enumSelRaw = collectEnumSelections(cfg.features);
  const explicitPaths = new Set(cfg.features.filter((f) => f.includes("=")).map((f) => f.slice(0, f.indexOf("="))));
  const enumFields = {}; // path -> { vals, explicit }
  for (const [p, vals] of Object.entries(enumSelRaw)) enumFields[p] = { vals, explicit: explicitPaths.has(p) };
  const enumLines = Object.entries(enumFields).map(([p, info]) => {
    const node = nodeAtPath(p) || {};
    const isArray = Array.isArray(node.items && node.items.enum); // array-of-enum vs scalar enum
    const scope = info.explicit ? "use ONLY these values" : "cover each value";
    if (isArray) {
      return `- ${p} (array-of-enum): ${scope} -> ${info.vals.join(" | ")}. ` +
        `Generate one Positive case per value (${p}: [value]) AND one combined Positive case using all of them (${p}: [${info.vals.join(", ")}]).`;
    }
    return `- ${p} (single-value): ${scope} -> ${info.vals.join(" | ")}. ` +
      `One Positive case per value; set ${p} to the value as a single string (values cannot coexist in one request).`;
  });
  const enumBlock = enumLines.length
    ? `\n\n# Enum values for the selected fields (use ONLY these exact values)\n${enumLines.join("\n")}\n` +
      `Do not use any value outside these lists.`
    : "";

  // SUPPORTING FIELDS — selected fields that are context, not subjects. Nothing else in the prompt
  // tells Claude to populate them, so this block is what actually makes them appear in the bodies.
  let supportBlock = "";
  if (plan.supportPaths.length) {
    const lines = plan.supportPaths.map((p) => {
      const f = compiledFeatures[p];
      const bits = [];
      if (f?.summary) bits.push(f.summary);
      if (f?.range) bits.push(`Range: ${f.range}`);
      return `  - ${p}${bits.length ? ": " + bits.join(" ") : ""}`;
    });
    supportBlock =
      `\n\n# SUPPORTING FIELDS (MUST be included in every applicable request — do NOT skip)\n` +
      `These fields were selected as CONTEXT, not as test subjects. INCLUDE them in every generated ` +
      `request body where they apply, with realistic, VARIED values, so the payloads look like ` +
      `production traffic AND reveal API behavior across different input combinations.\n\n` +
      `MANDATORY: Do NOT create a test case whose purpose is to test one of these fields, and ` +
      `do NOT list them alone in "details.features". But DO populate them wherever applicable.\n\n` +
      `VARIATION REQUIREMENT: When the same supporting field appears across multiple cases, use ` +
      `DIFFERENT VALUES in each case. For example:\n` +
      `  - If 3 cases include vehicles.skills, use different skill sets: ["A", "B"] in one, ["C"] in ` +
      `another, ["A", "C", "D"] in a third.\n` +
      `  - If 4 cases include time_window, use different ranges: 08:00–18:00, 14:00–20:00, overnight ` +
      `20:00–06:00, and tight 2-hour window.\n` +
      `  - If 3 cases include priority, use high, medium, low — not the same priority in all three.\n\n` +
      `Field definitions:\n${lines.join("\n")}\n\n` +
      `Applicability: only populate a field on an object the body actually contains (a body has jobs ` +
      `and/or shipments, not necessarily both; shipment pickup/delivery fields belong to their own step ` +
      `objects). Never invent a parent object just to carry a supporting field.`;
  }

  // Deterministic allocation — the planner decided these counts from the compiled coverage
  // obligations. Claude authors within them; it does not choose how many cases a feature gets.
  const scaleTiers = computeScaleTiers(cfg);
  const scaleBlock =
    `\n\n# Scale tiers (use these exact vehicle/job counts per case, per its assigned tier)\n` +
    `- small:  ${scaleTiers.small.vehicles} vehicle${scaleTiers.small.vehicles===1?"":"s"}, ` +
    `${scaleTiers.small.jobs} job${scaleTiers.small.jobs===1?"(s)":"(s)"}\n` +
    `- medium: ${scaleTiers.medium.vehicles} vehicle${scaleTiers.medium.vehicles===1?"":"s"}, ` +
    `${scaleTiers.medium.jobs} job${scaleTiers.medium.jobs===1?"(s)":"(s)"}\n` +
    `- large:  ${scaleTiers.large.vehicles} vehicle${scaleTiers.large.vehicles===1?"":"s"}, ` +
    `${scaleTiers.large.jobs} job${scaleTiers.large.jobs===1?"(s)":"(s)"}`;

  const planLines = plan.perFeature
    .filter((u) => u.allocated > 0)
    .map((u) => {
      const tierBreakdown = u.scaleTiers && Object.keys(u.scaleTiers).length > 1
        ? ` — scale mix: ${u.scaleTiers.small || 0} small${(u.scaleTiers.medium || 0) ? `, ${u.scaleTiers.medium} medium` : ""}${(u.scaleTiers.large || 0) ? `, ${u.scaleTiers.large} large` : ""}`
        : "";
      return `  - ${u.unit}: ${u.allocated} case(s) = ${u.positive} Positive` +
        (u.negative ? ` + ${u.negative} Negative` : "") + tierBreakdown;
    });
  const interactionHint = plan.perFeature.filter((u) => u.obligations.interaction > 0).map((u) => u.unit);
  const comboTierBreakdown = plan.comboTiers && Object.keys(plan.comboTiers).length > 1
    ? ` — scale mix: ${plan.comboTiers.small || 0} small${(plan.comboTiers.medium || 0) ? `, ${plan.comboTiers.medium} medium` : ""}${(plan.comboTiers.large || 0) ? `, ${plan.comboTiers.large} large` : ""}`
    : "";
  const planBlock =
    `\n\n# Test-case allocation (GENERATE EXACTLY THESE — not minimums)\n` +
    `The suite follows a GLOBAL 90% Positive / 10% Negative ratio. Counts below are derived from ` +
    `this ratio and the authored coverage obligations of each feature. Spend each feature's allocation ` +
    `on DISTINCT aspects of that feature — never repeat the same scenario with different numbers.\n` +
    `Per test subject:\n${planLines.join("\n") || "  (no test subjects selected)"}\n` +
    (plan.combo
      ? `Combination scenarios: ${plan.combo} Positive case(s) testing 2+ FEATURES INTERACTING IN THE SAME REQUEST${comboTierBreakdown}. ` +
        `NOT separate cases side-by-side — TRUE combinations where features constrain each other within a single request body. ` +
        `Use different feature mixes in each combination case, and vary their field values (not all same capacities/priorities/skills). ` +
        `Set details.features to the list of combined paths, e.g., ["vehicles.capacity", "jobs.priority"]. ` +
        `These cases are funded from INSIDE the positive share.` +
        (interactionHint.length ? ` Prioritise documented interactions on: ${interactionHint.join(", ")}.` : "") + "\n"
      : "") +
    `TARGET TOTALS -> Positive: ${plan.positive}; Negative: ${plan.negative}; GRAND TOTAL: ${plan.total}.\n` +
    `Generate exactly ${plan.total} case(s). Each case's details.features must list the feature path(s) it exercises.`;

  // incremental mode: if an existing suite is loaded, tell Claude NOT to regenerate it, and continue IDs
  let incrementalBlock = "";
  let idHint = "IDs: TC-RO-POS-###, TC-RO-NEG-###.";
  if (existingSuite && existingSuite.length) {
    const mx = maxIdsByCat(existingSuite);
    incrementalBlock =
      `\n\n# ADD-MORE MODE — an existing suite of ${existingSuite.length} case(s) is attached.\n` +
      `Do NOT regenerate any of these. Produce ONLY NEW cases that cover gaps / scenarios not already present below.\n` +
      `A new case is a duplicate if it has the same type + feature + essentially the same request body shape as one below — avoid those.\n` +
      `Already generated:\n${buildDigest(existingSuite)}\n` +
      `Continue IDs from the highest existing number per category: next Positive = TC-RO-POS-${String(mx.POS + 1).padStart(3, "0")}, ` +
      `next Negative = TC-RO-NEG-${String(mx.NEG + 1).padStart(3, "0")}.`;
    idHint = `IDs must CONTINUE from existing: Positive from TC-RO-POS-${String(mx.POS + 1).padStart(3, "0")}, ` +
      `Negative from TC-RO-NEG-${String(mx.NEG + 1).padStart(3, "0")} (never reuse an existing ID).`;
  }

  // coverage gaps → priority instructions. Only meaningful in INCREMENTAL mode (an existing
  // suite is loaded so partial coverage exists). On a fresh run every cell is empty, which just
  // restates the count plan — so we suppress it there to avoid noise.
  let gapBlock = "";
  if (existingSuite && existingSuite.length && coverageGaps && coverageGaps.length) {
    const byUnit = {};
    for (const g of coverageGaps) (byUnit[g.unit] = byUnit[g.unit] || []).push(g.archetype);
    const lines = Object.entries(byUnit).map(([u, arr]) => `  - ${u}: ${[...new Set(arr)].join(", ")}`);
    gapBlock =
      `\n\n# PRIORITY COVERAGE GAPS (target these first)\n` +
      `Relative to the attached existing suite, these feature × scenario-kind cells are NOT yet covered. Prioritise NEW cases that fill them:\n` +
      `${lines.join("\n")}\n` +
      `Archetype meaning: positive = valid request (nominal or at-limit); negative = invalid → 4xx OR valid-but-unsatisfiable → 200 + result.unassigned / 422. Also tag each case with "details.archetype" = one of positive|negative.`;
  }

  // draft-feature block: for any SELECTED feature that belongs to a draft overlay feature, teach Claude
  // its fields + rules + testing suggestions (these are NOT in openapi.json yet).
  let draftBlock = "";
  const selectedDraftRoots = new Set(
    cfg.features.map(basePath).filter((f) => draftPaths.has(f))
      .map((f) => { // map a draft path back to its feature root (e.g. jobs.split.can_be_split -> jobs.split)
        for (const feat of overlay) {
          const prefix = String(feat.target).replace(/\.items\.properties$|\.properties$/, "");
          for (const name of Object.keys(feat.fields || {})) {
            const root = prefix + "." + name;
            if (f === root || f.startsWith(root + ".")) return feat.id;
          }
        }
        return null;
      }).filter(Boolean)
  );
  if (selectedDraftRoots.size) {
    const blocks = overlay.filter((feat) => selectedDraftRoots.has(feat.id)).map((feat) => {
      const prefix = String(feat.target).replace(/\.items\.properties$|\.properties$/, "");
      const fieldLines = [];
      const describe = (path, def) => {
        fieldLines.push(`    - ${path} (${def.type}): ${stripTicks(def.description || "")}`);
        const kids = def.type === "object" && def.properties ? def.properties : null;
        if (kids) for (const [k, v] of Object.entries(kids)) describe(path + "." + k, v);
      };
      for (const [name, def] of Object.entries(feat.fields || {})) describe(prefix + "." + name, def);
      return `- ${feat.title || feat.id} (source: ${feat.source || "PDF"}):\n` +
        `  Fields:\n${fieldLines.join("\n")}\n` +
        (feat.rules?.length ? `  Rules:\n${feat.rules.map((r) => "    - " + r).join("\n")}\n` : "") +
        (feat.testingSuggestions?.length ? `  Testing suggestions:\n${feat.testingSuggestions.map((r) => "    - " + r).join("\n")}\n` : "") +
        (feat.limitations?.length ? `  Limitations: ${feat.limitations.join("; ")}\n` : "");
    });
    draftBlock =
      `\n\n# DRAFT FEATURES (NOT yet in openapi.json — distilled from a spec doc)\n` +
      `Treat these as REAL request fields when building testData (they are valid for this generation). Follow their rules for assertions. Tag each case that uses them with "details.draft": true.\n` +
      `${blocks.join("\n")}`;
  }

  // compiled enrichment + business rules for the selected features (from data/compiled/, via compile.mjs)
  const enrichBlock = buildEnrichmentBlock(cfg, plan);

  // The AUTHORING LAYER (skills/) owns role + reasoning + output contract. If it could not be
  // fetched, fall back to a minimal inline contract so the prompt is still self-sufficient.
  const authoring = skillBlock || FALLBACK_CONTRACT;

  return `${authoring}

# ==== GENERATION INPUTS (authoritative knowledge — obey; do not supplement from memory) ====

# API facts
- Auth: "key" QUERY PARAMETER (not a Bearer header).
- Flow: asynchronous submit -> poll. Success = HTTP 200 + status:"Ok" + result.code == 0.
- Coordinates: "latitude, longitude" STRINGS inside locations.location, referenced by integer location_index (0-based, in range).
- API error codes: 200 success; 400 input validation failed; 401 key missing/invalid; 403 no access;
  404 host/path not found; 413 request too large; 422 whole request unsolvable; 429 too many requests; 500 internal error.
- Three negative channels: malformed/unauthorized/oversized -> 4xx at submit;
  an individually infeasible task -> 200 + task in result.unassigned with a reason; a wholly unsolvable request -> 422.

# Scenario (from the UI)
${JSON.stringify({
  region: cfg.region,
  vehicles: cfg.vehicles,
  jobs: cfg.jobs,
  testTypes: cfg.testTypes,
  testSubjects: plan.perFeature.filter((u) => u.allocated > 0).map((u) => u.unit),
  supportingFields: plan.supportPaths,
  totalTestCases: plan.total,
}, null, 2)}

# Coordinates to use (from the ${cfg.region} pool — use these as locations.location values)
${coordLines}
${enumBlock}
${scaleBlock}
${draftBlock}
${supportBlock}
${enrichBlock}
${planBlock}
${incrementalBlock}
${gapBlock}

# Generation task (this run)
- Test ONLY the test subjects listed above. Build realistic vehicles (${cfg.vehicles}) and jobs (${cfg.jobs}) using the coordinates.
- Populate the supporting fields in every applicable body, but never make one the subject of a case.
- Produce only the categories matching the selected testTypes: ${cfg.testTypes.join(", ")}.
- Follow the allocation above EXACTLY (generate the stated totals, not fewer, not more).
- ${idHint}
Emit strictly per the output contract above. Return the JSON array only.`;
}

// Minimal inline contract used ONLY when skills/ could not be fetched (keeps the prompt valid).
// The canonical, richer version lives in qa-studio/skills/ — edit there, not here.
const FALLBACK_CONTRACT = `You are a Senior QA Lead authoring NextBillion.ai Route Optimization test cases.
Treat the GENERATION INPUTS below as your sole source of product truth; never add facts from memory.
Assert invariants only — never predict the solver's routes, ETAs, distances, or ordering.
Return ONLY a JSON array (no prose, no fences). Each element has exactly:
{ "testCaseId":"TC-RO-POS-001", "feature":"...", "title":"...", "description":"...",
  "testData":{ /* full request body object, or a request-line string for a no-body case */ },
  "details":{ "features":["vehicles.capacity"], "archetype":"positive" },
  "expectedResult":"200; result.code==0; ...", "priority":"P2", "type":"Positive" }
- testCaseId: TC-RO-POS-### (Positive) or TC-RO-NEG-### (Negative), unique.
- details.features: the selected paths this case exercises (no counts — the tool derives those).
- details.archetype: positive | negative. type: Positive | Negative.
- testData: complete valid body for Positive; the exact malformed OR infeasible body for Negative
  (change exactly one thing); every location_index resolvable within its own locations.location.`;

// =============================================================================
// 4. VALIDATION  (AJV against a sanitized copy of the request schema + business rules)
// =============================================================================
// The spec's enum values are documentation artifacts (backtick-wrapped, e.g. "`duration`"),
// so we DROP enum/format/example keywords for validation and keep structure/types/required/
// additionalProperties — the checks that actually catch defects. Enum values are still told to
// Claude in the prompt.
function sanitize(node) {
  if (Array.isArray(node)) return node.map(sanitize);
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (["enum", "x-enum-options", "examples", "example", "default", "format", "$schema"].includes(k)) continue;
      out[k] = sanitize(v);
    }
    return out;
  }
  return node;
}

function compileValidator() {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  validateFn = ajv.compile(sanitize(requestSchema));
}

// business rules AJV can't express from this spec
function businessRules(body) {
  const errs = [];
  if (!body || typeof body !== "object") return ["testData is not a JSON object"];
  const locs = body?.locations?.location;
  if (!Array.isArray(locs)) {
    errs.push("locations.location missing or not an array");
  } else {
    const n = locs.length;
    const check = (idx, where) => {
      if (typeof idx === "number" && (idx < 0 || idx >= n))
        errs.push(`${where} location_index ${idx} out of range [0, ${n})`);
    };
    (body.vehicles || []).forEach((v, i) => { check(v.start_index, `vehicles[${i}].start_index`); check(v.end_index, `vehicles[${i}].end_index`); });
    (body.jobs || []).forEach((j, i) => check(j.location_index, `jobs[${i}].location_index`));
    (body.shipments || []).forEach((s, i) => { check(s?.pickup?.location_index, `shipments[${i}].pickup`); check(s?.delivery?.location_index, `shipments[${i}].delivery`); });
  }
  if (!Array.isArray(body.vehicles) || body.vehicles.length === 0) errs.push("vehicles missing/empty");
  const hasJobs = Array.isArray(body.jobs) && body.jobs.length;
  const hasShip = Array.isArray(body.shipments) && body.shipments.length;
  if (!hasJobs && !hasShip) errs.push("at least one of jobs / shipments is required");
  return errs;
}

function validateOne(tc) {
  const td = tc.testData;
  if (typeof td === "string") return { kind: "no-body", errors: [] }; // e.g. GET /result line
  const schemaOk = validateFn(td);
  const schemaErrs = schemaOk ? [] : (validateFn.errors || []).map((e) => `${e.instancePath || "(root)"} ${e.message}`);
  const bizErrs = businessRules(td);
  return { kind: "body", errors: [...schemaErrs, ...bizErrs] };
}

// =============================================================================
// 5. RENDER
// =============================================================================
// which draft feature paths a case's testData/details reference (for the "draft" note)
function draftFieldsUsed(tc) {
  if (!draftPaths.size) return [];
  const feats = Array.isArray(tc.details?.features) ? tc.details.features : [];
  const hit = new Set(feats.filter((f) => draftPaths.has(f)));
  // also scan the body for draft leaf keys (e.g. a "split" object on jobs)
  const td = tc.testData;
  if (td && typeof td === "object") {
    for (const p of draftPaths) {
      const leaf = p.split(".").slice(-1)[0];
      const top = p.split(".")[0];
      const arr = td[top];
      if (Array.isArray(arr) && arr.some((o) => o && typeof o === "object" && leaf in o)) hit.add(p);
    }
  }
  return [...hit];
}

function badge(tc, res) {
  const isNeg = String(tc.type).toLowerCase() === "negative";
  if (res.kind === "no-body") return '<span class="text-slate-500">n/a (no body)</span>';
  if (res.errors.length === 0)
    return isNeg
      ? '<span class="text-slate-600" title="valid body — an infeasible-type negative (200 + unassigned)">✔ valid (infeasible-type)</span>'
      : '<span class="text-green-600">✅ valid</span>';
  // has schema/business errors
  return isNeg
    ? '<span class="text-amber-600" title="' + esc(res.errors.join("; ")) + '">⚠ invalid (intended for a malformed negative)</span>'
    : '<span class="text-red-600" title="' + esc(res.errors.join("; ")) + '">❌ invalid</span>';
}

// render each numbered step on its own line
// Details cell: counts computed from testData (reliable) + features from the model
function detailsHtml(tc) {
  const td = tc.testData;
  let locN = 0, jobN = 0, vehN = 0, shipN = 0;
  if (td && typeof td === "object") {
    locN = Array.isArray(td?.locations?.location) ? td.locations.location.length : 0;
    jobN = Array.isArray(td.jobs) ? td.jobs.length : 0;
    vehN = Array.isArray(td.vehicles) ? td.vehicles.length : 0;
    shipN = Array.isArray(td.shipments) ? td.shipments.length : 0;
  }
  const feats = Array.isArray(tc.details?.features) ? tc.details.features
    : Array.isArray(tc.features) ? tc.features : [];
  const rows = [
    "Locations used: <b>" + locN + "</b>",
    "Vehicles used: <b>" + vehN + "</b>",
    "Jobs used: <b>" + jobN + "</b>",
  ];
  if (shipN) rows.push("Shipments used: <b>" + shipN + "</b>");
  let html = rows.join("<br>");
  html += '<div class="mt-1 text-slate-500">Features:</div>';
  html += feats.length
    ? '<ul class="list-disc ml-4">' + feats.map((f) => "<li>" + esc(String(f)) + "</li>").join("") + "</ul>"
    : '<span class="text-slate-400">—</span>';
  return html;
}

function render(cases) {
  const results = $("results");
  results.innerHTML = "";

  let bad = 0;
  const cols = ["Test Case ID", "Feature", "Title", "Description", "Test Data", "Details", "Expected Result", "Priority", "Type", "Validation"];
  const table = el("table", "w-full text-xs border-collapse");
  const thead = el("thead", "bg-slate-100");
  const htr = el("tr");
  cols.forEach((c) => htr.appendChild(el("th", "border px-2 py-1 text-left align-top", c)));
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = el("tbody");
  // dedup: keys from the loaded existing suite + keys seen within this batch
  const existingKeys = new Set((existingSuite || []).map(caseKey));
  const seenKeys = new Set();
  let dupCount = 0;
  lastRendered = []; // rebuild the CSV source alongside the table
  cases.forEach((tc) => {
    const res = validateOne(tc);
    lastRendered.push({ tc, res });
    const isNeg = String(tc.type).toLowerCase() === "negative";
    if (!isNeg && res.kind === "body" && res.errors.length) bad++;

    // duplicate check (only meaningful in add-more mode or within-batch repeats)
    const key = caseKey(tc);
    let dupNote = "";
    if (existingKeys.has(key)) { dupCount++; dupNote = '<div class="mt-1 text-amber-600">⚠ DUPLICATE of an existing case (same type + feature + body shape)</div>'; }
    else if (seenKeys.has(key)) { dupCount++; dupNote = '<div class="mt-1 text-amber-600">⚠ DUPLICATE within this batch</div>'; }
    seenKeys.add(key);

    const tr = el("tr", "align-top border-b hover:bg-slate-50");
    const td = tc.testData;
    const tdCell = typeof td === "string" ? esc(td) : "<pre>" + esc(JSON.stringify(td, null, 2)) + "</pre>";

    const cells = [
      esc(tc.testCaseId || ""),
      esc(tc.feature || ""),
      esc(tc.title || ""),
      esc(tc.description || ""),
      tdCell,
      detailsHtml(tc),
      esc(tc.expectedResult || ""),
      esc(tc.priority || ""),
      esc(tc.type || ""),
      badge(tc, res) + dupNote + (draftFieldsUsed(tc).length ? '<div class="mt-1 text-amber-600">⚑ uses draft field(s): ' + esc(draftFieldsUsed(tc).join(", ")) + ' — confirm vs final spec</div>' : "") + (res.errors.length ? '<ul class="mt-1 text-red-500 list-disc ml-4">' + res.errors.map((e) => "<li>" + esc(e) + "</li>").join("") + "</ul>" : ""),
    ];
    cells.forEach((c, i) => {
      const cell = el("td", "border px-2 py-1");
      if (i === 4) {
        // Test Data — half width, own scrollbar so tall JSON doesn't stretch the row
        cell.className += " font-mono align-top";
        cell.innerHTML = '<div class="w-64 max-h-64 overflow-auto">' + c + "</div>";
        tr.appendChild(cell);
        return;
      }
      if (i === 5) cell.className += " align-top min-w-[16rem] leading-5"; // Details
      cell.innerHTML = c;
      tr.appendChild(cell);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  const scroller = el("div", "overflow-x-auto");
  scroller.appendChild(table);
  results.appendChild(scroller);

  $("validate-status").innerHTML =
    cases.length + " cases rendered · " +
    (bad === 0
      ? '<span class="text-green-600">all positive bodies valid against the spec</span>'
      : '<span class="text-red-600">' + bad + " positive body(ies) INVALID — see ❌ rows</span>") +
    (dupCount ? ' · <span class="text-amber-600">' + dupCount + " duplicate(s) flagged</span>" : (existingSuite && existingSuite.length ? ' · <span class="text-green-600">no duplicates vs existing suite</span>' : ""));

  // coverage matrix over existing ∪ rendered
  renderCoverage([...(existingSuite || []), ...cases]);

  // enable the CSV export now that there are rendered rows
  const dl = $("download-csv");
  if (dl) dl.disabled = lastRendered.length === 0;
}

// ---- CSV export -------------------------------------------------------------
// Plain-text (non-HTML) versions of the two computed columns, so the CSV matches
// what the table shows without carrying markup.
function detailsText(tc) {
  const td = tc.testData;
  let locN = 0, jobN = 0, vehN = 0, shipN = 0;
  if (td && typeof td === "object") {
    locN = Array.isArray(td?.locations?.location) ? td.locations.location.length : 0;
    jobN = Array.isArray(td.jobs) ? td.jobs.length : 0;
    vehN = Array.isArray(td.vehicles) ? td.vehicles.length : 0;
    shipN = Array.isArray(td.shipments) ? td.shipments.length : 0;
  }
  const feats = Array.isArray(tc.details?.features) ? tc.details.features
    : Array.isArray(tc.features) ? tc.features : [];
  const parts = [`Locations: ${locN}`, `Vehicles: ${vehN}`, `Jobs: ${jobN}`];
  if (shipN) parts.push(`Shipments: ${shipN}`);
  parts.push(`Features: ${feats.length ? feats.join(", ") : "—"}`);
  return parts.join("; ");
}

// A short validation verdict + any error detail, mirroring the on-screen badge.
function validationText(tc, res) {
  const isNeg = String(tc.type).toLowerCase() === "negative";
  let verdict;
  if (res.kind === "no-body") verdict = "n/a (no body)";
  else if (res.errors.length === 0) verdict = isNeg ? "valid (infeasible-type)" : "valid";
  else verdict = isNeg ? "invalid (intended)" : "invalid";
  return res.errors.length ? `${verdict}: ${res.errors.join("; ")}` : verdict;
}

// RFC-4180 field quoting: wrap in quotes and double any embedded quotes.
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

function buildCsv(rows) {
  const header = ["Test Case ID", "Feature", "Title", "Description", "Test Data", "Details", "Expected Result", "Priority", "Type", "Validation"];
  const lines = [header.map(csvCell).join(",")];
  for (const { tc, res } of rows) {
    const td = tc.testData;
    const testData = typeof td === "string" ? td : JSON.stringify(td);
    lines.push([
      tc.testCaseId || "",
      tc.feature || "",
      tc.title || "",
      tc.description || "",
      testData,
      detailsText(tc),
      tc.expectedResult || "",
      tc.priority || "",
      tc.type || "",
      validationText(tc, res),
    ].map(csvCell).join(","));
  }
  // BOM so Excel opens UTF-8 correctly; CRLF line endings per the CSV spec.
  return "﻿" + lines.join("\r\n");
}

function downloadCsv() {
  if (!lastRendered.length) return;
  const csv = buildCsv(lastRendered);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  // deterministic-ish name from the current scenario (no Date.now — matches app style)
  const cfg = collectConfig();
  a.href = url;
  a.download = `testcases_${cfg.region || "suite"}_${cfg.vehicles}v${cfg.jobs}j_${lastRendered.length}cases.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// coverage matrix: test subjects (rows) × archetypes (cols); filled counts, gaps highlighted.
// Supporting fields get their own neutral group below the table — they are injected into bodies by
// design, so they are never scored as gaps and never counted in the percentage.
function renderCoverage(cases, cfg = collectConfig()) {
  const box = $("coverage");
  if (!box) return;
  const cov = buildCoverage(cases || [], cfg);
  coverageGaps = cov.gaps; // fed back into the prompt as priority gaps
  if (!cov.units.size && !cov.supportRows.length) { box.innerHTML = '<span class="text-slate-400">Select features (or load a suite) to see coverage.</span>'; return; }

  let filledCells = 0, applicableCells = 0;

  const head = "<tr><th class='border px-2 py-1 text-left'>Test subject</th>" +
    ARCHETYPES.map((a) => `<th class='border px-2 py-1 text-center' title='${a.label}'>${a.label}</th>`).join("") +
    "<th class='border px-2 py-1 text-center'>Row</th></tr>";

  const rows = [...cov.units.entries()].map(([unit, info]) => {
    let rowFilled = 0, rowApp = 0;
    const tds = ARCHETYPES.map((a) => {
      if (!cov.active[a.key]) return "<td class='border px-2 py-1 text-center text-slate-300' title='this test type is not selected'>—</td>";
      rowApp++; applicableCells++;
      const n = info.cells[a.key] || 0;
      if (n > 0) { rowFilled++; filledCells++; return `<td class='border px-2 py-1 text-center bg-green-50 text-green-700'>✓ ${n}</td>`; }
      return "<td class='border px-2 py-1 text-center bg-red-50 text-red-600' title='gap'>gap</td>";
    }).join("");
    return `<tr><td class='border px-2 py-1 font-medium'>${esc(unit)}</td>${tds}<td class='border px-2 py-1 text-center'>${rowFilled}/${rowApp}</td></tr>`;
  }).join("");

  // supporting fields: shown for transparency, explicitly not scored
  const supportRowsHtml = cov.supportRows.map((p) =>
    `<tr class='bg-slate-50 text-slate-500'><td class='border px-2 py-1 font-medium'>${esc(p)}</td>` +
    `<td class='border px-2 py-1 text-center text-[11px]' colspan='${ARCHETYPES.length + 1}'>` +
    `support — injected into request bodies, not scored</td></tr>`
  ).join("");

  const pct = applicableCells ? Math.round((filledCells / applicableCells) * 100) : 0;
  const comboNote = cov.hasCombo
    ? ` · Combination: ${cov.comboCount > 0 ? '<span class="text-green-700">✓ ' + cov.comboCount + " combined case(s)</span>" : '<span class="text-red-600">gap — no combined-feature case</span>'}`
    : "";
  const gapList = cov.gaps.length
    ? '<div class="mt-2"><b>' + cov.gaps.length + ' gap(s):</b> ' +
      cov.gaps.slice(0, 20).map((g) => `<span class="inline-block bg-red-50 text-red-600 rounded px-1 mr-1 mb-1">${esc(g.unit)} · ${g.archetype}</span>`).join("") +
      (cov.gaps.length > 20 ? " …" : "") + "</div>"
    : '<div class="mt-2 text-green-700">No gaps — every test subject is covered for the selected test types.</div>';

  box.innerHTML =
    `<div class="mb-2 text-sm"><b>Coverage: ${pct}%</b> (${filledCells}/${applicableCells} applicable cells filled)${comboNote}</div>` +
    `<div class="overflow-x-auto"><table class="text-xs border-collapse"><thead class="bg-slate-100">${head}</thead><tbody>${rows}${supportRowsHtml}</tbody></table></div>` +
    gapList +
    '<div class="mt-1 text-[11px] text-slate-400">Rows are test subjects; “—” = that test type is not selected. Supporting fields are listed but never scored. Gaps feed into the next prompt as priorities.</div>';
}

// =============================================================================
// WIRING
// =============================================================================
async function init() {
  // region dropdown
  const sel = $("region");
  REGIONS.forEach((r) => sel.appendChild(new Option(r, r)));
  sel.addEventListener("change", () => loadRegion(sel.value));

  await loadSpec();
  await loadOverlay();
  await loadKnowledge();
  await loadSkill();
  await loadRegion(sel.value);
  compileValidator();

  $("tree").innerHTML = "";
  $("tree").appendChild(buildTree(requestSchema.properties, "", 0));
  syncRolePills();
  updateFeatureCount();

  $("load-tree").addEventListener("click", () => renderTree());          // reload features, collapsed
  $("refresh-tree").addEventListener("click", () => refreshSpec());       // re-fetch spec + rebuild
  $("expand-all").addEventListener("click", () => setAllTree(true));
  $("collapse-all").addEventListener("click", () => setAllTree(false));
  $("clear-all").addEventListener("click", () => {
    document.querySelectorAll(".feature-cb").forEach((c) => (c.checked = false));
    roleOverrides.clear();
    syncRolePills();
    updateFeatureCount();
    renderPlan();
  });

  // live allocation readout: recompute on the single count, the test types, and vehicle/job counts
  $("total-cases")?.addEventListener("input", renderPlan);
  document.querySelectorAll(".testtype").forEach((c) => c.addEventListener("change", renderPlan));
  ["vehicles", "jobs"].forEach((id) => $(id)?.addEventListener("input", renderPlan));
  renderPlan();

  $("show-prompt").addEventListener("click", () => {
    $("prompt-text").textContent = buildPrompt(collectConfig());
    $("prompt-preview").open = true;
  });

  $("copy-prompt").addEventListener("click", async () => {
    const p = buildPrompt(collectConfig());
    $("prompt-text").textContent = p;
    try {
      await navigator.clipboard.writeText(p);
      $("copy-status").textContent = "Prompt copied ✓ — paste it into Claude.";
    } catch {
      $("prompt-preview").open = true;
      $("copy-status").textContent = "Clipboard blocked — copy from the preview below.";
    }
    setTimeout(() => ($("copy-status").textContent = ""), 4000);
  });

  // ---- maximized prompt modal ------------------------------------------------
  const modal = $("prompt-modal");
  const openModal = () => { $("modal-prompt").textContent = buildPrompt(collectConfig()); modal.classList.remove("hidden"); };
  const closeModal = () => modal.classList.add("hidden");
  $("maximize-prompt").addEventListener("click", openModal);
  $("modal-close").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); }); // click backdrop to close
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  $("modal-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("modal-prompt").textContent); $("modal-copy").textContent = "Copied ✓"; }
    catch { $("modal-copy").textContent = "Copy blocked"; }
    setTimeout(() => ($("modal-copy").textContent = "Copy"), 1500);
  });

  // shared: parse a raw JSON string (from paste OR file) and render.
  function parseAndRender(raw, source) {
    if (!raw || !raw.trim()) {
      $("validate-status").innerHTML = '<span class="text-red-600">No JSON provided.</span>';
      return;
    }
    // strip accidental fenced code markers, then repair raw control chars a copy/paste can inject
    // inside long string values (charCode < 32). Structural whitespace is optional in JSON, so
    // replacing every control char with a space is safe and makes paste robust.
    const noFence = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    const cleaned = Array.from(noFence, (ch) => (ch.charCodeAt(0) < 32 ? " " : ch)).join("").trim();
    let data;
    try {
      data = JSON.parse(cleaned);
    } catch (e) {
      $("validate-status").innerHTML =
        '<span class="text-red-600">Not valid JSON: ' + esc(e.message) + "</span> " +
        '<span class="text-slate-500">' +
        (source === "paste"
          ? "(pasting large JSON from a chat can drop characters — use the .json file loader above instead)"
          : "(that file is not valid JSON)") +
        "</span>";
      return;
    }
    const cases = Array.isArray(data) ? data : data.testCases || data.cases || [data];
    render(cases);
  }

  $("validate").addEventListener("click", () => parseAndRender($("paste").value, "paste"));
  $("download-csv").addEventListener("click", downloadCsv);

  $("file-load").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { $("paste").value = reader.result; parseAndRender(reader.result, "file"); };
    reader.onerror = () => { $("validate-status").innerHTML = '<span class="text-red-600">Could not read file.</span>'; };
    reader.readAsText(file);
  });

  // ---- existing-suite loader (incremental "add more") ------------------------
  function setExistingStatus() {
    const s = $("existing-status");
    if (!existingSuite || !existingSuite.length) { s.textContent = "No existing suite loaded — the prompt generates a fresh suite."; s.className = "text-xs text-slate-500"; return; }
    const mx = maxIdsByCat(existingSuite);
    s.innerHTML = `<b>${existingSuite.length}</b> existing case(s) loaded — prompt will generate only NEW cases (next IDs: POS-${String(mx.POS+1).padStart(3,"0")}, NEG-${String(mx.NEG+1).padStart(3,"0")}).`;
    s.className = "text-xs text-indigo-700";
  }
  const readFileText = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsText(file);
  });
  const casesFromJson = (data) => (Array.isArray(data) ? data : data.testCases || data.cases || []);
  $("existing-load").addEventListener("change", async (e) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (!files.length) return;
    const merged = [];
    const failures = [];
    for (const file of files) {
      try {
        const text = await readFileText(file);
        const cleaned = Array.from(text, (ch) => (ch.charCodeAt(0) < 32 ? " " : ch)).join("");
        merged.push(...casesFromJson(JSON.parse(cleaned)));
      } catch (err) {
        failures.push(`${file.name}: ${err.message}`);
      }
    }
    if (!merged.length && failures.length) {
      existingSuite = null;
      $("existing-status").textContent = "Could not parse: " + failures.join("; ");
      $("existing-status").className = "text-xs text-red-600";
      return;
    }
    existingSuite = merged;
    setExistingStatus();
    if (failures.length) {
      const s = $("existing-status");
      s.innerHTML += ` <span class="text-red-600">(${failures.length} file(s) skipped: ${failures.join("; ")})</span>`;
    }
    renderCoverage(existingSuite || []);
  });
  $("existing-clear").addEventListener("click", () => { existingSuite = null; $("existing-load").value = ""; setExistingStatus(); renderCoverage([]); });
}

init().catch((e) => console.error("QA Studio init failed:", e));
