# NextBillion.ai — Route Optimization API — Verified Facts Sheet

> **Source of truth.** Every field name, endpoint, and rule below was extracted directly from the customer-provided OpenAPI spec at `Knowledge/openapi.json` (paths `/optimization/v2`, `/optimization/v2/result`, `/optimization/re_optimization`). Where the spec did not state something, it is marked **"Not in spec"**. This sheet is the single source used to rewrite all other docs. Do not add fields that are not listed here.

## 0. Global facts (apply everywhere)

| Fact | Value |
|------|-------|
| Base URL | `https://api.nextbillion.io` |
| Submit endpoint | `POST https://api.nextbillion.io/optimization/v2?key=YOUR_KEY` |
| Result endpoint | `GET https://api.nextbillion.io/optimization/v2/result?key=YOUR_KEY&id=REQUEST_ID` |
| Re-optimization endpoint | `POST https://api.nextbillion.io/optimization/re_optimization?key=YOUR_KEY` |
| **Authentication** | **`key` query parameter** (required, "32 bit alphanumeric character"). **NOT** a Bearer/Authorization header. |
| **Request flow** | **Asynchronous.** POST submits a job and returns an `id`. You then GET `/result?key=&id=` to poll for the solution. |
| **Coordinate format** | `locations.location` is an **array of strings** in **`"latitude, longitude"`** order (e.g. `"34.0522, -118.2437"`). This is the opposite of GeoJSON's `[lon, lat]`. Tasks/vehicles reference a coordinate by its **integer index** into this array via `location_index` / `start_index` / `end_index`. |
| Distances | meters |
| Durations / times | seconds; time windows are **UNIX timestamps (seconds)** |
| Response `status` | `Ok` on success; otherwise an error code/message (see API Error Codes) |
| Tag | `Optimization v2` |

---

## 1. `POST /optimization/v2` — Submit optimization job

**Auth:** `key` (query, required).
**Request body:** `application/json`. Top-level properties (exact names from spec):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `locations` | object | **Yes** | All coordinates used in the problem. See §1.1. |
| `vehicles` | array | **Yes** | Fleet. See §1.2. |
| `jobs` | array | Conditional | Single-location tasks. Provide `jobs` and/or `shipments`. See §1.3. |
| `shipments` | array | Conditional | Linked pickup→delivery task pairs. See §1.4. |
| `depots` | array | No | Depot definitions (for multi-depot / depot runs). |
| `options` | object | No | Objective, constraint, routing, grouping, webhook config. See §1.5. |
| `solution` | array | No | Re-optimization: previous routes to re-plan. |
| `unassigned` | array | No | Re-optimization: previously unassigned tasks. |
| `description` | string | No | Free-text label, echoed back in the result. |
| `relations` | array | No | Ordering/grouping relations between tasks. |
| `cost_matrix` | array | No | Custom cost matrix. |
| `zones` | array | No | Geographic zones. |
| `distance_matrix` | array | No | Custom distance matrix. |
| `duration_matrix` | array | No | Custom duration matrix. |

### 1.1 `locations` object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | integer | No | Positive integer ID for the location set. |
| `location` | array of string | **Yes** | Coordinates as `"latitude, longitude"` strings. Index into this array is used everywhere as `location_index`. Avoid duplicates; repeat an index for multiple tasks at one point. |
| `approaches` | array of string | No | Per-location curbside approach: `unrestricted` \| `curb` \| `""`. If given, length must equal number of locations. Case-sensitive. |

### 1.2 `vehicles[]` object — all fields in spec

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique vehicle ID (case-sensitive). Required. |
| `description` | string | Custom description, returned as-is. |
| `start_index` | integer | Index into `location` for start. If neither `start_index` nor `start_depot_ids` given, vehicle starts at first task. |
| `start_depot_ids` | array string | Depots the vehicle may start from. |
| `end_index` | integer | Index into `location` for end. |
| `end_depot_ids` | array string | Depots where the vehicle ends. |
| `capacity` | array integer | Multidimensional capacity; keep dimensions consistent with job/shipment quantities. |
| `alternative_capacities` | array | Alternate capacity configurations. |
| `time_window` | array integer | Vehicle shift `[start, end]` as UNIX timestamps. |
| `skills` | array integer | Skills the vehicle possesses. |
| `max_tasks` | integer | Max number of tasks assignable to this vehicle. |
| `breaks` | array | Driver breaks (each with `id`, `time_windows`, `service`, etc.). |
| `costs` | object/array | Cost configuration for the vehicle. |
| `speed_factor` | number | Multiplier on travel speed. |
| `layover_config` | object | Layover configuration. |
| `allowed_zones` | array integer | Zones the vehicle may enter. |
| `restricted_zones` | array integer | Zones the vehicle must avoid. |
| `max_distance` | integer | Max travel distance (meters). |
| `max_travel_time` | integer | Max travel time (seconds). |
| `max_stops` | integer | Max stops on the route. |
| `profile` | string | Routing profile name for the vehicle. |
| `max_working_time` | integer | Max working duration (seconds). |
| `volume` | object | Volumetric capacity (`width`/`depth`/`height`/`alignment`). |
| `max_depot_runs` | integer | Max number of depot runs (reloads). |
| `max_deadhead_distance` | integer | Max empty-travel distance. |
| `max_deadhead_duration` | integer | Max empty-travel duration. |
| `min_stop_load` | integer | Minimum load per stop. |
| `depot` | string | Depot association. |
| `max_travel_cost` | integer | Max travel cost. |

### 1.3 `jobs[]` object — all fields in spec

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique job ID (case-sensitive). Required. |
| `description` | string | Custom description, echoed back. |
| `location_index` | integer | Index into `location` array. Required. |
| `delivery` | array integer | Multidimensional quantity delivered at this job. |
| `pickup` | array integer | Multidimensional quantity picked up at this job. |
| `service` | integer | Service (handling) time at the job, seconds. |
| `time_windows` | array of [start,end] | Allowed service windows (UNIX seconds). |
| `skills` | array integer | Skills required to service this job. |
| `priority` | integer | 0–100; higher = more important to assign. |
| `setup` | integer | One-time setup time, seconds. |
| `zones` | array integer | Zone constraints. |
| `depot_ids` | array string | Depots that can source/sink this job. |
| `load_types` | array integer | Load type tags. |
| `incompatible_load_types` | array integer | Load types that cannot share the vehicle. |
| `sequence_order` | integer | Relative ordering constraint. |
| `revenue` | integer | Revenue earned by servicing the job. |
| `outsourcing_cost` | integer | Cost of leaving the job unassigned/outsourced. |
| `follow_lifo_order` | boolean | Enforce LIFO loading. |
| `max_visit_lateness` | integer | Max allowed lateness vs time window, seconds. |
| `volume` | object | Volumetric demand. |
| `joint_order` | integer | Joint-order grouping. |

### 1.4 `shipments[]` object

Each shipment links a **pickup** and a **delivery** step plus shared attributes.

`shipments[].pickup` / `shipments[].delivery` sub-fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Step ID. |
| `description` | string | Echoed back. |
| `location_index` | integer | Index into `location`. |
| `service` | integer | Service time, seconds. |
| `time_windows` | array | Allowed windows (UNIX seconds). |
| `setup` | integer | Setup time, seconds. |
| `sequence_order` | integer | Ordering constraint. |
| `max_visit_lateness` | integer | Max lateness, seconds. |

`shipments[]` shared fields: `amount` (array integer — quantity moved), `skills` (array int), `priority` (int), `zones`, `load_types`, `incompatible_load_types`, `max_time_in_vehicle` (int sec), `revenue` (int), `outsourcing_cost` (int), `follow_lifo_order` (bool), `volume` (object), `joint_order` (int).

### 1.5 `options` object

| Sub-object | Key fields (from spec) |
|------------|------------------------|
| `options.objective` | `custom` (object: e.g. `type`, `value`), `allow_early_arrival` (bool), `solving_time_limit` (int sec), `travel_cost`. |
| `options.constraint` | `max_vehicle_overtime`, `vehicle_overtime_penalty`, `max_visit_lateness`, `visit_lateness_penalty`, `sequence_order_penalty`. |
| `options.routing` | `mode`, `traffic_timestamp`, `truck_size`, `truck_weight`, `avoid`, `exclude`, `disable_cache`, `hazmat_type`, `profiles`, `allow`, `cross_border`, `truck_axle_load`. |
| `options.grouping` | Task grouping / proximity options. |
| `options.webhook` | Webhook config for async status callbacks. |

### 1.6 `POST /optimization/v2` response (submission acknowledgement)

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID — pass to the GET result endpoint. |
| `message` | string | Acknowledgement message. |
| `status` | string | `Ok` on success; error code/message otherwise. |
| `warnings` | array string | Warnings about input parameters/constraints. |

---

## 2. `GET /optimization/v2/result` — Fetch solution

**Auth/params:** `key` (query, required), `id` (query, required — the ID from the POST).

**Response top-level:**

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Echo of request `description` (absent if none). |
| `request_created_time` | integer | UNIX seconds when input was created. |
| `solution_created_time` | integer | UNIX seconds when the solution finished. |
| `result` | object | The optimized solution. See below. |
| `status` | string | Response state (`Ok` / error). |
| `message` | string | Status / error message. |

**`result` object:** `code` (integer — `0` = success; non-zero = internal error), `summary` (object), `routes` (array), `unassigned` (array).

**`result.summary` fields:** `cost`, `routes` (count), `unassigned` (count), `duration`, `distance`, `setup`, `service`, `waiting_time`, `priority`, `delivery` (array), `pickup` (array), `revenue`, `total_visit_lateness`, `num_late_visits`, … (all integers except `distance` which is number, and `delivery`/`pickup` arrays).

**`result.routes[]` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `vehicle` | string | Vehicle ID for this route. |
| `cost` | integer | Route cost. |
| `steps` | array | Ordered stops. See below. |
| `description` | string | Vehicle description. |
| `distance` | number | Route distance, meters. |
| `duration` | integer | Drive time, seconds. |
| `geometry` | string | Encoded polyline of the route. |
| `pickup` | array integer | Total picked up on route. |
| `delivery` | array integer | Total delivered on route. |
| `priority` | integer | Sum of assigned priorities. |
| `service` | integer | Total service time. |
| `vehicle_overtime` | integer | Overtime, seconds. |
| `waiting_time` | integer | Waiting time, seconds. |
| `setup` | integer | Total setup time. |
| `revenue` | integer | Revenue on route. |
| `profile` | string | Routing profile used. |
| `adopted_capacity` | array | Capacity configuration adopted. |
| `penalty` | integer | Penalty incurred. |

**`result.routes[].steps[]` fields:** `id`, `type` (**enum: `start` \| `job` \| `pickup` \| `delivery` \| `break` \| `layover` \| `end`**; `start`/`break`/`layover`/`end` steps have no `id`), `arrival` (UNIX sec), `duration`, `location` (`"lat, lon"` string), `projected_location`, `location_index`, `load` (array), `service`, `waiting_time`, `setup`, `late_by`, `description`, `distance`, `snapped_location`, `run`, `depot`.

**`result.unassigned[]` fields:** `id` (task ID), `type`, `location` (`"lat, lon"`), `reason` (why unassigned), `outsourcing_cost`.

---

## 3. `POST /optimization/re_optimization` — Re-optimize an existing solution

**Auth:** `key` (query, required). Also asynchronous (returns an `id`; fetch via the same `/optimization/v2/result` GET).

**Request top-level fields:**

| Field | Type | Description |
|-------|------|-------------|
| `existing_request_id` | string | ID of the original optimization request to re-plan. Required. |
| `vehicle_changes` | object | `add` (array of new vehicles), `remove` (array of vehicle IDs), `modify` (array of changed vehicles). |
| `job_changes` | object | `add`, `remove`, `modify` for jobs. |
| `shipment_changes` | object | `add`, `remove`, `modify` for shipments. |
| `locations` | object | Optional new location list (overwrites original; see spec cautions on indexes). |
| `options` | object | Re-optimization options incl. `webhook`. |

New vehicle/job/shipment IDs in `add` must be unique vs the original request; IDs in `remove`/`modify` must have existed in the original request.

---

## 4. API Error Codes / status

- POST/GET `status`: `Ok` on success; error otherwise.
- `result.code`: `0` = success; non-zero = internal error → verify parameters, constraints, and locations; contact `support@nextbillion.ai` if unresolved.
- **HTTP status catalog (confirmed by customer, 2026-07):**

| Status | Description | Notes |
|--------|-------------|-------|
| `200` | Normal success. | Individually infeasible tasks still return `200` + task in `result.unassigned` — not an error. |
| `400` | Input validation failed. | Missing/invalid parameter, wrong value type, out-of-range coordinate/`location_index`, malformed JSON. |
| `401` | API key not supplied or invalid. | Wrong or missing `key`. |
| `403` | Key valid but no access to the requested resource. | Region not valid for account, or service not enabled. |
| `404` | Requested host/path not found. | Malformed hostname. |
| `413` | Request entity too large. | Request URI or body too large. |
| `422` | Could not process the request. | No feasible solution for the given locations/parameters (whole-request infeasible). |
| `429` | Too many requests. | QPM or request-count quota reached. |
| `500` | Internal service error. | NextBillion.ai-side issue. |

- Account-specific request-size limits (max vehicles/jobs) remain **TBC** — not enumerated in the spec.

---

## 5. Key corrections vs the earlier (invented) "MapSphere" docs

| Topic | OLD (invented, wrong) | NEW (from spec, correct) |
|-------|----------------------|--------------------------|
| Brand | MapSphere | NextBillion.ai |
| Base URL | `api.mapsphere.com/v1` | `api.nextbillion.io` |
| Endpoint | `POST /v1/optimization` (sync) | `POST /optimization/v2` (async) + `GET /optimization/v2/result` + `POST /optimization/re_optimization` |
| Auth | `Authorization: Bearer` header | `key` query parameter |
| Coordinates | `[longitude, latitude]` array | `"latitude, longitude"` **string**, referenced by integer `location_index` |
| Location model | inline lat/lon on each job | central `locations.location` array + indexes |
| Response | inline `routes` in POST response | async: POST returns `id`; GET `/result` returns `result.routes[]` |
| Unassigned | `unassigned[]` with ad-hoc reasons | `result.unassigned[]` with `id`,`type`,`location`,`reason`,`outsourcing_cost` |
| Step types | invented | `start`,`job`,`pickup`,`delivery`,`break`,`layover`,`end` |
