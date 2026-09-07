#!/usr/bin/env node
// =============================================================================
// Phase 1 Enrichment Review Generator v2 — Deep Enrichment with Agents
// =============================================================================
// Uses 8 parallel agents (one per domain) to analyze spec deeply and generate
// comprehensive enrichment proposals covering enums, boundaries, interactions.
//
// This script orchestrates the workflow. Each agent analyzes its domain and
// returns structured enrichment proposals, which are then assembled into CSVs.
//
// Usage: This is called by the Workflow tool; see workflow-enrichment-review.mjs
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const ENRICHMENT_DIR = join(DIR, "enrichment");
const RULES_DIR = join(DIR, "rules");
const REVIEW_OUT_DIR = join(DIR, "enrichment-review");

const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));

function listJSON(d) {
  return (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".json")) : []).sort();
}

// ============================================================================
// Build domain-specific data packages for agents
// ============================================================================

const spec = readJSON(join(DIR, "openapi.json"));
const rules = listJSON(RULES_DIR).map(f => readJSON(join(RULES_DIR, f)));
const enrichmentFiles = listJSON(ENRICHMENT_DIR);

// Domain grouping
const DOMAINS = {
  vehicles: { file: "vehicles.csv", prefix: "VEH", paths: [] },
  jobs: { file: "jobs.csv", prefix: "JOB", paths: [] },
  shipments: { file: "shipments.csv", prefix: "SHP", paths: [] },
  options: { file: "options.csv", prefix: "OPT", paths: [] },
  relations: { file: "relations.csv", prefix: "REL", paths: [] },
  depots: { file: "depots.csv", prefix: "DEP", paths: [] },
  zones: { file: "zones.csv", prefix: "ZON", paths: [] },
  "locations-matrices": { file: "locations-matrices.csv", prefix: "LOC", paths: [] },
};

function getDomain(path) {
  if (path === "cost_matrix" || path === "distance_matrix" || path === "duration_matrix") {
    return "locations-matrices";
  }
  if (path.startsWith("locations.")) return "locations-matrices";
  const prefix = path.split(".")[0];
  return prefix;
}

// Build path → rule mapping
const rulesByPath = {};
rules.forEach(rule => {
  (rule.applies_to || []).forEach(path => {
    if (!rulesByPath[path]) rulesByPath[path] = [];
    rulesByPath[path].push(rule.id);
  });
});

// Load enrichment and classify by domain
const enrichment = {};
enrichmentFiles.forEach(f => {
  const path = f.replace(".json", "");
  const data = readJSON(join(ENRICHMENT_DIR, f));
  enrichment[path] = data;

  const domain = getDomain(path);
  if (DOMAINS[domain]) {
    DOMAINS[domain].paths.push(path);
  }
});

// Get spec node
function getSpecNode(path, spec) {
  const parts = path.split(".");
  let node = spec.paths?.["/optimization/v2"]?.post?.requestBody?.content?.["application/json"]?.schema?.properties;

  if (!node) return null;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLast = (i === parts.length - 1);

    if (!node || typeof node !== "object") return null;
    node = node[part];
    if (!node) return null;

    if (!isLast) {
      if (node.type === "array" && node.items?.properties) {
        node = node.items.properties;
      } else if (node.type === "object" && node.properties) {
        node = node.properties;
      }
    }
  }

  return node;
}

function specDescription(node) {
  if (!node?.description) return "";
  const s = String(node.description).replace(/`/g, "").replace(/\s+/g, " ").trim();
  return s.length > 300 ? s.slice(0, 297) + "…" : s;
}

function enumValues(node) {
  const arr = node?.enum || node?.items?.enum;
  if (!Array.isArray(arr)) return null;
  const vals = arr.map(v => String(v).replace(/`/g, "").trim()).filter(v => v && v !== '""');
  return vals.length ? vals : null;
}

// ============================================================================
// Export domain packages as JSON for agents
// ============================================================================

console.log("Building domain packages for agents...\n");

const domainPackages = {};

for (const [domain, config] of Object.entries(DOMAINS)) {
  const pathData = {};

  for (const path of config.paths) {
    const enrichedData = enrichment[path];
    const specNode = getSpecNode(path, spec);
    const appliedRules = rulesByPath[path] || [];

    pathData[path] = {
      enrichment: enrichedData,
      spec: specNode ? {
        type: specNode.type,
        description: specDescription(specNode),
        enum: enumValues(specNode),
        items: specNode.items ? {
          type: specNode.items.type,
          enum: enumValues(specNode.items),
        } : null,
        required: specNode.required,
        properties: specNode.properties ? Object.keys(specNode.properties) : [],
      } : null,
      rules: appliedRules,
    };
  }

  domainPackages[domain] = {
    domain,
    prefix: config.prefix,
    file: config.file,
    paths: config.paths,
    pathData,
    allRules: rules.filter(r =>
      config.paths.some(p => r.applies_to?.includes(p))
    ),
  };

  console.log(`✓ ${domain}: ${config.paths.length} paths packaged`);
}

// Write packages as JSON (agents will receive this)
const packagesFile = join(DIR, ".enrichment-review-packages.json");
writeFileSync(packagesFile, JSON.stringify(domainPackages, null, 2), "utf8");

console.log(`\n✓ Domain packages written to: ${packagesFile}`);
console.log(`  Ready for parallel agent processing.`);
console.log(`\nNext: Run the Workflow tool with workflow-enrichment-review.mjs`);
