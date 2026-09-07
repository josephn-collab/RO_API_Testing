# Route Optimization Knowledge Base

Authoritative domain reference for the **NextBillion.ai Route Optimization API**. This document is the single source of truth for QA test design, validation rules, and expected behavior of the optimization engine.

> **Verified against** the customer-provided OpenAPI spec (`Knowledge/openapi.json`), distilled in `Knowledge/_NextBillion_Optimization_API_Facts.md`. Field names below are quoted from the spec. Anything the spec does not define is marked **To Be Confirmed (TBC)**.

- **Product:** Route Optimization API
- **Base URL:** `https://api.nextbillion.io`
- **Endpoints:**
  - `POST /optimization/v2` — submit a problem, returns a request `id`
  - `GET /optimization/v2/result?key=…&id=…` — fetch the solution
  - `POST /optimization/re_optimization` — re-plan an existing solution
- **Authentication:** `key` **query parameter** (32-bit alphanumeric). No Authorization/Bearer header.
- **Request flow:** **asynchronous** — submit → poll for result.
- **Coordinates:** `"latitude, longitude"` **strings** in `locations.location`, referenced by integer `location_index` / `start_index` / `end_index`, WGS84.
- **Units:** distances in **meters**, durations/timestamps in **seconds** (Unix).
- **Success:** HTTP `200`, `status: "Ok"`, `result.code: 0`.
- **Area code:** RO (Route Optimization)

The Route Optimization API solves Vehicle Routing Problems (VRP): given a fleet of **vehicles** and a set of **jobs** (and/or **shipments**), it produces a set of **routes** that assign tasks to vehicles and order the stops to minimize total cost while honoring all constraints. Tasks that cannot be served are returned in **`result.unassigned`**.

---

## 0. The `locations` object

All coordinates are declared once in a central `locations` object; every task and vehicle refers to a coordinate by its **integer index** into `locations.location`.

| Field | Type | Description | Constraints/Validation | Example |
|---|---|---|---|---|
| `id` | integer | Optional identifier for the location set. | Positive integer. | `1` |
| `location` | array[string] | Coordinates as `"latitude, longitude"` strings. | Required. Each `"lat, lon"`; lat ∈ [-90,90], lon ∈ [-180,180]. Avoid duplicates. | `["52.5163, 13.3777", "52.5170, 13.3888"]` |
| `approaches` | array[string] | Curbside approach per location. | Optional. `unrestricted` \| `curb` \| `""`. If present, length == number of locations. | `["unrestricted", "curb"]` |

> **Indexing:** valid `location_index`/`start_index`/`end_index` values are `[0, len(location))`. Multiple tasks at the same physical point should reuse the same index rather than duplicate coordinates.

---

## 1. Vehicles

A `vehicles[]` entry describes a single resource (truck, van, courier) available to serve tasks. The `vehicles` array must contain at least one vehicle. `id` is a **string**.

### 1.1 Field Reference

| Field | Type | Description | Constraints/Validation | Example |
|---|---|---|---|---|
| `id` | string | Unique vehicle identifier. | Required. Unique, case-sensitive. | `"Vehicle 1"` |
| `description` | string | Custom description, echoed in output. | Optional. | `"Refrigerated van"` |
| `start_index` | integer | Index into `location` for the start point. | Optional. `[0, len(location))`. If neither this nor `start_depot_ids` is set, vehicle starts at its first task. | `0` |
| `end_index` | integer | Index into `location` for the end point. | Optional. If neither this nor `end_depot_ids` is set, vehicle ends at its last task (open route). | `0` |
| `start_depot_ids` | array[string] | Depots the vehicle may start from. | Optional. | `["depot_A"]` |
| `end_depot_ids` | array[string] | Depots the vehicle may end at. | Optional. | `["depot_A"]` |
| `capacity` | array[integer] | Multi-dimensional load capacity. | Optional. Values ≥ 0. Keep dimensions consistent with job/shipment quantities. | `[100, 40]` |
| `alternative_capacities` | array | Alternate capacity configurations. | Optional. | TBC |
| `skills` | array[integer] | Capabilities the vehicle provides. | Optional. Non-negative ints. Must be a superset of each assigned task's `skills`. | `[1, 4]` |
| `time_window` | array[integer] | Shift `[start, end]` as Unix epoch seconds. | Optional. `start < end`. Route must fit inside. | `[1700000000, 1700028800]` |
| `breaks` | array[object] | Driver rest periods (see 1.2). | Optional. | see 1.2 |
| `costs` | object | Per-vehicle cost weights. | Optional. | TBC (fields per spec) |
| `speed_factor` | number | Multiplier applied to travel speed. | Optional. `> 0`. | `0.9` |
| `layover_config` | object | Layover configuration. | Optional. | TBC |
| `allowed_zones` | array[integer] | Zones the vehicle may enter. | Optional. | `[1,2]` |
| `restricted_zones` | array[integer] | Zones the vehicle must avoid. | Optional. | `[3]` |
| `max_tasks` | integer | Max number of tasks assignable to the vehicle. | Optional. `≥ 0`. | `20` |
| `max_stops` | integer | Max number of stops on the route. | Optional. `≥ 0`. | `18` |
| `max_distance` | integer | Max cumulative distance (meters). | Optional. `> 0`. | `250000` |
| `max_travel_time` | integer | Max cumulative travel time (seconds). | Optional. `> 0`. | `28800` |
| `max_working_time` | integer | Max total working duration (seconds). | Optional. `> 0`. | `32400` |
| `max_depot_runs` | integer | Max number of depot reloads. | Optional. | `2` |
| `max_deadhead_distance` | integer | Max empty-travel distance (meters). | Optional. | `50000` |
| `max_deadhead_duration` | integer | Max empty-travel time (seconds). | Optional. | `3600` |
| `min_stop_load` | integer | Minimum load per stop. | Optional. | `1` |
| `volume` | object | Volumetric capacity. | Optional. | TBC |
| `profile` | string | Routing profile for the vehicle. | Optional. | `"truck"` |
| `depot` | string | Depot association. | Optional. | `"depot_A"` |
| `max_travel_cost` | integer | Max travel cost. | Optional. | TBC |

### 1.2 Breaks

A break models a driver rest that must be taken within a permitted window and consumes `service` seconds. The engine schedules it at a legal point along the route and it appears as a `type: "break"` step in the output.

| Field | Type | Description | Constraints/Validation | Example |
|---|---|---|---|---|
| `id` | string/integer | Break identifier within the vehicle. | Required. | `1` |
| `time_windows` | array[array[integer]] | Allowed intervals in which the break may start. | Required. Each `[start, end]`, ascending. | `[[1700010000, 1700013600]]` |
| `service` | integer | Break duration in seconds. | `≥ 0`. | `1800` |

### 1.3 Edge Cases — Vehicles

- **Neither `start_index` nor `start_depot_ids`:** valid — the vehicle starts at the location of its first task. Same logic for end.
- **`start_index` set, no end anchor:** valid open route; vehicle ends wherever the last task leaves it.
- **`capacity` dimension mismatch** with job/shipment quantities: inconsistent dimensions cause incorrect load accounting; keep them equal.
- **Empty `skills`:** vehicle can only serve tasks that also have empty `skills`.
- **`speed_factor` ≤ 0:** invalid; must be `> 0`.
- **Break window outside shift `time_window`:** break becomes unschedulable → the vehicle may serve fewer tasks.
- **`max_tasks: 0` / `max_stops: 0`:** vehicle effectively unusable; its candidate tasks go unassigned.

> **Validation & Testing Notes — Vehicles**
> - Verify capacity dimension consistency between vehicles and task quantities.
> - Confirm `skills` superset enforcement: a task requiring skill `7` must never be placed on a vehicle lacking `7`.
> - Test shift `time_window` boundaries (route ending exactly at `end` is valid; one second over is not).
> - Ensure breaks are scheduled within `time_windows` and `service` is added to route/working time.
> - Confirm `max_distance` / `max_travel_time` / `max_working_time` / `max_stops` / `max_tasks` are enforced and produce unassigned tasks rather than silent truncation.
> - Confirm start/end anchoring falls back to first/last task when no index/depot is given.

---

## 2. Jobs

A `jobs[]` entry is a single-location task (a visit). Paired pickup/delivery across two locations are expressed as **shipments** (see 2.2). The request must contain at least one `job` or one `shipment`. `id` is a **string**; the location is given as `location_index`.

### 2.1 Field Reference

| Field | Type | Description | Constraints/Validation | Example |
|---|---|---|---|---|
| `id` | string | Unique job identifier. | Required. Unique across `jobs`. | `"Job 101"` |
| `description` | string | Custom description, echoed in output. | Optional. | `"Grocery drop"` |
| `location_index` | integer | Index into `location` where the job is served. | Required. `[0, len(location))`. | `1` |
| `service` | integer | Service (dwell) time in seconds. | Optional. `≥ 0`. | `300` |
| `delivery` | array[integer] | Quantity delivered here (unloaded). | Optional. Values ≥ 0; dimensions consistent with capacity. | `[10]` |
| `pickup` | array[integer] | Quantity picked up here (loaded). | Optional. Values ≥ 0. | `[5]` |
| `skills` | array[integer] | Skills required to perform this job. | Optional. Vehicle `skills` must be a superset. | `[1]` |
| `priority` | integer | Importance when not all tasks can be served. | Optional. `0`–`100`. Higher served first. | `50` |
| `time_windows` | array[array[integer]] | Allowed service-start intervals (epoch s). | Optional. Ascending `[start, end]`. | `[[1700003600, 1700010800]]` |
| `setup` | integer | One-time setup time (seconds). | Optional. `≥ 0`. | `60` |
| `max_visit_lateness` | integer | Max tolerated lateness vs window (seconds). | Optional. | `600` |
| `depot_ids` | array[string] | Depots that can source/sink this job. | Optional. | `["depot_A"]` |
| `zones` | array[integer] | Zone constraints. | Optional. | `[1]` |
| `load_types` | array[integer] | Load-type tags. | Optional. | `[2]` |
| `incompatible_load_types` | array[integer] | Load types that can't share the vehicle. | Optional. | `[3]` |
| `sequence_order` | integer | Relative ordering constraint. | Optional. | `1` |
| `revenue` | integer | Revenue earned by servicing the job. | Optional. | `500` |
| `outsourcing_cost` | integer | Cost of leaving the job unassigned. | Optional. | `1000` |
| `follow_lifo_order` | boolean | Enforce LIFO loading. | Optional. | `true` |
| `volume` | object | Volumetric demand. | Optional. | TBC |
| `joint_order` | integer | Joint-order grouping. | Optional. | `7` |

### 2.2 Shipments (Pickup & Delivery pairs)

A `shipments[]` entry binds a `pickup` step and a `delivery` step so both are served by the **same vehicle**, pickup **before** delivery.

**`pickup` / `delivery` sub-object:**

| Field | Type | Description | Example |
|---|---|---|---|
| `id` | string | Step identifier. | `"P1"` / `"D1"` |
| `description` | string | Echoed in output. | `"Warehouse"` |
| `location_index` | integer | Index into `location`. | `3` |
| `service` | integer | Service time (seconds). | `180` |
| `time_windows` | array[[start,end]] | Allowed windows (epoch s). | `[[1700002000, 1700009000]]` |
| `setup` | integer | Setup time (seconds). | `60` |
| `sequence_order` | integer | Ordering constraint. | `1` |
| `max_visit_lateness` | integer | Max lateness (seconds). | `300` |

**Shipment-level fields:** `amount` (array[int], load moved), `skills` (array[int]), `priority` (int 0–100), `zones`, `load_types`, `incompatible_load_types`, `max_time_in_vehicle` (int sec), `revenue` (int), `outsourcing_cost` (int), `follow_lifo_order` (bool), `volume` (object), `joint_order` (int).

### 2.3 Time Windows

- Expressed in **absolute Unix epoch seconds**, consistent with vehicle `time_window`.
- Multiple windows model split availability (e.g. morning + afternoon).
- Early arrival → the vehicle **waits** (waiting time counts toward route/working time, not travel time).
- Arrival after the last window closes, beyond `max_visit_lateness`, is **infeasible** for that vehicle → task unassigned. Tolerated lateness surfaces as `steps[].late_by`.

### 2.4 Edge Cases — Jobs

- **Job outside all vehicle shifts:** unassignable → returned in `result.unassigned`.
- **`priority` ties:** engine falls back to cost minimization; identical input is deterministic.
- **Both `pickup` and `delivery` on one job:** allowed; net load change at that stop.
- **Demand exceeds every vehicle capacity:** permanently unassigned regardless of routing.
- **Zero-length window `[t, t]`:** feasible only if a vehicle can arrive at `t` (or within `max_visit_lateness`).
- **`location_index` out of range:** validation error.

> **Validation & Testing Notes — Jobs**
> - Confirm early arrival adds waiting time and does not violate the window.
> - Assert a shipment's delivery is never sequenced before its pickup, and never split across two vehicles.
> - Test `priority` by over-subscribing the fleet and verifying high-priority jobs win.
> - Verify per-dimension capacity math against `delivery`/`pickup` quantities.
> - Confirm `service`/`setup` are reflected in step `arrival` and route service totals.
> - Validate out-of-range `location_index` and malformed windows are rejected.

---

## 3. Routes (Output)

Fetched via `GET /optimization/v2/result`. The `result` object contains `code`, `summary`, one `routes[]` entry per used vehicle, and `unassigned[]`. Output coordinates are `"lat, lon"` strings.

### 3.1 `result.routes[]` Field Reference

| Field | Type | Description | Example |
|---|---|---|---|
| `vehicle` | string | Id of the vehicle serving this route. | `"Vehicle 1"` |
| `description` | string | Echo of the vehicle description. | `"Refrigerated van"` |
| `steps` | array[object] | Ordered stops (see 3.2). | see JSON |
| `cost` | integer | Engine cost for the route. | `1980` |
| `distance` | number | Total route distance (meters). | `18450` |
| `duration` | integer | Total travel duration (seconds; excludes service/wait). | `1980` |
| `geometry` | string | Encoded polyline of the driven path. | `"}_ibE..."` |
| `service` | integer | Total service time (seconds). | `780` |
| `setup` | integer | Total setup time (seconds). | `120` |
| `waiting_time` | integer | Total waiting time (seconds). | `240` |
| `vehicle_overtime` | integer | Overtime beyond shift (seconds). | `0` |
| `delivery` / `pickup` | array[integer] | Totals handled on the route. | `[42]` |
| `priority` | integer | Sum of assigned priorities. | `170` |
| `revenue` | integer | Revenue on the route. | `1500` |
| `profile` | string | Routing profile used. | `"car"` |
| `adopted_capacity` | array | Capacity configuration adopted. | TBC |
| `penalty` | integer | Penalty incurred. | `0` |

### 3.2 `result.routes[].steps[]` Object

| Field | Type | Description | Example |
|---|---|---|---|
| `type` | string | `start` \| `job` \| `pickup` \| `delivery` \| `break` \| `layover` \| `end`. `start`/`break`/`layover`/`end` have no `id`. | `"job"` |
| `id` | string | Id of the job/shipment step. | `"Job 101"` |
| `location` | string | `"lat, lon"` of the stop. | `"52.5170, 13.3888"` |
| `location_index` | integer | Index into `location`. | `1` |
| `arrival` | integer | ETA at the stop (epoch seconds). | `1700004100` |
| `duration` | integer | Cumulative travel time to this stop (s). | `600` |
| `distance` | integer | Cumulative distance to this stop (m). | `5400` |
| `load` | array[integer] | Vehicle load after the stop. | `[20]` |
| `service` | integer | Service time at this stop (s). | `300` |
| `setup` | integer | Setup time at this stop (s). | `0` |
| `waiting_time` | integer | Waiting incurred at this stop (s). | `0` |
| `late_by` | integer | Lateness vs window (s), if any. | `0` |
| `projected_location` / `snapped_location` | string | Projected/snapped coordinate. | `"52.5170, 13.3888"` |
| `run` | integer | Depot-run index. | `0` |
| `depot` | string | Depot associated with this step. | `"depot_A"` |

### 3.3 `result.unassigned[]`

| Field | Type | Description | Example |
|---|---|---|---|
| `id` | string | Id of the unserved task. | `"Job 205"` |
| `type` | string | Task type. | `"job"` |
| `location` | string | `"lat, lon"` of the task. | `"52.4900, 13.4500"` |
| `reason` | string | Cause (capacity, skill, time window, etc.). | `"time window"` |
| `outsourcing_cost` | integer | Configured outsourcing cost, if any. | `1000` |

### 3.4 `result.summary`

`cost`, `routes` (count), `unassigned` (count), `duration`, `distance`, `setup`, `service`, `waiting_time`, `priority`, `delivery[]`, `pickup[]`, `revenue`, `total_visit_lateness`, `num_late_visits` (plus additional totals per spec).

### 3.5 Edge Cases — Routes

- **All tasks unassigned:** `routes` may be empty; `summary.unassigned` equals total tasks.
- **Open route (no end anchor):** last step is the final `job`/`delivery`, not `end`.
- **Break/layover between stops:** appears as its own `type: "break"`/`"layover"` step (no `id`).
- **Rounding:** summed legs must equal route totals (no drift) within the field types.

> **Validation & Testing Notes — Routes**
> - Assert monotonicity: `arrival`, cumulative `distance`, and cumulative `duration` never decrease along `steps`.
> - Reconcile totals: `sum(leg distances) == route.distance`; `sum(leg durations) == route.duration`.
> - Verify `load` never exceeds vehicle capacity at any step, in any dimension.
> - Confirm every input task appears exactly once across all routes **or** in `unassigned` — never both, never neither.
> - Decode `geometry` and confirm endpoints match start/end anchors and pass near each stop.
> - Validate `summary` counts equal the sum of route stops and unassigned entries.

---

## 4. Optimization Constraints

See `Product Knowledge/OptimizationConstraints.md` for full depth. Summary of what the engine honors:

| Constraint | Type | Fields | Enforcement |
|---|---|---|---|
| Capacity | hard | `capacity`, `delivery`/`pickup`, `amount` | Load ≤ capacity per dimension at every step. |
| Time Window | hard | `time_window`, `time_windows`, `max_visit_lateness` | Early arrival waits; late beyond tolerance → unassigned. |
| Vehicle Skills | hard | `skills` | Vehicle skills ⊇ task skills. |
| Pickup & Delivery | hard | `shipments[].pickup`/`delivery`, `amount` | Same vehicle, pickup before delivery. |
| Maximum Stops/Tasks | hard | `max_stops`, `max_tasks` | Excess tasks unassigned/moved. |
| Maximum Duration/Distance | hard | `max_travel_time`, `max_working_time`, `max_distance` | Excess tasks unassigned. |
| Multi-Depot | structural | `start_index`/`end_index`, `start_depot_ids`/`end_depot_ids`, `depot_ids`, `depots` | Each vehicle routed from its own anchor/depot. |
| Route Balancing | soft | `options.objective`, `options.constraint` | Best-effort; never forces infeasibility. |

> **Testing implication.** Build isolated single-constraint fixtures, then combined fixtures to catch interaction defects. Hard constraints must never be silently relaxed. Identical requests must be deterministic.

---

## 5. Example Request (`POST /optimization/v2?key=YOUR_KEY`)

```json
{
  "locations": {
    "id": 1,
    "location": [
      "52.5163, 13.3777",
      "52.5170, 13.3888",
      "52.5200, 13.4050",
      "52.4900, 13.4500",
      "52.5300, 13.3700",
      "52.5100, 13.4600",
      "52.5000, 13.4200"
    ]
  },
  "vehicles": [
    {
      "id": "Vehicle 1",
      "start_index": 0,
      "end_index": 0,
      "capacity": [100],
      "skills": [1, 4],
      "time_window": [1700000000, 1700028800],
      "max_distance": 250000,
      "breaks": [
        { "id": 1, "service": 1800, "time_windows": [[1700010000, 1700013600]] }
      ]
    },
    {
      "id": "Vehicle 2",
      "start_index": 6,
      "end_index": 6,
      "capacity": [200],
      "skills": [1],
      "time_window": [1700000000, 1700028800]
    }
  ],
  "jobs": [
    { "id": "Job 101", "location_index": 1, "service": 300, "delivery": [10], "skills": [1], "priority": 50, "time_windows": [[1700003600, 1700010800]] },
    { "id": "Job 102", "location_index": 2, "service": 300, "delivery": [40], "skills": [4], "priority": 80 },
    { "id": "Job 103", "location_index": 3, "service": 600, "delivery": [25] }
  ],
  "shipments": [
    {
      "amount": [12],
      "skills": [1],
      "priority": 40,
      "pickup":   { "id": "P1", "location_index": 4, "service": 180, "time_windows": [[1700002000, 1700009000]] },
      "delivery": { "id": "D1", "location_index": 5, "service": 180 }
    }
  ],
  "options": { "objective": { "travel_cost": "duration" } }
}
```

**Submission response:**

```json
{ "id": "a1b2c3d4e5", "message": "Optimization job submitted", "status": "Ok", "warnings": [] }
```

## 6. Example Result (`GET /optimization/v2/result?key=YOUR_KEY&id=a1b2c3d4e5`)

```json
{
  "status": "Ok",
  "request_created_time": 1700000000,
  "solution_created_time": 1700000012,
  "result": {
    "code": 0,
    "summary": {
      "cost": 4210, "routes": 2, "unassigned": 1,
      "distance": 41230, "duration": 4210, "service": 1560, "waiting_time": 240
    },
    "routes": [
      {
        "vehicle": "Vehicle 1",
        "distance": 18450, "duration": 1980, "cost": 1980, "service": 780, "waiting_time": 240,
        "geometry": "}_ibE_}ppU...",
        "steps": [
          { "type": "start",    "location": "52.5163, 13.3777", "location_index": 0, "arrival": 1700000000, "duration": 0,    "distance": 0,     "load": [0] },
          { "type": "pickup",   "id": "P1",  "location": "52.5300, 13.3700", "location_index": 4, "arrival": 1700002000, "duration": 480,  "distance": 4100,  "load": [12] },
          { "type": "job",      "id": "Job 101", "location": "52.5170, 13.3888", "location_index": 1, "arrival": 1700003600, "duration": 900, "distance": 8600, "load": [22], "waiting_time": 240 },
          { "type": "delivery", "id": "D1",  "location": "52.5100, 13.4600", "location_index": 5, "arrival": 1700010200, "duration": 1500, "distance": 15200, "load": [10] },
          { "type": "break",    "location": "52.5100, 13.4600", "arrival": 1700010380, "duration": 1500, "distance": 15200, "load": [10] },
          { "type": "end",      "location": "52.5163, 13.3777", "location_index": 0, "arrival": 1700013560, "duration": 1980, "distance": 18450, "load": [10] }
        ]
      },
      {
        "vehicle": "Vehicle 2",
        "distance": 22780, "duration": 2230, "cost": 2230, "service": 780,
        "geometry": "a~jbE...",
        "steps": [
          { "type": "start", "location": "52.5000, 13.4200", "location_index": 6, "arrival": 1700000000, "duration": 0, "distance": 0, "load": [0] },
          { "type": "job", "id": "Job 102", "location": "52.5200, 13.4050", "location_index": 2, "arrival": 1700000900, "duration": 900, "distance": 9200, "load": [40] },
          { "type": "end", "location": "52.5000, 13.4200", "location_index": 6, "arrival": 1700002230, "duration": 2230, "distance": 22780, "load": [40] }
        ]
      }
    ],
    "unassigned": [
      { "id": "Job 103", "type": "job", "location": "52.4900, 13.4500", "reason": "time window" }
    ]
  }
}
```

---

## 7. Status & Response Codes (Reference)

| Layer | Value | Meaning | QA Expectation |
|---|---|---|---|
| Submit `status` | `Ok` | Job accepted; `id` returned. | Poll `/result` with the `id`. |
| Submit `status` | ≠ `Ok` | Request rejected (auth/validation). | Assert message; no `id` usable. |
| Result `result.code` | `0` | Optimization succeeded (may include unassigned). | Validate body invariants. |
| Result `result.code` | ≠ `0` | Internal error. | Verify parameters, constraints, locations. |
| `warnings[]` | non-empty | Non-fatal input issues. | Review; may indicate ignored fields. |

### HTTP status catalog (confirmed by customer, 2026-07)

| Status | Description | When it applies |
|---|---|---|
| `200` | Normal success. | Valid request. Individually infeasible tasks still return `200` + task in `result.unassigned` (not an error). |
| `400` | Input validation failed. | Missing/invalid parameter, out-of-range coordinate/`location_index`, malformed JSON, missing `id` on `GET /result`. |
| `401` | API key not supplied or invalid. | Missing/wrong `key`. |
| `403` | Key valid but no access to the requested resource. | Region/service not enabled for the account. |
| `404` | Requested host/path not found. | Malformed hostname/path. |
| `413` | Request entity too large. | Request URI or body too large. |
| `422` | Could not process the request. | No feasible solution for the whole request (locations/parameters unsolvable). |
| `429` | Too many requests. | QPM or request-count quota reached. |
| `500` | Internal service error. | NextBillion.ai-side failure. |

> **Three negative channels:** malformed/unauthorized/oversized → `4xx`; individually infeasible task → `200` + `result.unassigned`; wholly unsolvable request → `422`. Account-specific size limits (max vehicles/jobs) remain **TBC**.

---

## 8. Cross-Cutting QA Checklist

- [ ] Every input job/shipment appears exactly once in output (assigned XOR unassigned).
- [ ] Load never exceeds capacity at any step, in any dimension.
- [ ] Skills superset rule holds for every assignment.
- [ ] Pickup precedes delivery on the same vehicle for every shipment.
- [ ] Time windows respected; early arrival waits, late-beyond-tolerance unassigns.
- [ ] Breaks scheduled within their windows and counted in route/working time.
- [ ] `max_distance`, `max_travel_time`, `max_working_time`, `max_stops`, `max_tasks` enforced exactly.
- [ ] Route/summary totals reconcile with per-step sums (no drift).
- [ ] `geometry` decodes and aligns with stops.
- [ ] Async flow verified: submit returns `id`; `/result` returns solution for that `id`.
- [ ] Coordinates are `"lat, lon"` strings; `location_index` values are in range.
- [ ] Identical requests are deterministic (regression stability).
- [ ] Error/`status`/`result.code` responses are precise and leak no partial routes.

> Anything genuinely undefined by the current API contract (exact soft-constraint weighting, full HTTP error catalog, account size limits) is marked **To Be Confirmed (TBC)** and must be verified with NextBillion before asserting in tests.
