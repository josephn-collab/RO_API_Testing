#!/usr/bin/env node
// =============================================================================
// Phase 1 Enrichment Review Applicator
// =============================================================================
// Reads the 8 domain CSVs (with SME decisions filled in) and applies them to
// the enrichment files, then recompiles the knowledge base.
//
// Run: node qa-studio/apply-enrichment-review.mjs
// =============================================================================
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const DIR = dirname(fileURLToPath(import.meta.url));
const REVIEW_DIR = join(DIR, "enrichment-review");
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
          j++; // Skip next quote
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

    // Add last column
    if (col < headers.length) {
      row[headers[col]] = current.trim();
    }

    if (Object.keys(row).length > 0) {
      rows.push(row);
    }
  }

  return rows;
}

// Load all review CSVs
console.log("Loading review CSVs...\n");
const csvFiles = readdirSync(REVIEW_DIR).filter(f => f.endsWith(".csv")).sort();
const allReviewRows = [];

for (const file of csvFiles) {
  const content = readFileSync(join(REVIEW_DIR, file), "utf8");
  const rows = parseCSV(content);
  allReviewRows.push(...rows);
  console.log(`✓ ${file}: ${rows.length} rows`);
}

console.log(`\nTotal review rows loaded: ${allReviewRows.length}`);

// Group by (path, field)
const byPathField = {};
allReviewRows.forEach(row => {
  const key = `${row.path}|${row.field}`;
  if (!byPathField[key]) byPathField[key] = [];
  byPathField[key].push(row);
});

// Process decisions
console.log("\nProcessing SME decisions...\n");

const stats = {
  accepted: 0,
  rejected: 0,
  modified: 0,
  blank: 0,
  errors: [],
};

const updatedFields = {}; // path → { field → [...items] }

for (const [pathField, rows] of Object.entries(byPathField)) {
  const [path, field] = pathField.split("|");

  // Sort by item_index
  rows.sort((a, b) => parseInt(a.item_index) - parseInt(b.item_index));

  const items = [];

  for (const row of rows) {
    const decision = row.decision?.toUpperCase().trim() || "";

    if (decision === "ACCEPT") {
      items.push(row.suggested_text);
      stats.accepted++;
    } else if (decision === "MODIFY") {
      if (!row.sme_notes) {
        stats.errors.push(`${path}.${field} row ${row.row_id}: MODIFY but no sme_notes provided`);
      } else {
        items.push(row.sme_notes);
        stats.modified++;
      }
    } else if (decision === "REJECT") {
      stats.rejected++;
      // Item is dropped
    } else if (decision === "") {
      stats.blank++;
      // Conservative default: treat blank as REJECT
      console.log(`⚠ ${path}.${field} row ${row.row_id}: blank decision (treating as REJECT)`);
    } else {
      stats.errors.push(`${path}.${field} row ${row.row_id}: unknown decision '${decision}'`);
    }
  }

  if (!updatedFields[path]) updatedFields[path] = {};
  updatedFields[path][field] = items;
}

console.log(`Accepted: ${stats.accepted}, Modified: ${stats.modified}, Rejected: ${stats.rejected}, Blank: ${stats.blank}`);

if (stats.errors.length > 0) {
  console.log("\n⚠ Errors found:");
  stats.errors.forEach(e => console.log(`  ${e}`));
  console.log("\nPlease fix these errors and re-run.");
  process.exit(1);
}

// Apply to enrichment files
console.log("\nApplying to enrichment files...\n");

const enrichmentFiles = readdirSync(ENRICHMENT_DIR).filter(f => f.endsWith(".json"));
const pathsUpdated = new Set();
const pathsSkipped = [];

for (const path of Object.keys(updatedFields)) {
  const file = join(ENRICHMENT_DIR, `${path}.json`);

  if (!existsSync(file)) {
    console.log(`⚠ File not found: ${file}`);
    pathsSkipped.push(path);
    continue;
  }

  const enrichment = readJSON(file);

  // Update each field
  for (const [field, items] of Object.entries(updatedFields[path])) {
    if (items.length === 0) {
      // If no items accepted, remove the field or leave empty array
      enrichment[field] = [];
    } else if (["summary", "range"].includes(field)) {
      // Scalar fields: take first item
      enrichment[field] = items[0];
    } else {
      // Array fields
      enrichment[field] = items;
    }
  }

  writeJSON(file, enrichment);
  pathsUpdated.add(path);
}

console.log(`Updated: ${pathsUpdated.size} enrichment files`);
if (pathsSkipped.length > 0) {
  console.log(`Skipped: ${pathsSkipped.length} paths (files not found)`);
}

// Recompile
console.log("\nRecompiling knowledge base...");
try {
  const compileOut = execSync("node compile.mjs", { cwd: DIR }).toString();
  console.log("✓ Compilation successful");

  // Parse output to find obligation changes
  const match = compileOut.match(/enriched.*?(\d+)/i);
  if (match) {
    console.log(`\n${compileOut.split("\n").find(l => l.includes("enriched") || l.includes("obligation")) || ""}`);
  }
} catch (err) {
  console.error("✖ Compilation failed:");
  console.error(err.toString());
  process.exit(1);
}

console.log("\n✓ Phase 1 enrichment review applied!");
console.log(`\nSummary:`);
console.log(`  Fields accepted: ${stats.accepted}`);
console.log(`  Fields modified: ${stats.modified}`);
console.log(`  Fields rejected: ${stats.rejected}`);
console.log(`  Blank decisions: ${stats.blank}`);
console.log(`  Enrichment files updated: ${pathsUpdated.size}`);
