# API Overview — NextBillion.ai Route Optimization

> **Scope note.** This knowledge base is now scoped to the **Route Optimization API only**. Earlier drafts also described Routing, Navigation, Geocoding, Tracking, and Map APIs; those were illustrative placeholders and have been removed to avoid presenting unverified detail as fact. This document covers only what is verified against the customer-provided OpenAPI spec (`Knowledge/openapi.json`, distilled in `Knowledge/_NextBillion_Optimization_API_Facts.md`).

---

## 1. At a glance

| Property | Value |
|---|---|
| Product | NextBillion.ai Route Optimization API |
| Base URL | `https://api.nextbillion.io` |
| Authentication | `key` **query parameter** (32-bit alphanumeric): `?key=YOUR_KEY` |
| Request flow | **Asynchronous** — submit → poll for result |
| Content type | `application/json` |
| Coordinate format | `"latitude, longitude"` **strings** in `locations.location`, referenced by integer `location_index` |
| Units | distance in meters; durations & timestamps in seconds (Unix) |
| Success signal | HTTP `200`, `status: "Ok"`, `result.code: 0` |

---

## 2. Endpoints

| # | Operation | Method & Path | Purpose |
|---|-----------|---------------|---------|
| 1 | Submit | `POST /optimization/v2?key=YOUR_KEY` | Submit a fleet + demand problem; returns a request `id`. |
| 2 | Result | `GET /optimization/v2/result?key=YOUR_KEY&id=REQUEST_ID` | Retrieve the optimized solution for a submitted `id`. |
| 3 | Re-optimize | `POST /optimization/re_optimization?key=YOUR_KEY` | Re-plan an existing solution when orders/fleet change. |

### 2.1 `POST /optimization/v2` — Submit

- **Purpose:** Accept the optimization problem and queue it for solving.
- **Inputs (top level):** `locations` (required), `vehicles` (required), `jobs` and/or `shipments`, `depots`, `options`, `description`, `relations`, `cost_matrix` / `distance_matrix` / `duration_matrix`, `zones`.
- **Outputs:** `{ id, message, status, warnings }`. `status` is `Ok` on success.
- **Example:**
  ```
  POST https://api.nextbillion.io/optimization/v2?key=YOUR_KEY
  Content-Type: application/json
  { "locations": { "location": ["51.5074, -0.1278", "51.5010, -0.1426"] },
    "vehicles": [ { "id": "V1", "start_index": 0, "capacity": [10] } ],
    "jobs": [ { "id": "J1", "location_index": 1, "delivery": [1] } ] }
  ```
- **Common terminology:** *submission id* (the `id` used for polling), *warnings* (non-fatal input notes).
- **Business rules:** `locations.location` and `vehicles` are mandatory; at least one of `jobs`/`shipments` must be present; task `location_index` values must be valid indexes into `locations.location`.
- **Edge cases:** empty `vehicles` → validation error; both `jobs` and `shipments` empty → validation error; duplicate task `id` → validation error.

### 2.2 `GET /optimization/v2/result` — Result

- **Purpose:** Return the solution for a previously submitted `id`.
- **Inputs (query):** `key` (required), `id` (required — from the submit response).
- **Outputs:** `description`, `request_created_time`, `solution_created_time`, `status`, `message`, and `result` = `{ code, summary, routes[], unassigned[] }`.
- **Common terminology:** *summary* (global totals), *route* (per-vehicle plan), *step* (a stop within a route), *unassigned* (unserved demand).
- **Business rules:** `result.code == 0` = success; hard constraints are never violated in `routes` — infeasible demand appears in `unassigned` with a `reason`.
- **Edge cases:** polling before solving completes (handle a not-yet-ready state / retry); unknown `id` → error; partially feasible problem → some tasks in `unassigned`.

### 2.3 `POST /optimization/re_optimization` — Re-optimize

- **Purpose:** Re-plan an existing solution incrementally instead of resubmitting from scratch.
- **Inputs:** `existing_request_id` (the original `id`), `vehicle_changes`, `job_changes`, `shipment_changes` (each with `add` / `remove` / `modify`), optional `locations`, `options`.
- **Outputs:** same async pattern — returns an `id`; fetch via `GET /optimization/v2/result`.
- **Business rules:** IDs in `add` must be unique vs the original request; IDs in `remove`/`modify` must have existed in the original request.
- **Edge cases:** removing a vehicle that carried assigned tasks (tasks may become unassigned or move); adding demand beyond remaining capacity (new tasks may be unassigned).

---

## 3. Inputs & Outputs summary

| Category | Key objects/fields | Reference |
|---|---|---|
| **Inputs** | `locations{location[], approaches}`, `vehicles[]`, `jobs[]`, `shipments[]`, `depots[]`, `options{objective, constraint, routing, grouping, webhook}` | `RouteOptimizationKnowledge.md` §Vehicles/Jobs, `OptimizationConstraints.md` |
| **Outputs** | `result.summary`, `result.routes[].steps[]`, `result.unassigned[]` | `RouteOptimizationKnowledge.md` §Routes |
| **Auth** | `key` query param | this doc |
| **Errors** | `status` ≠ `Ok`; `result.code` ≠ 0; HTTP 4xx (exact catalog **TBC**) | §4 |

---

## 4. Errors & status

| Signal | Meaning | QA action |
|---|---|---|
| HTTP `200` + `status: "Ok"` + `result.code: 0` | Success | Validate solution content. |
| `result.code` ≠ `0` | Internal solver error | Verify parameters, constraints, and locations. |
| `warnings[]` non-empty | Non-fatal input issues | Review each warning; may indicate silently ignored fields. |

### API Error Codes

| Status | Description | Notes |
|---|---|---|
| `200` | Normal success. | Individually infeasible tasks still return `200` + task in `result.unassigned` — not an error. |
| `400` | Input validation failed. | Missing/invalid parameter, wrong value type, out-of-range coordinate/`location_index`, malformed JSON. |
| `401` | API key not supplied or invalid. | Wrong or missing `key` query parameter. |
| `403` | Key valid but no access to the requested resource. | Region not valid for the account, or a service not enabled. |
| `404` | Requested host/path not found. | Malformed hostname/path. |
| `413` | Request entity too large. | Request URI or body too large; contact support if it persists. |
| `422` | Could not process the request. | No feasible solution for the given locations/parameter configuration (whole-request infeasible). |
| `429` | Too many requests. | QPM or request-count quota reached. |
| `500` | Internal service error. | NextBillion.ai-side issue; contact support@nextbillion.ai. |

> **Note:** account-specific request-size limits (max vehicles/jobs) are not enumerated in the spec — mark those **"To Be Confirmed (TBC)"** where a test needs one. HTTP status codes above are confirmed.

---

## 5. Related documents

- `RouteOptimizationOverview.md` — product deep-dive and worked request/response.
- `RouteOptimizationKnowledge.md` — authoritative field-by-field reference.
- `OptimizationConstraints.md` — constraint semantics and edge cases.
- `_NextBillion_Optimization_API_Facts.md` — the verified facts sheet (single source of truth).
