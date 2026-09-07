# Draft Features: Complete Step-by-Step Workflow

## Overview

This workflow handles draft API features from design to production integration. Use it every time a new feature ships before the OpenAPI spec is updated.

---

## PHASE 1: ADD DRAFT FEATURE

### Step 1.1: Store the feature document

```bash
# Save the feature specification PDF from engineering
Knowledge/new_features_without_spec/[Feature Name]-YYYYMMDDHHMMSS.pdf
```

### Step 1.2: Create overlay.json entry

Edit `qa-studio/overlay.json` and add a new feature block:

```json
{
  "id": "split-order",
  "source": "[Atomic] Split Order Feature-2026071721444587.pdf",
  "status": "draft",
  "title": "Split Order / Split Jobs Across Vehicles",
  "target": "jobs.items.properties",  // Where to merge in schema
  "description": "Allow large jobs to be split across multiple vehicles...",
  "fields": {
    "split": {
      "type": "object",
      "description": "Split Order configuration (DRAFT)",
      "properties": {
        "can_be_split": {
          "type": "boolean",
          "description": "Whether this job may be split",
          "default": false
        }
        // ... other properties
      }
    }
  },
  "constraints": ["List of constraints"],
  "testingSuggestions": ["Test scenario 1", "Test scenario 2"],
  "limitations": ["Limitation 1"],
  "enrichment_references": [],  // Will fill after authoring
  "rule_references": []         // Will fill after authoring
}
```

**✓ Checkpoint:** Overlay entry created with schema definition.

---

## PHASE 2: AUTHOR ENRICHMENT & RULES

### Step 2.1: Create enrichment files

For each field in the draft feature, create a JSON file in `qa-studio/enrichment/`:

**Filename:** `[entity].[field].[subfield].json`

**Example:** `jobs.split.can_be_split.json`

```json
{
  "path": "jobs.items.properties.split.properties.can_be_split",
  "summary": "Boolean flag controlling whether a job may be split across multiple vehicles",
  "range": {
    "type": "boolean",
    "default": false
  },
  "constraints": [
    "Default false; split is opt-in per job",
    "Applies to jobs only (not shipments)"
  ],
  "businessRules": [
    "If can_be_split=false and job demand > vehicle capacity → job unassigned",
    "If can_be_split=true and vehicles available → job split across vehicles"
  ],
  "validationRules": [
    "Type must be boolean",
    "If true, max_splits must be present and ≥ 1"
  ],
  "testingGuidance": [
    "Positive: can_be_split=false with demand in single-vehicle capacity → assigned",
    "Positive: can_be_split=true with max_splits≥1 → job split across vehicles",
    "Negative-validation: can_be_split=true without max_splits → HTTP 400",
    "Negative-infeasible: can_be_split=false with 5x vehicle capacity → unassigned"
  ],
  "related": ["jobs.split.max_splits", "jobs.delivery", "vehicles.capacity"],
  "rules": ["split-job-capacity-feasibility"],
  "_source": "[Atomic] Split Order Feature-2026071721444587.pdf, section 2"
}
```

**Create one file per field.** Keep paths consistent.

### Step 2.2: Create cross-field rules (if needed)

In `qa-studio/rules/`, create rules for interactions:

**Filename:** `split-[constraint-name].json`

```json
{
  "id": "split-job-capacity-feasibility",
  "summary": "A job with split.can_be_split=true may be split across vehicles if demand exceeds capacity",
  "applies_to": [
    "jobs.delivery",
    "jobs.pickup",
    "vehicles.capacity"
  ],
  "rule": "When split object present with can_be_split=true: if job.delivery > max(capacity), split across vehicles. If can_be_split=false: if demand > capacity, job unassigned.",
  "testingGuidance": [
    "Positive: delivery=[2], 2 vehicles capacity=[1] each, can_be_split=true → split",
    "Negative-infeasible: delivery=[5], 2 vehicles capacity=[1] each, can_be_split=false → unassigned"
  ],
  "_source": "[Feature Name]-YYYYMMDDHHMMSS.pdf, section X"
}
```

**⚠️ Important:** `applies_to` must reference existing spec paths, not draft fields.

### Step 2.3: Update overlay references

Edit `qa-studio/overlay.json` again and add file pointers:

```json
{
  "id": "split-order",
  ...
  "enrichment_references": [
    "qa-studio/enrichment/jobs.split.can_be_split.json",
    "qa-studio/enrichment/jobs.split.max_splits.json",
    "qa-studio/enrichment/jobs.split.quant.json"
  ],
  "rule_references": [
    "qa-studio/rules/split-job-capacity-feasibility.json",
    "qa-studio/rules/split-shipment-rejection.json"
  ]
}
```

### Step 2.4: Compile with --lenient

```bash
cd qa-studio
node compile.mjs --lenient
```

Expected output:
```
✓ compiled 213 features (168 enriched), 21 rules
⚠ 3 orphaned enrichment path(s) (lenient): jobs.items.properties.split.properties.*
```

**Orphaned enrichment is normal for draft features — OK to proceed.**

**✓ Checkpoint:** Enrichment files created + rules linked + compiler runs with --lenient.

---

## PHASE 3: REVIEW — SME DECISION CSV

### Step 3.1: Generate the CSV

```bash
cd qa-studio
node generate-draft-enrichment-review.mjs
```

Output:
```
✓ Generated draft features CSV: qa-studio/enrichment-review/draft-features.csv
  3 enrichment row(s) for 1 draft feature(s)
```

### Step 3.2: Open and review the CSV

**File:** `qa-studio/enrichment-review/draft-features.csv`

Open in Excel / Numbers / Google Sheets.

**For each row, review columns:**
- `businessRules` — Are they accurate? Complete?
- `validationRules` — Do they match the spec?
- `testingGuidance` — Do they cover all scenarios?
- `constraints` — Are they clear and correct?

### Step 3.3: Fill in your decision

For each row, set the `decision` column to ONE of:

| Decision | When to use | Effect |
|----------|-------------|--------|
| `ACCEPT` | Enrichment is correct and complete | Removes `status: "proposed"` marker |
| `REJECT` | Don't test this field (out of scope) | Deletes enrichment file |
| `MODIFY` | Need to edit (add/remove rules, clarify tests) | Keep; you'll edit JSON manually |

**Optional:** Add notes in the `sme_notes` column.

**Example:**
```csv
DRF-001,split-order,jobs.items.properties.split.properties.can_be_split,can_be_split,boolean,"...",ACCEPT,Looks good
DRF-002,split-order,jobs.items.properties.split.properties.max_splits,max_splits,integer,"...",ACCEPT,
DRF-003,split-order,jobs.items.properties.split.properties.quant,quant,number,"...",MODIFY,Clarify multi-dimension behavior in testingGuidance
```

**✓ Checkpoint:** CSV reviewed and decisions filled in.

---

## PHASE 4: APPLY — Process Decisions

### Step 4.1: For MODIFY decisions, edit the JSON files

If you chose MODIFY, edit the enrichment JSON directly:

```bash
nano qa-studio/enrichment/jobs.split.quant.json
```

Example edits:
- Clarify a testingGuidance bullet
- Add a businessRule
- Remove a constraint
- Update the description

Save the file.

### Step 4.2: Run the applier

```bash
cd qa-studio
node apply-draft-enrichment-review.mjs
```

Output:
```
======================================================================
Draft Enrichment Review Applied
======================================================================
✓ ACCEPT (ratified): jobs.items.properties.split.properties.can_be_split
✓ ACCEPT (ratified): jobs.items.properties.split.properties.max_splits
✓ MODIFY (review manually applied): jobs.items.properties.split.properties.quant

3 ACCEPTED, 0 REJECTED, 1 MODIFIED

Next: Recompile with: node qa-studio/compile.mjs --lenient
```

### Step 4.3: Recompile

```bash
node compile.mjs --lenient
```

Verify:
```
✓ compiled 213 features (168 enriched), 21 rules
⚠ 0 orphaned enrichment path(s)  ← Fewer orphans = good
```

**✓ Checkpoint:** Decisions applied, enrichment ratified, compilation successful.

---

## PHASE 5: INTEGRATE — Feature Ships in Spec

When engineering releases the feature in the OpenAPI spec:

### Step 5.1: Update openapi.json

```bash
# From engineering, receive the updated openapi.json
cp ~/downloads/openapi-new.json qa-studio/openapi.json
cp ~/downloads/openapi-new.json Knowledge/openapi.json  # Keep in sync
```

### Step 5.2: Delete the overlay entry

Edit `qa-studio/overlay.json` and **remove the entire feature block**:

```json
{
  "note": "Draft feature definitions...",
  "features": [
    // DELETE THIS ENTIRE BLOCK:
    // {
    //   "id": "split-order",
    //   ...all content...
    // }
  ]
}
```

### Step 5.3: Verify enrichment paths

The enrichment files are still valid. If the spec changed the field structure, update the `path` in each file:

```json
{
  "path": "jobs.items.properties.split.properties.can_be_split",  // Update if structure changed
  ...
}
```

**✓ Checkpoint:** Spec updated, overlay deleted, enrichment paths verified.

---

## PHASE 6: FINALIZE — Remove Draft Layer

### Step 6.1: Recompile WITHOUT --lenient

```bash
cd qa-studio
node compile.mjs
```

Expected output:
```
✓ compiled 213 features (171 enriched), 21 rules
⊘ 0 orphaned enrichment path(s)  ← No more orphans!
```

**If orphans appear:** The enrichment path doesn't match the new spec. Verify the `path` field in the enrichment JSON matches the actual spec structure.

### Step 6.2: Verify in the app

1. Reload the app: `http://localhost:8000/qa-studio/`
2. Check the feature tree: Split fields should appear **without the amber "draft" chip**
3. Select them: They should behave like regular production fields

### Step 6.3: Update PROJECT_REFERENCE.md

Add a changelog entry:

```markdown
| 2026-MM-DD | **Integrated Split Order feature.** Removed overlay entry for split-order; enrichment now embedded in compiled KB. Feature path count: 168 → 171 (3 new split fields). Verified: compile.mjs --lenient → compile.mjs (orphans: 3 → 0), app loads split fields as production features without draft chip. | qa-studio/openapi.json, overlay.json, enrichment/jobs.split.*, PROJECT_REFERENCE.md |
```

**✓ Checkpoint:** Feature is now production; draft layer completely removed.

---

## Quick Command Reference

```bash
# Phase 2: Author
cd qa-studio
node compile.mjs --lenient

# Phase 3: Review
node generate-draft-enrichment-review.mjs
# → Edit: qa-studio/enrichment-review/draft-features.csv

# Phase 4: Apply
node apply-draft-enrichment-review.mjs
node compile.mjs --lenient

# Phase 5–6: Integrate & finalize
# (Manual: update openapi.json, remove overlay entry)
node compile.mjs  # No --lenient
```

---

## Decision Tree

**Should I ACCEPT, REJECT, or MODIFY?**

```
┌─ Is the enrichment correct per the spec?
│  ├─ YES, complete and comprehensive → ACCEPT
│  ├─ NO, delete this field → REJECT
│  └─ YES but needs clarification → Edit JSON + set MODIFY
│
└─ Run applier:  node apply-draft-enrichment-review.mjs
   Then recompile: node compile.mjs --lenient
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| CSV is blank | Run `generate-draft-enrichment-review.mjs` — make sure overlay.json has enrichment_references |
| Compile fails with orphans | Use `--lenient` flag; draft fields aren't in spec yet |
| Draft chip still showing after integration | Recompile with `compile.mjs` (no --lenient); verify overlay entry was deleted |
| Enrichment file not applying | Check `path` field matches the overlay `target` field |
| Can't find enrichment files | Verify filenames match paths in overlay `enrichment_references` |

---

## Files Modified During Workflow

| When | File | What |
|------|------|------|
| Phase 1 | `qa-studio/overlay.json` | Add feature entry |
| Phase 2 | `qa-studio/enrichment/*.json` | Create 1+ per field |
| Phase 2 | `qa-studio/rules/*.json` | Create cross-field rules |
| Phase 2 | `qa-studio/overlay.json` | Add enrichment_references |
| Phase 3 | `qa-studio/enrichment-review/draft-features.csv` | Generated (read & annotate) |
| Phase 4 | `qa-studio/enrichment/*.json` | Edit for MODIFY decisions |
| Phase 5 | `qa-studio/openapi.json` | Replace with new spec |
| Phase 5 | `qa-studio/overlay.json` | Delete feature entry |
| Phase 6 | `PROJECT_REFERENCE.md` | Update changelog |

---

## Support

- **Detailed guide:** See `DRAFT_FEATURES_WORKFLOW.md`
- **Quick checklist:** See `DRAFT_FEATURES_QUICK_REFERENCE.md`
- **Examples:** See Phase 2 changes for `split-order` feature

