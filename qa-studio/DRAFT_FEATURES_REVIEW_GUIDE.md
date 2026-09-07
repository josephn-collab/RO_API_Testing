# Draft Features Review — Phase 1 Pattern

**CSV Structure (Identical to Phase 1 enrichment review):**

```
row_id | path | field | item_index | origin | category_tag | current_text | suggested_text | rationale | decision | sme_notes
```

## How to Review (Split Order Example)

**103 enrichment items across 3 fields** are ready for review:

| Field | Items | Category breakdown |
|-------|-------|-------------------|
| `can_be_split` | 34 | 4 constraints + 6 businessRules + 3 validationRules + 9 testingGuidance + 6 related + 2 rules + 1 summary + 1 range + 2 rules |
| `max_splits` | 34 | 4 constraints + 6 businessRules + 4 validationRules + 9 testingGuidance + 5 related + 2 rules + 1 summary + 1 range + 2 rules |
| `quant` | 35 | 6 constraints + 6 businessRules + 5 validationRules + 10 testingGuidance + 6 related + 2 rules + 1 summary + 1 range + 2 rules |

---

## Step-by-Step Review Process

### 1. Open the CSV

```bash
open qa-studio/enrichment-review/draft-features.csv
# Or in Excel/Numbers, just double-click the file
```

### 2. Understand the columns

| Column | Meaning | What you do |
|--------|---------|-----------|
| **row_id** | Unique row ID (DRF-0001, etc.) | Read only |
| **path** | JSON path (e.g., `jobs.items.properties.split.properties.can_be_split`) | Read only |
| **field** | Field name (can_be_split, max_splits, quant) | Read only |
| **item_index** | 0-based index in the array | Read only |
| **origin** | Which enrichment file (jobs.split.can_be_split.json) | Read only |
| **category_tag** | Type of item (constraint, businessRule, validationRule, testingGuidance, related, rule, summary, range) | Read only |
| **current_text** | The actual text from enrichment | Review this |
| **suggested_text** | Empty (you fill if MODIFY) | Optional |
| **rationale** | Why this item exists | Read for context |
| **decision** | Your decision | **FILL THIS** (ACCEPT/REJECT/MODIFY) |
| **sme_notes** | Your notes (optional) | Optional |

### 3. For each row, decide

**ACCEPT** — The item is correct and complete
- Just leave `decision = ACCEPT`
- No need to touch `suggested_text`
- Example: A businessRule is accurate per the spec? → ACCEPT

**REJECT** — The item should not be included
- Set `decision = REJECT`
- This item will be deleted from the enrichment
- Example: A testingGuidance bullet is too vague? → REJECT

**MODIFY** — The item needs changes
- Set `decision = MODIFY`
- Put the corrected text in `suggested_text`
- If `suggested_text` is empty, current_text will be kept (but you're signaling it needs SME attention)
- Example: A constraint is incomplete? → MODIFY + enter corrected version in suggested_text

### 4. Filtering by category

To review by type, **filter on the `category_tag` column:**

- **All constraints:** Filter `category_tag = constraint` (19 rows)
- **All businessRules:** Filter `category_tag = businessRule` (18 rows)
- **All validationRules:** Filter `category_tag = validationRule` (12 rows)
- **All testingGuidance:** Filter `category_tag = testingGuidance` (28 rows)
- **All related:** Filter `category_tag = related` (17 rows)
- **All rules:** Filter `category_tag = rule` (6 rows)

### 5. Sort by field to review one field at a time

To review **only `can_be_split` field:**
- Filter `field = can_be_split` (34 rows)
- See all constraints, businessRules, testingGuidance, etc. for this field
- Decide on each one

---

## Common Review Scenarios

### Scenario A: Constraint is incomplete
```
DRF-0001
category_tag: constraint
current_text: "Default value is false; split is opt-in per job."
decision: MODIFY
suggested_text: "Default value is false; split is opt-in per job. Cannot be combined with can_be_split=true on a shipment."
```

### Scenario B: testingGuidance is too narrow
```
DRF-0014
category_tag: testingGuidance
current_text: "Positive: can_be_split=false (default) with job demand within single-vehicle capacity → job assigned to one vehicle."
decision: REJECT (it's obvious; not a distinct scenario)
```

### Scenario C: businessRule is perfect
```
DRF-0005
category_tag: businessRule
current_text: "If can_be_split=false (default) and job delivery/pickup volume exceeds any single vehicle's capacity → the job remains unassigned (HTTP 200, result.code=0, job ID in result.unassigned)."
decision: ACCEPT
```

---

## After You Review

### 1. Save the CSV

After filling in decisions for all rows, save the file.

### 2. Run the applier

```bash
cd qa-studio
node apply-draft-enrichment-review.mjs
```

Output will show:
```
======================================================================
Draft Enrichment Review Applied
======================================================================
✓ ACCEPT: jobs.items.properties.split.properties.can_be_split [constraint:0] "Default value is false; split is opt-in per job."
✗ REJECT: jobs.items.properties.split.properties.can_be_split [testingGuidance:2] "Positive: can_be_split=true with multi-vehicle split..."
✎ MODIFY: jobs.items.properties.split.properties.can_be_split [constraint:0]

95 ACCEPTED, 3 REJECTED, 5 MODIFIED
3 enrichment file(s) updated: jobs.split.can_be_split.json, jobs.split.max_splits.json, jobs.split.quant.json

✓ Decisions applied successfully!

Next: Recompile with: node qa-studio/compile.mjs --lenient
```

### 3. Recompile

```bash
cd qa-studio
node compile.mjs --lenient
```

---

## Tips

**Reviewing 100+ rows efficiently:**

1. **Sort by `category_tag`** — Review all constraints together, then all businessRules, etc.
2. **Filter by `field`** — Review one field at a time
3. **Use conditional formatting** — Highlight empty `decision` cells (yellow) so you see what's left
4. **Copy decisions** — If most items in a category are ACCEPT, fill one cell with "ACCEPT", then copy down
5. **Mark clearly modified rows** — Add a note in `sme_notes` if you MODIFY, so others know why

---

## CSV File Location

```
qa-studio/enrichment-review/draft-features.csv
```

**Total rows:** 103 enrichment items  
**Fields:** 11 (as above)  
**Encoding:** UTF-8 with CSV escaping for multi-line content

---

## What Happens to Your Decisions

| Decision | Effect on enrichment | Result |
|----------|-------------------|--------|
| **ACCEPT** | Item kept as-is | Becomes production enrichment |
| **REJECT** | Item deleted from array | Field loses this scenario/rule/constraint |
| **MODIFY** | Item replaced with `suggested_text` (or kept if no suggestion) | Updated enrichment with your changes |

**Note:** Once applied, decisions are permanent in the enrichment files. Re-running the generator/applier process only works if you have the original CSV with decisions still filled in.

---

## Next: Integration

Once all decisions are applied and recompiled:

1. **Feature stays as draft** while in testing (overlay active)
2. **When feature ships in spec:**
   - Replace `qa-studio/openapi.json`
   - Delete overlay entry
   - Run `node compile.mjs` (no `--lenient`)
   - Feature now appears as production in app
3. **Update PROJECT_REFERENCE.md** with integration date

