# Test Case Template — Generic SaaS

> Reusable test case template. Use the field order below in every case. Replace `<angle-bracket>` placeholders. There are **9 fields**; categories are **Positive, Negative**.

## (a) Field Definitions

| Field | Description | Allowed Values / Format |
|---|---|---|
| Test Case ID | Unique identifier for the test case | `TC-<AREA>-<CAT>-<NNN>` (e.g. `TC-RO-POS-001`); `CAT` = POS/NEG |
| Feature | Specific feature under test | Free text (e.g., "Capacity Constraint", "Authentication") |
| Title | Test-case name: concise summary of what is tested | Free text, imperative phrasing |
| Description | What the test verifies and why | 1–3 sentences |
| Test Data | The complete, ready-to-send request body | Minified single-line JSON (in backticks) — the exact body sent to the API under test. Fully valid for positive cases; exactly the malformed/infeasible body for negative cases |
| Details | Summary to understand the case | `Locations: N; Vehicles: N; Jobs: N; Features: a, b, c` — counts from Test Data + feature paths exercised |
| Expected Result | Observable outcome that defines pass | Exact HTTP status + measurable/assertable detail |
| Priority | Execution urgency | P1 (Urgent), P2 (High), P3 (Medium), P4 (Low) |
| Type | Positive or negative case | Positive \| Negative |

## (b) Single Test Case Template

| Field | Value |
|---|---|
| Test Case ID | TC-<AREA>-<CAT>-<NNN> |
| Feature | <Feature> |
| Title | <Concise title> |
| Description | <What this verifies and why> |
| Test Data | <complete minified JSON body> |
| Details | Locations: <N>; Vehicles: <N>; Jobs: <N>; Features: <paths> |
| Expected Result | <HTTP status + measurable expected outcome> |
| Priority | P1 \| P2 \| P3 \| P4 |
| Type | Positive \| Negative |

## (c) Bulk Test Case Template

Group cases under an H2 per category — **only** `## Positive`, `## Negative`.

| Test Case ID | Feature | Title | Description | Test Data | Details | Expected Result | Priority | Type |
|---|---|---|---|---|---|---|---|---|
| TC-<AREA>-POS-001 | <Feature> | <Title> | <Desc> | <Data> | Locations: N; Vehicles: N; Jobs: N; Features: … | <Status + Expected> | P2 | Positive |
| TC-<AREA>-NEG-001 | <Feature> | <Title> | <Desc> | <Data> | Locations: N; Vehicles: N; Jobs: N; Features: … | <Status + Expected> | P3 | Negative |

## (d) Naming & Conventions

- **Title:** Start with an action verb; state the condition and expected outcome (e.g., "Reject optimization request with out-of-range coordinates").
- **Categories:** exactly two H2 sections — Positive, Negative.
- **Type:** every case is `Positive` or `Negative`.
- **One assertion focus per case:** keep cases atomic so failures are diagnosable.

## (e) Worked Example

| Field | Value |
|---|---|
| Test Case ID | TC-RO-NEG-001 |
| Feature | Coordinate validation |
| Title | Reject optimization request with out-of-range coordinates |
| Description | Verify the submit endpoint rejects a `locations.location` coordinate outside valid WGS84 ranges with a clear error. |
| Test Data | `{"locations":{"location":["200.0, 95.0","51.5072, -0.1276"]},"vehicles":[{"id":"V1","start_index":1}],"jobs":[{"id":"J1","location_index":1,"delivery":[10]}]}` (first coordinate out of range) |
| Details | Locations: 2; Vehicles: 1; Jobs: 1; Features: locations.location, jobs.delivery |
| Expected Result | HTTP `400` (input validation failed) naming the offending coordinate; no `id` returned. |
| Priority | P2 |
| Type | Negative |

**Bulk example row**

| Test Case ID | Feature | Title | Description | Test Data | Details | Expected Result | Priority | Type |
|---|---|---|---|---|---|---|---|---|
| TC-RO-POS-001 | Solve | Single job assigned to one vehicle | Verify a trivial feasible problem returns one route with the job assigned. | `{"locations":{"location":["52.517, 13.388","52.529, 13.397"]},"vehicles":[{"id":"V1","start_index":0}],"jobs":[{"id":"J1","location_index":1}]}` | Locations: 2; Vehicles: 1; Jobs: 1; Features: vehicles.start_index, jobs.location_index | HTTP `200`; `status:"Ok"`; `result.code == 0`; job assigned; `result.unassigned` empty | P1 | Positive |
