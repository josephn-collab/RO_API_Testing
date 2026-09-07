#!/usr/bin/env node
// =============================================================================
// Phase 1 Enrichment Review Generator
// =============================================================================
// Generates 8 domain-split CSVs for deep enrichment review.
// Each CSV contains one row per proposed enrichment item (with origin tracking).
// No enrichment files are modified — only CSVs are created.
//
// Run: node qa-studio/generate-enrichment-review.mjs
// =============================================================================
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const ENRICHMENT_DIR = join(DIR, "enrichment");
const RULES_DIR = join(DIR, "rules");
const REVIEW_OUT_DIR = join(DIR, "enrichment-review");
const OPT_PATH = "/optimization/v2";

const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));

// Domain grouping: maps path prefixes to output file and row ID prefix
const DOMAIN_MAP = {
  vehicles: { file: "vehicles.csv", prefix: "VEH", paths: [] },
  jobs: { file: "jobs.csv", prefix: "JOB", paths: [] },
  shipments: { file: "shipments.csv", prefix: "SHP", paths: [] },
  options: { file: "options.csv", prefix: "OPT", paths: [] },
  relations: { file: "relations.csv", prefix: "REL", paths: [] },
  depots: { file: "depots.csv", prefix: "DEP", paths: [] },
  zones: { file: "zones.csv", prefix: "ZON", paths: [] },
  "locations-matrices": { file: "locations-matrices.csv", prefix: "LOC", paths: [] },
};

// Inverse mapping for domain classification
function getDomain(path) {
  if (path === "cost_matrix" || path === "distance_matrix" || path === "duration_matrix") {
    return "locations-matrices";
  }
  if (path.startsWith("locations.")) return "locations-matrices";
  const prefix = path.split(".")[0];
  return prefix;
}

// ============================================================================
// Load data
// ============================================================================

const spec = readJSON(join(DIR, "openapi.json"));
const rules = listJSON(RULES_DIR).map(f => readJSON(join(RULES_DIR, f)));
const enrichmentFiles = listJSON(ENRICHMENT_DIR);

function listJSON(d) {
  return (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".json")) : []).sort();
}

// Build path → rule mapping
const rulesByPath = {};
rules.forEach(rule => {
  (rule.applies_to || []).forEach(path => {
    if (!rulesByPath[path]) rulesByPath[path] = [];
    rulesByPath[path].push(rule.id);
  });
});

// Load all enrichment with path as key
const enrichment = {};
enrichmentFiles.forEach(f => {
  const path = f.replace(".json", "");
  const data = readJSON(join(ENRICHMENT_DIR, f));
  enrichment[path] = data;

  // Classify by domain
  const domain = getDomain(path);
  if (DOMAIN_MAP[domain]) {
    DOMAIN_MAP[domain].paths.push(path);
  }
});

// Get spec node for a path — walk the request schema
function getSpecNode(path, spec) {
  const parts = path.split(".");
  let node = spec.paths?.["/optimization/v2"]?.post?.requestBody?.content?.["application/json"]?.schema?.properties;

  if (!node) return null;

  // Process each part of the path
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLast = (i === parts.length - 1);

    if (!node || typeof node !== "object") return null;

    // Get the field/property for this part
    node = node[part];
    if (!node) return null;

    // If not the last part, descend if needed
    if (!isLast) {
      // Descend into array items if this is an array
      if (node.type === "array" && node.items?.properties) {
        node = node.items.properties;
      } else if (node.type === "object" && node.properties) {
        // Descend into object properties
        node = node.properties;
      }
      // else: can't descend further, might fail on next iteration
    }
  }

  return node;
}

// Extract spec description
function specDescription(node) {
  if (!node?.description) return "";
  const s = String(node.description).replace(/`/g, "").replace(/\s+/g, " ").trim();
  return s.length > 300 ? s.slice(0, 297) + "…" : s;
}

// Extract enum values
function enumValues(node) {
  const arr = node?.enum || node?.items?.enum;
  if (!Array.isArray(arr)) return null;
  const vals = arr.map(v => String(v).replace(/`/g, "").trim()).filter(v => v && v !== '""');
  return vals.length ? vals : null;
}

// Classify testingGuidance text by category tag
function classifyGuidance(text) {
  const s = String(text || "").trim();
  if (/^negative[-\s]*validation\b/i.test(s)) return "Negative-validation";
  if (/^negative[-\s]*infeasible\b/i.test(s) || /^infeasible\b/i.test(s)) return "Negative-infeasible";
  if (/^negative\b/i.test(s)) return /\b(unassigned|422|infeasible|deferred|breach)\b/i.test(s) ? "Negative-infeasible" : "Negative-validation";
  if (/^interaction\b/i.test(s)) return "Interaction";
  if (/^(positive|boundary|open route|multi[-\s]*dimension)\b/i.test(s)) return "Positive";
  if (/\b(400|401|403|413|reject|invalid|out of range|malformed|type error|missing)\b/i.test(s)) return "Negative-validation";
  if (/\b(unassigned|422|infeasible|breach|deferred)\b/i.test(s)) return "Negative-infeasible";
  return "Positive";
}

// ============================================================================
// Generate enrichment review rows for one path
// ============================================================================

function generateReviewRows(path, enrichedData, specNode, appliedRules) {
  const rows = [];
  const fields = ["summary", "range", "constraints", "businessRules", "validationRules", "testingGuidance"];

  for (const field of fields) {
    const current = enrichedData[field];

    // For scalar fields
    if (field === "summary" || field === "range") {
      // For now, mark existing text as "kept" (full rewrite would be "reworded")
      // In a real scenario, we'd compare and decide
      const origin = current ? "kept" : "new";
      const suggested = current || "(enrichment suggestion based on spec)";
      const rationale = specNode ? `Spec: ${specDescription(specNode).slice(0, 80)}...` : "No spec node found";

      rows.push({
        path,
        field,
        item_index: 1,
        origin,
        category_tag: null,
        current_text: current || "",
        suggested_text: suggested,
        rationale,
      });
    } else if (Array.isArray(current)) {
      // For array fields, one row per item
      for (let i = 0; i < current.length; i++) {
        const categoryTag = field === "testingGuidance" ? classifyGuidance(current[i]) : null;
        rows.push({
          path,
          field,
          item_index: i + 1,
          origin: "kept",
          category_tag: categoryTag,
          current_text: current[i],
          suggested_text: current[i],
          rationale: "Existing enrichment kept for review",
        });
      }
    }
  }

  return rows;
}

// ============================================================================
// Main generation
// ============================================================================

console.log("Starting Phase 1 Enrichment Review generation...\n");

// Create output directory
mkdirSync(REVIEW_OUT_DIR, { recursive: true });

const csvsByDomain = {};
let totalRows = 0;

// Process each domain
for (const [domain, config] of Object.entries(DOMAIN_MAP)) {
  const rows = [];
  let rowCounter = 1;

  console.log(`Processing domain: ${domain} (${config.paths.length} paths)`);

  for (const path of config.paths.sort()) {
    const enrichedData = enrichment[path];
    const specNode = getSpecNode(path, spec);
    const appliedRules = rulesByPath[path] || [];

    // Generate review rows for this path
    const pathRows = generateReviewRows(path, enrichedData, specNode, appliedRules);

    for (const row of pathRows) {
      const rowId = `${config.prefix}-${String(rowCounter).padStart(3, "0")}`;
      rows.push({
        row_id: rowId,
        ...row,
        decision: "",
        sme_notes: "",
      });
      rowCounter++;
    }
  }

  csvsByDomain[domain] = rows;
  totalRows += rows.length;
  console.log(`  → ${rows.length} review rows generated\n`);
}

// ============================================================================
// Write CSVs
// ============================================================================

function escapeCSV(val) {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writeCSV(filename, rows) {
  const headers = [
    "row_id", "path", "field", "item_index", "origin", "category_tag",
    "current_text", "suggested_text", "rationale", "decision", "sme_notes"
  ];

  const lines = [headers.join(",")];

  for (const row of rows) {
    const values = headers.map(h => escapeCSV(row[h]));
    lines.push(values.join(","));
  }

  writeFileSync(filename, lines.join("\n") + "\n", "utf8");
}

for (const [domain, config] of Object.entries(DOMAIN_MAP)) {
  const rows = csvsByDomain[domain];
  const filepath = join(REVIEW_OUT_DIR, config.file);
  writeCSV(filepath, rows);
  console.log(`✓ ${config.file} (${rows.length} rows)`);
}

console.log(`\n✓ Phase 1 enrichment review generated!`);
console.log(`  Output: ${REVIEW_OUT_DIR}`);
console.log(`  Total rows: ${totalRows}`);
console.log(`  Domains: ${Object.keys(DOMAIN_MAP).length}`);
