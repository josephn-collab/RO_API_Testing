# Route Optimization — Product Overview

> Deep-dive reference for the **NextBillion.ai Route Optimization API**.
> Audience: QA engineers, solution architects, and technical writers building test plans and product knowledge.
>
> **Verified against** the customer-provided OpenAPI spec (`Knowledge/openapi.json`). All endpoint, field, and flow details trace to `Knowledge/_NextBillion_Optimization_API_Facts.md`. Values the spec does not define are marked **TBC**.

---

## 1. Overview / Purpose

The **Route Optimization API** takes a **fleet of vehicles** and a set of **jobs and/or shipments** to be served, then computes the set of **optimized routes** that minimizes an overall cost objective (typically total travel time and/or distance) while respecting operational constraints such as vehicle capacity, time windows, driver skills, and shift durations.

Typical use cases:

- Last-mile delivery dispatch (parcels, groceries, food).
- Field-service scheduling (technicians visiting customer sites).
- Waste collection, home healthcare, and mobile sales routing.
- Pickup-and-delivery / courier assignments.

The API is **asynchronous**: you **submit** a problem with `POST /optimization/v2`, receive a request `id`, and then **poll** `GET /optimization/v2/result` with that `id` to retrieve the solution once solving completes. A separate `POST /optimization/re_optimization` re-plans an existing solution when new orders arrive or the fleet changes.

**Base URL:** `https://api.nextbillion.io`
**Authentication:** `key` **query parameter** (32-bit alphanumeric) — e.g. `?key=YOUR_KEY`. There is **no** Bearer/Authorization header.
**Area code:** `RO`.

| Operation | Method & path |
|---|---|
| Submit optimization job | `POST https://api.nextbillion.io/optimization/v2?key=YOUR_KEY` |
| Fetch result | `GET https://api.nextbillion.io/optimization/v2/result?key=YOUR_KEY&id=REQUEST_ID` |
| Re-optimize existing solution | `POST https://api.nextbillion.io/optimization/re_optimization?key=YOUR_KEY` |

---

## 2. How It Works (Fleet + Jobs → Optimized Routes)

```
           ┌─────────────┐        ┌──────────────────────┐        ┌────────────────┐
  locations│  locations  │        │                      │        │  result.routes │
  Vehicles │  vehicles[] │  ─POST▶│  Optimization Engine │        │  result.       │
  Jobs     │  jobs[]     │  /v2   │  (cost minimization) │  ──▶   │    unassigned  │
  Shipments│  shipments[]│        │                      │  GET   │  result.summary│
  Options  │  options{}  │        │   returns  id  ──────┼─/result│  result.code   │
           └─────────────┘        └──────────────────────┘        └────────────────┘
```

1. **Model the world.** The caller submits a central `locations.location` array of coordinates, plus vehicles (start/end, capacity, working hours, skills) and demand (jobs and/or pickup–delivery shipments). Every task/vehicle references a coordinate by its **integer `location_index`** into that array.
2. **Submit.** `POST /optimization/v2` validates the request and returns `{ id, message, status, warnings }` with `status: "Ok"`.
3. **Solve (async).** The engine assigns demand to vehicles and orders each vehicle's stops to minimize the objective while honoring hard constraints.
4. **Poll & retrieve.** `GET /optimization/v2/result?key=&id=` returns the solution: `result.routes[]` (ordered `steps`), a `result.summary`, and `result.unassigned[]` for demand that could not be served.

Hard constraints (capacity, time windows, skills) are **never** violated in a returned route — infeasible demand is placed in `result.unassigned[]` with a `reason`. Soft objectives (minimize cost, balance load) are optimized on a best-effort basis. `result.code == 0` indicates a successful solve.

---

## 3. Inputs — Complete Field Catalog

Request body for `POST /optimization/v2` (`application/json`). **Every** field from the OpenAPI spec is catalogued below (types, required/default, valid ranges, and QA-relevant notes) so test cases can cover the full surface. Defaults shown are the spec's defaults.

**Top-level fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `locations` | object | **Yes** | All coordinates used in the problem (see §3.1). |
| `vehicles` | array | **Yes** | The fleet. At least one vehicle required (see §3.2). |
| `jobs` | array | Conditional | Single-location tasks. Provide `jobs` and/or `shipments` (see §3.3). |
| `shipments` | array | Conditional | Paired pickup + delivery tasks. Provide `jobs` and/or `shipments` (see §3.4). |
| `depots` | array | No | Depot definitions for multi-depot / depot-run scenarios (see §3.6). |
| `options` | object | No | Solver configuration: `objective`, `constraint`, `routing`, `grouping`, `webhook` (see §3.7). |
| `description` | string | No | Free-text label, echoed back in the result. |
| `relations` | array | No | Task relations (`in_same_route`, `in_sequence`, `in_direct_sequence`, `precedence`, `pinned`) (see §3.8). |
| `cost_matrix` | array\<array\<int\>\> | No | Custom cost matrix; effective only when `options.objective.travel_cost = customized`. N×N over `location`. |
| `distance_matrix` | array\<array\<int\>\> | No | Custom distances (meters), N×N. **Requires `duration_matrix`.** Overrides real distances. |
| `duration_matrix` | array\<array\<int\>\> | No | Custom durations (seconds), N×N. Overrides real durations. |
| `zones` | array | No | Geographic zone geometries (see §3.9). |
| `solution` | array | No | Re-optimization: previous routes to re-plan (see §3.10). |
| `unassigned` | array | No | Re-optimization: previously unassigned tasks (see §3.10). |

### 3.1 `locations` object

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | integer | No | Positive integer ID for the location set. |
| `location` | array of **string** | **Yes** | Coordinates as **`"latitude, longitude"`** strings, e.g. `"51.5074, -0.1278"`. Referenced elsewhere by 0-based index. Avoid duplicates. |
| `approaches` | array of string | No | Per-location approach: `unrestricted` (default) \| `curb` \| `""` (empty string, skips a position). If given, length must equal number of locations. **Case-sensitive.** |

> **Coordinate order is `"latitude, longitude"` (a string), not `[lon, lat]`.** Tasks and vehicles never carry raw coordinates — they carry an integer index (`location_index`, `start_index`, `end_index`) into `locations.location`. Valid index range is `[0, len(location))`.
>
> **Exception:** `zones[].geometry.coordinates` (GeoJSON polygons, §3.9) *do* use `[longitude, latitude]` order per the GeoJSON standard. This is the only place lon/lat order appears.

### 3.2 Vehicle object (`vehicles[]`) — all fields

Required: `id`. At least one vehicle must be present.

| Field | Type | Default | Description / Validation |
|---|---|---|---|
| `id` | string | — | **Required.** Unique, case-sensitive. |
| `description` | string | — | Custom description, echoed in output. |
| `start_index` | integer | — | Index into `location` for start. Range `[0, len(location))`. If neither `start_index` nor `start_depot_ids` given, vehicle starts at its first task. |
| `start_depot_ids` | array\<string\> | — | Depots the vehicle may start from. |
| `end_index` | integer | — | Index into `location` for end. If neither `end_index` nor `end_depot_ids` given, vehicle ends at its last task (open route). |
| `end_depot_ids` | array\<string\> | — | Depots where the vehicle may end. |
| `capacity` | array\<int\> | — | Multi-dimensional capacity, e.g. `[weight, volume]`. Keep dimensions consistent with task quantities. |
| `alternative_capacities` | array\<array\<int\>\> | — | Alternate capacity configs; each inner array same dimension count as `capacity`. Cannot be shared/merged. |
| `time_window` | `[start,end]` int | — | **Single** shift window as Unix seconds (note: singular — unlike task `time_windows` which is a 2-D array). |
| `skills` | array\<int\> | — | Skills the vehicle provides. Vehicle must have **all** skills a task requires. |
| `max_tasks` | integer | — | Max number of tasks assignable. Positive integer. |
| `breaks` | array\<object\> | — | Mandatory driver breaks (see §3.2.1). Only one of `breaks` or `layover_config` allowed. |
| `costs` | object | — | Per-vehicle cost config (see §3.2.2). |
| `speed_factor` | number | `1` | Speed multiplier, `> 0` up to `5.0`, two-decimal precision. `>1` = faster. Affects arrival times and duration cost. |
| `layover_config` | object | — | Continuous-driving limit + rest (see §3.2.3). Only one of `breaks`/`layover_config`. |
| `allowed_zones` | array\<int\> | — | Zones the vehicle may serve tasks in. Empty array = only zone-less tasks. Omitted = all zones. |
| `restricted_zones` | array\<int\> | — | Zones the vehicle may **not** serve tasks in (may still route through). |
| `max_distance` | integer | — | Max driving distance (meters). Applies to `distance_matrix` values if provided. |
| `max_travel_time` | integer | — | Max driving duration (seconds); excludes wait/service/setup. |
| `max_stops` | integer | — | Max stops on the route; breaks/layovers not counted. |
| `profile` | string | — | Routing profile name; must be defined in `options.routing.profiles`. Default profile if omitted. |
| `max_working_time` | integer | — | Max total working duration (seconds); service + waiting + setup + driving all count. |
| `volume` | object | — | Loading compartment dimensions `{width, depth, height}` (meters). Vehicle without `volume` can't take tasks that specify `volume`. |
| `max_depot_runs` | integer | `1` | Max returns to depot to reload. Requires `start_depot_id`. Conflicts with `relations`, `layover_config`, `depots.throughput`, deadhead constraints. |
| `max_deadhead_distance` | integer | — | Soft cap on empty-travel distance (first/last leg), meters. Cannot combine with `max_depot_runs`. |
| `max_deadhead_duration` | integer | — | Soft cap on empty-travel duration (first/last leg), seconds. Cannot combine with `max_depot_runs`. |
| `min_stop_load` | array\<int\> | — | Preferred min load per stop (delivery jobs only); same dimensions as `capacity`. Below it, penalties apply (see `costs`). |
| `depot` | integer | — | **Deprecated** — use `start_depot_ids`/`end_depot_ids`. |
| `max_travel_cost` | integer | — | **Deprecated** — use `max_distance`/`max_travel_time`. |

**§3.2.1 `vehicles[].breaks[]`** — required: `id`, `time_windows`.

| Field | Type | Default | Description |
|---|---|---|---|
| `id` | integer | — | **Required.** Positive integer break ID. |
| `time_windows` | array\<`[start,end]`\> | — | **Required.** Possible start slots (Unix s); non-overlapping; must lie inside the vehicle's `time_window`. |
| `description` | string | — | Custom label (e.g. "Lunch"). |
| `service` | integer | `0` | Break duration (seconds). |

**§3.2.2 `vehicles[].costs{}`**

| Field | Type | Default | Description |
|---|---|---|---|
| `fixed` | integer | `0` | Fixed cost of using the vehicle. |
| `per_hour` | integer | `3600` | Cost per hour of drive time. Effective only when `travel_cost = duration`. Mutually exclusive with `per_km`. |
| `per_km` | integer | — | Cost per km. Effective only when `travel_cost = distance`. Mutually exclusive with `per_hour`. |
| `per_order` | integer | — | Cost per fulfilled order (job or shipment). Always added to route cost. |
| `min_stop_load_fixed_penalty` | integer | — | Fixed penalty when any delivery task's load is below `min_stop_load`. |
| `min_stop_load_unit_penalty` | array\<int\> | — | Per-unit shortfall penalty vs `min_stop_load`. |
| `deadhead_duration_penalty` | integer | `0` | Penalty per unit deadhead duration over `max_deadhead_duration`. |
| `deadhead_distance_penalty` | integer | `0` | Penalty per unit deadhead distance over `max_deadhead_distance`. |

**§3.2.3 `vehicles[].layover_config{}`** — required: `max_continuous_time`, `layover_duration`.

| Field | Type | Default | Description |
|---|---|---|---|
| `max_continuous_time` | integer | — | **Required.** Max continuous driving (seconds) before a rest. |
| `layover_duration` | integer | — | **Required.** Rest duration (seconds) after `max_continuous_time`. |
| `include_service_time` | boolean | `false` | If true, service time also counts toward continuous working time. |

**`vehicles[].volume{}`**: `width`, `depth`, `height` (number, meters).

### 3.3 Job object (`jobs[]`) — all fields

Required: `id`, `location_index`. A job has **either** a pickup **or** a delivery step, not both simultaneously as a pair (use `shipments` for pairs).

| Field | Type | Default | Description / Validation |
|---|---|---|---|
| `id` | string | — | **Required.** Unique, case-sensitive. |
| `description` | string | — | Custom description. |
| `location_index` | integer | — | **Required.** Index into `location`, range `[0, len(location))`. |
| `delivery` | array\<int\> | — | Multi-dim quantity delivered (added to vehicle's initial load). |
| `pickup` | array\<int\> | — | Multi-dim quantity picked up (carried to last stop). |
| `service` | integer | `0` | Service/dwell time (seconds). |
| `time_windows` | array\<`[start,end]`\> | — | Allowed start windows (Unix s); non-overlapping. |
| `skills` | array\<int\> | — | Skills required (each `> 0`). |
| `priority` | integer | `0` | Range `[0, 100]`. Affects assignment likelihood, not sequence. |
| `setup` | integer | — | One-time setup time (seconds); applied once per location, not per repeated task. |
| `zones` | array\<int\> | — | Zone IDs; if set for one job, must be set for all. Overrides `zones` geometries. |
| `depot_ids` | array\<string\> | — | Depots that can source/sink this job. No effect if job has no pickup/delivery step. |
| `load_types` | array\<string\> | — | Load type tags; effective only with pickup/delivery; ignored for first task of route. |
| `incompatible_load_types` | array\<string\> | — | Load types that cannot share the vehicle's history. |
| `sequence_order` | integer | — | Range `[0, 100]`. Relative ordering within a route. `relations` outrank it; it overrides `order_grouping`. |
| `revenue` | integer | — | Revenue from completing the job. Cannot be combined with `outsourcing_cost`. |
| `outsourcing_cost` | integer | — | Cost of leaving unassigned; overrides `priority`. Cannot combine with `revenue`. |
| `follow_lifo_order` | boolean | `false` | Enforce LIFO loading/unloading. |
| `max_visit_lateness` | integer | — | Allowed lateness (seconds) after window ends; overrides global `constraint.max_visit_lateness`. |
| `volume` | object | — | Cargo `{width, depth, height, alignment}` (see below). |
| `joint_order` | integer | — | Joint-order group ID; all tasks in the group assigned together or none. |

**`jobs[].volume{}`**: `width`, `depth`, `height` (number, meters), plus `alignment` (string enum: `strict` \| `parallel` \| `fixed_bottom` \| `" "` default = skip check).

### 3.4 Shipment object (`shipments[]`) — all fields

A shipment binds a `pickup` and a `delivery` served by the **same vehicle**, pickup **before** delivery. Required: `pickup`, `delivery`.

**`shipments[].pickup{}` / `shipments[].delivery{}`** — required: `id`, `location_index`.

| Field | Type | Default | Description |
|---|---|---|---|
| `id` | string | — | **Required.** Unique, case-sensitive (duplicate pickup/delivery IDs error). |
| `description` | string | — | Custom description. |
| `location_index` | integer | — | **Required.** Index into `location`, `[0, len(location))`. |
| `service` | integer | `0` | Service time (seconds). |
| `time_windows` | array\<`[start,end]`\> | — | Allowed start windows (Unix s); non-overlapping. |
| `setup` | integer | — | One-time setup time (seconds). |
| `sequence_order` | integer | — | `[0, 100]`. Pickup's must be ≤ its delivery's. |
| `max_visit_lateness` | integer | — | Allowed lateness (seconds); overrides global. |

**Shipment-level fields:**

| Field | Type | Default | Description |
|---|---|---|---|
| `amount` | array\<int\> | — | Multi-dim quantity shipped (added to vehicle load). |
| `skills` | array\<int\> | — | Skills required. |
| `priority` | integer | `0` | Range `[0, 100]`. |
| `zones` | array\<int\> | — | Zone IDs (both steps' zones considered). |
| `load_types` | array\<string\> | — | Load type tags. |
| `incompatible_load_types` | array\<string\> | — | Incompatible load types. |
| `max_time_in_vehicle` | integer | — | Max seconds the load may stay onboard between pickup and delivery. |
| `revenue` | integer | — | Revenue; cannot combine with `outsourcing_cost`. |
| `outsourcing_cost` | integer | — | Cost of leaving unassigned; overrides `priority`. |
| `follow_lifo_order` | boolean | `false` | Enforce LIFO. |
| `volume` | object | — | Cargo `{width, depth, height, alignment}` (same as job volume). |
| `joint_order` | integer | — | Joint-order group ID. |

### 3.5 Example request

```http
POST /optimization/v2?key=YOUR_KEY HTTP/1.1
Host: api.nextbillion.io
Content-Type: application/json
```

```json
{
  "locations": {
    "id": 1,
    "location": [
      "51.5074, -0.1278",
      "51.5010, -0.1426",
      "51.5142, -0.0899"
    ]
  },
  "vehicles": [
    {
      "id": "Vehicle 1",
      "start_index": 0,
      "end_index": 0,
      "capacity": [4, 100],
      "skills": [1, 2],
      "time_window": [32400, 61200],
      "max_tasks": 12
    },
    {
      "id": "Vehicle 2",
      "start_index": 0,
      "end_index": 0,
      "capacity": [20, 500],
      "skills": [1],
      "time_window": [28800, 64800]
    }
  ],
  "jobs": [
    {
      "id": "Job 101",
      "location_index": 1,
      "service": 300,
      "delivery": [1, 10],
      "skills": [1],
      "time_windows": [[36000, 43200]],
      "priority": 80
    },
    {
      "id": "Job 102",
      "location_index": 2,
      "service": 600,
      "delivery": [2, 20],
      "skills": [2]
    }
  ],
  "options": { "objective": { "travel_cost": "duration" } }
}
```

### 3.5.1 Submission response

```json
{ "id": "a1b2c3d4e5", "message": "Optimization job submitted", "status": "Ok", "warnings": [] }
```

Use the returned `id` in the result call.

### 3.6 Depot object (`depots[]`) — all fields

Required: `id`, `location_index`. Depots serve as start/end points and as pickup/delivery sources for jobs.

| Field | Type | Default | Description |
|---|---|---|---|
| `id` | string | — | **Required.** Unique, case-sensitive. |
| `location_index` | integer | — | **Required.** Index into `location`, `[0, len(location))`. |
| `description` | string | — | Custom description. |
| `time_windows` | array\<`[start,end]`\> | — | Operational windows (Unix s); non-overlapping. |
| `service` | integer | `0` | Load/unload time each time a vehicle starts/arrives at the depot. |
| `throughput` | object | — | Depot loading-rate config (see below). Ineffective with `max_depot_runs` or `relations`. |

**`depots[].throughput{}`**: `handling_duration` (int, default `0`), `max_vehicles` (int, soft — needs `vehicle_penalty`), `vehicle_penalty` (int), `max_load` (array\<int\>, soft — needs `load_penalty`; dimensions match capacity), `load_penalty` (array\<int\>).

### 3.7 `options` object — all fields

Four sub-objects plus webhook. All optional.

**§3.7.1 `options.objective{}`**

| Field | Type | Default | Description |
|---|---|---|---|
| `travel_cost` | string enum | `duration` | `duration` \| `distance` \| `air_distance` \| `customized`. `customized` uses `cost_matrix`. |
| `custom` | object | — | `{ type, value }`, both required when used. `type`: `min` \| `min-max`. `value`: for `min` → `vehicles` \| `completion_time`; for `min-max` → `tasks` \| `travel_cost`. |
| `allow_early_arrival` | boolean | `true` | If true, driver waits at the task location; if false, waits at previous location and departs to arrive just in time. |
| `solving_time_limit` | integer | — | Target solve time (seconds). Solver may exceed it to find any solution; ≥ 5–7 min recommended for large inputs. |

**§3.7.2 `options.constraint{}`** (soft constraints; ineffective when `relations` is used)

| Field | Type | Default | Description |
|---|---|---|---|
| `max_vehicle_overtime` | integer | `0` | Max overtime after a vehicle's window ends (seconds). |
| `vehicle_overtime_penalty` | integer | `200` | Penalty per unit overtime. |
| `max_visit_lateness` | integer | `0` | Global max lateness after a task window (seconds); per-task override available. |
| `visit_lateness_penalty` | integer | `10` | Penalty per unit lateness. |
| `sequence_order_penalty` | integer | `10000` | Penalty when a task isn't fulfilled at its `sequence_order`. |

**§3.7.3 `options.routing{}`**

| Field | Type | Default | Description |
|---|---|---|---|
| `mode` | string enum | `car` | `car` \| `truck` \| `motorcycle` \| `bike` \| `walk` (non-car may be region-limited). |
| `traffic_timestamp` | integer | — | Unix s; solver uses traffic conditions at that time. |
| `truck_size` | string | — | `"height,width,length"` in cm. `mode=truck` only. |
| `truck_weight` | integer | — | kg, incl. trailers/goods. `mode=truck` only. |
| `avoid` | array\<string\> enum | `ferry` avoided by default | Soft. `toll` \| `highway` \| `bbox` \| `left_turn` \| `right_turn` \| `sharp_turn` \| `uturn` \| `service_road` \| `ferry` \| `none`. Case-sensitive. `bbox` is a hard filter (`min_lat,min_lon,max_lat,max_lon`). |
| `exclude` | array\<string\> enum | `ferry` excluded by default | Hard. `toll` \| `highway` \| `ferry` \| `service_road` \| `uturn` \| `sharp_turn` \| `left_turn` \| `right_turn` \| `none`. 4xx if no feasible route. |
| `disable_cache` | boolean | `false` | If true, don't reuse the 60-min cached matrix. |
| `hazmat_type` | array\<string\> enum | — | `explosives` \| `gas` \| `flammable_liquid` \| `flammable_gas` \| `organic` \| `toxic` \| `radioactive` \| `corrosive` \| `other`. `mode=truck` only. |
| `profiles` | object | — | Dict of named profiles; each holds any `options.routing` property. Profile-count limits scale down with location count (15 / 6 / 2 / 1). `"default"` reserved; no nesting. |
| `allow` | array\<string\> enum | — | `taxi` (use taxi lanes). `mode=car` only. |
| `cross_border` | boolean | — | Allow international border crossing (North America only by default). |
| `truck_axle_load` | number | — | Tonnes per axle. `mode=truck` only. |

**§3.7.4 `options.grouping{}`**

| Field | Type | Default | Description |
|---|---|---|---|
| `order_grouping` | object | — | `{ grouping_diameter }` (number, meters, default `null`) — group nearby tasks into one stop. |
| `route_grouping` | object | — | `{ zone_source, zone_ids, zone_diameter, penalty_factor }`. `zone_source`: `system_generated` (default) \| `custom_definition` (requires `zones`). `zone_diameter` default `1000` m. `penalty_factor` default `0`. |
| `proximity_factor` | number | `0` | Range `[0, 10]` (recommend `[0, 1]`). Higher = tighter neighbor distances, more routes. |

**§3.7.5 `options.webhook{}`**: `url` (string, HTTP(S) POST), `events` (array enum: `JOB_COMPLETED` \| `JOB_FAILED`; docs also mention `JOB_CREATED`), `timeout` (int, default `10`, range `[1, 60]`; up to 3 retries).

### 3.8 `relations[]` object

Array of relation objects. `type` and `steps` are mandatory. Soft constraints are ineffective when `relations` is used; an unsatisfiable relation flags all its tasks unassigned.

| Field | Type | Description |
|---|---|---|
| `type` | string enum | `in_same_route` \| `in_sequence` \| `in_direct_sequence` \| `precedence` (exactly 2 steps) \| `pinned` (requires `vehicle`). |
| `steps` | array\<object\> | Each `{ type, id }`. Step `type`: `start` \| `end` \| `job` \| `pickup` \| `delivery` (`id` required except for `start`/`end`). |
| `vehicle` | string | Vehicle ID; mandatory for `pinned`. Same vehicle can't be reused across relations. |

### 3.9 `zones[]` object

Required: `id`. Each zone needs geometry via `geometry` **or** `geofence_id`.

| Field | Type | Description |
|---|---|---|
| `id` | integer | **Required.** Zone ID. |
| `geometry` | object | GeoJSON `{ type, coordinates }`. `type`: `Polygon` \| `MultiPolygon`. **`coordinates` are `[longitude, latitude]`** (GeoJSON order — the one lon/lat exception). |
| `geofence_id` | string | ID of a pre-created geofence (alternative to `geometry`). |

### 3.10 Re-optimization request fields (on `POST /optimization/v2`)

For re-optimizing within a v2 request, `solution` (array of previous route objects) and `unassigned` (array of previously unassigned task references) may be supplied. The dedicated `POST /optimization/re_optimization` endpoint (see §8) uses `existing_request_id` plus `vehicle_changes` / `job_changes` / `shipment_changes` (`add` / `remove` / `modify`) instead.



Fetched via `GET /optimization/v2/result?key=YOUR_KEY&id=REQUEST_ID` (HTTP `200 OK`). Top-level fields:

| Field | Type | Description |
|---|---|---|
| `description` | string | Echo of request `description` (absent if none was sent). |
| `request_created_time` | integer | Unix seconds when the input was created. |
| `solution_created_time` | integer | Unix seconds when solving finished. |
| `status` | string | `Ok` on success; error otherwise. |
| `message` | string | Status/error message. |
| `result` | object | The optimized solution (see below). |

### 4.1 `result` object

`result.code` — `0` = success; non-zero = internal error (verify parameters, constraints, locations). Contains `summary`, `routes`, `unassigned`.

### 4.2 `result.summary` object

| Field | Type | Description |
|---|---|---|
| `cost` | integer | Objective value of the solution. |
| `routes` | integer | Number of routes used. |
| `unassigned` | integer | Count of unassigned tasks. |
| `duration` | integer | Total drive time (seconds; excludes service/setup/waiting). |
| `distance` | number | Total distance (meters). |
| `service` | integer | Total service time (seconds). |
| `setup` | integer | Total setup time (seconds). |
| `waiting_time` | integer | Total waiting time (seconds). |
| `delivery` / `pickup` | array\<int\> | Total quantities delivered / picked up. |
| `priority` | integer | Sum of assigned priorities. |
| `revenue` | integer | Total revenue of assigned tasks. |
| `total_visit_lateness` | integer | Total lateness across all routes (seconds). |
| `num_late_visits` | integer | Count of visits that started after their window closed. |

### 4.3 `result.routes[]` object — all fields

| Field | Type | Description |
|---|---|---|
| `vehicle` | string | Vehicle id serving this route. |
| `description` | string | Echo of the vehicle's `description`. |
| `steps` | array | Ordered stops (see §4.4). |
| `cost` | integer | Route objective value. |
| `duration` | integer | Route drive time (seconds). |
| `distance` | number | Route distance (meters). |
| `geometry` | string | Encoded polyline of the route. |
| `service` | integer | Total service time on the route (seconds). |
| `setup` | integer | Total setup time on the route (seconds). |
| `waiting_time` | integer | Total waiting time on the route (seconds). |
| `vehicle_overtime` | integer | Overtime beyond the vehicle's window (seconds). |
| `delivery` / `pickup` | array\<int\> | Quantities handled on the route. |
| `priority` | integer | Sum of assigned priorities on the route. |
| `revenue` | integer | Revenue earned on the route. |
| `profile` | string | Routing profile used. |
| `adopted_capacity` | array | Capacity configuration adopted (relevant with `alternative_capacities`). |
| `penalty` | integer | Penalty incurred on the route. |

### 4.4 `result.routes[].steps[]` object — all fields

| Field | Type | Description |
|---|---|---|
| `type` | string | `start` \| `job` \| `pickup` \| `delivery` \| `break` \| `layover` \| `end`. `start`/`break`/`layover`/`end` have no `id`. |
| `id` | string | Job/shipment id (absent for non-task steps). |
| `location` | string | `"lat, lon"` of the step. |
| `location_index` | integer | Index into `location`. |
| `projected_location` | string | Projected coordinate for the step. |
| `snapped_location` | string | Road-snapped coordinate for the step. |
| `arrival` | integer | Arrival time (Unix seconds). |
| `duration` | integer | Cumulative travel time to this step (seconds). |
| `distance` | integer | Cumulative distance to this step (meters). |
| `load` | array\<int\> | Vehicle load leaving this step. |
| `service` | integer | Service time at this step (seconds). |
| `setup` | integer | Setup time at this step (seconds). |
| `waiting_time` | integer | Waiting time at this step (seconds). |
| `late_by` | integer | Seconds late vs the time window, if any. |
| `run` | integer | Depot-run index (for multi-depot-run routes). |
| `depot` | string | Depot associated with this step, if any. |
| `description` | string | Echo of the task's `description`. |

### 4.5 `result.unassigned[]` object — all fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Task id that could not be served. |
| `type` | string | Task type. |
| `location` | string | `"lat, lon"` of the task. |
| `reason` | string | Why it was left unassigned. |
| `outsourcing_cost` | integer | Cost of leaving it unassigned, if configured. |

### 4.6 Example result snippet

```json
{
  "status": "Ok",
  "request_created_time": 1721130000,
  "solution_created_time": 1721130012,
  "result": {
    "code": 0,
    "summary": {
      "cost": 4120, "routes": 1, "unassigned": 1,
      "duration": 4120, "distance": 21840, "service": 900
    },
    "routes": [
      {
        "vehicle": "Vehicle 1",
        "cost": 4120, "duration": 4120, "distance": 21840,
        "steps": [
          { "type": "start", "location": "51.5074, -0.1278", "location_index": 0, "arrival": 32400, "load": [0, 0] },
          { "type": "job", "id": "Job 101", "location": "51.5010, -0.1426", "location_index": 1, "arrival": 36300, "service": 300, "load": [1, 10] },
          { "type": "end", "location": "51.5074, -0.1278", "location_index": 0, "arrival": 40200, "load": [1, 10] }
        ]
      }
    ],
    "unassigned": [
      { "id": "Job 102", "type": "job", "location": "51.5142, -0.0899", "reason": "skill not available" }
    ]
  }
}
```

---

## 5. Common Terminology

| Term | Meaning |
|---|---|
| **Fleet** | The complete set of `vehicles` available to serve demand. |
| **Job** | A single-location task (delivery, service visit). |
| **Shipment** | A linked pickup + delivery pair served by one vehicle. |
| **Step** | An individual stop within a route (`start`/`job`/`pickup`/`delivery`/`break`/`layover`/`end`). |
| **Depot** | A start/end/reload location, referenced by `start_depot_ids` / `end_depot_ids` / `depot_ids`. |
| **`location_index`** | Integer index into `locations.location` identifying where a task/vehicle is. |
| **Matrix** | Table of pairwise travel times/distances; can be supplied via `duration_matrix` / `distance_matrix` / `cost_matrix`. |
| **Capacity** | Multi-dimensional load limit per vehicle. |
| **Delivery / Pickup amount** | Load a task consumes against capacity. |
| **Skill** | Integer capability tag matching vehicles to jobs. |
| **Time window** | Interval (Unix seconds) during which a stop may be started. |
| **Unassigned** | Demand excluded from all routes due to constraints. |
| **Objective / Cost** | The quantity the solver minimizes. |
| **Re-optimization** | Re-planning an existing solution via `POST /optimization/re_optimization`. |

---

## 6. Business Rules

| # | Rule |
|---|---|
| BR-RO-01 | Every **assigned** job appears on **exactly one** route, exactly once. |
| BR-RO-02 | A vehicle's cumulative `load` must **never exceed** its `capacity` on any dimension at any point in the route. |
| BR-RO-03 | Time windows are **hard**: a stop is served only if the vehicle can arrive within one of its `time_windows` (early arrival waits; late arrival beyond `max_visit_lateness` is infeasible). |
| BR-RO-04 | A job is assignable to a vehicle only if the vehicle's `skills` are a **superset** of the job's required `skills`. |
| BR-RO-05 | A shipment's `pickup` and `delivery` are served by the **same vehicle**, with pickup **before** delivery. |
| BR-RO-06 | A vehicle operates only within its `time_window`; total route time (travel + service + wait) must fit inside it. |
| BR-RO-07 | `max_tasks`, `max_stops`, `max_travel_time`, and `max_distance` are hard per-vehicle caps. |
| BR-RO-08 | Any task that cannot be served without violating a hard constraint is returned in `result.unassigned[]` with a `reason`; the solve still succeeds (`result.code: 0`). |
| BR-RO-09 | Higher-`priority` jobs are preferred for assignment when not all demand can be served. |
| BR-RO-10 | Coordinates are `"latitude, longitude"` WGS84 strings referenced by `location_index`; distances in meters, durations/timestamps in seconds. |

---

## 7. Common Edge Cases

| Edge case | Expected behavior |
|---|---|
| **Empty fleet** (`vehicles: []`) | Validation error; at least one vehicle required. |
| **No demand** (`jobs` and `shipments` both empty) | Validation error. |
| **Demand exceeds total capacity** | Excess tasks returned in `unassigned` (`reason` referencing capacity). |
| **Unreachable location** (island, no road) | Task unassigned, or a non-zero `result.code` if the location cannot be snapped. |
| **Overlapping time windows** | Handled normally; solver picks a feasible arrival within any window. |
| **Impossible time window** (window ends before vehicle can arrive) | Task unassigned (time-window reason) unless within `max_visit_lateness`. |
| **Single vehicle, many jobs** | All jobs on one route up to capacity/`max_tasks`/`max_stops`/shift limits; remainder unassigned. |
| **Job requires skill no vehicle has** | Task unassigned (skill reason). |
| **Shipment split across vehicles** | Prevented by BR-RO-05; solver keeps the pair together or leaves it unassigned. |
| **Zero service time / zero amount** | Valid; treated as instantaneous / weightless stop. |
| **Duplicate task `id`** | Validation error. |
| **`location_index` out of range** | Validation error; valid range is `[0, len(location))`. |
| **Very large problem** | Solve time governed by `options.objective.solving_time_limit`; account-specific size limits are **TBC**. |
| **Invalid coordinate string** (lat ∉ [-90,90] or lon ∉ [-180,180]) | Validation error. |

---

## 8. Related Operations

- **`GET /optimization/v2/result`** — poll for the solution of a submitted job.
- **`POST /optimization/re_optimization`** — re-plan an existing solution (`existing_request_id` + `vehicle_changes` / `job_changes` / `shipment_changes`, each supporting `add` / `remove` / `modify`).

See `APIOverview.md` for the endpoint catalog and `OptimizationConstraints.md` for constraint depth. The authoritative field reference is `RouteOptimizationKnowledge.md`, itself derived from `_NextBillion_Optimization_API_Facts.md`.
