# Negative Testing — NextBillion.ai Route Optimization API

## Definition

Negative Testing verifies that the system behaves *correctly when it is used incorrectly*. Instead of confirming that valid input produces the right output (positive testing), it confirms that invalid, malformed, unauthorized, contradictory, or impossible input is **rejected cleanly** — with the right response, a helpful message, and no partial side effects, crash, or information leak.

For the Route Optimization API this spans four failure families:
1. **Structural** — malformed JSON, wrong content type, wrong data types, missing required fields.
2. **Authentication/method** — absent or invalid `key`, unsupported HTTP verb.
3. **Semantic/constraint** — values that are individually well-formed but jointly impossible (demand > capacity, more required stops than time allows, unreachable coordinates).
4. **Domain** — coordinates outside the globe, an out-of-range `location_index`, a point with no road network.

A negative test passes when the API returns the *expected* outcome — either a request-level rejection (`status` ≠ `Ok` / HTTP 4xx) for malformed input, or a well-formed solution that places infeasible tasks in `result.unassigned` — never a `200`/`Ok` with wrong data and never an unhandled `500`.

**Base URL** `https://api.nextbillion.io`. Auth is the `key` **query parameter**. Coordinates are `"latitude, longitude"` strings referenced by `location_index`.

> **Two distinct failure channels — do not conflate them.**
> - **Malformed / invalid request** → rejected at submit (`status` ≠ `Ok`, HTTP 4xx). Example: bad JSON, missing `vehicles`, out-of-range `location_index`.
> - **Well-formed but infeasible** → accepted (`status: Ok`, `result.code: 0`), with the impossible tasks in `result.unassigned[]` carrying a `reason`. Example: demand exceeds all capacity.

> **Contract note.** The provided OpenAPI spec does **not** enumerate the exact HTTP 4xx catalog or error-body schema. Where a test needs a precise code/body, assert the observable behavior and mark the exact code **To Be Confirmed (TBC)** until verified with NextBillion.

## Purpose

- Guarantee robust, predictable error handling so clients can react programmatically (retry, surface, abort).
- Prevent silent data corruption where bad input yields a plausible-but-wrong route.
- Lock the observable error behavior so it does not drift between releases.
- Ensure failures are safe: no stack traces, internal hostnames, SQL, or secrets in responses.
- Confirm that impossible optimization problems are reported via `result.unassigned` rather than solved incorrectly or hung.

## Checklist

### Malformed structure
- [ ] Truncated / invalid JSON body → request rejected (4xx), no `500`.
- [ ] Empty body on `POST /optimization/v2` → rejected.
- [ ] Wrong `Content-Type` (e.g. `text/plain` for JSON) → rejected (expect `415`; **TBC**).
- [ ] Duplicate JSON keys — documented, deterministic resolution.
- [ ] Trailing commas / comments (strict JSON) rejected.
- [ ] Deeply nested / oversized payload → rejected (expect `413`; **TBC**), not a hang.

### Wrong types & missing fields
- [ ] String where array expected (`location` must be an array of strings).
- [ ] Number where string expected inside `locations.location` (coordinates are `"lat, lon"` strings).
- [ ] Boolean/null where object expected.
- [ ] Missing required field (`locations`, `vehicles`) → rejected, naming the field.
- [ ] Both `jobs` and `shipments` absent/empty → rejected (empty problem).
- [ ] Unknown/extra field — ignored or surfaced via `warnings[]` per documented strictness.
- [ ] `null` for a required non-nullable field.

### Auth & HTTP method
- [ ] No `key` query parameter → unauthorized (expect `401`; **TBC**).
- [ ] Malformed `key` (wrong length/format) → unauthorized.
- [ ] Valid-format but unknown/revoked `key` → unauthorized.
- [ ] `key` lacking scope for the endpoint → forbidden (expect `403`; **TBC**).
- [ ] Unsupported verb (`DELETE /optimization/v2`) → method not allowed (expect `405` + `Allow`; **TBC**).
- [ ] `GET /optimization/v2/result` missing `id` → rejected.
- [ ] `GET /optimization/v2/result` with unknown `id` → documented not-found / not-ready behavior.

### Semantic / impossible constraints (expect `result.unassigned`, not a hard error)
- [ ] Single job demand > every vehicle's capacity → job in `result.unassigned` with capacity reason.
- [ ] Total demand > total fleet capacity → excess tasks unassigned, not silently dropped.
- [ ] Time windows that cannot all be satisfied → unassigned tasks listed with time-window reason.
- [ ] Vehicle shift `time_window` ends before it starts → rejected at submit (malformed).
- [ ] Shipment delivery window earlier than its pickup window → pair unassigned (precedence).
- [ ] Job requiring a skill no vehicle has → unassigned with skill reason.

### Domain / geospatial
- [ ] Coordinate outside globe (`"200, 13"`) → rejected (invalid coordinate).
- [ ] `location_index` ≥ `len(location)` or negative → rejected.
- [ ] Unreachable point (no road network) → task unassigned or non-zero `result.code`, not `500`.
- [ ] Pickup and delivery at the same `location_index` — documented zero-distance behavior.
- [ ] Duplicate task `id` → rejected.

### Rate & size
- [ ] Exceed rate limit → throttled (expect `429` + `Retry-After`; **TBC**).
- [ ] Request exceeding account max jobs/vehicles → rejected (limit; cap value **TBC**).

## Examples

The error-body schema is **TBC**; assert the observable channel (`status` / HTTP / `result.unassigned`) and treat exact codes as TBC.

| Test Case ID | Input | Endpoint | Expected channel |
|---|---|---|---|
| TC-RO-NEG-101 | coordinate `"abc, 13"` in `location` | `POST /optimization/v2` | Rejected — invalid coordinate |
| TC-RO-NEG-102 | `vehicles` field absent | `POST /optimization/v2` | Rejected — missing field |
| TC-RO-NEG-103 | both `jobs` and `shipments` empty | `POST /optimization/v2` | Rejected — empty problem |
| TC-RO-NEG-110 | delivery `[500]`, capacity `[100]` | `POST /optimization/v2` | `Ok` → job in `result.unassigned` (capacity) |
| TC-RO-NEG-112 | vehicle `time_window` end < start | `POST /optimization/v2` | Rejected — invalid time window |
| TC-RO-NEG-113 | `location_index` = `len(location)` | `POST /optimization/v2` | Rejected — index out of range |
| TC-RO-NEG-120 | job needs `skills:[9]`, no vehicle has it | `POST /optimization/v2` | `Ok` → job in `result.unassigned` (skill) |
| TC-RO-NEG-121 | `DELETE /optimization/v2` | `DELETE /optimization/v2` | Method not allowed (`405`; **TBC**) |
| TC-RO-NEG-130 | no `key` query param | `POST /optimization/v2` | Unauthorized (`401`; **TBC**) |
| TC-RO-NEG-131 | revoked `key` | `POST /optimization/v2` | Unauthorized |
| TC-RO-NEG-140 | `GET /result` missing `id` | `GET /optimization/v2/result` | Rejected — missing `id` |
| TC-RO-NEG-150 | malformed JSON body | `POST /optimization/v2` | Rejected (4xx), no partial job created |

### Infeasible-demand example (TC-RO-NEG-110) — accepted but unassigned

```json
POST https://api.nextbillion.io/optimization/v2?key=YOUR_KEY
{
  "locations": { "location": ["52.517, 13.388", "52.520, 13.400"] },
  "vehicles":  [ { "id": "V1", "capacity": [100], "start_index": 0 } ],
  "jobs":      [ { "id": "J10", "location_index": 1, "delivery": [500] } ]
}
```
Submit returns `{ "id": "...", "status": "Ok", ... }`. The result then shows the job as unassigned:
```json
{ "result": { "code": 0,
  "unassigned": [ { "id": "J10", "type": "job", "location": "52.520, 13.400", "reason": "capacity" } ] } }
```
(The exact `reason` wording is **TBC**; assert that the job appears in `unassigned` with a capacity-related reason.)

### Malformed JSON example (TC-RO-NEG-150)

Body `{ "vehicles": [ { "id": "V1"` (truncated) → request rejected with a 4xx and **no** partial optimization job created. Exact status/body **TBC**.

## Common Mistakes

- **Accepting `500` as "it errored".** A `500` is a defect: bad input reached code that did not expect it. Negative tests must assert the *specific* 4xx (or that infeasible input landed in `unassigned`).
- **Conflating malformed with infeasible.** Malformed → 4xx at submit. Well-formed-but-impossible → `Ok` with tasks in `result.unassigned`. They have different owners and contracts.
- **Only asserting a status code** while ignoring the `result.unassigned` reason for infeasible cases.
- **Not checking for side effects.** A rejected submit must not create a partial job or consume quota; re-poll/verify no orphan `id`.
- **Assuming an error-body schema.** It is TBC — snapshot the real response once and assert against that, not an invented shape.
- **Forgetting the `Allow` and `Retry-After` headers** on `405`/`429` (behavior TBC — verify).
- **Leaking internals** — echoing stack traces, DB errors, or file paths.
- **Skipping auth on the result endpoint**, assuming submit covers it — verify `key` on `GET /result` too.

## Best Practices

- Assert the correct **channel** (submit rejection vs `result.unassigned`) in every negative case, and mark unconfirmed codes **TBC**.
- Build a reusable **fault library**: malformed-JSON body, wrong-type value, missing-field mutator, invalid-`key` — compose them across the three endpoints.
- Use **schema/contract testing** (the OpenAPI spec) to auto-generate type-violation cases.
- Assert **no side effects** after rejection (no orphan `id`, quota unchanged) — negative correctness is more than the response.
- Separate **client errors (4xx)** from **infeasibility (`unassigned`)** in the test taxonomy.
- Snapshot real error messages so wording changes are reviewed; keep them secret-free.
- Tag negative cases (`negative`) and run them on every PR; they are cheap and catch contract drift early.
- For each impossible-constraint case, assert the **reason** in `result.unassigned`, enabling clients to explain failures to end users.
