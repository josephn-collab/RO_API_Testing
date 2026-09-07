# Complete QA Authoring Workflow — Phase 1 + Draft Features

## 🏗️ Architecture Overview

```
OPENAPI.JSON SPEC
        ↓
    [Phase 1]
    Deep enrichment review & application
    Spec → analyze deeply → 2,545+ review rows → SME → apply
        ↓
    168 enriched paths with rich businessRules & testingGuidance
        ↓
    Claude generates high-quality test cases
        ↓
    TEST GENERATION CEILING: ~50+ cases (obstacle-free)


DESIGN DOCS (NOT IN SPEC YET)
        ↓
    [Draft Features Workflow]
    Extract → generate enrichment → review → apply → test
    Design doc → spec.md → review CSVs → enrichment-draft/
        ↓
    Draft features with enrichment ready (parallel to spec work)
        ↓
    Claude generates test cases immediately when feature ready
        ↓
    [WHEN SPEC LANDS]
    Migrate draft → spec (auto-generated Phase 1 review)
        ↓
    Phase 1 deepening on spec-based enrichment
        ↓
    PRODUCTION READY (fully enriched & tested)
```

---

## 📋 Complete Workflow Phases

### Phase 1: Deep Enrichment (Existing Fields in Spec)
**Current State:** COMPLETE ✅
- 2,545 review rows across 8 domain CSVs
- 736 NEW businessRules proposals
- 727 NEW testingGuidance scenarios
- Awaiting SME review → Phase 1 applicator → enrichment applied

**Outcome:** All 168 spec-based fields deeply enriched

---

### Phase 2: Draft Features (New Fields, Not in Spec Yet)
**Status:** Plan Complete, Ready for Implementation
- Extract design docs → standardized spec.md
- Generate enrichment CSVs (same ACCEPT/REJECT/MODIFY workflow as Phase 1)
- Apply draft enrichment to enrichment-draft/ + overlay.json
- Test features with Claude using draft enrichment
- When spec lands: migrate draft → spec, generate Phase 1 review

**Outcome:** Multiple concurrent draft features tested before spec lands

---

### Phase 3: Seamless Spec Transition
**Status:** Script Architecture Designed
- When feature enters openAPI.json:
  - migrate-draft-to-spec.mjs runs automatically
  - Generates Phase 1 enrichment-review CSV (spec-based)
  - Updates overlay.json (feature now in spec)
  - Updates features.index.json (status: spec-ready)

**Outcome:** Draft enrichment smoothly transitions to spec-based enrichment deepening

---

### Phase 4: Test Generation at Scale
**Status:** Enabled by Phase 1 + Phase 2
- Spec-based fields: 168 paths with 2,545+ enrichment items (Phase 1)
- Draft features: 5-10 concurrent features with enrichment (Phase 2)
- Claude sees explicit businessRules + comprehensive testingGuidance
- Test generation ceiling: 50+ cases (currently ~17)

**Outcome:** High-quality test cases generated automatically

---

## 🛠️ Tools & Scripts

### Phase 1 Tools (Complete)
| Tool | Purpose | Status |
|------|---------|--------|
| generate-enrichment-review-analytical.mjs | Spec → enrichment CSVs | ✅ Done |
| phase1-status.mjs | Track review progress | ✅ Done |
| apply-enrichment-review.mjs | Apply decisions → enrichment | ✅ Done |
| PHASE1-CHECKLIST.md | Quick reference | ✅ Done |
| PHASE1-SESSION-CONTINUITY.md | Session restart guide | ✅ Done |

### Phase 2 Tools (To Build)
| Tool | Purpose | Status |
|------|---------|--------|
| generate-draft-enrichment.mjs | Design doc → enrichment CSVs | 📋 Planned |
| apply-draft-enrichment.mjs | Apply decisions → enrichment-draft/ | 📋 Planned |
| migrate-draft-to-spec.mjs | Transition draft → spec | 📋 Planned |
| DRAFT-FEATURES-PLAN.md | Complete workflow guide | ✅ Done |
| DRAFT-FEATURES-QUICK-REF.md | Quick reference + templates | ✅ Done |

---

## 📊 File Organization

```
Knowledge/
├── new_features_without_spec/
│   ├── features.index.json                    ← NEW: Registry
│   ├── split-order/
│   │   ├── spec.md                            ← NEW: Standardized
│   │   ├── design-document.pdf
│   │   └── api-examples.json
│   └── [other features...]

qa-studio/
├── enrichment/                                ← Phase 1 (spec-based)
│   └── [168 spec-based fields]
├── enrichment-draft/                          ← Phase 2 (draft features)
│   └── [feature-XX.*.json]
├── enrichment-review/                         ← Phase 1 CSVs (being reviewed)
│   └── [8 domain CSVs with decisions]
├── draft-features-review/                     ← Phase 2 CSVs (to build)
│   └── [feature-name.csv]
├── overlay.json                               ← References enrichment-draft/ paths
├── phase1-status.mjs                          ✅ Done
├── apply-enrichment-review.mjs                ✅ Done
├── generate-draft-enrichment.mjs              📋 To build
├── apply-draft-enrichment.mjs                 📋 To build
├── migrate-draft-to-spec.mjs                  📋 To build
└── PHASE1-*.md                                ✅ Done
```

---

## 🚀 Ready Now (Phase 1)

**You can do immediately:**

1. **Review Phase 1 CSVs** (qa-studio/enrichment-review/)
   - Fill decision + sme_notes columns
   - 2,545 rows total, parallelizable by domain
   - ~2-4 hours per domain for thorough SME review

2. **Apply when ready**
   ```bash
   node qa-studio/apply-enrichment-review.mjs
   ```

3. **Test the app**
   - See how enrichment depth affects test generation
   - Test generation ceiling should rise (from ~17 to 30+)

---

## 🔮 Coming Next (Phase 2)

**After Phase 1 is applied:**

1. **Build draft features tools** (generate + apply + migrate)
2. **Document first 2-3 draft features** (spec.md format)
3. **Generate enrichment CSVs** for draft features
4. **SME review** (same workflow as Phase 1)
5. **Apply draft enrichment** → available in overlay.json
6. **Test features** with Claude using draft enrichment
7. **When spec lands** → migrate automatically
8. **Phase 1 deepen** on spec-based enrichment for that feature

---

## 💡 Key Insights

### Phase 1 (Spec-Based)
- ✅ Complete coverage of all 168 enriched fields
- ✅ Deep analysis (2,545 review items)
- ✅ Spec is source of truth
- ✅ One-time effort for each field
- ✅ Enrichment improves over time as spec clarity increases

### Phase 2 (Draft Features)
- ✅ Parallel to Phase 1 (non-blocking)
- ✅ Design doc is temporary source of truth
- ✅ Multiple concurrent features
- ✅ Reusable workflow (extract → review → apply → test)
- ✅ Seamless transition when spec lands

### Integrated Benefit
- ✅ Claude sees rich enrichment for spec-based AND draft features
- ✅ Test generation ceiling rises significantly
- ✅ No delays waiting for spec (draft features ready early)
- ✅ Audit trail (every decision tracked)
- ✅ Scalable (handles 5-10 concurrent draft features)

---

## ✅ Success Definition

You'll know this is working when:

1. **Phase 1 Applied**
   - 168 fields have 2,545 enrichment items
   - businessRules explain field purposes + interactions
   - testingGuidance covers all enums + boundaries + interactions

2. **Test Generation Improves**
   - Suite sizes go from ~17 cases to 30-50+ cases
   - Test cases more specific and targeted
   - Coverage matrix shows better balance

3. **Draft Features Workflow Active**
   - 2-3 draft features documented (spec.md)
   - Enrichment CSVs generated and under SME review
   - Decisions filled and applied to enrichment-draft/
   - overlay.json reflects new draft paths
   - Test generation available for draft features

4. **Spec Transition Smooth**
   - When spec lands, migration runs cleanly
   - Phase 1 review CSVs auto-generated for spec-based enrichment
   - overlay.json automatically updated
   - No manual intervention needed

---

## 🎯 Next Immediate Actions

### For You (Now)
1. ✅ Review Phase 1 CSVs (2,545 rows across 8 domains)
   - Focus on businessRules first (higher impact)
   - Fill decision + sme_notes columns
   - Save CSVs

2. ✅ Run Phase 1 applicator when ready
   ```bash
   node qa-studio/apply-enrichment-review.mjs
   ```

3. ✅ Test the app
   - Generate test cases with enriched fields
   - See improvement in coverage

### For Implementation Team (Next)
1. 📋 Implement Phase 2 tools (generate/apply/migrate draft enrichments)
2. 📋 Document first draft features (spec.md format)
3. 📋 Establish enrichment review SLA (e.g., 48-hour turnaround)
4. 📋 Create features.index.json status tracking
5. 📋 Test migration workflow

---

## 📞 Session Continuity

**For Phase 1:**
- Run `node qa-studio/phase1-status.mjs` anytime to check progress
- I'll track state automatically if context limit hits
- No manual status updates needed

**For Phase 2 (once tools built):**
- Run `node qa-studio/draft-features-status.mjs` (to be built)
- Similar automatic tracking for draft features
- Session continuity same as Phase 1

---

**You're set for Phase 1. Start reviewing the CSVs whenever ready. Phase 2 tools follow once Phase 1 is applied and tested. 🚀**
