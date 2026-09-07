#!/usr/bin/env node
// =============================================================================
// Phase 1 Review Status Checker
// =============================================================================
// Quick status check: where are we in the Phase 1 workflow?
// Run this to see: CSVs ready? Decisions filled? Applicator run? Compiled?
//
// Usage: node qa-studio/phase1-status.mjs
// =============================================================================

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIR = process.cwd();
const REVIEW_DIR = join(DIR, "qa-studio", "enrichment-review");
const ENRICHMENT_DIR = join(DIR, "qa-studio", "enrichment");

console.log("=".repeat(70));
console.log("PHASE 1 ENRICHMENT REVIEW — STATUS CHECK");
console.log("=".repeat(70));
console.log("");

// 1. Check if CSVs exist
const csvFiles = readdirSync(REVIEW_DIR).filter(f => f.endsWith(".csv"));
console.log(`✓ CSVs generated: ${csvFiles.length} files`);
console.log(`  Location: qa-studio/enrichment-review/`);
console.log("");

// 2. Check decision fill status
console.log("Decision Status (by CSV):");
let totalRows = 0;
let totalDecisions = 0;
let hasAccept = 0;
let hasReject = 0;
let hasModify = 0;
let hasBlank = 0;

for (const csv of csvFiles.sort()) {
  const content = readFileSync(join(REVIEW_DIR, csv), "utf8");
  const lines = content.trim().split("\n").slice(1); // skip header

  let accepts = 0, rejects = 0, modifies = 0, blanks = 0;

  for (const line of lines) {
    const cols = line.split(",");
    const decision = cols[9]?.trim().toUpperCase() || "";

    if (decision === "ACCEPT") accepts++;
    else if (decision === "REJECT") rejects++;
    else if (decision === "MODIFY") modifies++;
    else blanks++;
  }

  totalRows += lines.length;
  totalDecisions += accepts + rejects + modifies;
  hasAccept += accepts;
  hasReject += rejects;
  hasModify += modifies;
  hasBlank += blanks;

  const pct = lines.length > 0 ? Math.round((accepts + rejects + modifies) / lines.length * 100) : 0;
  const status = pct === 100 ? "✅ COMPLETE" : `⏳ ${pct}%`;
  console.log(`  ${csv.padEnd(30)} ${status.padEnd(12)} (A:${accepts} R:${rejects} M:${modifies} B:${blanks})`);
}

console.log("");
console.log(`Total Rows: ${totalRows}`);
console.log(`Decisions Filled: ${totalDecisions}/${totalRows} (${Math.round(totalDecisions/totalRows*100)}%)`);
console.log(`  ACCEPT: ${hasAccept}`);
console.log(`  REJECT: ${hasReject}`);
console.log(`  MODIFY: ${hasModify}`);
console.log(`  BLANK:  ${hasBlank}`);
console.log("");

// 3. Workflow Status
console.log("Workflow Status:");

if (totalDecisions === 0) {
  console.log("  ⏳ STAGE 1: WAITING FOR SME REVIEW");
  console.log("     → Open CSVs in qa-studio/enrichment-review/");
  console.log("     → Fill decision column (ACCEPT/REJECT/MODIFY)");
  console.log("     → Save CSVs");
  console.log("");
} else if (hasBlank > 0) {
  console.log("  ⏳ STAGE 1.5: REVIEW IN PROGRESS");
  console.log(`     → ${hasBlank} rows still have blank decisions`);
  console.log("     → Continue filling remaining rows");
  console.log("     → Fill any MODIFY rows with final text in sme_notes");
  console.log("");
} else {
  console.log("  ✅ STAGE 1 COMPLETE: All decisions filled");
  console.log("");
  console.log("  Next: Run the applicator to apply changes to enrichment/*.json");
  console.log("     → node qa-studio/apply-enrichment-review.mjs");
  console.log("");
}

// 4. Check if applicator has been run
const samplePath = join(ENRICHMENT_DIR, "vehicles.capacity.json");
if (existsSync(samplePath)) {
  const enrichment = JSON.parse(readFileSync(samplePath, "utf8"));
  console.log("Enrichment File Status:");
  console.log(`  ✓ ${samplePath.split("/").pop()} exists`);
  console.log(`    summary: ${enrichment.summary ? "✓" : "✗"}`);
  console.log(`    testingGuidance: ${enrichment.testingGuidance?.length || 0} items`);
  console.log(`    businessRules: ${enrichment.businessRules?.length || 0} items`);
  console.log("");
}

// 5. Recommendations
console.log("Recommendations:");
if (totalDecisions < totalRows) {
  console.log("  1. Open CSVs and continue filling decisions");
  console.log("  2. Start with BUSINESSRULES rows (higher impact)");
  console.log("  3. Most 'field defines...' rows are safe to ACCEPT");
  console.log("  4. Reject rules that don't apply to your API");
  console.log("");
} else if (hasBlank === 0) {
  console.log("  1. Run: node qa-studio/apply-enrichment-review.mjs");
  console.log("  2. Verify: node qa-studio/compile.mjs");
  console.log("  3. Test app: open qa-studio/start.command");
  console.log("");
}

console.log("=".repeat(70));
