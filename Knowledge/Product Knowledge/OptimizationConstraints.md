# NextBillion.ai Route Optimization — Constraints In Depth

> Reference for the constraints enforced by `POST /optimization/v2` (results fetched via `GET /optimization/v2/result`).
> For each constraint: **Definition**, **Configuration (fields)**, **Validation rules**, **When violated**, **Edge cases**, and **Example scenarios**.
>
> **Verified against** `Knowledge/_NextBillion_Optimization_API_Facts.md` (from the customer OpenAPI spec).

**Convention reminders:** coordinates are `"latitude, longitude"` WGS84 **strings** in `locations.location`, referenced by integer `location_index` / `start_index` / `end_index`; distances in meters; durations & timestamps in seconds. Auth is the `key` query parameter. Hard constraints are never violated in a returned route — infeasible demand is returned in `result.unassigned[]` with a `reason`. A successful solve has `result.code == 0`.

---

## Constraint Summary

| # | Constraint | Type | Key fields | Violation outcome |
|---|---|---|---|---|
| C1 | Capacity | Hard | `vehicles[].capacity`, `jobs[].delivery`/`pickup`, `shipments[].amount` | Task → `unassigned` (capacity reason) |
| C2 | Time Window | Hard | `vehicles[].time_window`, `jobs[].time_windows`, `jobs[].max_visit_lateness` | Task → `unassigned` (time-window reason) |
| C3 | Vehicle Skills | Hard | `vehicles[].skills`, `jobs[].skills`, `shipments[].skills` | Task → `unassigned` (skill reason) |
| C4 | Pickup & Delivery | Hard | `shipments[].pickup`, `shipments[].delivery`, `amount` | Pair → `unassigned` (precedence/capacity) |
| C5 | Maximum Stops | Hard | `vehicles[].max_stops`, `vehicles[].max_tasks` | Excess tasks → `unassigned` |
| C6 | Maximum Duration | Hard | `vehicles[].max_travel_time`, `max_working_time`, `max_distance`, `time_window` | Excess tasks → `unassigned` |
| C7 | Multi-Depot | Structural | `vehicles[].start_index`/`end_index`, `start_depot_ids`/`end_depot_ids`, `jobs[].depot_ids`, `depots[]` | Infeasible reach → `unassigned` |
| C8 | Route Balancing | Soft | `options.objective`, `options.constraint` | Best-effort; never forces infeasibility |

---

## C1 — Capacity Constraints

**Definition.** A vehicle's cumulative onboard load must never exceed its `capacity` on **any** dimension at **any** point along the route. Capacity is multi-dimensional (e.g. `[weight, volume, pallets]`).

**Configuration.**

| Field | On | Meaning |
|---|---|---|
| `capacity` | vehicle | Array of max loads per dimension, e.g. `[20, 500]`. |
| `delivery` | job | Multi-dimensional quantity delivered at the job (loaded at depot, dropped here). |
| `pickup` | job | Multi-dimensional quantity picked up at the job (added to load). |
| `amount` | shipment | Load carried from pickup to delivery. |

**Validation rules.**
- Keep the dimension count consistent across `capacity`, `delivery`, `pickup`, and `amount`.
- Values must be **non-negative integers**.
- For each dimension `d`: running load `≤ capacity[d]` at every step.

**When violated.** The offending task is placed in `result.unassigned[]` with a capacity `reason`. The solve still returns `result.code: 0`.

**Edge cases.**
- Single job whose `delivery`/`pickup` exceeds every vehicle's capacity → always unassigned.
- Zero quantity → weightless stop, always capacity-feasible.
- Inconsistent dimension lengths → validation error.
- Pickups increase load mid-route; a feasible-at-depot load can still breach capacity between a pickup and its delivery.

**Example scenarios.**
1. Vehicle `capacity:[4]`; jobs each `delivery:[1]`. First 4 jobs fit; a 5th on the same route would breach → assigned elsewhere or unassigned.
2. Two dimensions `capacity:[10, 100]`; a job `delivery:[2, 60]` plus another `delivery:[2, 50]` breaches **volume** (110 > 100) though **weight** (4 ≤ 10) is fine → second job unassigned by volume.

---

## C2 — Time Window Constraints

**Definition.** A stop may only be **started** during one of its allowed intervals; the vehicle also operates only within its shift `time_window`. Early arrival **waits**; lateness beyond `max_visit_lateness` is **infeasible**.

**Configuration.**

| Field | On | Meaning |
|---|---|---|
| `time_window` | vehicle | `[start, end]` shift bounds (Unix s), e.g. `[32400, 61200]`. |
| `time_windows` | job | Array of allowed arrival intervals, e.g. `[[36000,43200]]`. |
| `service` | job | Dwell time added after arrival. |
| `max_visit_lateness` | job / shipment step | Max tolerated lateness vs the window (seconds). |

**Validation rules.**
- Each window `[start, end]` must satisfy `start ≤ end`.
- Times are non-negative integers (Unix seconds).
- Vehicle must reach the stop such that `arrival ∈ window` (or within `max_visit_lateness`) and `arrival + service` still fits the shift.

**When violated.** Task → `result.unassigned[]` (time-window reason). Waiting is allowed and modeled; lateness beyond tolerance is not. Any lateness within tolerance surfaces as `steps[].late_by` and `summary.total_visit_lateness`.

**Edge cases.**
- **Overlapping windows** on a job → solver may use any; feasible arrival in the union.
- **Impossible window** (ends before earliest possible arrival, beyond `max_visit_lateness`) → always unassigned.
- **Wait time** inflates route duration and can then breach `max_travel_time`/`max_working_time` or the shift end.
- Window equal to a single instant `[t, t]` → must arrive exactly at `t` (or within lateness tolerance).

**Example scenarios.**
1. Job window `[36000, 43200]` (10:00–12:00); vehicle can arrive 09:40 → waits until 10:00, then services. Feasible.
2. Job window `[32400, 34200]` (09:00–09:30), `max_visit_lateness: 0`, nearest vehicle cannot arrive before 09:45 → unassigned (time-window).

---

## C3 — Vehicle Skills

**Definition.** A job can only be served by a vehicle whose `skills` **contain all** of the job's required `skills` (superset match).

**Configuration.**

| Field | On | Meaning |
|---|---|---|
| `skills` | vehicle | Integer capability tags the vehicle provides, e.g. `[1, 2, 5]`. |
| `skills` | job / shipment | Integer tags required to perform it, e.g. `[2]`. |

**Validation rules.**
- Skills are non-negative integers; arrays may be empty.
- Assignment allowed iff `job.skills ⊆ vehicle.skills`.

**When violated.** No qualifying vehicle → task `unassigned` (skill reason).

**Edge cases.**
- Job with empty `skills` → any vehicle qualifies.
- Job requires a skill **no** vehicle in the fleet has → always unassigned.
- A single high-skill vehicle can become a bottleneck (see Constraint Interaction Notes).

**Example scenarios.**
1. Job needs `skills:[2]`; Vehicle A `skills:[1]`, Vehicle B `skills:[1,2]` → only B can serve; assigned to B.
2. Job needs `skills:[3]`; no vehicle has `3` → unassigned (skill), even if capacity/time are ample.

---

## C4 — Pickup & Delivery (Precedence)

**Definition.** A shipment binds a pickup and a delivery that must be served by the **same vehicle**, with **pickup before delivery**, and the carried `amount` respected as load between them.

**Configuration.**

| Field | On | Meaning |
|---|---|---|
| `pickup` | shipment | `{ id, location_index, service, time_windows, setup, sequence_order, max_visit_lateness }`. |
| `delivery` | shipment | Same shape as `pickup`. |
| `amount` | shipment | Load carried pickup → delivery. |
| `skills` | shipment | Skills required for both steps. |
| `max_time_in_vehicle` | shipment | Max time the load may remain onboard (seconds). |

**Validation rules.**
- Both `pickup` and `delivery` are mandatory for a shipment.
- Same vehicle serves both; the delivery step occurs after the pickup step.
- Load added at pickup, removed at delivery; capacity honored throughout (couples with C1).

**When violated.** If the pair cannot be co-assigned feasibly → both steps `unassigned` (precedence or the binding constraint, e.g. capacity).

**Edge cases.**
- Pickup feasible but delivery window unreachable → whole pair unassigned.
- Multiple concurrent shipments onboard stack load — capacity checked cumulatively.
- Pickup and delivery at the **same** `location_index` → valid (zero-distance leg).
- Delivery time window earlier than pickup window → infeasible precedence → unassigned.
- `max_time_in_vehicle` too small for the route between pickup and delivery → unassigned.

**Example scenarios.**
1. Shipment pickup at index 3, delivery at index 5, `amount:[3]`. Vehicle `capacity:[5]` picks up (load 3), later delivers (load 0). Feasible.
2. Two shipments each `amount:[3]` onboard simultaneously on a `capacity:[5]` vehicle → 6 > 5 → one shipment deferred/unassigned by capacity.

---

## C5 — Maximum Stops

**Definition.** Per-vehicle hard caps on how many tasks/stops may appear on a route.

**Configuration.**

| Field | On | Meaning |
|---|---|---|
| `max_stops` | vehicle | Maximum number of stops on the route. |
| `max_tasks` | vehicle | Maximum number of tasks assignable to the vehicle. |

**Validation rules.**
- Non-negative integers.
- Count of served stops/tasks on the route `≤ max_stops` / `≤ max_tasks`.

**When violated.** Tasks beyond the cap are assigned to other vehicles or returned `unassigned`.

**Edge cases.**
- `max_tasks: 0` / `max_stops: 0` → vehicle effectively unused (serves no tasks).
- A shipment consumes **two** steps (pickup + delivery) — model conservatively against `max_stops`.
- Cap smaller than skill-eligible demand → forced unassigned.

**Example scenarios.**
1. Vehicle `max_tasks: 8` with 12 eligible jobs → 8 served, remaining 4 go to other vehicles or `unassigned`.
2. Fleet of two vehicles each `max_tasks: 5`, 12 jobs → max 10 served, ≥2 unassigned.

---

## C6 — Maximum Duration / Distance

**Definition.** Hard caps on route travel time, working time, and distance (and, via the shift `time_window`, total elapsed time including service and waiting).

**Configuration.**

| Field | On | Meaning |
|---|---|---|
| `max_travel_time` | vehicle | Max cumulative **driving** time (seconds). |
| `max_working_time` | vehicle | Max total working duration (seconds). |
| `max_distance` | vehicle | Max cumulative distance (meters). |
| `time_window` | vehicle | Shift bounds capping total elapsed route time. |

**Validation rules.**
- Non-negative integers (seconds / meters).
- Route driving time `≤ max_travel_time`; working time `≤ max_working_time`; distance `≤ max_distance`; route end `≤ time_window[1]`.

**When violated.** Adding a task would breach a cap → task `unassigned` (duration/distance reason) or reassigned.

**Edge cases.**
- Long **wait** for a late time window can push elapsed time past the shift end even if driving time is small.
- `max_travel_time`/`max_distance` shorter than the leg to the nearest task → vehicle serves nothing.
- Interacts with C2: a distant job may be reachable time-window-wise but blow the duration/distance cap.

**Example scenarios.**
1. Vehicle `max_travel_time: 14400` (4h). A candidate insertion raising driving time to 15000s is rejected → that job routed elsewhere.
2. Shift `[32400, 61200]`; a job forces a 40-min wait plus service ending at 61500 (past 17:00) → unassigned.

---

## C7 — Multi-Depot

**Definition.** Vehicles may start and end at **different** depots; the fleet is not tied to a single origin. Depots are referenced by index (`start_index`/`end_index`) or by depot IDs (`start_depot_ids`/`end_depot_ids`), and jobs may be restricted to depots via `depot_ids`.

**Configuration.**

| Field | On | Meaning |
|---|---|---|
| `start_index` / `end_index` | vehicle | Index into `locations.location` for origin / return point. |
| `start_depot_ids` / `end_depot_ids` | vehicle | Depots the vehicle may start from / end at. |
| `depot_ids` | job | Depots that can source/sink this job. |
| `depots` | request | Depot definitions (for depot runs / reloads). |
| `max_depot_runs` | vehicle | Max number of depot reloads. |

**Validation rules.**
- If neither `start_index` nor `start_depot_ids` is given, the vehicle starts at its first task; likewise for end.
- With multiple depots, the vehicle starts/ends at the depot nearest the first/last task.
- Pickup-type jobs with depots configured cannot be fulfilled by a vehicle that has only start depots; delivery-type jobs with depots cannot be fulfilled by a vehicle that has only end depots.

**When violated.** If a task cannot be reached/returned within a vehicle's depot/shift geometry, it is assigned to a better-placed vehicle or `unassigned`.

**Edge cases.**
- Multiple depots let the solver pick the geographically closest vehicle per cluster.
- Open route (no `end_index`/`end_depot_ids`) — vehicle finishes at its last task; no return leg cost.
- Depot far from all demand → that vehicle likely unused.
- Job `depot_ids` incompatible with any available vehicle's depots → unassigned.

**Example scenarios.**
1. Depot A (north) and Depot B (south), demand split by region → each vehicle serves its nearby cluster, minimizing total distance.
2. Vehicle with `start_index` at A and `end_index` at B (relocation shift) → route must terminate at B while serving en-route jobs.

---

## C8 — Route Balancing

**Definition.** A **soft** objective to distribute work (stops, time, or load) more evenly across vehicles rather than loading one route heavily. Configured through `options.objective` (and penalty terms under `options.constraint`). Never overrides hard constraints.

**Configuration.**

| Field | On | Meaning |
|---|---|---|
| `options.objective` | request | Objective definition, including `custom` objective terms and `travel_cost`. |
| `options.constraint` | request | Penalty terms (e.g. `max_vehicle_overtime`, `vehicle_overtime_penalty`, `visit_lateness_penalty`) that shape trade-offs. |

**Validation rules.**
- Balancing is best-effort; it may **increase** total cost slightly to even out routes.
- Cannot cause a hard-constraint violation or force a task to be unassigned that would otherwise be served.

**When violated.** Not a hard constraint — imbalance is tolerated when balancing would conflict with feasibility or the primary objective.

**Edge cases.**
- One high-skill vehicle required for most jobs → balancing cannot spread that work (skills dominate).
- Strong balancing weight can trade minimum total drive time for more even routes.
- Small fleets/demand → balancing effect negligible.

**Example scenarios.**
1. 20 jobs, 2 identical vehicles, objective weighted toward even task counts → ~10/10 split instead of 15/5.
2. Balancing requested but only Vehicle B has the needed skill → B carries the load; balancing yields to C3.

---

## Constraint Interaction Notes

- **Priority of hard constraints.** Capacity (C1), time windows (C2), skills (C3), precedence (C4), max stops (C5), and max duration/distance (C6) are all **hard** and jointly enforced — a task is assigned only if **all** are satisfied simultaneously. Any single violation sends it to `result.unassigned[]`.
- **Skills as a bottleneck.** When few vehicles possess a required skill (C3), those vehicles hit capacity/duration/max-stops limits sooner, causing skill-eligible demand to be unassigned even when other vehicles sit idle. Watch for this in fleet-mix test data.
- **Time windows amplify duration.** Waiting for a late window (C2) inflates elapsed time and can breach `max_travel_time`/`max_working_time` or the shift end (C6). Feasibility of C2 and C6 must be evaluated together.
- **Pickup/delivery couples with capacity.** Concurrent onboard shipments (C4) stack load and interact with C1 at every intermediate step — capacity can be breached *between* a pickup and delivery even if start/end loads look fine.
- **Multi-depot shapes everything.** Depot placement (C7) determines which vehicle can feasibly satisfy C2/C6 for a given cluster; poor depot geometry surfaces as time-window/duration unassignments, not obvious depot errors.
- **Soft yields to hard.** Route balancing (C8) is always subordinate: it optimizes *within* the feasible space defined by C1–C7 and never trades feasibility for evenness.
- **`priority` as a tiebreaker.** When not all demand fits, higher-`priority` jobs are preferred for assignment, but priority **cannot** override any hard constraint — a high-priority job with an impossible window/skill still goes `unassigned`.
- **Testing implication.** Design test cases that flip **one** constraint at a time to isolate the `reason`, then combined-constraint cases (e.g. tight window + tight duration) to verify correct precedence and `unassigned[].reason` reporting.
