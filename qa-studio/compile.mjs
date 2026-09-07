#!/usr/bin/env node
// =============================================================================
// Knowledge Compiler — Test Authoring Studio
// =============================================================================
// Reads openapi.json (structure) + enrichment/*.json + rules/*.json (behavior),
// validates every authored path against the spec (HARD-FAIL on dangling paths),
// merges them, and emits a machine-readable compiled knowledge layer + graph:
//
//   data/compiled/features.json      { "<path>": {compiled feature}, ... }  (ALL spec features)
//   data/compiled/_graph.json        { nodes, edges, rules, clusters }
//   data/compiled/_index.json        { featureCount, enrichedPaths, ruleIds, compiledAt }
//   data/compiled/drift-report.json  { orphanedEnrichment, unEnriched, needsReview, ... }
//
// Run: node qa-studio/compile.mjs   (no dependencies; cwd-independent)
//
// Design of record: ~/.claude/plans/curried-wiggling-galaxy.md
// =============================================================================
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const DIR = dirname(fileURLToPath(import.meta.url));           // qa-studio/
const OPT_PATH = "/optimization/v2";
// Paths deliberately OUT OF SCOPE for enrichment: re-optimization/output echoes (solution.*,
// unassigned.*) describe a prior solve's result, not request fields we author test cases for.
// They are excluded from the "un-enriched gap" accounting so coverage reflects in-scope features.
// Also excluded implicitly: structural id/description leaves (never testable features).
const SCOPE_EXCLUDE_PREFIXES = ["solution", "unassigned"];
const inScope = (p) => !/(^|\.)(id|description)$/.test(p) &&
  !SCOPE_EXCLUDE_PREFIXES.some((pre) => p === pre || p.startsWith(pre + "."));
const OUT = join(DIR, "data", "compiled");
const HASH_SNAPSHOT = join(OUT, "_spec-hashes.json");

// CLI flags: --lenient downgrades orphaned-enrichment from hard-fail to a drift entry (spec-update
// workflows where a path was renamed). Proposed enrichment (status:"proposed") is NEVER embedded.
const ARGV = new Set(process.argv.slice(2));
const LENIENT = ARGV.has("--lenient");
const proposedPaths = [];   // enrichment carrying status:"proposed" — parked for human ratification

const die = (msg) => { console.error("✖ compile failed: " + msg); process.exit(1); };
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));
const listJSON = (d) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".json")) : []);

// ---- spec helpers (mirror app.js childrenOf / enumValues / nodeAtPath) -------
const stripTicks = (s) => String(s).replace(/`/g, "").replace(/\\([[\]])/g, "$1");
function childrenOf(node) {
  if (!node || typeof node !== "object") return null;
  if (node.type === "object" && node.properties) return node.properties;
  if (node.type === "array" && node.items && node.items.type === "object" && node.items.properties)
    return node.items.properties;
  return null; // leaf (primitive or array of primitives)
}
function typeOf(node) {
  if (!node || typeof node !== "object") return "unknown";
  if (node.type === "array") {
    const it = node.items || {};
    return it.type === "object" ? "array<object>" : it.type ? `array<${it.type}>` : "array";
  }
  return node.type || (node.properties ? "object" : "unknown");
}
function enumOf(node) {
  const arr = node?.enum || node?.items?.enum;
  if (!Array.isArray(arr)) return null;
  const vals = arr.map(stripTicks).map((v) => v.trim()).filter((v) => v && v !== '""');
  return vals.length ? vals : null;
}
function specDescription(node) {
  if (!node?.description) return "";
  const s = stripTicks(node.description).replace(/\s+/g, " ").trim();
  return s.length > 300 ? s.slice(0, 297) + "…" : s;
}

// ---- coverage obligations ----------------------------------------------------
// Each testingGuidance bullet is one COVERAGE OBLIGATION (a distinct aspect to author a case for).
// Authoring convention — every bullet SHOULD begin with a typed tag so obligations are countable:
//   Positive:                 a valid representative case
//   Boundary:                 valid at-the-limit (counts as a positive obligation)
//   Negative-validation:      malformed/out-of-range input -> 4xx at submit
//   Negative-infeasible:      structurally valid but unsatisfiable -> 200 + result.unassigned, or 422
//   Interaction:              cross-feature behavior (drives combination cases, not per-feature pos/neg)
// Untagged bullets are still classified by a keyword fallback so legacy enrichment keeps working.
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
function computeObligations(f) {
  const g = Array.isArray(f.testingGuidance) ? f.testingGuidance : [];
  const o = { positive: 0, negativeValidation: 0, negativeInfeasible: 0, interaction: 0 };
  for (const it of g) o[classifyGuidance(it)]++;
  o.positiveTotal = o.positive;
  o.negativeTotal = o.negativeValidation + o.negativeInfeasible;
  o.total = o.positiveTotal + o.negativeTotal;
  return o;
}
// Resolve a dotted path in the request schema (mirror of app.js nodeAtPath).
function makeResolver(requestSchema) {
  return (path) => {
    let node = requestSchema;
    for (const seg of path.split(".")) {
      let props = null;
      if (node.type === "object" && node.properties) props = node.properties;
      else if (node.type === "array" && node.items && node.items.properties) props = node.items.properties;
      else if (node.properties) props = node.properties;
      if (!props || !props[seg]) return null;
      node = props[seg];
    }
    return node;
  };
}

// ---- 1. load spec ------------------------------------------------------------
let spec;
try { spec = readJSON(join(DIR, "openapi.json")); }
catch (e) { die("cannot read openapi.json (" + e.message + ")"); }
const requestSchema =
  spec?.paths?.[OPT_PATH]?.post?.requestBody?.content?.["application/json"]?.schema;
if (!requestSchema) die(`request schema not found at paths['${OPT_PATH}'].post.requestBody`);
const resolve = makeResolver(requestSchema);

// ---- 2. enumerate EVERY feature path (mirror app.js buildTree recursion) -----
// Emits a structural record per path; carries the parent's `required[]` so leaf
// required-ness is known.
const features = {};                 // path -> compiled feature (structure first)
const specHash = {};                 // path -> hash of the spec node (drift detection)
function walk(props, parentPath, requiredList) {
  for (const [key, node] of Object.entries(props)) {
    const path = parentPath ? parentPath + "." + key : key;
    features[path] = {
      path,
      type: typeOf(node),
      required: Array.isArray(requiredList) ? requiredList.includes(key) : false,
      enum: enumOf(node),
      specDescription: specDescription(node),
      // enrichment fields (filled in step 4; null/[] until authored)
      summary: null, range: null,
      constraints: [], businessRules: [], validationRules: [], testingGuidance: [],
      related: [], rules: [],
    };
    specHash[path] = createHash("sha1")
      .update(JSON.stringify([typeOf(node), node.enum || node.items?.enum || null, node.description || ""]))
      .digest("hex").slice(0, 12);
    const kids = childrenOf(node);
    if (kids) {
      const childRequired =
        (node.type === "object" ? node.required : node.type === "array" ? node.items?.required : node.required) || [];
      walk(kids, path, childRequired);
    }
  }
}
walk(requestSchema.properties || {}, "", requestSchema.required || []);
const allPaths = new Set(Object.keys(features));

// ---- 3. load enrichment + rules ---------------------------------------------
const ENRICH_DIR = join(DIR, "enrichment");
const RULES_DIR = join(DIR, "rules");
const enrichments = listJSON(ENRICH_DIR).map((f) => ({ file: f, data: readJSON(join(ENRICH_DIR, f)) }));
const rules = listJSON(RULES_DIR).map((f) => ({ file: f, data: readJSON(join(RULES_DIR, f)) }));

// ---- 4. VALIDATE (hard gate) + merge ----------------------------------------
const errors = [];
const warnings = [];
const enrichedPaths = [];

for (const { file, data } of enrichments) {
  if (!data.path) { errors.push(`enrichment/${file}: missing "path"`); continue; }
  if (!resolve(data.path) || !features[data.path]) {
    // path is authored but absent from the spec — an ORPHAN. Hard-fail unless --lenient (spec-update
    // workflow); either way it is recorded in drift.orphanedEnrichment below and never embedded.
    if (!LENIENT) errors.push(`enrichment/${file}: path "${data.path}" does not resolve in the spec (orphan — re-key/delete, or use --lenient)`);
    continue;
  }
  if (data.status === "proposed") { proposedPaths.push(data.path); continue; } // un-ratified draft — not embedded
  // overlay authored behavior onto the structural record
  const f = features[data.path];
  for (const k of ["summary", "range"]) if (data[k] != null) f[k] = data[k];
  for (const k of ["constraints", "businessRules", "validationRules", "testingGuidance", "related", "rules"])
    if (Array.isArray(data[k])) f[k] = data[k];
  // warn (not fail) on related hints that don't resolve
  for (const r of f.related) if (!allPaths.has(r)) warnings.push(`enrichment/${file}: related "${r}" is not a known feature`);
  enrichedPaths.push(data.path);
}

const ruleById = {};
const proposedRules = [];
for (const { file, data } of rules) {
  if (!data.id) { errors.push(`rules/${file}: missing "id"`); continue; }
  if (!Array.isArray(data.applies_to) || !data.applies_to.length) { errors.push(`rules/${file}: missing "applies_to"`); continue; }
  for (const p of data.applies_to)
    if (!resolve(p)) errors.push(`rules/${file}: applies_to "${p}" does not resolve in the spec`);
  if (data.status === "proposed") { proposedRules.push(data.id); continue; } // un-ratified draft — not embedded
  ruleById[data.id] = data;
}
// warn: a feature references a rule id that has no file
for (const p of enrichedPaths)
  for (const rid of features[p].rules || [])
    if (!ruleById[rid]) warnings.push(`enrichment for "${p}": references unknown rule "${rid}"`);
// warn: a rule that no enriched feature references
for (const rid of Object.keys(ruleById)) {
  const referenced = enrichedPaths.some((p) => (features[p].rules || []).includes(rid));
  if (!referenced) warnings.push(`rule "${rid}": not referenced by any enriched feature`);
}

if (errors.length) { errors.forEach((e) => console.error("  ✖ " + e)); die(`${errors.length} validation error(s)`); }

// ---- 4b. compute coverage obligations per feature ---------------------------
for (const p of Object.keys(features)) features[p].obligations = computeObligations(features[p]);

// coverage-lint: in-scope, enriched features that still under-specify their aspects.
//   noNegative     = has positive obligations but no negative/infeasible obligation (can't author its Negative).
//   noPositive     = has no positive obligation at all.
//   emptyValidation= no validationRules authored (structural rejection path undocumented).
const coverageLint = { noNegative: [], noPositive: [], emptyValidation: [] };
for (const p of enrichedPaths) {
  if (!inScope(p)) continue;
  const o = features[p].obligations;
  if (o.positiveTotal > 0 && o.negativeTotal === 0) coverageLint.noNegative.push(p);
  if (o.positiveTotal === 0) coverageLint.noPositive.push(p);
  if (!Array.isArray(features[p].validationRules) || !features[p].validationRules.length) coverageLint.emptyValidation.push(p);
}
coverageLint.noNegative.sort(); coverageLint.noPositive.sort(); coverageLint.emptyValidation.sort();

// cross-field rule lint: detect stale rule references and unbacked related[]
const staleRuleRefs = [];   // enriched paths whose rules[] references an incomplete applies_to[]
const unbackedRelated = [];  // enriched paths with non-empty related[] but empty rules[]
for (const p of enrichedPaths) {
  const f = features[p];
  // stale refs: rule is referenced but doesn't include this path in applies_to
  for (const ruleId of f.rules || []) {
    const rule = ruleById[ruleId];
    if (rule && !rule.applies_to.includes(p)) {
      staleRuleRefs.push(`"${p}" → rule "${ruleId}" (applies_to does not list this path)`);
    }
  }
  // unbacked related: has related[] but no rule[] (relationship identified but not formalized)
  if (Array.isArray(f.related) && f.related.length > 0 && (!f.rules || f.rules.length === 0)) {
    unbackedRelated.push(p);
  }
}
staleRuleRefs.sort(); unbackedRelated.sort();
coverageLint.staleRuleRefs = staleRuleRefs;
coverageLint.unbackedRelated = unbackedRelated;

// ---- 5. assemble the graph ---------------------------------------------------
// nodes = every feature; edges = enrichment `related`; rules = hyperedges.
// clusters = connected components over (edges + rule-member cliques), size >= 2.
const nodes = {};
for (const p of allPaths) nodes[p] = { type: features[p].type, cluster: null };

const edges = [];
const seenEdge = new Set();
for (const p of enrichedPaths) {
  for (const r of features[p].related) {
    if (!allPaths.has(r)) continue;
    const key = [p, r].sort().join("→");
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    edges.push({ from: p, to: r, kind: "relatesTo" });
  }
}

// union-find for clustering
const parent = {};
const find = (x) => (parent[x] === undefined ? (parent[x] = x) : parent[x] === x ? x : (parent[x] = find(parent[x])));
const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
for (const e of edges) { if (allPaths.has(e.from) && allPaths.has(e.to)) union(e.from, e.to); }
for (const r of Object.values(ruleById)) {
  const members = r.applies_to.filter((p) => allPaths.has(p));
  for (let i = 1; i < members.length; i++) union(members[0], members[i]);
}
const groups = {};
for (const p of allPaths) { const root = find(p); (groups[root] = groups[root] || []).push(p); }
const clusters = {};
let ci = 0;
for (const members of Object.values(groups)) {
  if (members.length < 2) continue;                  // singletons are not clusters
  const id = "cluster-" + (++ci);
  clusters[id] = members.sort();
  for (const p of members) nodes[p].cluster = id;
}

const graphRules = {};
for (const [id, r] of Object.entries(ruleById))
  graphRules[id] = {
    applies_to: r.applies_to,
    summary: r.summary || "",
    rule: r.rule || "",
    testingGuidance: Array.isArray(r.testingGuidance) ? r.testingGuidance : [],
  };

// ---- 6. drift report ---------------------------------------------------------
// Compare the current spec-node hashes against the prior snapshot (if any):
//   needsReview  = ENRICHED paths whose underlying spec node changed (type/enum/description) — the
//                  human enrichment may now be stale and should be re-checked.
//   orphaned     = enriched/proposed paths that existed in the snapshot but are GONE from the spec
//                  (renamed/removed). Hard-fail unless --lenient (spec-update workflow).
let priorHashes = {};
if (existsSync(HASH_SNAPSHOT)) { try { priorHashes = readJSON(HASH_SNAPSHOT); } catch { priorHashes = {}; } }
const enrichedOrProposed = new Set([...enrichedPaths, ...proposedPaths]);
const needsReview = [...enrichedOrProposed]
  .filter((p) => priorHashes[p] && priorHashes[p] !== specHash[p])
  .sort();
// authored paths that were known before but no longer resolve in the spec
const authoredAll = enrichments.map((e) => e.data.path).filter(Boolean);
const orphaned = authoredAll.filter((p) => !allPaths.has(p)).sort();
if (orphaned.length && !LENIENT) {
  orphaned.forEach((p) => console.error(`  ✖ orphaned enrichment: "${p}" no longer resolves in the spec (renamed/removed). Re-key or delete it, or re-run with --lenient.`));
  die(`${orphaned.length} orphaned enrichment path(s)`);
}
const drift = {
  compiledAt: new Date().toISOString(),
  specFeatureCount: allPaths.size,
  enrichedCount: enrichedPaths.length,
  proposedCount: proposedPaths.length + proposedRules.length,
  proposed: proposedPaths.slice().sort(),
  proposedRules: proposedRules.slice().sort(),
  orphanedEnrichment: orphaned,
  // gaps that actually matter = in-scope, real (non-structural), not-yet-enriched features
  unEnriched: [...allPaths].filter((p) => !enrichedPaths.includes(p) && inScope(p)).sort(),
  excluded: [...allPaths].filter((p) => !inScope(p) && !/(^|.)(id|description)$/.test(p)).sort(),
  needsReview,
  coverageLint,
  warnings,
};

// ---- 7. emit -----------------------------------------------------------------
mkdirSync(OUT, { recursive: true });
const index = {
  compiledAt: drift.compiledAt,
  featureCount: allPaths.size,
  inScopeCount: [...allPaths].filter(inScope).length,
  excludedCount: drift.excluded.length,
  enrichedPaths: enrichedPaths.sort(),
  ruleIds: Object.keys(ruleById).sort(),
  clusterCount: Object.keys(clusters).length,
};
writeFileSync(join(OUT, "features.json"), JSON.stringify(features, null, 2));
writeFileSync(join(OUT, "_graph.json"), JSON.stringify({ nodes, edges, rules: graphRules, clusters }, null, 2));
writeFileSync(join(OUT, "_index.json"), JSON.stringify(index, null, 2));
writeFileSync(join(OUT, "drift-report.json"), JSON.stringify(drift, null, 2));
writeFileSync(HASH_SNAPSHOT, JSON.stringify(specHash, null, 2));   // snapshot for next compile's drift diff

// ---- 8. report ---------------------------------------------------------------
console.log(`✓ compiled ${allPaths.size} features (${enrichedPaths.length} enriched), ` +
  `${Object.keys(ruleById).length} rules, ${Object.keys(clusters).length} cluster(s).`);
console.log(`  enriched: ${enrichedPaths.join(", ") || "(none)"}`);
if (warnings.length) { console.log(`  ${warnings.length} warning(s):`); warnings.forEach((w) => console.log("    ⚠ " + w)); }
console.log(`  → ${join("data", "compiled")}/ {features,_graph,_index,drift-report}.json`);
const inScopeTotal = [...allPaths].filter(inScope).length;
const inScopeEnriched = enrichedPaths.filter(inScope).length;
console.log(`  in-scope coverage: ${inScopeEnriched}/${inScopeTotal} features enriched ` +
  `(${drift.unEnriched.length} in-scope gap(s); ${drift.excluded.length} excluded by scope: ${SCOPE_EXCLUDE_PREFIXES.join("/")}.*)`);
if (proposedPaths.length) console.log(`  ${proposedPaths.length} proposed enrichment(s) awaiting ratification (see drift-report.json)`);
if (proposedRules.length) console.log(`  ${proposedRules.length} proposed rule(s) awaiting ratification: ${proposedRules.join(", ")}`);
if (needsReview.length) console.log(`  ⚠ ${needsReview.length} enriched path(s) NEED REVIEW (spec node changed): ${needsReview.join(", ")}`);
const clint = coverageLint.noNegative.length + coverageLint.noPositive.length + coverageLint.emptyValidation.length;
if (clint) {
  console.log(`  ⚠ coverage-lint: ${coverageLint.noNegative.length} without a Negative obligation, ` +
    `${coverageLint.noPositive.length} without a Positive obligation, ${coverageLint.emptyValidation.length} with empty validationRules (see drift-report.json → coverageLint)`);
}
// cross-field rule lint summary
{
  const srCount = (coverageLint.staleRuleRefs || []).length;
  const ubCount = (coverageLint.unbackedRelated || []).length;
  if (srCount || ubCount) {
    console.log(`  ⚠ rule-lint: ${srCount} stale rule reference(s), ${ubCount} unbacked related[] relationship(s) (see drift-report.json → coverageLint → staleRuleRefs/unbackedRelated)`);
  }
}
// obligation totals across enriched, in-scope features (visibility into coverage depth)
{
  let tp = 0, tn = 0;
  for (const p of enrichedPaths) if (inScope(p)) { tp += features[p].obligations.positiveTotal; tn += features[p].obligations.negativeTotal; }
  console.log(`  coverage obligations (enriched, in-scope): ${tp} positive + ${tn} negative = ${tp + tn} aspects`);
}
if (orphaned.length) console.log(`  ⚠ ${orphaned.length} orphaned enrichment path(s) (lenient): ${orphaned.join(", ")}`);
