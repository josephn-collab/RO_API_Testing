# Draft Features Enrichment Workflow

This document describes the complete workflow for authoring, reviewing, and integrating draft API features that are not yet in the OpenAPI spec.

**Key principle:** Draft features are authored in a separate layer (`overlay.json` + `enrichment/` + `rules/`) for SME review before landing in the live API spec. Once a feature ships in the real `openapi.json`, the draft layer is deleted and the enrichment is merged into the main knowledge base.

---

## Phase Overview

| Phase | What | When | Who | Output |
|-------|------|------|-----|--------|
| **1. Add** | Feature spec doc + overlay definition | Feature design complete | Engineering + Product | Feature PDF + overlay.json entry |
| **2. Author** | Enrichment + cross-field rules | Before SME review | Claude (AI + Claude Code) | Enrichment JSON files + rules |
| **3. Review** | CSV-based decision workflow | Feature ready for testing | QA SME | Marked-up CSV + decisions |
| **4. Apply** | Accept/Reject/Modify decisions | After review | Claude (apply script) | Ratified enrichment + recompile |
| **5. Integrate** | Feature lands in openapi.json | Release time | Engineering | Update openapi.json + delete overlay |
| **6. Finalize** | Remove draft layer, recompile | After integration | Claude | Production knowledge base |

---

## Step-by-Step Process

### **PHASE 1: ADD — New Draft Feature**

#### 1.1 Where to add the feature document

```
Knowledge/new_features_without_spec/
├── [Feature Name]-YYYYMMDDHHMMSS.pdf    ← Add here
├── [Other Feature].pdf
└── overlay.json                          ← Update this
```

**Files to create:**
- `Knowledge/new_features_without_spec/[Feature Name]-YYYYMMDDHHMMSS.pdf` — The feature spec from engineering
- Update `qa-studio/overlay.json` with a new feature entry (template below)

**Example overlay entry structure:**
```json
{
  "id": "feature-name",
  "source": "[Feature Name]-YYYYMMDDHHMMSS.pdf",
  "status": "draft",
  "title": "Feature Title",
  "target": "jobs.items.properties",  // Where in spec to merge
  "description": "What this feature does",
  "fields": {
    "field_name": {
      "type": "object|string|number|boolean|array",
      "description": "Field purpose",
      "properties": { /* nested structure */ }
    }
  },
  "constraints": ["Constraint 1", "Constraint 2"],
  "responseFields": { /* optional response additions */ },
  "testingSuggestions": ["Scenario 1", "Scenario 2"],
  "limitations": ["Limitation 1"],
  "enrichment_references": [],  // Will populate after authoring
  "rule_references": []         // Will populate after authoring
}
```

---

### **PHASE 2: AUTHOR — Create Enrichment & Rules**

#### 2.1 Author enrichment files manually

For each draft field, create a file in `qa-studio/enrichment/`:

```bash
qa-studio/enrichment/
├── [entity].[field].[subfield].json
├── [entity].[field].[subfield].json
└── ...
```

**File structure (from split-order example):**
```json
{
  "path": "jobs.items.properties.split.properties.can_be_split",
  "summary": "Short description of the field",
  "range": { "type": "boolean", "default": false },
  "constraints": ["List of constraints"],
  "businessRules": ["Rule 1", "Rule 2", "..."],
  "validationRules": ["Validation 1", "Validation 2"],
  "testingGuidance": [
    "Positive: scenario 1",
    "Boundary: scenario 2",
    "Negative-validation: scenario 3",
    "Negative-infeasible: scenario 4"
  ],
  "related": ["related.field.1", "related.field.2"],
  "rules": ["rule-id-1", "rule-id-2"],
  "_source": "[Feature Name]-YYYYMMDDHHMMSS.pdf, section X"
}
```

#### 2.2 Author cross-field rules (if applicable)

For interactions between draft fields and existing spec paths, create rules in `qa-studio/rules/`:

```json
{
  "id": "draft-feature-rule-name",
  "summary": "What this rule enforces",
  "applies_to": [
    "existing.spec.path.1",
    "existing.spec.path.2"
  ],
  "rule": "The invariant or constraint description",
  "testingGuidance": [
    "Positive: test case 1",
    "Negative-validation: test case 2"
  ],
  "_source": "[Feature Name]-YYYYMMDDHHMMSS.pdf, section X"
}
```

**⚠️ Important:** Rules' `applies_to` must reference **existing spec paths**, not draft fields (compiler validation). Mention draft fields in the rule description and testingGuidance.

#### 2.3 Update overlay.json with references

Add the file paths to the overlay entry:

```json
{
  "id": "split-order",
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

#### 2.4 Compile with `--lenient` flag

The draft enrichment files won't resolve in the spec (overlay hasn't been merged yet), so use:

```bash
cd qa-studio
node compile.mjs --lenient
```

Expected output:
```
✓ compiled 213 features (168 enriched), 21 rules, 6 cluster(s).
⚠ 3 orphaned enrichment path(s) (lenient): jobs.items.properties.split.properties.*
```

The orphaned enrichment is **normal** for draft features — they won't be embedded until the spec is updated. The overlay handles merging them at app runtime.

---

### **PHASE 3: REVIEW — SME Decision Workflow**

#### 3.1 Generate the review CSV

```bash
cd qa-studio
node generate-draft-enrichment-review.mjs
```

**Output:** `qa-studio/enrichment-review/draft-features.csv`

**CSV structure:**
```
row_id,feature_id,path,field,category,businessRules,validationRules,testingGuidance,constraints,decision,sme_notes
DRF-001,split-order,jobs.items.properties.split.properties.can_be_split,can_be_split,boolean,"Rule 1 | Rule 2 | ...","Validation 1 | ...","Positive: ... | Boundary: ... | ...","Constraint 1 | ...",ACCEPT,
DRF-002,split-order,jobs.items.properties.split.properties.max_splits,max_splits,integer,"Rule 1 | ...","Validation 1 | ...","Positive: ... | ...","Constraint 1 | ...",
```

#### 3.2 Where to review

**Open the CSV in your spreadsheet tool:**
```
qa-studio/enrichment-review/draft-features.csv
```

**For each row, fill:**
- **decision** column: One of `ACCEPT`, `REJECT`, or `MODIFY`
- **sme_notes** column (optional): Any notes about your decision

**Decision meanings:**
- `ACCEPT` — The enrichment is correct; mark it as ratified (remove `status: "proposed"`)
- `REJECT` — Delete this enrichment file; the feature won't be testable
- `MODIFY` — Keep the enrichment but with edits you'll make manually (see step 3.3)

#### 3.3 Manual modifications (if MODIFY)

If you choose `MODIFY`, edit the enrichment JSON file directly:

```bash
# Edit the file(s) marked MODIFY
nano qa-studio/enrichment/jobs.split.can_be_split.json
# Make your changes, save, and continue to step 4
```

Common edits:
- Add/remove businessRules
- Clarify testingGuidance bullets
- Adjust constraints
- Link additional related fields

---

### **PHASE 4: APPLY — Process Decisions**

#### 4.1 Apply the CSV decisions

```bash
cd qa-studio
node apply-draft-enrichment-review.mjs
```

**What it does:**
- `ACCEPT` → Removes the `status: "proposed"` field (ratifies the enrichment)
- `REJECT` → Deletes the enrichment file from disk
- `MODIFY` → Notes the decision (you've already edited manually)

**Output:**
```
======================================================================
Draft Enrichment Review Applied
======================================================================
✓ ACCEPT (ratified): jobs.items.properties.split.properties.can_be_split
✓ ACCEPT (ratified): jobs.items.properties.split.properties.max_splits
✗ REJECT (deleted): jobs.items.properties.split.properties.quant

3 ACCEPTED, 1 REJECTED, 0 MODIFIED

Next: Recompile with: node qa-studio/compile.mjs --lenient
```

#### 4.2 Recompile

```bash
cd qa-studio
node compile.mjs --lenient
```

Verify the output looks healthy:
```
✓ compiled 213 features (168 enriched), 20 rules, 6 cluster(s).
⚠ 2 orphaned enrichment path(s) (lenient): ...  ← Fewer orphans = good
```

---

### **PHASE 5: INTEGRATE — Feature Ships in Spec**

When engineering lands the feature in the OpenAPI spec:

#### 5.1 Update openapi.json

Replace `qa-studio/openapi.json` with the new version from engineering:

```bash
# From engineering, receive the updated openapi.json
cp ~/Downloads/openapi-new.json qa-studio/openapi.json
cp ~/Downloads/openapi-new.json Knowledge/openapi.json  # Keep in sync
```

#### 5.2 Delete the overlay entry

Remove the feature from `qa-studio/overlay.json`:

```json
{
  "note": "...",
  "features": [
    // Remove the entire block for split-order:
    // {
    //   "id": "split-order",
    //   ...
    // }
  ]
}
```

#### 5.3 Keep enrichment files

**Do NOT delete the enrichment files!** They're now valid against the real spec. Update their `path` fields if the spec changed the structure:

```json
{
  "path": "jobs.items.properties.split.properties.can_be_split",  // Update if needed
  ...
}
```

---

### **PHASE 6: FINALIZE — Remove Draft Layer**

#### 6.1 Recompile without `--lenient`

```bash
cd qa-studio
node compile.mjs
```

**Expected result:**
```
✓ compiled 213 features (168 enriched), 20 rules, 6 cluster(s).
⊘ 0 orphaned enrichment path(s)  ← No more orphans!
```

The enrichment files are now **embedded** in the compiled output.

#### 6.2 Verify in the app

- Reload the app (`http://localhost:8000/qa-studio/`)
- The split fields should **no longer have the amber "draft" chip**
- They should appear as regular testable fields in the feature tree

#### 6.3 Update PROJECT_REFERENCE.md

Add a changelog entry:

```markdown
| 2026-MM-DD | **Integrated Split Order feature.** Removed overlay entry, enrichment now embedded in compiled KB. Feature path count: 168 → 171 (3 new split fields). Verified: compile.mjs --lenient → compile.mjs (orphans: 3 → 0), app loads split fields as production features. | qa-studio/openapi.json, overlay.json, enrichment/jobs.split.*, PROJECT_REFERENCE.md |
```

---

## Summary Checklist

### Before SME Review
- [ ] Feature PDF in `Knowledge/new_features_without_spec/`
- [ ] `overlay.json` entry created with schema definition
- [ ] 1 enrichment file per draft field (e.g., `jobs.split.can_be_split.json`)
- [ ] Cross-field rules created (referencing existing spec paths)
- [ ] `overlay.json` updated with enrichment/rule references
- [ ] `node compile.mjs --lenient` succeeds
- [ ] App loads overlay; draft fields appear in tree with amber chip

### After SME Review
- [ ] CSV generated: `qa-studio/enrichment-review/draft-features.csv`
- [ ] Decision filled in for each row (ACCEPT/REJECT/MODIFY)
- [ ] SME notes added as needed
- [ ] `node apply-draft-enrichment-review.mjs` runs without error
- [ ] Recompiled: `node compile.mjs --lenient`

### After Feature Ships
- [ ] `openapi.json` updated with feature in real spec
- [ ] Overlay entry deleted from `overlay.json`
- [ ] Enrichment file paths updated if spec structure changed
- [ ] `node compile.mjs` (without `--lenient`) succeeds
- [ ] App verified: draft chip gone, fields are production
- [ ] `PROJECT_REFERENCE.md` updated with integration date

---

## Example: Split Order Workflow

### 1. Add
```bash
# PDF already in: Knowledge/new_features_without_spec/[Atomic] Split Order Feature-2026071721444587.pdf
# Update overlay.json with split-order entry
git add Knowledge/new_features_without_spec/
git add qa-studio/overlay.json
```

### 2. Author
```bash
# Create enrichment
touch qa-studio/enrichment/jobs.split.can_be_split.json
touch qa-studio/enrichment/jobs.split.max_splits.json
touch qa-studio/enrichment/jobs.split.quant.json

# Create rules
touch qa-studio/rules/split-*.json

# Update overlay references
node qa-studio/compile.mjs --lenient
```

### 3. Review
```bash
node qa-studio/generate-draft-enrichment-review.mjs
# → qa-studio/enrichment-review/draft-features.csv
# Open in Excel/Numbers, fill in decisions
```

### 4. Apply
```bash
node qa-studio/apply-draft-enrichment-review.mjs
node qa-studio/compile.mjs --lenient
```

### 5–6. Integrate & Finalize
```bash
# When feature ships:
cp ~/downloads/openapi.json qa-studio/openapi.json
# Remove overlay entry for split-order
node qa-studio/compile.mjs  # No --lenient
# App reloaded → split fields are production
```

---

## FAQ

**Q: Can I test draft features in the app before they ship?**
A: Yes! The overlay merges them at runtime, so they appear in the feature tree (amber "draft" chip) and can be selected for test case generation. The skills layer treats them the same as production fields.

**Q: What if I need to reject some fields but keep others?**
A: Set decision = `REJECT` for the fields to delete, `ACCEPT` for the rest. The applier handles this per-field.

**Q: Can I modify enrichment after ACCEPT?**
A: Yes. Open the JSON file, edit it, and recompile. The decision is just for initial ratification; the enrichment is live.

**Q: What if the spec changes while I'm reviewing?**
A: Run `node compile.mjs --lenient` again. If the spec change invalidates a draft field path, the compiler will report it as orphaned (lenient downgrades it to a warning). You can then decide to reject that field or update its path in the enrichment file.

**Q: Can I have multiple draft features at once?**
A: Yes! The CSV generator collects all features from overlay.json and generates one row per field. The applier processes them all in one run.

**Q: How do I add a new draft feature while reviewing an existing one?**
A: Just add a new entry to overlay.json. On next run of `generate-draft-enrichment-review.mjs`, it will append new rows to the CSV (keeping previous decisions intact if you append=true, or regenerate fresh if you want to re-review).

---

## Related Files

| File | Purpose |
|------|---------|
| `qa-studio/overlay.json` | Draft feature definitions (schema + metadata) |
| `qa-studio/enrichment/` | Enrichment JSON for in-scope spec fields + draft fields |
| `qa-studio/rules/` | Cross-field rules (17 base + draft-specific) |
| `qa-studio/generate-draft-enrichment-review.mjs` | Generate CSV from draft features |
| `qa-studio/apply-draft-enrichment-review.mjs` | Apply SME decisions to enrichment |
| `qa-studio/enrichment-review/draft-features.csv` | SME review workbook |
| `Knowledge/new_features_without_spec/` | Feature PDFs (source docs) |
| `PROJECT_REFERENCE.md` | Master project documentation |

---

## Next Steps

1. For the next draft feature, follow the Phase 1–6 workflow above.
2. Accumulate multiple draft features if desired; process them all together in Phase 3–4.
3. Once a feature ships, follow Phase 5–6 to integrate and finalize.

