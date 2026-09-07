#!/usr/bin/env node
// =============================================================================
// Phase 1 Enrichment Review — Analytical Deep Dive
// =============================================================================
// Analyzes OpenAPI spec thoroughly (no agents) to propose enhanced testingGuidance.
// Focuses on:
// - Enum values (all documented options)
// - Range boundaries (min/max, zero, negative, non-integer)
// - Required vs optional behavior
// - Rule interactions (from rules/*.json)
//
// Run: node qa-studio/generate-enrichment-review-analytical.mjs
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
// Load data
// ============================================================================

const spec = readJSON(join(DIR, "openapi.json"));
const rules = listJSON(RULES_DIR).map(f => readJSON(join(RULES_DIR, f)));
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
  return path.split(".")[0];
}

const rulesByPath = {};
rules.forEach(rule => {
  (rule.applies_to || []).forEach(path => {
    if (!rulesByPath[path]) rulesByPath[path] = [];
    rulesByPath[path].push(rule.id);
  });
});

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
  return s.length > 200 ? s.slice(0, 197) + "…" : s;
}

function enumValues(node) {
  const arr = node?.enum || node?.items?.enum;
  if (!Array.isArray(arr)) return null;
  const vals = arr.map(v => String(v).replace(/`/g, "").trim()).filter(v => v && v !== '""');
  return vals.length ? vals : null;
}

// ============================================================================
// Generate enhanced testingGuidance proposals
// ============================================================================

function generateTestingGuidance(path, enrichedData, specNode, appliedRules) {
  const existing = enrichedData.testingGuidance || [];
  const guidance = [];
  const seen = new Set(existing.map(t => t.toLowerCase().slice(0, 50)));

  // Keep existing guidance tagged as "kept"
  for (const item of existing) {
    guidance.push({ origin: "kept", text: item });
  }

  if (!specNode) return guidance;

  const desc = specDescription(specNode);
  const enums = enumValues(specNode);
  const nodeType = specNode.type;

  // 1. Enum values — one test per option
  if (enums && enums.length > 0) {
    for (const enumVal of enums) {
      const testCase = `Positive: ${path.split(".").pop()} = "${enumVal}"`;
      if (!seen.has(testCase.toLowerCase().slice(0, 50))) {
        guidance.push({
          origin: "new",
          text: `Positive: test with ${path.split(".").pop()} set to "${enumVal}"`,
        });
        seen.add(testCase.toLowerCase().slice(0, 50));
      }
    }
  }

  // 2. Boundaries
  if (nodeType === "number" || nodeType === "integer") {
    const boundaries = [
      { origin: "new", text: "Boundary: zero value (0)" },
      { origin: "new", text: "Boundary: negative value (-1)" },
      { origin: "new", text: "Boundary: very large value" },
    ];
    for (const b of boundaries) {
      if (!seen.has(b.text.toLowerCase().slice(0, 50))) {
        guidance.push(b);
        seen.add(b.text.toLowerCase().slice(0, 50));
      }
    }
  }

  // 3. Required vs optional
  if (specNode.required === false || !specNode.required) {
    const optional = { origin: "new", text: `Positive: omit optional field ${path.split(".").pop()}` };
    if (!seen.has(optional.text.toLowerCase().slice(0, 50))) {
      guidance.push(optional);
    }
  }

  // 4. Rule interactions
  for (const ruleId of appliedRules) {
    const rule = rules.find(r => r.id === ruleId);
    if (rule && rule.testingGuidance) {
      for (const ruleGuidance of rule.testingGuidance) {
        if (!seen.has(ruleGuidance.toLowerCase().slice(0, 50))) {
          guidance.push({ origin: "new", text: `Interaction: ${ruleGuidance}` });
          seen.add(ruleGuidance.toLowerCase().slice(0, 50));
        }
      }
    }
  }

  return guidance;
}

// ============================================================================
// Generate CSVs
// ============================================================================

mkdirSync(REVIEW_OUT_DIR, { recursive: true });

function escapeCSV(val) {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function classifyTag(text) {
  const s = String(text || "").trim();
  if (/^Positive:/i.test(s)) return "Positive";
  if (/^Boundary:/i.test(s)) return "Boundary";
  if (/^Negative[-\s]*validation:/i.test(s)) return "Negative-validation";
  if (/^Negative[-\s]*infeasible:/i.test(s)) return "Negative-infeasible";
  if (/^Interaction:/i.test(s)) return "Interaction";
  return "";
}

// Generate comprehensive businessRules proposals
function generateBusinessRules(path, enrichedData, specNode, appliedRules) {
  const existing = enrichedData.businessRules || [];
  const rules_list = [];
  const seen = new Set(existing.map(t => t.toLowerCase().slice(0, 60)));

  // Keep existing
  for (const item of existing) {
    rules_list.push({ origin: "kept", text: item });
  }

  if (!specNode) return rules_list;

  const fieldName = path.split(".").pop();
  const desc = specDescription(specNode);
  const enums = enumValues(specNode);
  const nodeType = specNode.type;
  const isArray = nodeType === "array";

  // 1. Core field purpose (from spec description)
  if (desc && !seen.has(desc.toLowerCase().slice(0, 60))) {
    rules_list.push({
      origin: "new",
      text: `${fieldName} defines: ${desc}`,
    });
    seen.add(desc.toLowerCase().slice(0, 60));
  }

  // 2. Type-specific rules
  if (isArray) {
    const singular = fieldName.replace(/s$/, "");
    const rule = `Each element in ${fieldName} must be valid and consistent with related fields.`;
    if (!seen.has(rule.toLowerCase().slice(0, 60))) {
      rules_list.push({ origin: "new", text: rule });
      seen.add(rule.toLowerCase().slice(0, 60));
    }
  }

  // 3. Enum-specific business logic
  if (enums && enums.length > 0) {
    const enumRule = `Valid options: ${enums.slice(0, 5).join(", ")}${enums.length > 5 ? ", ..." : ""}. Each affects solver behavior differently.`;
    if (!seen.has(enumRule.toLowerCase().slice(0, 60))) {
      rules_list.push({ origin: "new", text: enumRule });
      seen.add(enumRule.toLowerCase().slice(0, 60));
    }

    // Field-specific enum rules
    if (fieldName === "mode" && path.includes("routing")) {
      const modeRule = `mode=truck enables truck_size/truck_weight/hazmat attributes; other modes restrict them.`;
      if (!seen.has(modeRule.toLowerCase().slice(0, 60))) {
        rules_list.push({ origin: "new", text: modeRule });
        seen.add(modeRule.toLowerCase().slice(0, 60));
      }
    }
    if (fieldName === "type" && path.includes("objective")) {
      const objRule = `type=distance/duration/cost changes optimization focus; custom allows weighted combination.`;
      if (!seen.has(objRule.toLowerCase().slice(0, 60))) {
        rules_list.push({ origin: "new", text: objRule });
        seen.add(objRule.toLowerCase().slice(0, 60));
      }
    }
    if ((fieldName === "type" || fieldName === "allow" || fieldName === "avoid") && path.includes("routing")) {
      const routeRule = `Routing attributes affect which roads/zones are accessible; conflicts cause unsolvable requests.`;
      if (!seen.has(routeRule.toLowerCase().slice(0, 60))) {
        rules_list.push({ origin: "new", text: routeRule });
        seen.add(routeRule.toLowerCase().slice(0, 60));
      }
    }
  }

  // 4. Related field consistency
  if (enrichedData.related && enrichedData.related.length > 0) {
    const relatedFields = enrichedData.related.slice(0, 3).join(", ");
    const consRule = `Must stay consistent with: ${relatedFields}. Changes here may require validation of those fields.`;
    if (!seen.has(consRule.toLowerCase().slice(0, 60))) {
      rules_list.push({ origin: "new", text: consRule });
      seen.add(consRule.toLowerCase().slice(0, 60));
    }
  }

  // 5. Cross-field rules (from rules/*.json) — simplified language
  for (const ruleId of appliedRules) {
    const rule = rules.find(r => r.id === ruleId);
    if (rule && rule.rule) {
      const ruleText = rule.rule.toLowerCase();

      // Extract the business rule essence
      let simplified = null;

      if (ruleText.includes("dimension")) {
        simplified = `Capacity dimensions must match across jobs, shipments, and vehicles.`;
      } else if (ruleText.includes("location_index") && ruleText.includes("range")) {
        simplified = `location_index must be within [0, locations.location.length).`;
      } else if (ruleText.includes("pickup") && ruleText.includes("delivery")) {
        simplified = `Shipments: pickup always occurs before delivery on the route.`;
      } else if (ruleText.includes("time_window") && ruleText.includes("feasib")) {
        simplified = `Time windows must allow completion within route timing constraints.`;
      } else if (ruleText.includes("zone")) {
        simplified = `Vehicle's allowed_zones must include the job/shipment's zones.`;
      } else if (ruleText.includes("priority")) {
        simplified = `Higher priority jobs are serviced first; ties break by job ID order.`;
      } else if (ruleText.includes("relation")) {
        simplified = `Relations define hard sequencing: job pairs, duration bounds, vehicle affinity.`;
      } else if (ruleText.includes("route-balanc") || ruleText.includes("subordinate")) {
        simplified = `Route-balancing is soft; hard constraints (capacity, time, zones) override it.`;
      } else if (ruleText.includes("skill")) {
        simplified = `Vehicle must have all skills required by the job (exact match, case-sensitive).`;
      } else if (ruleText.includes("load.*type")) {
        simplified = `Load type compatibility: vehicle and job load types must be compatible.`;
      } else if (ruleText.includes("matrix")) {
        simplified = `Cost/distance/duration matrices must have consistent dimensions and indices.`;
      } else if (ruleText.includes("custom") && ruleText.includes("weight")) {
        simplified = `Custom objectives allow weighted combinations of distance, duration, cost.`;
      }

      if (simplified && !seen.has(simplified.toLowerCase().slice(0, 60))) {
        rules_list.push({
          origin: "new",
          text: `Rule: ${simplified}`,
        });
        seen.add(simplified.toLowerCase().slice(0, 60));
      }
    }
  }

  // 6. Soft vs hard constraint distinction
  if (path.includes("constraint") || fieldName.includes("penalty") || fieldName.includes("cost")) {
    const softRule = `This is a soft constraint. Violations are penalized but don't make solutions infeasible.`;
    if (!seen.has(softRule.toLowerCase().slice(0, 60))) {
      rules_list.push({ origin: "new", text: softRule });
      seen.add(softRule.toLowerCase().slice(0, 60));
    }
  }

  // 7. Numeric field semantics
  if (nodeType === "number" || nodeType === "integer") {
    let numRule = null;
    if (fieldName.includes("penalty") || fieldName.includes("cost")) {
      numRule = `Zero means no penalty/cost; larger values increase incentive to avoid violation.`;
    } else if (fieldName.includes("duration") || fieldName.includes("time")) {
      numRule = `Values in seconds; must be non-negative. Zero means instantaneous.`;
    } else if (fieldName.includes("distance")) {
      numRule = `Values in meters; must be non-negative. Affects routing cost calculations.`;
    } else if (fieldName.includes("capacity") || fieldName.includes("load") || fieldName.includes("quantity")) {
      numRule = `Values must be non-negative. Zero means no capacity/demand on that dimension.`;
    } else {
      numRule = `Numeric field; verify sign (positive/negative) and unit from spec.`;
    }
    if (numRule && !seen.has(numRule.toLowerCase().slice(0, 60))) {
      rules_list.push({ origin: "new", text: numRule });
      seen.add(numRule.toLowerCase().slice(0, 60));
    }
  }

  // 8. Optional vs required
  if (specNode.required === false || !specNode.required) {
    const optionalRule = `Optional field. Omitting uses solver's default behavior (no penalty).`;
    if (!seen.has(optionalRule.toLowerCase().slice(0, 60))) {
      rules_list.push({ origin: "new", text: optionalRule });
      seen.add(optionalRule.toLowerCase().slice(0, 60));
    }
  } else {
    const requiredRule = `Required field. Missing causes HTTP 400 validation error.`;
    if (!seen.has(requiredRule.toLowerCase().slice(0, 60))) {
      rules_list.push({ origin: "new", text: requiredRule });
      seen.add(requiredRule.toLowerCase().slice(0, 60));
    }
  }

  // 9. Field-specific gotchas
  if (fieldName === "skills" || fieldName === "skill") {
    const skillRule = `Skills matching is case-sensitive and exact. Vehicle must have ALL skills required by job.`;
    if (!seen.has(skillRule.toLowerCase().slice(0, 60))) {
      rules_list.push({ origin: "new", text: skillRule });
      seen.add(skillRule.toLowerCase().slice(0, 60));
    }
  }
  if (fieldName === "zones" || fieldName === "zone" || fieldName.includes("zone")) {
    const zoneRule = `Vehicle and job zones must intersect. Vehicle without zone restrictions can serve any zone.`;
    if (!seen.has(zoneRule.toLowerCase().slice(0, 60))) {
      rules_list.push({ origin: "new", text: zoneRule });
      seen.add(zoneRule.toLowerCase().slice(0, 60));
    }
  }
  if (fieldName === "lifo") {
    const lifoRule = `LIFO (Last-In-First-Out): if enabled, last pickup must be first delivery.`;
    if (!seen.has(lifoRule.toLowerCase().slice(0, 60))) {
      rules_list.push({ origin: "new", text: lifoRule });
      seen.add(lifoRule.toLowerCase().slice(0, 60));
    }
  }
  if (fieldName === "profile") {
    const profileRule = `Vehicle profile affects speed factor, restrictions, and routing attributes availability.`;
    if (!seen.has(profileRule.toLowerCase().slice(0, 60))) {
      rules_list.push({ origin: "new", text: profileRule });
      seen.add(profileRule.toLowerCase().slice(0, 60));
    }
  }

  return rules_list;
}

console.log("Generating enrichment review CSVs with analytical deep dive...\n");

let totalRows = 0;

for (const [domain, config] of Object.entries(DOMAINS)) {
  const rows = [];
  let rowCounter = 1;

  console.log(`Processing ${domain} (${config.paths.length} paths)...`);

  for (const path of config.paths) {
    const enrichedData = enrichment[path];
    const specNode = getSpecNode(path, spec);
    const appliedRules = rulesByPath[path] || [];

    const fields = ["summary", "range", "constraints", "businessRules", "validationRules", "testingGuidance"];

    for (const field of fields) {
      const current = enrichedData[field];

      if (field === "businessRules") {
        // Enhanced businessRules with new proposals
        const proposals = generateBusinessRules(path, enrichedData, specNode, appliedRules);
        for (let i = 0; i < proposals.length; i++) {
          const proposal = proposals[i];
          const rowId = `${config.prefix}-${String(rowCounter).padStart(3, "0")}`;
          rows.push({
            row_id: rowId,
            path,
            field,
            item_index: String(i + 1),
            origin: proposal.origin,
            category_tag: "",
            current_text: proposal.origin === "kept" ? proposal.text : "",
            suggested_text: proposal.text,
            rationale: proposal.origin === "new" ? "Analytical business logic extraction" : "Existing enrichment",
            decision: "",
            sme_notes: "",
          });
          rowCounter++;
        }
      } else if (field === "testingGuidance") {
        // Enhanced testingGuidance with new proposals
        const proposals = generateTestingGuidance(path, enrichedData, specNode, appliedRules);
        for (let i = 0; i < proposals.length; i++) {
          const proposal = proposals[i];
          const rowId = `${config.prefix}-${String(rowCounter).padStart(3, "0")}`;
          rows.push({
            row_id: rowId,
            path,
            field,
            item_index: String(i + 1),
            origin: proposal.origin,
            category_tag: classifyTag(proposal.text),
            current_text: proposal.origin === "kept" ? proposal.text : "",
            suggested_text: proposal.text,
            rationale: proposal.origin === "new" ? "Analytical spec deep-dive" : "Existing enrichment",
            decision: "",
            sme_notes: "",
          });
          rowCounter++;
        }
      } else if (field === "summary" || field === "range") {
        // Scalar fields
        const rowId = `${config.prefix}-${String(rowCounter).padStart(3, "0")}`;
        rows.push({
          row_id: rowId,
          path,
          field,
          item_index: "1",
          origin: current ? "kept" : "new",
          category_tag: "",
          current_text: current || "",
          suggested_text: current || `[Spec: ${specDescription(specNode).slice(0, 100)}]`,
          rationale: specNode ? `Spec: ${specDescription(specNode)}` : "No spec node",
          decision: "",
          sme_notes: "",
        });
        rowCounter++;
      } else if (Array.isArray(current)) {
        // Array fields (constraints, businessRules, validationRules)
        for (let i = 0; i < current.length; i++) {
          const rowId = `${config.prefix}-${String(rowCounter).padStart(3, "0")}`;
          rows.push({
            row_id: rowId,
            path,
            field,
            item_index: String(i + 1),
            origin: "kept",
            category_tag: "",
            current_text: current[i],
            suggested_text: current[i],
            rationale: "Existing enrichment",
            decision: "",
            sme_notes: "",
          });
          rowCounter++;
        }
      }
    }
  }

  // Write CSV
  const headers = [
    "row_id", "path", "field", "item_index", "origin", "category_tag",
    "current_text", "suggested_text", "rationale", "decision", "sme_notes"
  ];

  const lines = [headers.join(",")];
  for (const row of rows) {
    const values = headers.map(h => escapeCSV(row[h]));
    lines.push(values.join(","));
  }

  const filepath = join(REVIEW_OUT_DIR, config.file);
  writeFileSync(filepath, lines.join("\n") + "\n", "utf8");

  console.log(`  ✓ ${config.file} (${rows.length} rows)`);
  totalRows += rows.length;
}

console.log(`\n✓ Phase 1 enrichment review generated!`);
console.log(`  Output: ${REVIEW_OUT_DIR}`);
console.log(`  Total rows: ${totalRows}`);
console.log(`  New testingGuidance proposals added from spec analysis`);
