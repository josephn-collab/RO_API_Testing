# Test Plan — NextBillion.ai Route Optimization API v2 (TP-RO-001)

## Document Control

| Field | Value |
|---|---|
| Document ID | TP-RO-001 |
| Title | Test Plan — NextBillion.ai Route Optimization API v2 |
| Product | NextBillion.ai Platform |
| Component | Route Optimization API (`POST /optimization/v2`, `GET /optimization/v2/result`, `POST /optimization/re_optimization`) |
| Author | J. Okafor, Senior QA Automation Lead |
| Owner | QA Guild — Geospatial Services |
| Status | Approved |
| Classification | Internal |

### Version History

| Version | Date | Author | Reviewer | Change Summary |
|---|---|---|---|---|
| 0.1 | 2026-05-04 | J. Okafor | — | Initial draft; scope and objectives |
| 0.5 | 2026-05-19 | J. Okafor | R. Nováková | Added risk table, entry/exit criteria |
| 0.9 | 2026-06-02 | M. Alvarez | J. Okafor | Performance & security sections, schedule |
| 1.0 | 2026-06-11 | J. Okafor | D. Fischer (Eng Mgr) | Baseline approved for Release RO-2026.3 |
| 1.1 | 2026-07-09 | M. Alvarez | J. Okafor | Traceability matrix expanded to REQ-RO-014 |

### Approvals

| Role | Name | Decision | Date |
|---|---|---|---|
| QA Lead | J. Okafor | Approved | 2026-06-11 |
| Engineering Manager | D. Fischer | Approved | 2026-06-11 |
| Product Manager | S. Haddad | Approved | 2026-06-12 |

## Objective

Validate that the NextBillion.ai Route Optimization API v2 correctly solves vehicle routing
problems and returns optimal or near-optimal routes that honor all declared constraints.
The plan verifies functional correctness, constraint enforcement (capacity, time windows,
skills, pickup & delivery), input validation, the asynchronous submit→poll flow, performance
under representative load, and security of the `POST /optimization/v2`, `GET /optimization/v2/result`,
and `POST /optimization/re_optimization` endpoints prior to the RO-2026.3 production release.

Specific goals:

- Confirm that every requirement REQ-RO-001 through REQ-RO-014 is covered by at least one test case.
- Confirm that valid problems submit with `status: "Ok"` and, once polled, return a well-formed solution (`result.routes`, `result.unassigned`, `result.summary`, `result.code == 0`).
- Confirm that infeasible problems return `Ok` with the impossible tasks in `result.unassigned` (with a `reason`), while malformed problems are rejected at submit.
- Establish an automated regression suite executable in CI on every merge to `main`.
- Establish a performance baseline (p95 end-to-end latency and solver throughput) for release gating.

## Scope

The following are in scope for TP-RO-001:

- Endpoints on `https://api.nextbillion.io`: `POST /optimization/v2`, `GET /optimization/v2/result`, `POST /optimization/re_optimization` (staging and pre-prod).
- The **asynchronous** flow: submit returns an `id`; result is polled from `GET /optimization/v2/result?key=&id=`.
- Request/response schema validation for the optimization payload against the OpenAPI spec.
- Constraint enforcement:
  - Vehicle **capacity** (single and multi-dimensional loads).
  - **Time windows** on jobs and vehicles (hard windows, `max_visit_lateness`).
  - **Skills** matching between jobs and vehicles.
  - **Pickup & delivery** (paired shipments, precedence, same-vehicle rule).
  - **Multi-depot** (`start_index`/`end_index`, `start_depot_ids`/`end_depot_ids`, `depot_ids`).
- Coordinate handling as `"latitude, longitude"` WGS84 strings referenced by `location_index`; distances in meters, durations in seconds.
- Authentication via the `key` **query parameter**.
- Solution quality checks (all jobs assigned when feasible; correct `result.unassigned` reporting when not).
- Negative and boundary input validation.
- Non-functional: performance/load, and endpoint security (authN/authZ, injection, rate limits).
- Regression coverage integrated into CI.

## Out of Scope

- The internal optimization/solver algorithm's mathematical proof of optimality (treated as a black box; we assert quality bounds only).
- Third-party map/matrix data accuracy (road network, traffic) — owned by the Routing Data team.
- Billing, metering, and quota accounting services.
- Other NextBillion products (Directions, Distance Matrix, Geocoding, Navigation, Tracking, Maps) — out of scope for this plan.
- Mobile SDKs and offline routing.
- Localization/i18n of error message copy.

## Assumptions

- Staging mirrors production solver version and configuration within one minor version.
- A dedicated test API `key` with optimization scope is provisioned for staging.
- The distance/duration matrix service is available and returns deterministic values in staging.
- Test data fixtures (jobs, vehicles, shipments, `locations`) are version-controlled alongside the test code.
- Rate limits in staging are set high enough to permit load runs during scheduled windows.
- Requirements REQ-RO-001..014 are baselined and frozen for RO-2026.3.
- The exact HTTP error-code catalog and account size limits are treated as **To Be Confirmed (TBC)** until verified against NextBillion; tests assert observable behavior.

## Risks

| ID | Risk | Likelihood | Impact | Severity | Mitigation | Owner |
|---|---|---|---|---|---|---|
| RSK-01 | Solver non-determinism causes flaky exact-match assertions | High | Medium | S3 | Assert on invariants (feasibility, totals) not exact route order; pin solver seed where supported | QA |
| RSK-02 | Staging matrix service instability skews distance/duration checks | Medium | High | S2 | Health-gate suite; mock matrix for unit-level; retry with backoff | QA/Eng |
| RSK-03 | Performance environment under-provisioned vs prod | Medium | High | S2 | Run k6 on isolated pre-prod node; document hardware; report relative deltas | QA |
| RSK-04 | Requirement churn late in cycle | Low | High | S2 | Freeze REQ set at v1.0; change control for additions | PM |
| RSK-05 | Test API key leakage | Low | Critical | S1 | Store in vault/CI secrets; pass as `key` query param from secret, never in URLs logged in plaintext; rotate post-release; never commit | QA Lead |
| RSK-06 | Time-window tests brittle across timezones/DST | Medium | Medium | S3 | Use explicit epoch seconds in fixtures; UTC only | QA |
| RSK-07 | Rate limiting blocks CI during parallel runs | Medium | Medium | S3 | Dedicated CI key with elevated staging quota; serialize load stage | QA/Eng |
| RSK-08 | API `key` in query string leaks via access logs/referrers | Medium | High | S2 | Prefer secret injection; scrub keys from logs; rotate; confirm log redaction with Eng | QA/Eng |
| RSK-09 | Async polling races cause flaky reads before solve completes | Medium | Medium | S3 | Poll with backoff until `result.code` present; bound max wait; treat not-ready as retry, not failure | QA |

## Dependencies

- **Optimization service** RO-2026.3 deployed to `staging` and `pre-prod`.
- **Matrix/Distance service** healthy in the same environments.
- **Auth**: a valid API `key` with optimization scope for staging/pre-prod.
- **CI runner** (GitHub Actions) with network egress to the NextBillion staging host.
- **Secrets vault** entry `nextbillion/qa/optimization-key`.
- **Test data repo** `qa-fixtures/route-optimization` at tag `ro-2026.3`.
- Engineering support for triage during the execution window (2026-07-13 → 2026-07-24).

## Test Strategy

A risk-based, layered strategy prioritizing API contract correctness and constraint
enforcement, backed by automation-first execution.

- **Shift-left contract testing:** schema validation of request/response against the published OpenAPI spec runs on every PR.
- **Black-box functional testing:** representative problems exercise each constraint family with known-feasible and known-infeasible inputs.
- **Invariant-based assertions:** because the solver may return equivalent-cost alternatives, assertions target invariants — all deliverable jobs assigned when feasible, no capacity/time/skill violation, `result.unassigned` populated with a `reason` when infeasible, totals in `result.summary` consistent with per-route sums.
- **Equivalence partitioning & boundary analysis** for validation (counts at 0 / 1 / max, capacity at exact / +1, `location_index` at boundary/out-of-range).
- **Async-flow handling:** every functional test submits, captures `id`, polls `GET /result` with backoff until `result.code` is present, then asserts.
- **Automation:** pytest + `requests` for functional/API; k6 for load; nightly regression in CI. Manual exploratory sessions supplement each constraint area.
- **Defect management:** defects logged as DEF-### with severity/priority; S1/S2 block the exit gate.

## Test Environment

| Attribute | Value |
|---|---|
| Staging base URL | `https://api.nextbillion.io` (staging key/env) |
| Pre-prod base URL | `https://api.nextbillion.io` (pre-prod key/env) |
| Endpoints under test | `POST /optimization/v2`, `GET /optimization/v2/result`, `POST /optimization/re_optimization` |
| Auth | `key` **query parameter** (optimization scope) |
| Coordinate system | WGS84, `"latitude, longitude"` strings via `location_index` |
| Units | Distances in meters, durations/timestamps in seconds |
| Solver version | `ro-solver 2026.3.x` |

### Tooling

| Purpose | Tool | Notes |
|---|---|---|
| Exploratory / manual API | Postman | Shared collection `NextBillion-RO-v2.postman_collection.json` |
| Automated functional/API | pytest + `requests` | Repo `qa-route-optimization`; submit+poll helper |
| Schema/contract | `jsonschema` + OpenAPI spec | Validates submit ack and result bodies |
| Load / performance | k6 | Submit→poll end-to-end scenarios |
| Alt. load (stretch) | Apache JMeter | Cross-check k6 p95 numbers |
| CI | GitHub Actions | `ci-regression.yml`, nightly + on-merge |
| Reporting | Allure | HTML report published as CI artifact |

## Test Data

Fixtures live in `qa-fixtures/route-optimization` and are referenced by test cases.

- **Locations:** a central `locations.location` array of `"lat, lon"` strings; all tasks/vehicles reference entries by `location_index`.
- **Vehicles:** 1–20 vehicles with `start_index`/`end_index` (or depot IDs) in the Berlin metro bbox, `capacity` arrays, optional `time_window`, optional `skills`, optional `max_stops`/`max_travel_time`.
- **Jobs:** 1–500 jobs with `location_index`, `service` duration (s), optional `delivery`/`pickup` amounts, optional `time_windows`, optional `skills`.
- **Shipments:** paired `pickup`+`delivery` objects (each with `location_index`) for PD scenarios.
- **Golden cases:** small hand-verified problems (`golden_5jobs_2veh.json`) with known optimal totals for sanity checks.
- **Infeasible cases:** demand > total capacity, unsatisfiable skill, empty/impossible time window.
- All coordinates WGS84 `"lat, lon"` strings; all times epoch seconds (UTC).

## Entry Criteria

- RO-2026.3 build deployed to staging and smoke-passed (a golden submit→poll returns `result.code == 0`).
- OpenAPI spec for the optimization endpoints published and version-tagged.
- Requirements REQ-RO-001..014 baselined (v1.0).
- Test data fixtures merged at tag `ro-2026.3`.
- Test API `key` provisioned and validated with a golden case.
- No open S1 defect against the endpoints' request/response contract.

## Exit Criteria

- 100% of planned test cases executed.
- ≥ 98% pass rate; **0 open S1/S2** defects.
- All REQ-RO-001..014 traced to at least one passed test case.
- Performance: p95 **end-to-end** (submit→ready→fetched) latency for the *reference* problem (50 jobs / 5 vehicles) ≤ 2500 ms in pre-prod; no error-rate regression > 0.5%.
- Regression suite green on `main` for two consecutive nightly runs.
- Sign-off recorded by QA Lead and Engineering Manager.

## Deliverables

- This Test Plan (TP-RO-001).
- Automated test suite (`qa-route-optimization`) and Postman collection.
- Traceability matrix (below, kept in sync each release).
- Defect log (DEF-### items) and triage notes.
- CI regression report (Allure HTML) per run.
- Performance report (k6 summary + p95/throughput charts).
- Release test summary and sign-off memo.

## Test Schedule

| Phase | Activity | Start | End | Owner |
|---|---|---|---|---|
| 1 | Test design & fixture prep | 2026-07-06 | 2026-07-10 | J. Okafor |
| 2 | Automation build-out (functional) | 2026-07-08 | 2026-07-14 | M. Alvarez |
| 3 | Functional & negative execution | 2026-07-13 | 2026-07-17 | QA team |
| 4 | Constraint suites (CAP/TW/SKL/PD) | 2026-07-15 | 2026-07-20 | QA team |
| 5 | Integration & regression | 2026-07-20 | 2026-07-22 | M. Alvarez |
| 6 | Performance (k6) & security | 2026-07-21 | 2026-07-23 | R. Nováková |
| 7 | Triage, retest, sign-off | 2026-07-23 | 2026-07-24 | J. Okafor |

## Test Types Covered

- Functional testing
- API / contract testing
- UI smoke testing (Optimization Playground)
- Integration testing
- Regression testing
- Performance / load testing
- Security testing

### Functional Testing

Verify core solving behavior via `POST /optimization/v2` then `GET /optimization/v2/result`:

- Single-vehicle single-job trivial route returns one route with the job assigned.
- Multi-vehicle multi-job problems assign all feasible jobs; `result.unassigned` empty when feasible.
- `result.summary.cost`, `.distance`, `.duration` equal the sum of per-route values.
- Route `steps` ordered with valid `arrival` times respecting `service` durations; step `type` in the documented enum.
- Coordinates handled as `"lat, lon"` strings via `location_index`; distances in meters, durations in seconds.
- Covers REQ-RO-001, REQ-RO-002, REQ-RO-003, REQ-RO-004.

### API / Contract Testing

- Submit ack validates against the OpenAPI schema (`id`, `message`, `status`, `warnings`); `status == "Ok"`.
- Result validates against the schema; required fields present: `result.routes[]`, `result.unassigned[]`, `result.summary{}`, `result.code`.
- `Content-Type: application/json`; correct behavior for missing `key`/`id`.
- Idempotency of identical requests at the invariant level.
- Covers REQ-RO-002, REQ-RO-011, REQ-RO-012.

### UI Testing

- Thin smoke of an internal **Optimization Playground** page (if present): submit the golden 5-job/2-vehicle problem, confirm the map renders two polylines and the results panel shows 0 unassigned.
- Not a full UI regression — one happy-path smoke to catch integration breakage. If no UI exists, mark REQ-RO-013 coverage **To Be Confirmed (TBC)**.
- Covers REQ-RO-013.

### Integration Testing

- End-to-end path: API gateway → auth (`key`) → optimization service → matrix service → async result store → `GET /result`.
- Verify matrix-derived distances/durations are consistent between two identical calls.
- Verify auth rejection for missing/invalid `key`; verify unknown `id` handling on the result endpoint.
- Covers REQ-RO-011, REQ-RO-012.

### Regression Testing

- Full functional + constraint suite tagged `regression` runs nightly and on merge to `main`.
- Golden cases assert stable totals within tolerance to catch solver drift.
- Any newly fixed DEF-### gains a regression test before closure.
- Covers all REQ-RO-001..014 (subset marked `regression`).

### Performance Testing

- k6 scenarios against pre-prod, measured **end-to-end** (submit → poll → ready):
  - **Ramp:** 1 → 50 VUs over 5 min submitting the 50-job/5-vehicle reference problem.
  - **Steady:** 25 VUs for 10 min; record p50/p95/p99 latency, throughput, error rate.
  - **Stress:** increase problem size (200 jobs / 20 vehicles) to observe solver time growth.
- Gate: reference p95 ≤ 2500 ms; error rate ≤ 0.5%. Cross-check top-line numbers with JMeter.
- Covers REQ-RO-014.

### Security Testing

- **AuthN:** missing/invalid/revoked `key` → unauthorized (expect `401`; **TBC**).
- **AuthZ:** valid `key` without optimization scope → forbidden (expect `403`; **TBC**); tenant isolation on `GET /result?id=` (cannot read another org's result).
- **Injection/robustness:** oversized payloads, deeply nested JSON, non-numeric coordinate strings → rejected, no stack traces leaked.
- **Rate limiting:** exceed quota → throttled (expect `429` + `Retry-After`; **TBC**).
- **Transport:** endpoint reachable only over HTTPS; HTTP redirected/refused; `key` not leaked in logs.
- Covers REQ-RO-011, REQ-RO-012, REQ-RO-010.

## Traceability Matrix

| Requirement ID | Requirement Summary | Covered By (Test Cases) |
|---|---|---|
| REQ-RO-001 | Solve valid single-vehicle problem, return route | TC-RO-POS-001 |
| REQ-RO-002 | Return well-formed solution (`routes`,`unassigned`,`summary`) | TC-RO-POS-001, TC-RO-POS-002 |
| REQ-RO-003 | Assign all jobs when feasible (multi-vehicle) | TC-RO-POS-002, TC-RO-POS-003 |
| REQ-RO-004 | `summary` totals equal sum of route totals | TC-RO-POS-003 |
| REQ-RO-005 | Enforce vehicle capacity constraints | TC-RO-CAP-001, TC-RO-CAP-002, TC-RO-CAP-003 |
| REQ-RO-006 | Enforce job/vehicle time windows | TC-RO-TW-001, TC-RO-TW-002 |
| REQ-RO-007 | Enforce skills matching | TC-RO-SKL-001, TC-RO-SKL-002 |
| REQ-RO-008 | Support pickup & delivery shipments | TC-RO-PD-001, TC-RO-PD-002 |
| REQ-RO-009 | Report infeasible jobs in `result.unassigned` with reason | TC-RO-CAP-003, TC-RO-TW-002, TC-RO-SKL-002 |
| REQ-RO-010 | Enforce rate limits (throttling; exact code TBC) | TC-RO-NEG-004 |
| REQ-RO-011 | Reject missing/invalid `key` (unauthorized; exact code TBC) | TC-RO-NEG-005 |
| REQ-RO-012 | Reject insufficient scope / cross-tenant result access (TBC) | TC-RO-NEG-006 |
| REQ-RO-013 | Playground renders solution (if UI exists; else TBC) | (UI smoke — manual) |
| REQ-RO-014 | Meet performance SLO for reference problem (end-to-end) | (k6 perf run) |
| REQ-RO-015 | Multi-depot: vehicles start/end at correct depots | TC-RO-DEP-001 |
| REQ-RO-005 | Boundary: capacity exactly met vs exceeded | TC-RO-BND-001 |
| REQ-RO-002 | Validation of malformed/empty payloads & out-of-range `location_index` | TC-RO-NEG-001, TC-RO-NEG-002, TC-RO-NEG-003 |
