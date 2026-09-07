# Final Checklist

Run through these before emitting output. Do **not** emit until all items pass.

## Knowledge & facts

- [ ] Every field value is traced to an injected knowledge block (API facts, scenario, enrichment, allocation, coordinate pool), the OpenAPI schema, or the coordinate pool — **nothing from memory**?
- [ ] No status code, error code, field limit, or enum value is asserted that isn't present in the injected knowledge?
- [ ] Any unknown marked `TBC` with a clear note on what would resolve it?

## Allocation & coverage

- [ ] Every test subject's allocation is honored exactly — cases authored for exactly that many distinct aspects?
- [ ] No subject is silently dropped; subjects that receive zero cases are listed / flagged?
- [ ] Positive/Negative ratio and combination-case count match the injected allocation (90/10 global split)?
- [ ] Combination cases, if present, are funded from **inside** the Positive share, not on top of it?
- [ ] Every case whose allocation specifies a scale tier (medium/large) actually uses that tier's vehicle/job counts — not silently collapsed to 1 vehicle/1-2 jobs?

## Per-case rigor

- [ ] Every Negative case is invalid for **exactly one reason** (not ambiguous about what it's testing)?
- [ ] No Expected Result asserts a solver-computed route, ETA, distance, or order?
- [ ] Every Expected Result is **observable** (names a response field, HTTP status, or unassigned list entry) and **invariant** (must always hold, never a value the engine derives)?
- [ ] Was the full candidate pool enumerated per subject before choosing, not just the first pair?
- [ ] Does each case reproduce the specific documented mechanism rather than a generic paraphrase?
- [ ] testCaseId sequence is unique per category and continues correctly from any prior add-more IDs, with no reuse?
- [ ] Every location_index resolves within that case's own `locations.location` array?

## Supporting fields inclusion

- [ ] Every test case includes applicable supporting fields (those listed in the "Scenario" JSON)?
- [ ] No case omits a supporting field that applies to an object it contains (e.g., vehicles.skills when the case has vehicles)?
- [ ] Supporting field values **differ across cases** — not the same priority/skills/time_window used in every case?
- [ ] Supporting fields carry realistic, production-like values (not placeholder or dummy values)?
- [ ] `details.features` does **not** list supporting fields alone (they only appear alongside a test subject)?

## Field-value variation

- [ ] Every field value (capacity, priority, time_window, skills, amount, etc.) that appears in multiple cases carries **different values** across those cases?
- [ ] No field uses the same value in all its cases — variation is deliberate and substantial?
- [ ] When a field is numeric (weight, volume, distance, cost), cases use values from different parts of its range (low, mid, high, near-limit)?
- [ ] When a field is categorical (priority, skill name, constraint type), cases use different categories/combinations?
- [ ] Variation is documented per case so it's clear why this case differs from the previous (e.g., "higher capacity threshold" vs "tighter window")?

## Combination cases

- [ ] Every combination case exercises **two or more test subjects in the SAME request body**, not separate scenarios?
- [ ] Combination cases use `details.features` with **multiple paths**, e.g., `["vehicles.capacity", "jobs.priority"]`?
- [ ] Combination cases have Expected Results that reference the **interaction**, not just one feature?
- [ ] Each combination case uses **different feature combinations** or different values for the same pair (not repetitions)?
- [ ] Combination cases are counted correctly in the total (funded from inside the Positive share, not on top)?

## Output contract

- [ ] Output is **exactly** a JSON array with no prose, no markdown code fences — first character is `[`, last is `]`?
- [ ] Each element has **exactly** the fields in `output-contract.md` — no extra keys, no missing keys?
- [ ] `details.archetype` is `positive` or `negative`, matching the scenario kind?
- [ ] `priority` is `P1`, `P2`, `P3`, or `P4`?
- [ ] `type` is `Positive` or `Negative`, matching the testCaseId category?

## Timestamp generation

- [ ] Every `time_window` value (on vehicles or jobs) is an epoch timestamp (seconds since Unix epoch)?
- [ ] All timestamps are calculated relative to today's epoch at generation time, not hardcoded?
- [ ] Time windows are realistic (e.g., 04:00–23:59 for overnight, 08:00–18:00 for business hours)?
- [ ] If any time window spans multiple days, is it handled correctly (split into separate time windows or extended via schema)?

## One-to-Many Shipments (Draft Feature) — Schema Validation

**Only applies if `shipments.deliveries` is a test subject:**

- [ ] Every one-to-many shipment uses `deliveries` array (not the singular `delivery` field)?
- [ ] `deliveries` array has **at least 2 items** (minimum requirement from schema)?
- [ ] **Every delivery object has ALL three required fields: `id`, `location_index`, `amount`** — NO exceptions?
- [ ] `amount` dimensionality on each delivery matches `shipment.amount` dimensionality (e.g., if shipment is 2D, each delivery is 2D)?
- [ ] **Sum of all delivery amounts equals shipment-level `amount` exactly, per dimension** (e.g., [100, 200] + [80, 100] = [180, 300])?
- [ ] All delivery IDs are unique within the shipment (no duplicates)?
- [ ] Pickup ID does not match any delivery ID?
- [ ] No case uses **both** `delivery` and `deliveries` in the same shipment object?
- [ ] Negative validation cases (HTTP 400) test exactly one structural violation (missing amount, dimensionality mismatch, sum mismatch, etc.) — not multiple violations at once?
- [ ] Negative-infeasible cases (200 + unassigned) test feasibility constraints (capacity, time window, skills) with structurally correct one-to-many payloads?
- [ ] Case is tagged with `"draft": true` in `details` if the feature is still in draft state (not yet in openapi.json)?
- [ ] Supporting shipment-level fields (skills, priority, zone_ids) are included when applicable?

## Shipment Structure Completeness

- [ ] Every shipment has at least: pickup (id, location_index, time_windows), delivery OR deliveries, amount, skills?
- [ ] If using `deliveries`, all delivery objects have: id, location_index, amount (at minimum)?
- [ ] If using `delivery` (singular), it has: id, location_index (no amount on delivery itself; amount at shipment level)?
- [ ] All pickup and delivery location_index values are valid integers in range [0, len(locations.location))?
- [ ] All location_index references are resolvable within the same request body (no cross-case references)?
