#!/usr/bin/env node
// =============================================================================
// Draft Features Enrichment Review Applicator (Phase 1 Pattern)
// =============================================================================
// Reads the draft-features.csv (with SME decisions filled in) and applies them
// to the draft enrichment files in enrichment/ directory.
//
// Matches Phase 1 structure: one row per item, so decisions are per-item.
// Decision types:
//   ACCEPT  — keep the item as-is
//   REJECT  — remove the item from enrichment
//   MODIFY  — replace with suggested_text (or keep current if no suggestion)
//
// Run: node qa-studio/apply-draft-enrichment-review.mjs
// =============================================================================
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const REVIEW_CSV = join(DIR, "enrichment-review", "draft-features.csv");
const ENRICHMENT_DIR = join(DIR, "enrichment");

const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJSON = (p, obj) => writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");

// Parse CSV
function parseCSV(content) {
  const lines = content.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const row = {};
    let current = "";
    let inQuotes = false;
    let col = 0;

    for (let j = 0; j < lines[i].length; j++) {
      const char = lines[i][j];
      const next = lines[i][j + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          j++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        row[headers[col]] = current.trim();
        current = "";
        col++;
      } else {
        current += char;
      }
    }

    if (col < headers.length) {
      row[headers[col]] = current.trim();
    }

    if (Object.keys(row).length > 0 && row.row_id) {
      rows.push(row);
    }
  }

  return rows;
}

// Main
if (!existsSync(REVIEW_CSV)) {
  console.error(`✖ CSV not found: ${REVIEW_CSV}`);
  console.error("   Run: node qa-studio/generate-draft-enrichment-review.mjs first");
  process.exit(1);
}

const csvContent = readFileSync(REVIEW_CSV, "utf8");
const csvRows = parseCSV(csvContent);

// Index enrichment files by origin (filename)
const enrichmentByOrigin = {};
const enrichmentFiles = readdirSync(ENRICHMENT_DIR).filter(f => f.endsWith(".json"));

enrichmentFiles.forEach(f => {
  const path = join(ENRICHMENT_DIR, f);
  const data = readJSON(path);
  enrichmentByOrigin[f] = { path, data, original: JSON.parse(JSON.stringify(data)) };
});

// Group decisions by (path, category_tag) for batch processing
const decisionsByPathAndTag = {};

for (const row of csvRows) {
  const { path, category_tag, item_index, current_text, suggested_text, decision } = row;

  if (!path || !category_tag || !decision) continue;

  const key = `${path}::${category_tag}`;
  if (!decisionsByPathAndTag[key]) {
    decisionsByPathAndTag[key] = [];
  }

  decisionsByPathAndTag[key].push({
    item_index: parseInt(item_index) || 0,
    current_text,
    suggested_text,
    decision: decision.toUpperCase()
  });
}

// Process decisions and rebuild enrichment
const summary = [];
let accepted = 0;
let rejected = 0;
let modified = 0;

for (const [pathAndTag, decisions] of Object.entries(decisionsByPathAndTag)) {
  const [path, categoryTag] = pathAndTag.split("::");

  // Find the enrichment file for this path
  let targetOrigin = null;
  let targetData = null;

  for (const [origin, enriched] of Object.entries(enrichmentByOrigin)) {
    if (enriched.data.path === path) {
      targetOrigin = origin;
      targetData = enriched.data;
      break;
    }
  }

  if (!targetData) {
    console.warn(`⚠ Path not found: ${path}`);
    continue;
  }

  // Map category_tag to enrichment field name
  const tagToField = {
    "constraint": "constraints",
    "businessRule": "businessRules",
    "validationRule": "validationRules",
    "testingGuidance": "testingGuidance",
    "related": "related",
    "rule": "rules",
    "summary": "summary",
    "range": "range"
  };

  const fieldName = tagToField[categoryTag];
  if (!fieldName) {
    console.warn(`⚠ Unknown category_tag: ${categoryTag}`);
    continue;
  }

  // Special handling for non-array fields
  if (fieldName === "summary" || fieldName === "range") {
    const decision = decisions[0]?.decision;
    const suggestedText = decisions[0]?.suggested_text;

    if (decision === "ACCEPT") {
      // Keep as-is
      summary.push(`✓ ACCEPT (${fieldName}): ${path}`);
      accepted++;
    } else if (decision === "REJECT") {
      delete targetData[fieldName];
      summary.push(`✗ REJECT (${fieldName}): ${path}`);
      rejected++;
    } else if (decision === "MODIFY") {
      if (suggestedText) {
        targetData[fieldName] = fieldName === "range" ? JSON.parse(suggestedText) : suggestedText;
      }
      summary.push(`✎ MODIFY (${fieldName}): ${path}`);
      modified++;
    }
    continue;
  }

  // Process array fields
  if (!Array.isArray(targetData[fieldName])) {
    targetData[fieldName] = [];
  }

  const originalItems = [...targetData[fieldName]];
  const newItems = [];

  for (let i = 0; i < originalItems.length; i++) {
    const item = originalItems[i];
    const itemDecision = decisions.find(d => d.item_index === i);

    if (!itemDecision) {
      // No decision for this item → keep it (default ACCEPT)
      newItems.push(item);
      continue;
    }

    const decision = itemDecision.decision;
    const suggestedText = itemDecision.suggested_text;

    if (decision === "ACCEPT") {
      newItems.push(item);
      accepted++;
    } else if (decision === "REJECT") {
      // Skip this item (don't add to newItems)
      summary.push(`✗ REJECT: ${path} [${categoryTag}:${i}] "${item.substring(0, 60)}..."`);
      rejected++;
    } else if (decision === "MODIFY") {
      const newItem = suggestedText || item;
      newItems.push(newItem);
      if (suggestedText && suggestedText !== item) {
        summary.push(`✎ MODIFY: ${path} [${categoryTag}:${i}]`);
        modified++;
      } else {
        summary.push(`✓ ACCEPT: ${path} [${categoryTag}:${i}]`);
        accepted++;
      }
    }
  }

  targetData[fieldName] = newItems;
}

// Write updated enrichment files
const updatedFiles = [];
for (const [origin, enriched] of Object.entries(enrichmentByOrigin)) {
  const dataChanged = JSON.stringify(enriched.data) !== JSON.stringify(enriched.original);
  if (dataChanged) {
    writeJSON(enriched.path, enriched.data);
    updatedFiles.push(origin);
  }
}

// Output summary
console.log("\n" + "=".repeat(70));
console.log("Draft Enrichment Review Applied");
console.log("=".repeat(70));
summary.slice(0, 20).forEach(s => console.log(s));
if (summary.length > 20) {
  console.log(`  ... and ${summary.length - 20} more item(s)`);
}
console.log(`\n${accepted} ACCEPTED, ${rejected} REJECTED, ${modified} MODIFIED`);
console.log(`${updatedFiles.length} enrichment file(s) updated: ${updatedFiles.join(", ")}`);

if (accepted + rejected + modified > 0) {
  console.log("\n✓ Decisions applied successfully!");
  console.log("\nNext: Recompile with: node qa-studio/compile.mjs --lenient");
  console.log("Once feature lands in openapi.json, run: node qa-studio/compile.mjs (without --lenient)");
} else {
  console.log("\n⚠ No decisions applied. Fill the 'decision' column in the CSV and retry.");
}
