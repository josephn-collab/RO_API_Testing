# Draft Features — Quick Reference

## 🎯 High-Level Workflow

```
DESIGN DOC READY
    ↓
Extract spec.md + create features.index.json entry
    ↓
Generate draft enrichment (generate-draft-enrichment.mjs)
    ↓
SME reviews enrichment (draft-features-review/*.csv) — ACCEPT/REJECT/MODIFY
    ↓
Apply draft enrichment (apply-draft-enrichment.mjs)
    ↓
Test feature with Claude (enrichment in overlay.json)
    ↓
[SPEC LANDS IN openAPI.json]
    ↓
Migrate draft → spec (migrate-draft-to-spec.mjs)
    ↓
Phase 1 enrichment review (deepen on spec)
    ↓
FEATURE SHIPS (enriched & tested)
```

---

## 📁 File Structure

```
Knowledge/new_features_without_spec/
├── features.index.json                    ← Registry of all draft features
├── split-order/                           ← One folder per feature
│   ├── spec.md                            ← Standardized feature spec (extracted)
│   ├── design-document.pdf                (original design doc)
│   └── api-examples.json                  (API payloads for reference)
├── dynamic-pricing/
│   ├── spec.md
│   ├── design-document.pdf
│   └── api-examples.json
└── ...

qa-studio/
├── enrichment-draft/                      ← Draft feature enrichment (temporary)
│   ├── feature-01.jobs.split.json
│   ├── feature-01.jobs.can_be_split.json
│   ├── feature-01.jobs.max_splits.json
│   ├── feature-02.options.pricing.*.json
│   └── ...
├── draft-features-review/                 ← Review CSVs (like Phase 1)
│   ├── split-order.csv
│   ├── dynamic-pricing.csv
│   └── ...
├── overlay.json                           ← References enrichment-draft/ paths
├── generate-draft-enrichment.mjs           ← Generator
├── apply-draft-enrichment.mjs              ← Applicator
└── migrate-draft-to-spec.mjs               ← Transition script
```

---

## 🔑 Key Scripts (To Be Built)

| Script | Purpose |
|--------|---------|
| `generate-draft-enrichment.mjs` | Extract design doc → enrichment CSVs for review |
| `apply-draft-enrichment.mjs` | Apply SME decisions → enrichment-draft/*.json + update overlay.json |
| `migrate-draft-to-spec.mjs` | Move feature from draft → spec when openAPI.json updates |

---

## 📝 Standardized spec.md Template

Location: `Knowledge/new_features_without_spec/feature-name/spec.md`

```markdown
# Feature: [Exact Feature Name]

## Overview
[What this feature does in 1-3 sentences]
[Why it matters for the API]

## Status & Timeline
- Design finalized: [date]
- Target release: [quarter/date]
- Expected spec date: [estimated when openAPI.json will update]

## Acceptance Criteria
- [ ] Test cases cover all enum values
- [ ] Test cases cover boundary conditions
- [ ] Cross-feature interactions tested
- [ ] No breaking changes to existing fields
- [ ] All validation rules tested

## API Changes

### New Fields
Create a table with these columns:

| Path | Type | Required | Min/Max | Default | Description |
|------|------|----------|---------|---------|-------------|
| jobs.split | object | false | - | null | Split job configuration |
| jobs.split.can_be_split | boolean | false | - | false | Whether this job can be split |
| jobs.split.max_splits | integer | false | 0-∞ | 0 | Maximum splits (0=unlimited) |

### Modified Fields
Document what changed:

| Path | Change | Backward Compatible |
|------|--------|---|
| jobs | Added optional split object | Yes |

### New Rules/Constraints
- [List all new validation rules]
- [List all business rule changes]

### Removed/Deprecated
- [If any, list deprecations]

## Business Rules
- [Hard constraint 1]: ...
- [Hard constraint 2]: ...
- [Soft constraint 1]: ...
(Each should be clear, testable)

## Validation Rules
- [Error condition 1] → HTTP 400: ...
- [Error condition 2] → HTTP 400: ...
- [Infeasible condition 1] → HTTP 200 + result.unassigned: ...

## Example Payloads

### Before (without feature)
```json
{
  "jobs": [
    {
      "id": "job-1",
      "delivery": {"location_index": 1, "amount": [50]}
    }
  ]
}
```

### After (with feature)
```json
{
  "jobs": [
    {
      "id": "job-1",
      "delivery": {"location_index": 1, "amount": [50]},
      "split": {
        "can_be_split": true,
        "max_splits": 3
      }
    }
  ]
}
```

### Edge Case Example
```json
{
  "split": {
    "can_be_split": false,
    "max_splits": 0
  }
}
```
(What does this mean? How should it behave?)

## Cross-Feature Interactions

### Rules Affected
- [Rule ID 1]: [How feature changes this rule]
- [Rule ID 2]: [Interaction details]

### Related Fields
- [Field path 1]: [How they interact]
- [Field path 2]: [Dependencies]

### Depends On
- [Any prerequisite features needed?]

## Known Limitations
- [If applicable, list any limits or phase-2 work]

## Testing Guidance

### Positive Cases
- [Test when feature is used normally]
- [Test with max_splits = 0 (unlimited)]
- [Test with can_be_split = false]

### Negative Cases
- [Test invalid enum value]
- [Test when constraint violated]
- [Test interaction with other rules]

### Boundary Cases
- [Test at limits]
- [Test with other optional fields omitted]
```

---

## 📊 features.index.json Template

Location: `Knowledge/new_features_without_spec/features.index.json`

```json
{
  "version": "1.0",
  "lastUpdated": "2026-08-04",
  "features": [
    {
      "id": "split-order",
      "name": "Split Order",
      "shortDescription": "Allow jobs to be split across multiple vehicles",
      "status": "enrichment-applied",
      "paths": [
        "jobs.split",
        "jobs.can_be_split",
        "jobs.max_splits",
        "jobs.quant"
      ],
      "relatedPaths": [
        "jobs.delivery",
        "jobs.pickup",
        "vehicles.capacity"
      ],
      "affectedRules": [
        "pickup-delivery-precedence",
        "capacity-dimension-consistency"
      ],
      "documentedAt": "2026-07-20",
      "enrichmentGeneratedAt": "2026-07-21",
      "enrichmentAppliedAt": "2026-07-22",
      "specReadyAt": null,
      "productionAt": null,
      "notes": "Waiting for spec update to openAPI.json"
    },
    {
      "id": "dynamic-pricing",
      "name": "Dynamic Pricing",
      "shortDescription": "Allow dynamic cost adjustments based on market conditions",
      "status": "ready-for-enrichment",
      "paths": [
        "options.pricing.dynamic_enabled",
        "options.pricing.price_adjustment"
      ],
      "relatedPaths": [
        "jobs.revenue",
        "vehicles.costs"
      ],
      "affectedRules": [
        "objective-cost-mode-consistency"
      ],
      "documentedAt": "2026-08-01",
      "enrichmentGeneratedAt": null,
      "enrichmentAppliedAt": null,
      "specReadyAt": null,
      "productionAt": null,
      "notes": "Design doc ready, enrichment generation pending"
    }
  ],
  "statuses": {
    "documented": "Design doc finalized, spec.md created, waiting for enrichment generation",
    "ready-for-enrichment": "spec.md ready, awaiting generation",
    "enrichment-generated": "Review CSVs created, waiting for SME review",
    "enrichment-review": "SME currently reviewing",
    "enrichment-applied": "Draft enrichment in place, ready for feature testing",
    "testing": "Claude generating test cases with draft enrichment",
    "spec-ready": "openAPI.json updated with feature, ready for Phase 1 deepening",
    "phase1-review": "Phase 1 enrichment deepening underway",
    "production": "Feature shipped with full enrichment"
  }
}
```

---

## ✅ Implementation Roadmap

### Week 1: Foundation
- [ ] Create standardized spec.md template (copy from above)
- [ ] Create features.index.json template
- [ ] Extract split-order design doc → spec.md
- [ ] Add entry to features.index.json (status: documented)
- [ ] Design generate-draft-enrichment.mjs architecture

### Week 2: First Feature Complete
- [ ] Implement generate-draft-enrichment.mjs
- [ ] Generate split-order review CSVs
- [ ] Implement apply-draft-enrichment.mjs
- [ ] SME review split-order CSVs
- [ ] Apply split-order enrichment

### Week 3: Multi-Feature Support
- [ ] Document 2-3 more features (spec.md)
- [ ] Batch generate enrichment
- [ ] Parallel SME review
- [ ] Apply all enrichments

### Week 4: Spec Migration
- [ ] Implement migrate-draft-to-spec.mjs
- [ ] Test migration workflow with split-order
- [ ] When spec lands, perform migration
- [ ] Generate Phase 1 review for spec-based enrichment

---

## 🎯 Success Criteria

✅ Multiple draft features can exist concurrently
✅ Enrichment generated from design docs (not manual)
✅ SME review workflow identical to Phase 1
✅ Seamless transition when spec lands (draft → spec)
✅ Phase 1 enrichment-review CSV auto-generated at transition
✅ overlay.json automatically updated
✅ features.index.json tracks all status changes
✅ No manual editing of enrichment or overlay files

---

## 💡 Key Principles

**Standardize Everything:**
- spec.md format (not free-form)
- features.index.json status tracking
- Enrichment generation (extract, don't invent)
- Review workflow (ACCEPT/REJECT/MODIFY like Phase 1)
- Migration process (automatic, traceable)

**Parallel Development:**
- Multiple features at different stages simultaneously
- No bottlenecks between documentation, enrichment, review, testing
- SME can review multiple features in parallel

**Quality First:**
- Draft features tested with rich enrichment before spec
- No "wait for spec" delays
- Enrichment deepened when spec lands (Phase 1)

**Traceable & Auditable:**
- Every feature has documented spec.md
- features.index.json shows timeline
- Decisions recorded in review CSVs
- Migration auto-generated

---

**Ready to build this workflow? Start with the standardized templates above.**
