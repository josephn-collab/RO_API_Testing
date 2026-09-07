#!/usr/bin/env node
// =============================================================================
// Draft Features Enrichment Review Generator (Phase 1 Pattern)
// =============================================================================
// Reads all draft features from overlay.json and generates a CSV for SME review.
// Matches Phase 1 CSV structure: one row per enrichment item (constraint,
// businessRule, validationRule, testingGuidance, etc.), NOT one row per field.
//
// CSV structure: row_id,path,field,item_index,origin,category_tag,current_text,suggested_text,rationale,decision,sme_notes
//
// Run: node qa-studio/generate-draft-enrichment-review.mjs
// Output: qa-studio/enrichment-review/draft-features.csv
// =============================================================================
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const OVERLAY_PATH = join(DIR, "overlay.json");
const ENRICHMENT_DIR = join(DIR, "enrichment");
const REVIEW_DIR = join(DIR, "enrichment-review");
const OUTPUT_PATH = join(REVIEW_DIR, "draft-features.csv");

const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));

// CSV escaping
function escapeCSV(str) {
  if (!str) return "";
  str = String(str);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// Load overlay
const overlay = readJSON(OVERLAY_PATH);
if (!overlay.features || !Array.isArray(overlay.features)) {
  console.error("✖ overlay.json has no features array");
  process.exit(1);
}

// Collect draft feature enrichment
const draftFeatures = overlay.features.filter(f => f.status === "draft" || !f.status);

// Build CSV rows (one per enrichment item)
const rows = [
  "row_id,path,field,item_index,origin,category_tag,current_text,suggested_text,rationale,decision,sme_notes"
];

let rowId = 1;
const itemsByPath = {}; // Track items per path for rationale

for (const feature of draftFeatures) {
  const enrichmentRefs = feature.enrichment_references || [];

  for (const ref of enrichmentRefs) {
    const enrichFile = ref.split("/").pop();
    const enrichPath = join(ENRICHMENT_DIR, enrichFile);

    if (!existsSync(enrichPath)) continue;

    const data = readJSON(enrichPath);
    const path = data.path;
    const fieldName = path.split(".").pop();
    const origin = enrichFile; // e.g., "jobs.split.can_be_split.json"

    // Process each array of items
    const itemTypes = [
      { key: "constraints", tag: "constraint" },
      { key: "businessRules", tag: "businessRule" },
      { key: "validationRules", tag: "validationRule" },
      { key: "testingGuidance", tag: "testingGuidance" },
      { key: "related", tag: "related" },
      { key: "rules", tag: "rule" }
    ];

    for (const itemType of itemTypes) {
      const items = data[itemType.key] || [];
      const items_array = Array.isArray(items) ? items : [];

      items_array.forEach((item, index) => {
        // Rationale: summary of the field + the category
        const rationale = `${data.summary || ""} [${itemType.tag}]`;

        const row = [
          `DRF-${String(rowId).padStart(4, "0")}`,
          path,
          fieldName,
          index,
          origin,
          itemType.tag,
          escapeCSV(String(item)),
          "",  // suggested_text (empty for user to fill)
          escapeCSV(rationale),
          "",  // decision (empty for user to fill)
          ""   // sme_notes
        ].join(",");

        rows.push(row);
        rowId++;
      });
    }

    // Also add summary and range info as special rows
    if (data.summary) {
      const row = [
        `DRF-${String(rowId).padStart(4, "0")}`,
        path,
        fieldName,
        0,
        origin,
        "summary",
        escapeCSV(data.summary),
        "",
        escapeCSV("Field description from specification"),
        "",
        ""
      ].join(",");
      rows.push(row);
      rowId++;
    }

    if (data.range) {
      const rangeStr = JSON.stringify(data.range);
      const row = [
        `DRF-${String(rowId).padStart(4, "0")}`,
        path,
        fieldName,
        0,
        origin,
        "range",
        escapeCSV(rangeStr),
        "",
        escapeCSV("Field type and default value"),
        "",
        ""
      ].join(",");
      rows.push(row);
      rowId++;
    }
  }
}

// Write CSV
writeFileSync(OUTPUT_PATH, rows.join("\n") + "\n", "utf8");
console.log(`✓ Generated draft features CSV: ${OUTPUT_PATH}`);
console.log(`  ${rows.length - 1} enrichment item(s) across ${draftFeatures.length} feature(s)`);
console.log("\nNext steps:");
console.log("  1. Open the CSV in Excel/Numbers");
console.log("  2. For each row, fill in:");
console.log("     - decision: ACCEPT | REJECT | MODIFY");
console.log("     - suggested_text (if decision=MODIFY, what should change)");
console.log("     - sme_notes (optional)");
console.log("  3. Save the CSV");
console.log("  4. Run: node qa-studio/apply-draft-enrichment-review.mjs");
