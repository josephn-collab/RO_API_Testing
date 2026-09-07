# Phase 1 Quick Checklist

## ✅ Current Status (2026-08-04)

- [x] 8 domain CSVs generated: `qa-studio/enrichment-review/`
- [x] 2,545 enrichment review rows created
- [x] 736 NEW businessRules proposals (simple, clear language)
- [x] 727 NEW testingGuidance scenarios (enum, boundaries, interactions)
- [x] Status checker script created: `phase1-status.mjs`
- [x] Applicator ready: `apply-enrichment-review.mjs`
- [x] No enrichment files modified yet ✓

---

## 📋 Next Steps for You

### Right Now (or whenever ready)

- [ ] Open CSVs in `qa-studio/enrichment-review/` (one domain at a time, or all 8 in parallel)
- [ ] For each row: fill `decision` column → ACCEPT / REJECT / MODIFY
- [ ] For MODIFY rows: write final text in `sme_notes` column
- [ ] Save CSVs

**Tip:** Start with businessRules rows (they have higher impact). Most "field defines..." rows are safe to ACCEPT.

### Quick Progress Check (Anytime)

```bash
node qa-studio/phase1-status.mjs
```

Shows you exactly how many rows are decided.

### When All Decisions Filled

```bash
node qa-studio/apply-enrichment-review.mjs
```

This applies your decisions to `enrichment/*.json` files.

### Verify (Optional)

```bash
node qa-studio/compile.mjs
```

Should report: 213 features / 168 enriched / 17 rules / 0 gaps

---

## 📂 File Reference

| File | Purpose |
|---|---|
| `enrichment-review/*.csv` | 8 CSVs with 2,545 review rows — YOU FILL decision column |
| `phase1-status.mjs` | Check your progress (how many decisions filled) |
| `apply-enrichment-review.mjs` | Apply decisions to enrichment/*.json files |
| `PHASE1-SESSION-CONTINUITY.md` | How Claude will track state across sessions |
| `PHASE1-ENHANCED.md` | Full guide to businessRules & testingGuidance |

---

## 🎯 Review Strategy (Recommended)

### Priority Order

1. **businessRules rows** (2-10 per field)
   - Field-purpose rows ("X defines: ...") → almost always ACCEPT
   - Cross-field rules ("Rule: ...") → ACCEPT if applies to your API
   - Gotchas ("Skills are case-sensitive") → highly valuable, ACCEPT
   - Soft vs hard ("This is soft...") → verify against your solver, ACCEPT or MODIFY

2. **testingGuidance rows** (1-20 per field)
   - Enum values → ACCEPT for each valid option
   - Boundaries (zero, negative, max) → ACCEPT if numeric field
   - Interactions ("Rule: ...") → ACCEPT for cross-field scenarios

### By Domain

If doing in parallel, assign to different reviewers:
- **vehicles.csv** (693 rows) — Fleet/routing expert
- **options.csv** (537 rows) — Solver options/constraints expert
- **shipments.csv** (496 rows) — Pickup-delivery expert
- **jobs.csv** (384 rows) — Task modeling expert
- **relations.csv** (156 rows) — Sequencing expert
- **depots.csv** (129 rows) — Depot constraints expert
- **locations-matrices.csv** (88 rows) — Geographic/matrix expert
- **zones.csv** (62 rows) — Zone/geofence expert

Or do them all yourself, one at a time.

---

## 🔐 Session Continuity (Don't Worry)

When context hits and new session starts:

1. I **automatically** run `phase1-status.mjs`
2. I **know** how many decisions are filled
3. I **see** if applicator has run
4. I **recommend** next action
5. You just continue

**What I'll tell you:** "312 rows decided (12% complete), keep going on vehicles.csv" or "All decisions filled, ready to apply changes?"

No manual status checks needed. I'll track it.

---

## 💡 Tips

✅ **Save frequently** as you edit CSVs
✅ **Start with businessRules** (higher impact than testingGuidance)
✅ **"field defines..." rows are usually safe to ACCEPT**
✅ **Cross-field rule rows ("Rule: ...")** verify they apply, then ACCEPT
✅ **If unsure, REJECT** — conservative default, nothing broken
✅ **Run `phase1-status.mjs` anytime** to see progress

---

## ⚠️ Important Notes

- Decisions live in CSVs — they're persistent across sessions
- No enrichment files modified until you run `apply-enrichment-review.mjs`
- Blank decision = treated as REJECT (conservative)
- Enrichment files only updated after all decisions filled AND applicator runs
- Compile.mjs verifies everything worked

---

## ❓ If You Get Stuck

### "I don't understand this row"
→ Look at the `rationale` column (spec excerpt or rule ID)
→ Check `suggested_text` wording

### "Should I accept or reject?"
→ ACCEPT if it makes sense for your API
→ REJECT if it doesn't apply
→ MODIFY if the wording needs tweaking

### "I need to start over"
→ Delete decisions from CSVs and regenerate:
```bash
rm -rf qa-studio/enrichment-review
node qa-studio/generate-enrichment-review-analytical.mjs
```

### "How do I know if applicator worked?"
→ Run `node qa-studio/compile.mjs`
→ Check enrichment file contents (should have more items)

---

## 📞 How I'll Help

**In this session:**
- ✓ Answer questions about any row
- ✓ Explain businessRules wording
- ✓ Help decide ACCEPT/REJECT/MODIFY
- ✓ Run status checks

**In next session:**
- ✓ Automatically check progress
- ✓ Tell you where you left off
- ✓ Run applicator when ready
- ✓ Verify compilation

---

**You're all set. Open the CSVs whenever you're ready and start filling decisions. I'll track your progress automatically.**
