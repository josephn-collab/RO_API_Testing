# Phase 1 Workflow & Session Continuity Guide

## 📋 Complete Workflow

### Stage 1: SME Review (You are here)
1. **Open CSVs** in `qa-studio/enrichment-review/`
   - 8 files: vehicles.csv, options.csv, shipments.csv, jobs.csv, relations.csv, depots.csv, zones.csv, locations-matrices.csv
   - 2,545 total rows

2. **For each row, decide:**
   - **ACCEPT** → use suggested_text as-is (leave sme_notes blank)
   - **REJECT** → drop entirely (leave sme_notes blank)
   - **MODIFY** → write final wording in sme_notes column

3. **Save CSVs** (same location)

4. **Check status** (optional):
   ```bash
   node qa-studio/phase1-status.mjs
   ```
   This shows your progress and tells you when you're done.

### Stage 2: Apply Changes (Once all decisions filled)
```bash
node qa-studio/apply-enrichment-review.mjs
```

This does:
- Reads your decisions from CSVs
- Updates `enrichment/*.json` files
- Runs `compile.mjs` to verify
- Reports what changed

### Stage 3: Verify (Optional)
```bash
node qa-studio/compile.mjs
# Check for: 168 enriched, 17 rules, 0 gaps

# Test app
open "/Users/joseph/QA Assistant/qa-studio/start.command"
```

---

## 🔄 Session Continuity

### What Happens If Context Limit Hits

When you start a new session:

**First Thing I'll Do:**
```bash
node qa-studio/phase1-status.mjs
```

This tells me:
- ✓ How many decisions are filled
- ✓ What percentage complete
- ✓ Which CSVs need work
- ✓ What to do next

### What I Can Determine Without Asking

✅ **Review progress:** I'll see decision counts
✅ **Current stage:** Awaiting review / In progress / Ready to apply
✅ **What's blocked:** Any rows still blank
✅ **Applied or not:** Enrichment file timestamps + compile.mjs output

### What I Can Do Automatically

✅ **Check status:** `phase1-status.mjs` gives full picture
✅ **Run applicator:** If decisions are complete, apply them
✅ **Verify compilation:** Run `compile.mjs` and show results
✅ **Point to next step:** Clear recommendation

### What Needs Your Input

❓ **Which domain to focus on?** (if you want to split the work)
❓ **How to handle conflicts?** (if you need clarification on a proposal)
❓ **Priority order?** (if you want businessRules done first)

---

## 💾 The Source of Truth

The **CSVs are your persistent data**:
- Live in `qa-studio/enrichment-review/`
- Survive session restarts
- Decision column is what matters
- sme_notes column holds your final wording

The **enrichment/*.json files update only after** `apply-enrichment-review.mjs` runs with your decisions.

---

## 🎯 Quick Reference for Next Session

### If I say "You're in a new session"
I'll immediately run:
```bash
node qa-studio/phase1-status.mjs
```

And tell you:
- How many rows have decisions ✓
- What percentage done
- What to do next

### If context limit hit mid-review
No problem. Just:
1. **Save the CSV** you were editing
2. **Start new session**
3. I'll check `phase1-status.mjs`
4. **Continue where you left off**

### If you want to check progress anytime
```bash
node qa-studio/phase1-status.mjs
```

---

## 📝 State Detection (How I'll Know Where You Are)

I use three independent checks:

**Check 1: CSV decision columns**
```bash
grep -c "ACCEPT\|REJECT\|MODIFY" enrichment-review/*.csv
# Tells me how many rows decided
```

**Check 2: Enrichment file freshness**
```bash
stat enrichment/vehicles.capacity.json
stat enrichment-review/vehicles.csv
# Enrichment newer = applicator ran
```

**Check 3: Compile.mjs obligations**
```bash
node qa-studio/compile.mjs | grep obligation
# New obligations = enrichment changed
```

All three together give me **high confidence** of current state.

---

## ⚡ Fast Path (Skip Ceremony)

If you're comfortable, just:
1. Open CSVs
2. Fill decisions
3. Save
4. Next session: I check status, run applicator if ready
5. Done

No need to ask, no status updates—just work and save.

---

## 🛡️ Safety Guarantees

✓ **No enrichment files touched** until `apply-enrichment-review.mjs` runs
✓ **CSVs are always readable** — if I can't parse them, I'll ask
✓ **Reversible** — if you reject a row, it stays as enrichment was
✓ **Complete record** — every decision is in the CSV, nothing lost

---

## 📋 Checklist for Session Continuity

I will always check:

- [ ] CSVs exist and have valid format
- [ ] Decision column has ACCEPT/REJECT/MODIFY/blank values
- [ ] sme_notes column has text (if MODIFY rows exist)
- [ ] File timestamps (enrichment older than CSVs = not applied yet)
- [ ] Compile output (0 gaps = current state)
- [ ] Status report (how many decided)

Then I will:

- [ ] Tell you current progress
- [ ] Show what stage you're in
- [ ] Recommend next action
- [ ] Run applicator if ready (or ask first)
- [ ] Verify if requested

---

## 🚀 Starting Next Session: Your Job is Just to Say

**Option A (Check-in):**
> "Let me know where we are with Phase 1 review"

**Option B (Continue working):**
> "I'll keep filling the CSVs"
(I'll check status automatically)

**Option C (Run applicator):**
> "All decisions are filled, apply the changes"
(I'll verify status first, then run it)

**I'll do the rest.**
