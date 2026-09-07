# Draft Features Workflow — Standardized Plan

## 🎯 Goal

Enable comprehensive testing of new features **before** they land in openAPI.json, with full enrichment (businessRules, testingGuidance, etc.) so Claude can generate high-quality test cases immediately upon feature release.

---

## 📋 Current State vs. Desired State

### Current
- `overlay.json` contains draft features (currently just split-order)
- Design docs in `Knowledge/new_features_without_spec/`
- Ad-hoc enrichment embedded in overlay or created by hand
- Limited scalability (one feature at a time)

### Desired
- **Standardized workflow** for multiple concurrent draft features
- **Separate enrichment layer** for draft features (like Phase 1 for spec-based)
- **Reusable enrichment templates** (extract from design docs systematically)
- **Draft → Spec migration** (transition enrichment when feature lands in openAPI.json)
- **Multi-feature support** (5-10 draft features simultaneously)

---

## 🏗️ Architecture

```
Knowledge/
├── new_features_without_spec/
│   ├── features.index.json          ← NEW: index of all draft features
│   ├── feature-01-split-order/
│   │   ├── spec.md                  ← NEW: standardized feature spec (extracted from PDF)
│   │   ├── design-document.pdf      (original)
│   │   └── api-examples.json        ← NEW: API examples for context
│   ├── feature-02-dynamic-pricing/
│   │   ├── spec.md
│   │   ├── design-document.pdf
│   │   └── api-examples.json
│   └── ...

qa-studio/
├── enrichment-draft/                ← NEW: enrichment for draft features
│   ├── feature-01.split_order.*.json
│   ├── feature-02.dynamic_pricing.*.json
│   └── ...
├── overlay.json                      (updated to reference enrichment-draft/)
├── generate-draft-enrichment.mjs     ← NEW: generator for draft features
├── apply-draft-enrichment.mjs        ← NEW: applicator for draft features
├── draft-features-review/            ← NEW: review CSVs (like Phase 1)
│   ├── split-order.csv
│   ├── dynamic-pricing.csv
│   └── ...
└── migrate-draft-to-spec.mjs         ← NEW: transition script (draft → spec)
```

---

## 📊 Complete Workflow (3 Phases)

### Phase A: Feature Discovery & Documentation

**Step 1: Standardize Feature Documentation**

Each draft feature gets a standardized `spec.md` in its folder:

```markdown
# Feature: Split Order

## Overview
{extracted from design doc}

## API Changes
{new endpoints, new parameters, modified responses}

## Field Definitions
{all new fields with types, constraints, ranges}

## Business Rules
{constraints, validations, interactions}

## Example Payloads
{before/after examples}

## Acceptance Criteria
{what "done" looks like for testing}
```

**Step 2: Extract to Index**

Create `Knowledge/new_features_without_spec/features.index.json`:

```json
{
  "features": [
    {
      "id": "split-order",
      "name": "Split Order",
      "status": "ready-for-enrichment",
      "paths": ["jobs.split", "jobs.can_be_split", "jobs.max_splits", "jobs.quant"],
      "relatedPaths": ["jobs.delivery", "jobs.pickup"],
      "rules": ["split-order-precedence", "split-delivery-consistency"],
      "targetedFor": "Q3-2026",
      "documentedAt": "2026-07-20",
      "specReadyAt": null
    },
    {
      "id": "dynamic-pricing",
      "name": "Dynamic Pricing",
      "status": "ready-for-enrichment",
      "paths": ["options.pricing.*.dynamic_enabled", "options.pricing.*.price_adjustment"],
      "relatedPaths": ["jobs.revenue", "vehicles.costs"],
      "rules": [],
      "targetedFor": "Q4-2026",
      "documentedAt": "2026-08-01",
      "specReadyAt": null
    }
  ]
}
```

---

### Phase B: Enrichment Generation & Review (Like Phase 1)

**Step 3: Generate Draft Enrichment**

Create `qa-studio/generate-draft-enrichment.mjs`:

```
For each draft feature:
  1. Read feature/spec.md
  2. Extract field definitions, business rules, examples
  3. Parse design doc (text extraction)
  4. Generate initial enrichment:
     - summary (from spec.md)
     - range (from field definitions)
     - constraints (from business rules)
     - businessRules (from design doc + related rule interactions)
     - validationRules (from error handling section)
     - testingGuidance (from examples + acceptance criteria + interactions)
  5. Write enrichment-draft/feature-XX.field.json files
  6. Generate review CSVs (like Phase 1: split-order.csv, dynamic-pricing.csv, ...)
```

**Step 4: SME Review (Like Phase 1)**

- CSVs in `qa-studio/draft-features-review/`
- Same ACCEPT/REJECT/MODIFY workflow
- Same decision/sme_notes columns
- Different agent prompt (no spec node, relies on design doc instead)

**Step 5: Apply Draft Enrichment**

Create `qa-studio/apply-draft-enrichment.mjs`:

```
For each draft feature review CSV:
  1. Parse SME decisions
  2. Build final enrichment arrays (same logic as Phase 1 applicator)
  3. Write to enrichment-draft/feature-XX.*.json
  4. Update overlay.json to reference new enrichment files
  5. Run compile.mjs (should recognize draft features via overlay)
  6. Report: X fields enriched, Y test scenarios ready
```

---

### Phase C: Feature Transition (Draft → Spec)

**Step 6: Spec Lands in openAPI.json**

When `split-order` ships and spec is added to openAPI.json:

```bash
node qa-studio/migrate-draft-to-spec.mjs --feature split-order
```

This script:
1. Reads `enrichment-draft/feature-01.split_order.*.json`
2. Maps to spec node paths (jobs.split → jobs[].split in openAPI.json)
3. **Transitions enrichment:**
   - Validates new paths exist in spec
   - Compares enrichment-draft with spec-based extracted enrichment
   - Flags conflicts (design said X, spec says Y)
   - Generates enrichment-review CSV for **spec-based enrichment** (Phase 1 for this feature)
4. Removes from overlay.json (feature now in spec, treated like regular field)
5. Updates features.index.json: `specReadyAt: <date>`
6. Ready for Phase 1 enrichment review (deepening on spec)

---

## 🛠️ Tools & Scripts to Create

### 1. `generate-draft-enrichment.mjs` (NEW)

```
Input:
  - Knowledge/new_features_without_spec/features.index.json
  - Knowledge/new_features_without_spec/feature-XX/spec.md
  - Knowledge/new_features_without_spec/feature-XX/design-document.pdf (text extraction)
  - qa-studio/rules/*.json (cross-feature rules)

Output:
  - qa-studio/enrichment-draft/feature-XX.field.json (one per field)
  - qa-studio/draft-features-review/feature-name.csv (review CSV)
```

**Logic:**
- Parse spec.md sections → extract field definitions
- Design doc → business rules & validation logic
- Examples → testingGuidance scenarios
- Cross-feature rules → interactions
- Same deduplication & tagging as Phase 1

### 2. `apply-draft-enrichment.mjs` (NEW)

```
Input:
  - qa-studio/draft-features-review/*.csv (with decisions filled)

Output:
  - qa-studio/enrichment-draft/feature-XX.*.json (updated)
  - qa-studio/overlay.json (updated with new paths)
  - qa-studio/data/compiled/ (recompiled with draft features)
```

**Logic:**
- Same as Phase 1 applicator, but writes to enrichment-draft/
- Updates overlay.json with new draft paths
- Compiles with draft features recognized

### 3. `migrate-draft-to-spec.mjs` (NEW)

```
Input:
  - Feature ID (e.g., "split-order")
  - Updated openAPI.json (with feature now in spec)

Process:
  1. Load enrichment-draft/feature-XX.*.json
  2. Load spec nodes from openAPI.json
  3. Map field paths (draft → spec)
  4. Validate consistency
  5. Flag conflicts/mismatches
  6. Generate Phase 1 enrichment-review CSV (spec-based)
  7. Update features.index.json (status: ready, specReadyAt)
  8. Remove from overlay.json
  9. Mark for Phase 1 deepening

Output:
  - Conflict report (if design ≠ spec)
  - Phase 1 enrichment-review CSV for this feature
  - Updated features.index.json
  - Updated overlay.json
```

### 4. `features.index.json` (NEW)

Central registry of all draft features with status tracking.

---

## 📝 Standardized Documentation Format

### `Knowledge/new_features_without_spec/feature-XX/spec.md`

```markdown
# Feature: [Name]

## Overview
[1-3 sentence description]

## Acceptance Criteria
- [Done when...]
- [Test coverage for...]
- [No breaking changes to...]

## API Changes

### New Fields
| Path | Type | Required | Description |
|------|------|----------|-------------|
| jobs.split | object | false | Split job configuration |
| jobs.split.can_be_split | boolean | false | Whether this job can be split |
| jobs.split.max_splits | integer | false | Maximum number of splits (0 = no limit) |

### Modified Fields
| Path | Change |
|------|--------|
| jobs | Added optional split object |

### New Endpoints
[None, or list if applicable]

## Business Rules
- Split jobs must maintain pickup-delivery precedence
- Total demand across splits ≤ original demand
- Each split must be independently feasible

## Validation Rules
- max_splits must be ≥ 2 or 0 (0 = unlimited)
- can_be_split=false overrides max_splits

## Examples

### Before (single job)
```json
{
  "id": "job-123",
  "delivery": [40],
  "pickup": [30]
}
```

### After (split job)
```json
{
  "id": "job-123",
  "delivery": [40],
  "pickup": [30],
  "split": {
    "can_be_split": true,
    "max_splits": 3
  }
}
```

## Cross-Feature Interactions
- Interacts with: pickup-delivery-precedence rule
- Depends on: No other draft features
- Affects: capacity-dimension-consistency (if split affects dimensions)

## Testing Considerations
- Test splitting across vehicles
- Test when max_splits=0 (unlimited)
- Test when can_be_split=false (no split)
- Test interaction with priority field (high-priority jobs split?)
```

---

## 🔄 Workflow for Multiple Concurrent Features

### Timeline Example

```
Week 1: Split Order feature documented
  Day 1: Extract spec.md, create features.index.json
  Day 2-3: Generate enrichment + review CSV
  Day 4-5: SME review
  Day 5: Apply draft enrichment

Week 2: Dynamic Pricing documented (concurrent with split-order testing)
  Day 1: Extract spec.md, update features.index.json
  Day 2-3: Generate enrichment + review CSV
  Day 4-5: SME review (parallel with split-order testing)
  Day 5: Apply draft enrichment

Week 3: Both features in testing, spec lands
  Day 1: openAPI.json updated with split-order
  Day 2: Migrate split-order (draft → spec), generate Phase 1 review
  Day 3: SME Phase 1 review of split-order (deepen on spec)
  Day 4-5: Continue testing dynamic-pricing (still draft)

Week 4: Split-order in production (enriched & tested)
  Dynamic-pricing ready for draft testing
```

---

## 📊 Status Tracking

`features.index.json` tracks each feature through stages:

```
States:
  documented           (spec.md created, waiting for enrichment)
  ready-for-enrichment (spec.md complete, awaiting generation)
  enrichment-review    (review CSVs generated, waiting for SME)
  enrichment-applied   (draft enrichment in place, ready for testing)
  testing              (Claude generating test cases with draft enrichment)
  spec-ready           (openAPI.json updated with feature)
  phase1-review        (enrichment being deepened on spec)
  production           (enrichment finalized, feature shipped)
```

---

## 🎯 Key Differences from Phase 1

| Aspect | Phase 1 (Spec-based) | Draft Features |
|--------|---|---|
| **Source** | openAPI.json spec | Design doc + spec.md |
| **Enrichment location** | enrichment/*.json | enrichment-draft/*.json |
| **Applicator** | apply-enrichment-review.mjs | apply-draft-enrichment.mjs |
| **Generator** | analyze spec nodes | extract from design doc + rules |
| **Integration** | compile.mjs reads enrichment/ | compile.mjs reads enrichment-draft/ + overlay.json |
| **Transition** | N/A (spec doesn't change) | migrate-draft-to-spec.mjs when spec lands |
| **Multiple features** | All 168 paths at once | 1-5 concurrent features |

---

## 🚀 Implementation Phases

### Phase D: Foundation (Week 1-2)
- [ ] Create standardized spec.md template
- [ ] Create features.index.json
- [ ] Extract split-order to spec.md format
- [ ] Create generate-draft-enrichment.mjs
- [ ] Create apply-draft-enrichment.mjs

### Phase E: First Feature Complete (Week 2-3)
- [ ] Generate split-order enrichment CSVs
- [ ] SME review split-order
- [ ] Apply split-order enrichment
- [ ] Test split-order with enhanced enrichment
- [ ] Validate overlay.json integration

### Phase F: Multi-Feature Support (Week 3-4)
- [ ] Document 2-3 more features (spec.md)
- [ ] Batch generate enrichment for all
- [ ] Parallel SME review
- [ ] Apply all enrichments

### Phase G: Spec Migration (Week 4+)
- [ ] When spec lands, run migrate-draft-to-spec.mjs
- [ ] Generate Phase 1 enrichment-review for the feature
- [ ] SME review Phase 1 (deepen on spec)
- [ ] Remove from overlay.json (now just regular enriched field)

---

## 📋 Quick Start Checklist for a New Draft Feature

```
☐ 1. Design document finalized
☐ 2. Extract spec.md from design doc
☐ 3. Add entry to features.index.json (status: documented)
☐ 4. Run: node qa-studio/generate-draft-enrichment.mjs --feature [name]
☐ 5. Review CSVs generated in draft-features-review/
☐ 6. SME review: fill decision columns
☐ 7. Run: node qa-studio/apply-draft-enrichment.mjs
☐ 8. Verify: compile.mjs reports new paths
☐ 9. Test: generate test cases with draft enrichment
☐ 10. (Later) When spec lands: migrate-draft-to-spec.mjs
```

---

## 💡 Benefits

✅ **Parallel development** — multiple features at different stages
✅ **No delays** — test features before spec is final
✅ **Reusable enrichment** — when spec lands, enrichment becomes Phase 1 review (deepen on spec)
✅ **Traceable** — every draft feature has documented spec.md and features.index.json entry
✅ **Audit trail** — status tracking from documented → production
✅ **Quality** — Claude sees rich enrichment (businessRules + testingGuidance) even before spec
✅ **Scalability** — handles 5-10 concurrent draft features without bottleneck

---

## ⚠️ Important Notes

- **Draft enrichment ≠ Spec enrichment** — kept separate until feature ships
- **overlay.json is temporary** — removed when feature lands in spec
- **Phase 1 applies after migration** — deepen on spec once official
- **No manual editing** — always go through generation + review + applicator
- **Features.index.json is source of truth** — for status tracking

---

## 🎓 Example: Split Order Feature

### Week 1: Feature Documented
```
Knowledge/new_features_without_spec/split-order/
  ├── spec.md (extracted from design doc)
  ├── design-document.pdf (original)
  └── api-examples.json

features.index.json
  └── split-order entry (status: documented)
```

### Week 1-2: Enrichment Generated & Reviewed
```
node qa-studio/generate-draft-enrichment.mjs --feature split-order

Generates:
  enrichment-draft/feature-01.jobs.split.json
  enrichment-draft/feature-01.jobs.can_be_split.json
  enrichment-draft/feature-01.jobs.max_splits.json
  enrichment-draft/feature-01.jobs.quant.json
  draft-features-review/split-order.csv (2,545 rows like Phase 1)

SME reviews CSVs, fills decisions
```

### Week 2: Enrichment Applied
```
node qa-studio/apply-draft-enrichment.mjs

Updates:
  enrichment-draft/*.json (with SME decisions)
  overlay.json (adds new paths)
  features.index.json (status: enrichment-applied)
  data/compiled/ (includes draft features)
```

### Week 3: Testing with Draft Enrichment
```
Claude sees in prompt:
  - jobs.split.can_be_split definition + businessRules + 8 testingGuidance scenarios
  - jobs.split.max_splits definition + businessRules + 12 testingGuidance scenarios
  - Interactions with capacity, pickup-delivery rules

Generates targeted test cases for split-order feature
```

### Week 4: Spec Lands
```
openAPI.json updated with split order fields

node qa-studio/migrate-draft-to-spec.mjs --feature split-order

Outputs:
  Conflict report (compare design spec.md vs openAPI.json)
  Phase 1 enrichment-review CSV (for spec-based deepening)
  Updated features.index.json (status: spec-ready)
  Updated overlay.json (split-order removed, now in spec)

Next: Phase 1 SME review (deepen split-order enrichment on spec)
```

---

**This is your complete workflow for handling draft features systematically. Ready to implement?**
