# NextBillion.ai Route Optimization — QA Best-Practices Guide

This guide defines the core testing techniques and validation disciplines used for the NextBillion.ai **Route Optimization API** (`/optimization/v2`, `/optimization/v2/result`, `/optimization/re_optimization`). Each topic includes a short definition, guidance on when to apply it, a practical checklist, and one or two worked examples.

**Conventions used throughout**
- Base URL: `https://api.nextbillion.io`
- Authentication: `key` **query parameter** (`?key=…`); no Bearer header.
- Flow: **asynchronous** — `POST /optimization/v2` returns an `id`; poll `GET /optimization/v2/result?key=&id=` for the solution.
- Coordinates are `"latitude, longitude"` strings in `locations.location`, WGS84, referenced by integer `location_index`.
- Requirement IDs: `REQ-RO-<NNN>`; Test Cases: `TC-RO-<MODULE>-<NNN>`; Defects: `DEF-<NNN>`.
- Severity: Critical (S1), High (S2), Medium (S3), Low (S4). Priority: P1–P4.
- The exact HTTP 4xx error catalog and account size limits are **To Be Confirmed (TBC)**; assert observable behavior (`status`, `result.code`, `result.unassigned`).

> **Scope:** this project authors **Positive** and **Negative** test cases only. Edge-of-range, invalid-input, and infeasibility scenarios are covered **within** those two types (a boundary or malformed-input case is authored as a Positive or Negative case), not as separate test types.

## Table of Contents

1. [Positive Testing](#1-positive-testing)
2. [Negative Testing](#2-negative-testing)

---

## 1. Positive Testing

**Definition:** Verifying that the system behaves correctly when supplied with valid, expected inputs within the supported range. Also called "happy path" testing.

**When to use:** As the baseline for every feature — confirm the intended workflow succeeds before probing edge cases or failures.

**Checklist**
- [ ] Identify the primary success scenario for the feature.
- [ ] Use realistic, in-range, well-formed test data.
- [ ] Assert both the response status and the response payload contents.
- [ ] Confirm side effects (persisted records, emitted events) occurred.
- [ ] Include valid at-the-limit values (e.g. demand exactly equal to capacity) as Positive cases.

**Examples**
- `POST /optimization/v2?key=…` with a `locations` array, 2 vehicles, and 10 feasible jobs returns `status:"Ok"` with an `id`; the polled result has `result.code == 0`, all jobs assigned, and a positive `result.summary.distance`.
- A feasible pickup-&-delivery shipment solves with the pickup step sequenced before the delivery step on the same vehicle.

## 2. Negative Testing

**Definition:** Verifying that the system gracefully rejects invalid, unexpected, or malicious inputs without crashing or corrupting data — and that valid-but-unsatisfiable requests surface the right unassigned/failure outcome.

**When to use:** Immediately after positive coverage exists; wherever the system accepts external input.

**Checklist**
- [ ] Supply malformed, out-of-range, and wrong-type inputs.
- [ ] Assert a correct 4xx status and a structured error body for rejected submits.
- [ ] For valid-but-infeasible inputs, assert `200` + the task in `result.unassigned` with a reason (or `422` for a wholly unsolvable request).
- [ ] Confirm no partial write or side effect occurs on rejection.
- [ ] Verify the error message is actionable and does not leak internals.

**Examples**
- A `locations.location` entry of `"200.0, 95.0"` (latitude out of range) is rejected at submit (`status` ≠ `Ok`); no `id` is returned.
- Submitting a vehicle with `capacity: [-5]` is rejected at submit; no optimization job is created.
- A job whose demand exceeds every vehicle's capacity is accepted but lands in `result.unassigned` with a capacity reason.
- A `time_window` of `[36000, 35999]` (end before start) is rejected as an invalid window at submit.
