# Draft Features CSV Structure — Now Matches Phase 1

## Before vs. After

### ❌ Before (Incorrect)
**One row per field** — all items crammed into single columns:

```
row_id,feature_id,path,field,category,businessRules,validationRules,testingGuidance,constraints,decision,sme_notes
DRF-001,split-order,jobs.split.can_be_split,can_be_split,unknown,"Rule 1 | Rule 2 | Rule 3 | Rule 4 | Rule 5 | Rule 6","Validation 1 | Validation 2 | Validation 3","Positive: ... | Boundary: ... | Negative: ...","Constraint 1 | Constraint 2 | ...","",
```

**Problems:**
- ❌ Cannot review individual items
- ❌ Cannot reject a single businessRule while keeping others
- ❌ Does not match Phase 1 CSV structure
- ❌ Hard to apply granular decisions

---

### ✅ After (Correct — Phase 1 Pattern)
**One row per item** — like Phase 1 enrichment review:

```
row_id,path,field,item_index,origin,category_tag,current_text,suggested_text,rationale,decision,sme_notes
DRF-0001,jobs.items.properties.split.properties.can_be_split,can_be_split,0,jobs.split.can_be_split.json,constraint,Default value is false; split is opt-in per job.,,Boolean flag... [constraint],ACCEPT,
DRF-0002,jobs.items.properties.split.properties.can_be_split,can_be_split,1,jobs.split.can_be_split.json,constraint,Applies to jobs only — shipments cannot be split.,,Boolean flag... [constraint],ACCEPT,
DRF-0003,jobs.items.properties.split.properties.can_be_split,can_be_split,2,jobs.split.can_be_split.json,constraint,Used only when demand exceeds capacity.,,Boolean flag... [constraint],REJECT,Too vague
DRF-0005,jobs.items.properties.split.properties.can_be_split,can_be_split,0,jobs.split.can_be_split.json,businessRule,"If can_be_split=false and delivery exceeds capacity → job unassigned (HTTP 200, code 0).",,Boolean flag... [businessRule],ACCEPT,
DRF-0006,jobs.items.properties.split.properties.can_be_split,can_be_split,1,jobs.split.can_be_split.json,businessRule,"If can_be_split=true and vehicles exist → job split across vehicles.",,Boolean flag... [businessRule],MODIFY,"Add: each split carries a sub-portion"
```

**Benefits:**
- ✅ Review each item individually
- ✅ Accept/Reject/Modify per item (not all-or-nothing)
- ✅ Matches Phase 1 enrichment review exactly
- ✅ Consistent workflow across all enrichment reviews

---

## Column-by-Column Explanation

| Column | Example | Type | Your Role | Notes |
|--------|---------|------|-----------|-------|
| `row_id` | `DRF-0001` | String | Read only | Unique identifier |
| `path` | `jobs.items.properties.split.properties.can_be_split` | String | Read only | JSON path in spec |
| `field` | `can_be_split` | String | Read only | Field name |
| `item_index` | `0` | Integer | Read only | 0-based index in the array |
| `origin` | `jobs.split.can_be_split.json` | String | Read only | Source enrichment file |
| `category_tag` | `constraint` | String | Read only | Item type: constraint, businessRule, validationRule, testingGuidance, related, rule, summary, range |
| `current_text` | `Default value is false; split is opt-in per job.` | String | **Review this** | The actual item from enrichment |
| `suggested_text` | `` | String | **Fill if MODIFY** | Corrected text (leave empty if ACCEPT) |
| `rationale` | `Boolean flag... [constraint]` | String | Read for context | Why this item exists |
| `decision` | `ACCEPT` | String | **FILL THIS** | Your decision: ACCEPT, REJECT, or MODIFY |
| `sme_notes` | `Too vague` | String | Optional | Your reasoning |

---

## Decision Workflow

### Decision: ACCEPT
- Current text is correct ✓
- Leave `suggested_text` empty
- Leave `sme_notes` empty (or add praise)
- **Result:** Item stays in enrichment as-is

```
decision: ACCEPT
suggested_text: 
sme_notes: 
```

### Decision: REJECT
- Item should not exist
- Leave `suggested_text` empty
- Optional: explain why in `sme_notes`
- **Result:** Item deleted from enrichment

```
decision: REJECT
suggested_text: 
sme_notes: Redundant with constraint 4
```

### Decision: MODIFY
- Item needs changes
- Put corrected text in `suggested_text`
- Optional: explain change in `sme_notes`
- **Result:** Item replaced with `suggested_text`

```
decision: MODIFY
suggested_text: Default value is false; split is opt-in per job. Cannot be combined with shipments.
sme_notes: Added shipment restriction for clarity
```

---

## Example: Reviewing `can_be_split` Field (34 rows)

| row_id | category_tag | current_text (abbreviated) | decision | suggested_text | sme_notes |
|--------|--------------|--------------------------|----------|----------------|---------  |
| DRF-0001 | constraint | Default value is false... | ACCEPT | | ✓ |
| DRF-0002 | constraint | Applies to jobs only... | ACCEPT | | ✓ |
| DRF-0003 | constraint | Used only when demand... | REJECT | | Covered by business rule |
| DRF-0004 | constraint | When false or absent... | MODIFY | When false, over-capacity jobs are unassigned (HTTP 200, code 0, job ID in unassigned list) | More specific |
| DRF-0005 | businessRule | If can_be_split=false... | ACCEPT | | ✓ Correct |
| DRF-0006 | businessRule | If can_be_split=true... | ACCEPT | | ✓ Clear |
| DRF-0007 | businessRule | Split applies to multi-dim... | MODIFY | Split applies only when load dimension=1; multi-dimension behavior is TBC. | Clarify TBC |
| DRF-0008 | businessRule | All split sub-jobs... | ACCEPT | | ✓ Important |
| DRF-0009 | businessRule | Only applies to jobs... | ACCEPT | | ✓ Validation rule |
| DRF-0010 | businessRule | Interaction with capacity... | REJECT | | Redundant with DRF-0008 |

**Result:** 8 ACCEPTED, 1 REJECTED, 1 MODIFIED across just constraints + businessRules

---

## How to Review 103 Items Efficiently

### Strategy 1: By Category
Filter Excel to show only one `category_tag` at a time:

```
1. Filter: category_tag = constraint
   → Review 19 items (all constraints across all fields)
   
2. Filter: category_tag = businessRule
   → Review 18 items (all business rules)
   
3. Filter: category_tag = validationRule
   → Review 12 items
   
4. Filter: category_tag = testingGuidance
   → Review 28 items
   
5. Filter: category_tag = related
   → Review 17 items
   
6. Filter: category_tag = rule
   → Review 6 items
   
7. Filter: category_tag = summary OR range
   → Review 3 items
```

**Time estimate:** 30–45 minutes total

### Strategy 2: By Field
Filter to review one field at a time:

```
1. Filter: field = can_be_split
   → Review 34 items (all aspects of this field)
   
2. Filter: field = max_splits
   → Review 34 items
   
3. Filter: field = quant
   → Review 35 items
```

**Time estimate:** 25–35 minutes total

### Strategy 3: Sorted by Confidence
Sort by `category_tag` and fill decisions in order of confidence:

```
1. Start with constraints (easy to validate against spec)
2. Then businessRules (core logic)
3. Then validationRules (clear/pass checks)
4. Then testingGuidance (requires scenario thinking)
5. Summary + range (usually ACCEPT)
6. Related + rules (reference checks)
```

**Tip:** Use "Copy Down" in Excel to quickly apply the same decision to similar rows (e.g., all constraints → ACCEPT, then adjust outliers)

---

## After Deciding

### 1. Save the CSV

```bash
# In Excel/Numbers: File → Save (or Cmd+S)
```

### 2. Run the applier

```bash
cd qa-studio
node apply-draft-enrichment-review.mjs
```

**Output example:**
```
======================================================================
Draft Enrichment Review Applied
======================================================================
✓ ACCEPT: jobs.split.can_be_split [constraint:0] "Default value is false..."
✓ ACCEPT: jobs.split.can_be_split [businessRule:0] "If can_be_split=false..."
✗ REJECT: jobs.split.can_be_split [constraint:2] "Used only when demand..."
✎ MODIFY: jobs.split.can_be_split [constraint:3] (changed to: "When false, over-capacity...")

95 ACCEPTED, 3 REJECTED, 5 MODIFIED
3 enrichment file(s) updated: jobs.split.can_be_split.json, jobs.split.max_splits.json, jobs.split.quant.json

✓ Decisions applied successfully!

Next: Recompile with: node qa-studio/compile.mjs --lenient
```

### 3. Recompile

```bash
node compile.mjs --lenient
```

---

## Consistency with Phase 1

| Aspect | Phase 1 CSV | Draft Features CSV | Match? |
|--------|-------------|-------------------|--------|
| Columns | `row_id,path,field,item_index,origin,category_tag,current_text,suggested_text,rationale,decision,sme_notes` | Same | ✅ |
| One row per | enrichment item | enrichment item | ✅ |
| Decision type | ACCEPT/REJECT/MODIFY | ACCEPT/REJECT/MODIFY | ✅ |
| Suggested field | Yes, for edits | Yes, for edits | ✅ |
| Rationale column | Yes | Yes | ✅ |
| Applier logic | Per-item decisions | Per-item decisions | ✅ |
| Generation | Pre-built from spec | Generated from overlay | ⚠️ Different timing, same output |

**Result:** Draft features review workflow is **100% identical to Phase 1** once the CSV is generated.

---

## Files and Locations

| File | Purpose | Type |
|------|---------|------|
| `qa-studio/enrichment-review/draft-features.csv` | The review spreadsheet | Generated |
| `qa-studio/generate-draft-enrichment-review.mjs` | Creates the CSV | Script |
| `qa-studio/apply-draft-enrichment-review.mjs` | Applies decisions | Script |
| `qa-studio/DRAFT_FEATURES_REVIEW_GUIDE.md` | How to review | Doc |
| `qa-studio/DRAFT_FEATURES_PROCESS.md` | Step-by-step | Doc |
| `qa-studio/DRAFT_FEATURES_WORKFLOW.md` | Comprehensive | Doc |

