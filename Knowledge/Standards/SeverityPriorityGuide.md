# Severity & Priority Guide

This guide defines how to classify defects by **Severity** (impact of the failure) and **Priority** (urgency of the fix), and how the two combine. It uses NextBillion.ai Route Optimization examples throughout.

## Definitions

- **Severity** measures the *technical/business impact* of a defect on the system or user — how bad the failure is, independent of scheduling. Owned primarily by QA.
- **Priority** measures the *urgency* of fixing it relative to other work — when it should be addressed. Owned primarily by Product/Engineering.

Severity and priority are related but independent: a low-severity typo in a headline may still be high priority, while a high-severity crash in an unused feature may be low priority.

## Severity Levels

| Level | Name | Definition | Examples | Response Expectation |
|---|---|---|---|---|
| S1 | Critical | System down, data loss/corruption, or core function unusable with no workaround | Optimization returns routes that violate capacity/time-window constraints; submitted jobs silently lost | Immediate; drop-everything hotfix |
| S2 | High | Major function broken or severely impaired; workaround is difficult | `GET /result` intermittently returns `result.code` ≠ 0 for valid jobs; auth via `key` intermittently fails | Fix in current cycle/next release |
| S3 | Medium | Partial or minor functional issue with an acceptable workaround | Capacity constraint occasionally ignored on small jobs; a valid task wrongly placed in `unassigned` in an edge case | Scheduled in a normal sprint |
| S4 | Low | Cosmetic or trivial issue with negligible functional impact | Misleading wording in a `warnings[]` message; typo in an error message | Backlog; fix opportunistically |

## Priority Levels

| Level | Name | Definition | Response Expectation |
|---|---|---|---|
| P1 | Urgent | Must be fixed immediately; blocks release or customers | Hotfix now; active incident handling |
| P2 | High | Fix in the current release cycle | Scheduled this sprint |
| P3 | Medium | Fix when convenient within upcoming work | Planned in a future sprint |
| P4 | Low | Fix if time permits | Backlog; may be deferred indefinitely |

## Severity vs Priority Decision Matrix

Cells show *typical* combinations with example scenarios. Combinations are guidance, not rules.

| | **P1 (Urgent)** | **P2 (High)** | **P3 (Medium)** | **P4 (Low)** |
|---|---|---|---|---|
| **S1 (Critical)** | Optimization returns constraint-violating routes in production | Critical solver bug in a feature launching next week | Crash only in a rarely-used re-optimization edge path | Critical fault in a deprecated endpoint |
| **S2 (High)** | `result.code` ≠ 0 on common valid jobs, live | Solver timeout under expected load | Major issue behind a disabled feature flag | High-impact bug in an internal-only tool |
| **S3 (Medium)** | Wrong distance affecting billing this cycle | Capacity constraint ignored on some jobs | Off-by-one in a secondary report | Minor logic issue in an experimental beta |
| **S4 (Low)** | Offensive typo in customer-facing docs | Misspelled field in a key API example | Wording nit in a `warnings[]` message | Typo in a rarely-seen debug log |

## How to Choose

**Assign Severity by asking:**
- Is core functionality broken or data lost? → S1
- Is a major feature impaired with a hard workaround? → S2
- Is it a minor functional issue with an easy workaround? → S3
- Is it cosmetic or trivial? → S4

**Assign Priority by asking:**
- Does it block the release, an SLA, or paying customers right now? → P1
- Should it ship this cycle? → P2
- Can it wait for an upcoming sprint? → P3
- Is it "nice to have"? → P4

**Then reconcile:** most defects sit on the S1↔P1 / S4↔P4 diagonal, but deliberately break from it when business context (visibility, contracts, revenue, timing) demands.

## NextBillion.ai Route Optimization Worked Examples

| # | Defect | Severity | Priority | Rationale |
|---|---|---|---|---|
| 1 | Optimization returns routes that exceed vehicle capacity | S1 | P1 | Core constraint violated; wrong, unusable plans — fix immediately |
| 2 | `GET /result` returns `result.code` ≠ 0 for common valid jobs | S2 | P1 | Major feature broken in production; blocks customers |
| 3 | Vehicle capacity constraint ignored on some small jobs | S3 | P2 | Functional but bounded; workaround exists; fix this cycle |
| 4 | Solver timeout under expected load | S2 | P1 | Reliability/SLA risk at normal load; urgent |
| 5 | Distance miscalculation in `result.summary` affecting billing | S1 | P1 | Data correctness with financial impact |
| 6 | Valid task wrongly placed in `unassigned` only in a rare edge case | S3 | P3 | Bounded correctness issue; low urgency |
| 7 | Typo in an error/`warnings` message | S4 | P4 | Trivial; opportunistic fix |
| 8 | Customer-facing typo in public API docs | S4 | P1 | Cosmetic severity but high visibility/brand impact — urgent |

## Common Pitfalls

- [ ] **Conflating severity and priority.** They answer different questions (impact vs. urgency); assign each independently.
- [ ] **Auto-mapping severity to priority.** Not every S1 is P1, and some S4s are P1 due to visibility or contracts.
- [ ] **Inflating severity** to force attention — erodes trust in the scale. Use priority to express urgency instead.
- [ ] **Ignoring business context.** Revenue, SLAs, legal, and brand impact belong in the priority decision.
- [ ] **Inconsistent criteria across teams.** Calibrate with shared examples like those above.
- [ ] **Never revisiting classification.** Re-triage as usage, exposure, or release timing changes.
- [ ] **Vague repro/impact notes**, which force reviewers to guess and mis-rate the defect.
