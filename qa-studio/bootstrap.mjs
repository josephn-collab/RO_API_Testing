#!/usr/bin/env node
// =============================================================================
// Enrichment Bootstrap — Test Authoring Studio (P4)
// =============================================================================
// Scales enrichment from a handful of hand-authored features toward all 213 WITHOUT
// hand-writing every file, while never auto-trusting AI output. Two modes:
//
//   node qa-studio/bootstrap.mjs emit [N] [--out prompt.txt]
//     Picks the N highest-value un-enriched features (graph-connected / important first),
//     embeds each one's spec structure + any legacy Knowledge/*.md hint, and writes a
//     paste-ready Claude prompt asking for enrichment JSON objects. (N default 8.)
//
//   node qa-studio/bootstrap.mjs ingest <pasted.json>
//     Reads the JSON array Claude returned and writes each object to
//     enrichment/<path>.json with status:"proposed" (NEVER embedded until a human
//     removes/flips the status). Refuses to overwrite an already-ratified file.
//
// The compiler already parks status:"proposed" enrichment (see compile.mjs). Ratify a
// draft by reviewing it and deleting its "status" field (or setting it to "ratified").
// =============================================================================
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const COMPILED = join(DIR, "data", "compiled");
const ENRICH_DIR = join(DIR, "enrichment");
const KNOWLEDGE = join(DIR, "..", "Knowledge");

const die = (m) => { console.error("✖ bootstrap: " + m); process.exit(1); };
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));

// ---- load compiled artifacts (bootstrap runs AFTER compile.mjs) --------------
if (!existsSync(join(COMPILED, "features.json"))) die("run `node qa-studio/compile.mjs` first (no compiled layer found).");
const features = readJSON(join(COMPILED, "features.json"));
const graph = existsSync(join(COMPILED, "_graph.json")) ? readJSON(join(COMPILED, "_graph.json")) : { nodes: {}, edges: [] };
const drift = existsSync(join(COMPILED, "drift-report.json")) ? readJSON(join(COMPILED, "drift-report.json")) : { unEnriched: [] };

// ---- shared: legacy .md hint for a feature (best-effort, optional) -----------
// Pull the first sentence that mentions the leaf field name from a couple of legacy docs, so the
// prompt seeds Claude with any human knowledge that already exists. Purely advisory.
const LEGACY_DOCS = [
  "Product Knowledge/RouteOptimizationOverview.md",
  "Product Knowledge/OptimizationConstraints.md",
  "RouteOptimizationKnowledge.md",
];
function legacyHint(path) {
  const leaf = path.split(".").pop();
  for (const rel of LEGACY_DOCS) {
    const fp = join(KNOWLEDGE, rel);
    if (!existsSync(fp)) continue;
    const text = readFileSync(fp, "utf8");
    // table row or prose line that references `leaf` in backticks
    for (const line of text.split("\n")) {
      if (line.includes("`" + leaf + "`") && /[a-z]{4,}/i.test(line)) {
        return line.replace(/\|/g, " ").replace(/\s+/g, " ").replace(/`/g, "").trim().slice(0, 240);
      }
    }
  }
  return "";
}

// ---- feature priority: graph-connected first, then non-structural leaves -----
const degree = {};
for (const e of graph.edges || []) { degree[e.from] = (degree[e.from] || 0) + 1; degree[e.to] = (degree[e.to] || 0) + 1; }
for (const r of Object.values(graph.rules || {})) for (const p of r.applies_to || []) degree[p] = (degree[p] || 0) + 1;
const STRUCTURAL_LEAF = /(^|\.)(id|description)$/;
function priority(path) {
  const f = features[path] || {};
  let score = 0;
  if (degree[path]) score += 100 + degree[path];               // already referenced by an edge/rule
  if (!STRUCTURAL_LEAF.test(path)) score += 10;                // real testable field, not id/description
  if (f.enum) score += 5;                                      // enums are high-value to enrich
  if (/capacity|amount|priority|time_window|skill|max_|zone|load|constraint|routing|objective/.test(path)) score += 8;
  return score;
}

// =============================================================================
// MODE: emit
// =============================================================================
function emit(n, outFile) {
  const candidates = (drift.unEnriched || [])
    .filter((p) => !STRUCTURAL_LEAF.test(p))                   // skip id/description noise
    .sort((a, b) => priority(b) - priority(a) || a.localeCompare(b))
    .slice(0, n);
  if (!candidates.length) die("no un-enriched features to bootstrap (all enriched, or drift-report empty).");

  const featBlocks = candidates.map((p) => {
    const f = features[p];
    const hint = legacyHint(p);
    return `### ${p}\n` +
      `- type: ${f.type}${f.required ? " (required)" : ""}${f.enum ? ` | enum: ${f.enum.join(" | ")}` : ""}\n` +
      `- spec description: ${f.specDescription || "(none)"}\n` +
      (hint ? `- legacy hint (advisory, verify): ${hint}\n` : "");
  }).join("\n");

  const schema = `{
  "path": "<the exact feature path, copied from the heading>",
  "summary": "<one-sentence what-it-is + why it matters for testing>",
  "range": "<allowed values / numeric range / default — from the spec description or your domain knowledge; say 'no fixed bound in spec' if unknown>",
  "constraints": ["<hard input constraints, e.g. non-negative integer>"],
  "businessRules": ["<cross-field or behavioral rules, e.g. must be superset of task skills>"],
  "validationRules": ["<what makes it invalid and the resulting HTTP status, e.g. out of range -> 400>"],
  "testingGuidance": ["<concrete boundary / positive / infeasible test ideas>"],
  "related": ["<other feature paths this interacts with, if any>"],
  "status": "proposed"
}`;

  const prompt = `You are a Senior QA domain expert for the NextBillion.ai Route Optimization API.
For EACH feature below, write an enrichment object capturing the behavior a test author needs that is
NOT already in the OpenAPI structure (ranges, cross-field invariants, infeasibility semantics, boundary
ideas). Base it on the spec description + your route-optimization knowledge. Do NOT invent fields.

Return ONLY a JSON array, one object per feature, each matching EXACTLY this schema (keep "status":"proposed"):
${schema}

Rules:
- "path" MUST be copied verbatim from the "### <path>" heading.
- Prefer precise, testable statements over generic prose. Empty arrays are fine if nothing applies.
- "related" must reference real feature paths (same dotted style). Omit if none.

# FEATURES TO ENRICH
${featBlocks}
Return the JSON array only.`;

  if (outFile) { writeFileSync(outFile, prompt); console.log(`✓ wrote bootstrap prompt for ${candidates.length} feature(s) → ${outFile}`); }
  else { console.log(prompt); }
  console.error(`\n[bootstrap] features: ${candidates.join(", ")}`);
  console.error(`[bootstrap] next: run this prompt in Claude, save the JSON array, then: node qa-studio/bootstrap.mjs ingest <file.json>`);
}

// =============================================================================
// MODE: ingest
// =============================================================================
function ingest(file) {
  if (!file || !existsSync(file)) die("ingest needs a path to the pasted JSON array file.");
  let raw = readFileSync(file, "utf8").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let arr;
  try { arr = JSON.parse(raw); } catch (e) { die("not valid JSON: " + e.message); }
  if (!Array.isArray(arr)) arr = arr.testCases || arr.cases || [arr];

  mkdirSync(ENRICH_DIR, { recursive: true });
  const existing = new Set(readdirSync(ENRICH_DIR).filter((f) => f.endsWith(".json")));
  let written = 0, skipped = 0;
  for (const obj of arr) {
    if (!obj || !obj.path) { console.error(`  ⚠ skipped an object with no "path"`); skipped++; continue; }
    if (!features[obj.path]) { console.error(`  ⚠ skipped "${obj.path}" — not a known feature path`); skipped++; continue; }
    const fname = obj.path + ".json";
    if (existing.has(fname)) {
      // refuse to clobber a ratified (non-proposed) file
      const prior = readJSON(join(ENRICH_DIR, fname));
      if (prior.status !== "proposed") { console.error(`  ⚠ skipped "${obj.path}" — a RATIFIED enrichment already exists (won't overwrite)`); skipped++; continue; }
    }
    const out = { ...obj, status: "proposed" };                // force proposed regardless of what came back
    writeFileSync(join(ENRICH_DIR, fname), JSON.stringify(out, null, 2) + "\n");
    written++;
  }
  console.log(`✓ ingested ${written} proposed enrichment file(s)${skipped ? `, skipped ${skipped}` : ""}.`);
  console.log(`  review each in enrichment/, then RATIFY by removing its "status" field (or set "ratified").`);
  console.log(`  re-run: node qa-studio/compile.mjs  (proposed drafts stay parked until ratified).`);
}

// =============================================================================
// MODE: ratify — remove status:"proposed" so the compiler embeds the enrichment/rule
// =============================================================================
function ratify(args) {
  const RULES_DIR = join(DIR, "rules");
  const all = args.includes("--all");
  const targets = args.filter((a) => !a.startsWith("--"));
  const clear = (fp, label) => {
    if (!existsSync(fp)) return false;
    const d = readJSON(fp);
    if (d.status !== "proposed") return false;
    delete d.status;
    writeFileSync(fp, JSON.stringify(d, null, 2) + "\n");
    console.log("  ✓ ratified " + label);
    return true;
  };
  let n = 0;
  if (all) {
    for (const f of readdirSync(ENRICH_DIR).filter((x) => x.endsWith(".json"))) if (clear(join(ENRICH_DIR, f), "enrichment/" + f)) n++;
    if (existsSync(RULES_DIR)) for (const f of readdirSync(RULES_DIR).filter((x) => x.endsWith(".json"))) if (clear(join(RULES_DIR, f), "rules/" + f)) n++;
  } else if (targets.length) {
    for (const t of targets) {
      // accept a feature path, an enrichment filename, or a rule id
      const cands = [join(ENRICH_DIR, t.endsWith(".json") ? t : t + ".json"), join(RULES_DIR, t.endsWith(".json") ? t : t + ".json")];
      let hit = false;
      for (const fp of cands) if (clear(fp, fp.replace(DIR + "/", ""))) { hit = true; n++; }
      if (!hit) console.error("  ⚠ no proposed file matched \"" + t + "\"");
    }
  } else { die("ratify needs feature path(s)/rule id(s), or --all."); }
  console.log(`✓ ratified ${n} file(s). Re-run: node qa-studio/compile.mjs`);
}

// ---- dispatch ----------------------------------------------------------------
const [mode, ...rest] = process.argv.slice(2);
if (mode === "emit") {
  const n = parseInt(rest.find((a) => /^\d+$/.test(a)) || "8", 10);
  const oi = rest.indexOf("--out");
  emit(n, oi > -1 ? rest[oi + 1] : null);
} else if (mode === "ingest") {
  ingest(rest.find((a) => !a.startsWith("--")));
} else if (mode === "ratify") {
  ratify(rest);
} else {
  console.log("usage:\n  node qa-studio/bootstrap.mjs emit [N] [--out prompt.txt]\n  node qa-studio/bootstrap.mjs ingest <pasted.json>\n  node qa-studio/bootstrap.mjs ratify <path|ruleId>... | --all");
  process.exit(mode ? 1 : 0);
}
