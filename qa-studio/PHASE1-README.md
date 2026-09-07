# Phase 1 Enrichment Review — Workflow Guide

## Overview

Phase 1 deepens enrichment across all 168 enriched paths by generating comprehensive review CSVs split by domain. You review and annotate them, then apply the decisions back to enrichment files.

This is **no live Claude API call** — all deep-enrichment reasoning is in your hands as you review the CSVs. The tool stays true to the copy-prompt → paste-result scope in CLAUDE.md.

---

## The 8-CSV Structure

| File | Domain | Approx. Rows | Target audience |
|---|---|---|---|
| `vehicles.csv` | vehicles.* | ~297 | Routing/fleet expert |
| `jobs.csv` | jobs.* | ~166 | Task modeling expert |
| `shipments.csv` | shipments.* | ~197 | Shipment / pickup-delivery expert |
| `options.csv` | options.* | ~217 | Routing options / solver modes expert |
| `relations.csv` | relations.* | ~79 | Relationships / precedence expert |
| `depots.csv` | depots.* | ~50 | Depot constraints expert |
| `zones.csv` | zones.* | ~34 | Zone / geofence expert |
| `locations-matrices.csv` | locations.*, cost_matrix, distance_matrix, duration_matrix | ~42 | Location/coordinate expert |

Each CSV can be worked on by a different SME in parallel, or all by you in sequence.

---

## CSV Columns Explained

| Column | Meaning | Examples |
|---|---|---|
| **row_id** | Stable identifier (e.g., VEH-001) — how you reference a row | VEH-042, JOB-015, OPT-093 |
| **path** | Enriched field path | vehicles.capacity, jobs.delivery, options.routing.mode |
| **field** | Enrichment section | summary, range, constraints, businessRules, validationRules, testingGuidance |
| **item_index** | Position in the final array (1 for scalar fields like summary/range) | 1, 2, 3, ... |
| **origin** | What this row represents | kept (unchanged) / reworded (same idea, tightened) / new (didn't exist) |
| **category_tag** | [testingGuidance only] Classification | Positive, Boundary, Negative-validation, Negative-infeasible, Interaction |
| **current_text** | What's in the enrichment file today (blank if origin=new) | "Positive: one vehicle with capacity [100]" |
| **suggested_text** | The proposed final text | "Positive: single vehicle, capacity [100], fulfilling one delivery [50]" |
| **rationale** | Why the suggestion exists | Spec: "capacity attribute defines multidimensional capacities", or rule-id-123 |
| **decision** | [YOU FILL IN] Accept/Reject/Modify | ACCEPT, REJECT, or MODIFY |
| **sme_notes** | [YOU FILL IN] Final wording (if MODIFY) or a comment | "Combine with multi-dim variant", or blank |

---

## Workflow: Review → Annotate → Apply

### Step 1: Generate the CSVs

CSVs are already generated in `qa-studio/enrichment-review/`. If you need to regenerate (after a spec update or to pick up new enrichment):

```bash
cd /Users/joseph/QA\ Assistant/qa-studio
node generate-enrichment-review.mjs
```

Output: 8 CSVs, 1,082 total rows, ready for review.

### Step 2: Review & Annotate

For each CSV row, decide:

**ACCEPT** — Use `suggested_text` as-is. Leave `sme_notes` blank.

**REJECT** — Drop this item entirely (it won't appear in the final enrichment). Leave `sme_notes` blank.

**MODIFY** — Reword `suggested_text`. Write your final wording in `sme_notes` — that text will be used instead.

**Blank decision** — Conservative default = REJECT (nothing is added without an explicit accept).

#### Tips

- **You don't need to review every row.** If `suggested_text` matches `current_text` and makes sense, just ACCEPT.
- **Constraints/businessRules/validationRules:** typically 3–8 items per field. If there are 10+, you can REJECT some weak ones.
- **testingGuidance:** typically 12–25 rows covering enum values, range boundaries, required-vs-optional, and rule interactions. Read the rationale to understand why each is proposed.
- **Interaction rows:** testingGuidance rows tagged "Interaction" drive combination test cases. Accept these to fund cross-field scenario generation.
- **Rationale links:** if a row cites a rule (e.g., "capacity-dimension-consistency"), check `qa-studio/rules/capacity-dimension-consistency.json` to verify the connection.

### Step 3: Apply Decisions

Once all CSVs are annotated (decisions + sme_notes filled), run:

```bash
cd /Users/joseph/QA\ Assistant/qa-studio
node apply-enrichment-review.mjs
```

The script will:

1. Read all 8 CSVs.
2. Parse your decisions (ACCEPT/REJECT/MODIFY).
3. Build final enrichment arrays (MODIFY text, ACCEPT text, drop REJECT rows).
4. Update enrichment/*.json files in place.
5. Recompile the knowledge base (runs `compile.mjs`).
6. Report summary: fields accepted/modified/rejected, files updated.

If any rows have blank decisions or parsing errors, the script **aborts** and reports them. Fix and re-run.

### Step 4: Verify

After apply, the compiler runs automatically. Check:

```bash
node qa-studio/compile.mjs
# Should report: 213 features / 168 enriched / 17 rules / 0 gaps / 0 orphans
```

Open the app to verify the enrichment loads and test generation works:

```bash
open "/Users/joseph/QA Assistant/qa-studio/start.command"
```

Run a quick test generation (a few features, small N) to confirm the deeper enrichment produces more test cases.

---

## What Happens Next (Phase 2 & 3)

- **Phase 2:** Remove the obligation ceiling in `app.js` `buildPlan()` (replace `sized = min(total, ...)` with `sized = total`), add an advisory-obligations note to the prompt.
- **Phase 3:** Documentation (README updates, etc.).

Phase 1 enrichment **must** be committed and working before those phases begin.

---

## Troubleshooting

### Script won't parse a CSV

- Check for unmatched quotes or escaped characters. The parser handles `"` inside quoted strings by doubling: `"hello""world"` → `hello"world`.
- If stuck, look at `apply-enrichment-review.mjs` line 44–73 (parseCSV function) for the exact rules.

### Applicator aborts with "decision X in row Y is unknown"

- Row decision must be exactly `ACCEPT`, `REJECT`, or `MODIFY` (case-insensitive, whitespace trimmed).
- Blank is treated as REJECT, not an error.

### Compilation fails after apply

- Check that no enrichment file got corrupted (JSON syntax). The applicator writes `JSON.stringify(obj, null, 2)`, so indentation is 2-space.
- Check console output for spec drift (paths renamed in openapi.json since Phase 1 generation).
- If drift detected, regenerate CSVs with `--lenient` flag (not yet supported; use `compile.mjs --lenient` to diagnose).

### I want to re-review a row I already decided

- Edit the CSV in place: change `decision` to a new value and fill/clear `sme_notes` as needed. Re-run apply.

### I want to keep my current enrichment and start over

- Stash the CSVs (e.g., `mv enrichment-review enrichment-review.backup`) and regenerate: `node generate-enrichment-review.mjs`. You'll get a fresh CSV set to review.

---

## Files to Edit

- **Review + annotate:** `qa-studio/enrichment-review/{vehicles,jobs,shipments,options,relations,depots,zones,locations-matrices}.csv`
- **Never hand-edit during Phase 1:** `qa-studio/enrichment/*.json` (the applicator will update them)

---

## Rollback

If you need to roll back Phase 1 (e.g., applied too aggressively and want to start over):

1. Delete `qa-studio/enrichment-review/` (your CSVs).
2. Restore enrichment files from backup or git (if available).
3. Run `compile.mjs` to rebuild the compiled layer.
4. Re-run `generate-enrichment-review.mjs` to start fresh.

Since there's no git in this project, there's no automatic undo — **be deliberate before applying**.

---

## Next Steps

1. Review the CSVs (or assign domains to different SMEs).
2. Fill in `decision` and `sme_notes` for each row.
3. Run `node apply-enrichment-review.mjs`.
4. Verify the app still works and test generation increases.
5. Document the session in PROJECT_REFERENCE.md.

Good luck!
