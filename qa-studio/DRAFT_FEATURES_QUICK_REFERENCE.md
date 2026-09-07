# Draft Features Review Quick Reference

**Fast path for reviewing draft feature enrichment and applying decisions.**

## 5-Minute Review

Open `qa-studio/enrichment-review/draft-features.csv` in Excel/Numbers and for each row:

| If... | Then... |
|-------|---------|
| **Enrichment looks good** | Set `decision = ACCEPT` |
| **Field shouldn't be tested** | Set `decision = REJECT` |
| **Need to edit the enrichment** | Set `decision = MODIFY`, edit the JSON file directly |

**Columns to review:**
- `businessRules` — Does the field follow the documented business logic?
- `validationRules` — Are validation checks correct?
- `testingGuidance` — Do the scenarios cover all important cases?
- `constraints` — Are constraints complete and accurate?

## Apply Your Decisions

```bash
cd qa-studio
node apply-draft-enrichment-review.mjs
```

Output shows what was ACCEPT/REJECT/MODIFIED, then:

```bash
node compile.mjs --lenient
```

## Field Decision Guide

### ACCEPT
✓ Use when: Enrichment is accurate, matches the spec PDF, and test scenarios are comprehensive.

**Side effect:** Removes `status: "proposed"` marker; enrichment is now ratified.

### REJECT
✗ Use when: The field shouldn't be tested (out of scope, too complex, or marked as TBC with no clear tests).

**Side effect:** Deletes the enrichment file; field won't appear in test generation.

### MODIFY
✎ Use when: Enrichment needs edits (add/remove rules, clarify scenarios, fix constraints).

**Action required:**
1. Open the enrichment JSON file in the editor
2. Make your changes (e.g., edit `testingGuidance` array)
3. Save the file
4. Set decision = `MODIFY` in CSV
5. Run the applier script

**Side effect:** Enrichment is kept; your manual edits are the source of truth.

---

## Example: Split Order

**File:** `qa-studio/enrichment-review/draft-features.csv`

**Rows:** 3 (can_be_split, max_splits, quant)

**Typical review:**
```
DRF-001,split-order,...,can_be_split,...,ACCEPT,Looks good; covers all scenarios
DRF-002,split-order,...,max_splits,...,ACCEPT,Clear co-field requirement
DRF-003,split-order,...,quant,...,MODIFY,TBC for multi-dimension; clarify in testingGuidance
```

After MODIFY decision, you'd edit `jobs.split.quant.json` to clarify the TBC behavior, then run the applier.

---

## Next: When Feature Ships

Once the feature lands in `openapi.json`:

1. **Update the spec:**
   ```bash
   cp ~/downloads/openapi.json qa-studio/openapi.json
   cp ~/downloads/openapi.json Knowledge/openapi.json
   ```

2. **Remove from overlay:**
   Edit `qa-studio/overlay.json` and delete the draft feature entry.

3. **Recompile (no --lenient):**
   ```bash
   cd qa-studio
   node compile.mjs
   ```

4. **Verify in app:**
   - Reload `http://localhost:8000/qa-studio/`
   - Draft chip gone? ✓ Done!

---

## CSV Column Reference

| Column | What it is | Your role |
|--------|-----------|-----------|
| **row_id** | Unique identifier (DRF-001, etc.) | Read-only |
| **feature_id** | Draft feature name (split-order) | Read-only |
| **path** | JSON path in spec | Read-only |
| **field** | Leaf field name | Read-only |
| **category** | Field type (string, integer, etc.) | Read-only |
| **businessRules** | Rules enforced by the field | Review these |
| **validationRules** | Input validation constraints | Review these |
| **testingGuidance** | Test scenarios (positive/negative) | Review these |
| **constraints** | Cross-field constraints | Review these |
| **decision** | Your decision | **FILL THIS** (ACCEPT/REJECT/MODIFY) |
| **sme_notes** | Your comments (optional) | Optional notes |

---

## Troubleshooting

**Q: CSV is too wide in Excel?**
A: Format → Columns → Auto-fit, or wrap text in the cells.

**Q: Can I edit multiple drafts at once?**
A: Yes! All draft features go into one CSV. Decisions are per-row.

**Q: I changed my mind after applying.**
A: The enrichment files are JSON — just edit them directly and recompile.

**Q: What if I REJECT all fields?**
A: The feature won't appear in test generation. It's fine to reject entire features if they're not ready.

**Q: MODIFY — do I edit the CSV or the JSON?**
A: Edit the JSON file directly (e.g., `qa-studio/enrichment/jobs.split.quant.json`). The CSV row just notes your intention.

