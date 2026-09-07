#!/usr/bin/env node
// =============================================================================
// Phase 1 Enrichment Review Generator v3 — Simplified Deep Analysis
// =============================================================================
// Instead of sending all 40+ paths per domain to agents, send focused batches.
// This avoids API errors from oversized prompts.
//
// Strategy: For each domain, batch paths into groups of ~5-8 and analyze each
// batch independently, then merge results into CSVs.
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const ENRICHMENT_DIR = join(DIR, "enrichment");
const REVIEW_OUT_DIR = join(DIR, "enrichment-review");

const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));

function listJSON(d) {
  return (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".json")) : []).sort();
}

// ============================================================================
// Load and categorize
// ============================================================================

const enrichmentFiles = listJSON(ENRICHMENT_DIR);

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

console.log("Domain distribution:");
Object.entries(DOMAINS).forEach(([domain, config]) => {
  console.log(`  ${domain}: ${config.paths.length} paths`);
});

// ============================================================================
// Strategy: Focus on HIGH-VALUE paths first
// ============================================================================

// These paths have low testingGuidance coverage and directly impact test generation
const HIGH_VALUE_PATHS = {
  vehicles: [
    'vehicles.capacity',
    'vehicles.time_window',
    'vehicles.max_stops',
    'vehicles.max_tasks',
  ],
  jobs: [
    'jobs',
    'jobs.delivery',
    'jobs.time_windows',
    'jobs.priority',
  ],
  shipments: [
    'shipments',
    'shipments.delivery',
    'shipments.pickup',
    'shipments.max_time_in_vehicle',
  ],
  options: [
    'options.constraint',
    'options.objective',
    'options.routing',
    'options.routing.mode',
  ],
  relations: [
    'relations',
    'relations.type',
    'relations.min_duration',
  ],
  depots: [
    'depots',
    'depots.time_windows',
  ],
  zones: [
    'zones',
  ],
  'locations-matrices': [
    'locations',
    'cost_matrix',
  ],
};

console.log("\nHigh-value paths to deepen:");
Object.entries(HIGH_VALUE_PATHS).forEach(([domain, paths]) => {
  console.log(`  ${domain}: ${paths.join(', ')}`);
});

// ============================================================================
// Write simplified data for manual agent prompts
// ============================================================================

const dataFile = join(DIR, ".enrichment-high-value.json");
writeFileSync(dataFile, JSON.stringify({
  HIGH_VALUE_PATHS,
  DOMAINS,
  enrichment,
}, null, 2), "utf8");

console.log(`\n✓ Data prepared: ${dataFile}`);
console.log("\nNext steps:");
console.log("1. Create a workflow that uses agents to analyze these high-value paths");
console.log("2. Each agent handles one domain's high-value subset (much smaller prompts)");
console.log("3. Merge results into CSVs in enrichment-review/");
