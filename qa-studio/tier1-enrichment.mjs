#!/usr/bin/env node
// =============================================================================
// Tier 1 enrichment authoring — Test Authoring Studio (P4 scale-up)
// =============================================================================
// Emits grounded enrichment for the highest-value CONSTRAINT-bearing features
// (vehicles / jobs / shipments / locations / zones) as status:"proposed", plus the
// C2–C8 cross-feature rule hyperedges. Content is drawn from:
//   Knowledge/Product Knowledge/OptimizationConstraints.md  (C1–C8)
//   Knowledge/Product Knowledge/RouteOptimizationOverview.md (field catalog: ranges/defaults)
//
// Nothing here is trusted until a human ratifies it (removes "status") — same gate as
// bootstrap.mjs ingest. Run:  node qa-studio/tier1-enrichment.mjs   then  node qa-studio/compile.mjs
// =============================================================================
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const ENRICH = join(DIR, "enrichment");
const RULES = join(DIR, "rules");
mkdirSync(ENRICH, { recursive: true });
mkdirSync(RULES, { recursive: true });

// compact authoring helper: F(path, summary, range, {c,b,v,t,rel,rules})
const feats = [];
const F = (path, summary, range, o = {}) => feats.push({
  path, summary, range,
  constraints: o.c || [], businessRules: o.b || [], validationRules: o.v || [],
  testingGuidance: o.t || [], related: o.rel || [], rules: o.rules || [],
  status: "proposed", _source: o.src || "OptimizationConstraints.md + RouteOptimizationOverview.md",
});

// ---------- LOCATIONS -------------------------------------------------------
F("locations.location",
  "Central array of \"lat, lon\" coordinate strings; every task/vehicle references a coordinate by integer index into this array.",
  "Array of \"latitude, longitude\" strings (WGS84). At least the indices referenced by vehicles/jobs must exist.",
  { c: ["Each entry is a \"lat, lon\" string; latitude in [-90,90], longitude in [-180,180]."],
    b: ["Referenced everywhere by 0-based integer index (location_index/start_index/end_index); valid index range is [0, len)."],
    v: ["Out-of-range coordinate value -> 400 input validation failed.", "A referenced index >= len(location) -> 400."],
    t: ["Boundary: coordinates at -90/90 lat and -180/180 lon accepted; beyond -> 400.",
        "Negative: a job location_index equal to len(location) -> 400 (out of range)."],
    rel: ["jobs.location_index", "vehicles.start_index"], rules: ["location-index-range"] });

F("locations.approaches",
  "Per-location curbside approach setting, aligned by position with the location array.",
  "Array of enum strings: unrestricted (default) | curb | \"\" (skip). Length must equal number of locations. Case-sensitive.",
  { c: ["If given, length MUST equal len(location)."],
    v: ["Length mismatch vs locations -> 400.", "A value outside {unrestricted, curb, \"\"} -> 400."],
    t: ["Positive: approaches all 'unrestricted'.", "Negative: approaches shorter than locations -> 400.",
        "Boundary: mix 'curb' and '' (skip) across positions."],
    rel: ["locations.location"] });

// ---------- VEHICLES: anchors / depots (C7) --------------------------------
F("vehicles.start_index",
  "Index into locations.location where the vehicle begins its route.",
  "Integer in [0, len(location)). If neither start_index nor start_depot_ids is given, the vehicle starts at its first task.",
  { c: ["Range [0, len(location))."],
    v: ["start_index >= len(location) or < 0 -> 400."],
    t: ["Positive: start_index 0.", "Boundary: start_index len-1 (last valid).", "Negative: start_index len -> 400."],
    rel: ["locations.location", "vehicles.end_index", "vehicles.start_depot_ids"], rules: ["location-index-range", "multi-depot-reachability"] });

F("vehicles.end_index",
  "Index into locations.location where the vehicle must end its route.",
  "Integer in [0, len(location)). If neither end_index nor end_depot_ids is given, the route is open (ends at last task, no return leg).",
  { c: ["Range [0, len(location))."],
    v: ["end_index out of range -> 400."],
    t: ["Positive: end_index equals start_index (return to origin).", "Open route: omit end_index -> finishes at last task.",
        "Negative: end_index out of range -> 400."],
    rel: ["locations.location", "vehicles.start_index", "vehicles.end_depot_ids"], rules: ["location-index-range", "multi-depot-reachability"] });

F("vehicles.start_depot_ids",
  "Depots the vehicle may start from (alternative to start_index).",
  "Array of depot id strings; each must match a defined depot.",
  { b: ["Pickup-type jobs with depots configured cannot be served by a vehicle that has only start depots."],
    v: ["A depot id not present in depots[] -> 400."],
    t: ["Positive: vehicle starts from one of two depots nearest its cluster.",
        "Negative: start_depot_ids referencing an undefined depot -> 400."],
    rel: ["vehicles.start_index", "jobs.depot_ids"], rules: ["multi-depot-reachability"] });

F("vehicles.end_depot_ids",
  "Depots where the vehicle may end (alternative to end_index).",
  "Array of depot id strings; each must match a defined depot.",
  { b: ["Delivery-type jobs with depots configured cannot be served by a vehicle that has only end depots."],
    t: ["Positive: relocation shift starting at depot A, ending at depot B."],
    rel: ["vehicles.end_index", "jobs.depot_ids"], rules: ["multi-depot-reachability"] });

F("vehicles.max_depot_runs",
  "Max number of returns to depot to reload during a route.",
  "Integer, default 1. Requires start_depot_ids. Conflicts with relations, layover_config, deadhead constraints.",
  { c: ["Requires a start depot.", "Cannot combine with max_deadhead_distance/duration, layover_config, relations."],
    v: ["max_depot_runs > 1 without a start depot -> 400.", "Combined with a conflicting field -> 400."],
    t: ["Positive: max_depot_runs 2 lets a small vehicle reload and serve more demand.",
        "Negative: max_depot_runs with layover_config also set -> 400."],
    rel: ["vehicles.start_depot_ids"], rules: ["multi-depot-reachability"] });

// ---------- VEHICLES: capacity-adjacent ------------------------------------
F("vehicles.alternative_capacities",
  "Alternate capacity configurations the vehicle can adopt (the solver picks one).",
  "Array of integer arrays; each inner array has the SAME dimension count as capacity. Cannot be shared/merged across vehicles.",
  { c: ["Each inner array's length must equal capacity's dimension count."],
    v: ["Dimension mismatch vs capacity -> 400."],
    t: ["Positive: two alt configs [[10],[20]] — solver adopts the one that fits demand.",
        "Negative: an alt config with a different dimension count than capacity -> 400."],
    rel: ["vehicles.capacity"], rules: ["capacity-dimension-consistency"] });

F("vehicles.min_stop_load",
  "Preferred minimum load per (delivery) stop; below it, penalties from costs apply.",
  "Array of integers, same dimensions as capacity. Delivery jobs only. Soft — drives penalties, not infeasibility.",
  { c: ["Same dimension count as capacity."],
    b: ["Soft constraint: shortfall triggers costs.min_stop_load_fixed_penalty / _unit_penalty, does not force unassignment."],
    t: ["Positive: min_stop_load [5] with all deliveries >= 5 — no penalty.",
        "Behavioral: a delivery below min_stop_load still assigned but incurs penalty."],
    rel: ["vehicles.capacity", "vehicles.costs.min_stop_load_fixed_penalty"], rules: ["capacity-dimension-consistency"] });

// ---------- VEHICLES: time / shift (C2, C6) --------------------------------
F("vehicles.time_window",
  "The vehicle's single shift window; the whole route (incl. service + waiting) must fit within it.",
  "A single [start, end] pair of Unix seconds (singular — unlike task time_windows which is a 2-D array). start <= end.",
  { c: ["start <= end; non-negative Unix seconds."],
    b: ["Route end (last arrival + service) must be <= time_window[1].", "Waiting for a late task window counts toward elapsed shift time."],
    v: ["start > end -> 400.", "A 2-D array (task-style) here -> 400 (vehicle uses a single pair)."],
    t: ["Positive: shift [32400,61200] (09:00–17:00) comfortably fits the route.",
        "Infeasible: a job forcing route end past time_window[1] -> unassigned (C6/C2).",
        "Boundary: route ending exactly at time_window[1] accepted."],
    rel: ["jobs.time_windows", "vehicles.max_working_time"], rules: ["time-window-feasibility", "max-duration-distance-cap"] });

F("vehicles.speed_factor",
  "Multiplier on travel speed; affects arrival times and duration-based cost.",
  "Number > 0 up to 5.0, two-decimal precision. Default 1. >1 = faster.",
  { c: ["Range (0, 5.0]; two decimals."],
    v: ["speed_factor 0 or negative -> 400.", "speed_factor > 5.0 -> 400."],
    t: ["Boundary: 0.01 (slowest) and 5.0 (fastest) accepted; 5.01 -> 400.",
        "Behavioral: speed_factor 2 halves travel times, easing time-window/duration feasibility."],
    rel: ["vehicles.max_travel_time"] });

// ---------- VEHICLES: limits (C5, C6) --------------------------------------
F("vehicles.max_stops",
  "Hard cap on the number of stops on the vehicle's route (breaks/layovers not counted).",
  "Non-negative integer. A shipment consumes TWO stops (pickup + delivery).",
  { c: ["Non-negative integer.", "Served stops on the route must be <= max_stops."],
    b: ["Tasks beyond the cap go to other vehicles or result.unassigned.", "max_stops 0 makes the vehicle effectively unused."],
    t: ["Positive: max_stops 8 with 8 eligible jobs — all served.",
        "Boundary: 9th eligible job with max_stops 8 -> unassigned or reassigned.",
        "Infeasible: fleet cap below total eligible demand forces unassigned."],
    rel: ["vehicles.max_tasks"], rules: ["max-stops-tasks-cap"] });

F("vehicles.max_tasks",
  "Hard cap on the number of tasks assignable to the vehicle.",
  "Positive integer.",
  { c: ["Positive integer; served tasks <= max_tasks."],
    b: ["Excess tasks reassigned or unassigned. max_tasks 0 -> vehicle serves nothing."],
    t: ["Positive: max_tasks 5, 5 jobs -> all served.", "Boundary: 6th job with max_tasks 5 -> elsewhere/unassigned.",
        "Combination: two vehicles each max_tasks 5, 12 jobs -> >=2 unassigned."],
    rel: ["vehicles.max_stops"], rules: ["max-stops-tasks-cap"] });

F("vehicles.max_travel_time",
  "Hard cap on cumulative DRIVING time (excludes wait/service/setup).",
  "Non-negative integer seconds.",
  { c: ["Non-negative integer seconds; route driving time <= max_travel_time."],
    b: ["An insertion raising driving time past the cap is rejected (task routed elsewhere/unassigned)."],
    t: ["Positive: max_travel_time 14400 (4h) with a 3h route.",
        "Infeasible: nearest task's leg alone exceeds max_travel_time -> vehicle serves nothing.",
        "Boundary: route driving time exactly max_travel_time accepted."],
    rel: ["vehicles.max_distance", "vehicles.max_working_time", "vehicles.time_window"], rules: ["max-duration-distance-cap"] });

F("vehicles.max_working_time",
  "Hard cap on total working duration: service + waiting + setup + driving all count.",
  "Non-negative integer seconds.",
  { c: ["Non-negative integer seconds; total working time <= max_working_time."],
    b: ["Unlike max_travel_time, waiting and service count — a long wait for a late window can breach this."],
    t: ["Positive: generous max_working_time covers driving+service+wait.",
        "Infeasible: a late time window forces waiting that pushes working time past the cap -> unassigned."],
    rel: ["vehicles.max_travel_time", "vehicles.time_window"], rules: ["max-duration-distance-cap"] });

F("vehicles.max_distance",
  "Hard cap on cumulative route distance (meters).",
  "Non-negative integer meters. Applies to distance_matrix values if provided.",
  { c: ["Non-negative integer meters; route distance <= max_distance."],
    t: ["Positive: max_distance 100000 (100km) covers the plan.",
        "Infeasible: max_distance shorter than the leg to the nearest task -> vehicle unused.",
        "Boundary: route distance exactly max_distance accepted."],
    rel: ["vehicles.max_travel_time"], rules: ["max-duration-distance-cap"] });

// ---------- VEHICLES: skills / zones (C3 + zones) --------------------------
F("vehicles.skills",
  "Capability tags the vehicle provides; must be a superset of any task it serves.",
  "Array of non-negative integers; may be empty (then it can only serve tasks with empty skills).",
  { c: ["Non-negative integers."],
    b: ["A task is assignable to this vehicle iff task.skills is a subset of vehicle.skills.",
        "A single high-skill vehicle can become a bottleneck under load."],
    t: ["Positive: vehicle skills [1,2] serves a job needing [2].",
        "Infeasible: no vehicle has the required skill -> job unassigned (skill reason).",
        "Boundary: empty vehicle skills can serve only empty-skill jobs."],
    rel: ["jobs.skills", "shipments.skills"], rules: ["skills-superset"] });

F("vehicles.allowed_zones",
  "Zones the vehicle may serve tasks in.",
  "Array of integer zone IDs. Empty array = only zone-less tasks. Omitted = all zones.",
  { b: ["Empty allowed_zones restricts the vehicle to tasks with no zone.", "A task in a non-allowed zone cannot be served by this vehicle."],
    t: ["Positive: allowed_zones [1] serves jobs.zones [1].",
        "Infeasible: a job in zone 2 with no vehicle allowed there -> unassigned.",
        "Boundary: empty allowed_zones + a zoned job -> unassigned."],
    rel: ["jobs.zones", "vehicles.restricted_zones"], rules: ["zone-eligibility"] });

F("vehicles.restricted_zones",
  "Zones the vehicle may NOT serve tasks in (it may still route through them).",
  "Array of integer zone IDs.",
  { b: ["A task in a restricted zone cannot be assigned to this vehicle, though the vehicle may transit the zone."],
    t: ["Positive: restricted_zones [3] — vehicle avoids serving zone-3 tasks but can drive through.",
        "Infeasible: every vehicle restricts the only zone a job is in -> unassigned."],
    rel: ["jobs.zones", "vehicles.allowed_zones"], rules: ["zone-eligibility"] });

// ---------- JOBS: core / quantity (C1) -------------------------------------
F("jobs.location_index",
  "Index into locations.location where the job is served. Required.",
  "Required integer in [0, len(location)).",
  { c: ["Required.", "Range [0, len(location))."],
    v: ["Missing -> 400.", "Out of range -> 400.", "Non-integer (e.g. \"first\") -> 400 type error."],
    t: ["Positive: valid index.", "Boundary: index len-1.", "Negative: index len -> 400; string index -> 400."],
    rel: ["locations.location"], rules: ["location-index-range"] });

F("jobs.delivery",
  "Multi-dimensional quantity delivered at the job (loaded at depot, dropped here); consumes vehicle capacity.",
  "Array of non-negative integers; dimension count must match vehicles.capacity.",
  { c: ["Non-negative integers.", "Dimension count consistent with capacity/pickup/amount."],
    b: ["Delivered load must fit remaining capacity at every step (C1)."],
    v: ["Negative value -> 400.", "Dimension mismatch vs capacity -> 400."],
    t: ["Positive: delivery [1] on capacity [4].", "Boundary: delivery equal to capacity fits; +1 breaches -> unassigned.",
        "Infeasible: delivery exceeds every vehicle's capacity -> unassigned (capacity reason)."],
    rel: ["vehicles.capacity", "jobs.pickup"], rules: ["capacity-dimension-consistency"] });

F("jobs.pickup",
  "Multi-dimensional quantity picked up at the job (added to onboard load, carried onward).",
  "Array of non-negative integers; dimension count must match vehicles.capacity.",
  { c: ["Non-negative integers.", "Dimension count consistent with capacity."],
    b: ["Pickups raise mid-route load; a depot-feasible load can breach capacity between pickup and a later stop (C1)."],
    v: ["Negative value -> 400.", "Dimension mismatch -> 400."],
    t: ["Positive: pickup [2] on capacity [5].",
        "Infeasible: two pickups stacking load past capacity mid-route -> one unassigned."],
    rel: ["vehicles.capacity", "jobs.delivery"], rules: ["capacity-dimension-consistency"] });

F("jobs.service",
  "Dwell time spent performing the job at its stop; added after arrival.",
  "Non-negative integer seconds. Default 0.",
  { c: ["Non-negative integer seconds."],
    b: ["Service extends the stop's occupancy and counts toward max_working_time and the shift end."],
    t: ["Positive: service 300 (5 min).", "Boundary: service 0 (instantaneous).",
        "Interaction: large service inflates working time and can breach max_working_time (C6)."],
    rel: ["jobs.time_windows", "vehicles.max_working_time"] });

F("jobs.time_windows",
  "Allowed arrival intervals for starting the job; early arrival waits, lateness beyond tolerance is infeasible.",
  "Array of [start,end] Unix-second pairs; non-overlapping; each start <= end.",
  { c: ["Each [start,end] with start <= end; non-overlapping; non-negative Unix seconds."],
    b: ["Arrival must land in a window (or within max_visit_lateness); early arrival waits and inflates duration."],
    v: ["A window with end < start -> 400.", "Overlapping windows -> 400."],
    t: ["Positive: window [36000,43200], vehicle arrives 09:40 -> waits to 10:00.",
        "Infeasible: window ends before earliest possible arrival and max_visit_lateness 0 -> unassigned.",
        "Boundary: instant window [t,t] -> must arrive exactly at t."],
    rel: ["vehicles.time_window", "jobs.max_visit_lateness", "jobs.service"], rules: ["time-window-feasibility"] });

F("jobs.max_visit_lateness",
  "Tolerated lateness after a job's window ends; overrides the global constraint value.",
  "Non-negative integer seconds. Overrides options.constraint.max_visit_lateness for this job.",
  { c: ["Non-negative integer seconds."],
    b: ["Lateness within tolerance surfaces as steps[].late_by / summary.total_visit_lateness; beyond it -> unassigned."],
    t: ["Positive: max_visit_lateness 600 lets a 5-min-late arrival still serve.",
        "Infeasible: max_visit_lateness 0 with an unreachable window -> unassigned."],
    rel: ["jobs.time_windows"], rules: ["time-window-feasibility"] });

F("jobs.skills",
  "Skills required to perform the job; the servicing vehicle's skills must be a superset.",
  "Array of positive integers (each > 0); may be empty (any vehicle qualifies).",
  { c: ["Each skill > 0."],
    b: ["Assignable iff job.skills subset of vehicle.skills."],
    v: ["Non-integer skill -> 400."],
    t: ["Positive: job skills [2] served by vehicle skills [1,2].",
        "Infeasible: job needs a skill no vehicle has -> unassigned (skill reason).",
        "Boundary: empty job skills -> any vehicle."],
    rel: ["vehicles.skills"], rules: ["skills-superset"] });

F("jobs.setup",
  "One-time setup time applied once per location (not per repeated task at the same spot).",
  "Non-negative integer seconds.",
  { c: ["Non-negative integer seconds."],
    b: ["Applied once per location_index on a route; repeated tasks at the same location don't re-incur it."],
    t: ["Positive: setup 60.", "Behavioral: two jobs at the same location_index incur setup once."],
    rel: ["jobs.service"] });

F("jobs.priority",
  "Importance used to decide which tasks are served first when demand is over-subscribed; affects likelihood, not sequence.",
  "Integer in [0,100]. Default 0. Higher = preferred for assignment.",
  { c: ["Integer within [0,100]."],
    b: ["Tiebreaker only — cannot override any hard constraint. outsourcing_cost, if present, overrides priority."],
    v: ["priority < 0 or > 100 -> 400."],
    t: ["Boundary: 0 and 100 valid; 101 / -1 -> 400.",
        "Behavioral: high vs low priority competing for the last slot -> high assigned, low unassigned.",
        "Interaction: high-priority job with an infeasible window -> still unassigned."],
    rel: ["jobs.outsourcing_cost"], rules: ["priority-tiebreaker"] });

F("jobs.sequence_order",
  "Relative ordering of the job within a route; relations outrank it, it overrides order_grouping.",
  "Integer in [0,100].",
  { c: ["Integer within [0,100]."],
    b: ["Lower sequence_order is served earlier; a hard relations constraint overrides it."],
    v: ["Outside [0,100] -> 400."],
    t: ["Positive: two jobs sequence_order 1 and 2 served in that order.",
        "Boundary: 0 and 100 valid; 101 -> 400."],
    rel: ["relations"] });

F("jobs.zones",
  "Zone IDs constraining which vehicles can serve the job; if set for one job, must be set for all.",
  "Array of integer zone IDs. Overrides zones[] geometries. Consistency required across jobs.",
  { c: ["If any job sets zones, all jobs must set zones."],
    b: ["Only vehicles whose allowed_zones include the job's zone (and don't restrict it) can serve it."],
    v: ["zones set on some jobs but not others -> 400."],
    t: ["Positive: job zones [1], vehicle allowed_zones [1].",
        "Infeasible: job zone with no eligible vehicle -> unassigned."],
    rel: ["vehicles.allowed_zones", "vehicles.restricted_zones"], rules: ["zone-eligibility"] });

F("jobs.load_types",
  "Load-type tags on the job; effective only with a pickup/delivery step; combine with incompatible_load_types.",
  "Array of string tags. Ignored for the first task of a route.",
  { b: ["Two load types that are mutually incompatible cannot share a vehicle's history."],
    t: ["Positive: load_types [\"frozen\"].",
        "Infeasible: a job whose load_type is incompatible with everything already onboard -> deferred/unassigned."],
    rel: ["jobs.incompatible_load_types"], rules: ["load-type-compatibility"] });

F("jobs.incompatible_load_types",
  "Load types that cannot share the vehicle's cargo history with this job.",
  "Array of string tags.",
  { b: ["If any onboard/previous load matches an incompatible type, the job can't be co-assigned."],
    t: ["Negative-behavioral: job incompatible with 'raw' cannot ride a vehicle that carried 'raw'."],
    rel: ["jobs.load_types"], rules: ["load-type-compatibility"] });

F("jobs.revenue",
  "Revenue earned by completing the job; used in the profit trade-off. Cannot combine with outsourcing_cost.",
  "Integer. Mutually exclusive with outsourcing_cost.",
  { c: ["Cannot be set together with outsourcing_cost on the same job."],
    v: ["Both revenue and outsourcing_cost set -> 400."],
    t: ["Positive: revenue 500.", "Negative: revenue + outsourcing_cost together -> 400."],
    rel: ["jobs.outsourcing_cost"] });

F("jobs.outsourcing_cost",
  "Cost of leaving the job unassigned; overrides priority in the assignment decision. Cannot combine with revenue.",
  "Integer. Overrides priority. Mutually exclusive with revenue.",
  { c: ["Cannot be set together with revenue."],
    b: ["A high outsourcing_cost makes the solver prefer serving the job over a higher-priority one."],
    v: ["Both outsourcing_cost and revenue set -> 400."],
    t: ["Behavioral: high outsourcing_cost job preferred over a higher-priority job for the last slot."],
    rel: ["jobs.priority", "jobs.revenue"], rules: ["priority-tiebreaker"] });

F("jobs.follow_lifo_order",
  "Enforce last-in-first-out loading/unloading for this job.",
  "Boolean. Default false.",
  { t: ["Positive: follow_lifo_order true respected in stop ordering.", "Boundary: default false (no LIFO constraint)."] });

F("jobs.depot_ids",
  "Depots that can source/sink this job; no effect if the job has no pickup/delivery step.",
  "Array of depot id strings.",
  { b: ["Only vehicles whose depots intersect the job's depot_ids can fulfill it."],
    t: ["Positive: job depot_ids [\"A\"] served by a vehicle starting at A.",
        "Infeasible: job depot_ids incompatible with any vehicle's depots -> unassigned."],
    rel: ["vehicles.start_depot_ids", "vehicles.end_depot_ids"], rules: ["multi-depot-reachability"] });

F("jobs.joint_order",
  "Joint-order group ID; all tasks in the group are assigned together, or none are.",
  "Integer group ID.",
  { b: ["Atomic group: if any member is infeasible, the whole group is unassigned."],
    t: ["Positive: two jobs sharing joint_order 7 both assigned.",
        "Infeasible: one member of a joint_order group infeasible -> the whole group unassigned."] });

F("jobs.volume.alignment",
  "Cargo alignment rule for volumetric packing.",
  "Enum: strict | parallel | fixed_bottom | \" \" (default = skip check).",
  { v: ["A value outside the enum set -> 400."],
    t: ["Positive: alignment 'strict'.", "Boundary: default ' ' skips the volume check."],
    rel: ["jobs.volume"] });

// ---------- SHIPMENTS (C4) -------------------------------------------------
F("shipments.amount",
  "Load carried from a shipment's pickup to its delivery; consumes capacity between the two steps.",
  "Array of non-negative integers; dimension count must match vehicles.capacity.",
  { c: ["Non-negative integers.", "Dimension count consistent with capacity."],
    b: ["Load added at pickup, removed at delivery; capacity honored cumulatively while onboard (C1+C4)."],
    v: ["Dimension mismatch -> 400."],
    t: ["Positive: amount [3] on capacity [5].",
        "Infeasible: two shipments each amount [3] onboard together on capacity [5] -> one deferred (6>5)."],
    rel: ["vehicles.capacity", "shipments.pickup", "shipments.delivery"], rules: ["capacity-dimension-consistency", "pickup-delivery-precedence"] });

F("shipments.skills",
  "Skills required to perform BOTH steps of the shipment; the vehicle's skills must be a superset.",
  "Array of positive integers.",
  { c: ["Each skill > 0."],
    b: ["Both pickup and delivery served by one vehicle whose skills superset these."],
    t: ["Positive: shipment skills [1] served by vehicle skills [1,4].",
        "Infeasible: no vehicle has the required skill -> both steps unassigned."],
    rel: ["vehicles.skills"], rules: ["skills-superset"] });

F("shipments.priority",
  "Importance of the shipment when demand is over-subscribed.",
  "Integer in [0,100]. Default 0.",
  { c: ["Integer within [0,100]."],
    b: ["Tiebreaker only; cannot override hard constraints."],
    v: ["Outside [0,100] -> 400."],
    t: ["Boundary: 0/100 valid; 101 -> 400.", "Behavioral: higher-priority shipment wins the last slot."],
    rules: ["priority-tiebreaker"] });

F("shipments.max_time_in_vehicle",
  "Max time the load may remain onboard between pickup and delivery.",
  "Non-negative integer seconds.",
  { c: ["Non-negative integer seconds."],
    b: ["If the route between pickup and delivery exceeds this, the pair is infeasible (C4)."],
    t: ["Positive: generous max_time_in_vehicle covers the leg.",
        "Infeasible: max_time_in_vehicle smaller than the pickup->delivery travel -> unassigned."],
    rel: ["shipments.pickup", "shipments.delivery"], rules: ["pickup-delivery-precedence"] });

F("shipments.pickup.location_index",
  "Index into locations.location for the shipment's pickup step. Required.",
  "Required integer in [0, len(location)).",
  { c: ["Required.", "Range [0, len(location))."],
    v: ["Missing/out of range -> 400."],
    t: ["Positive: valid index.", "Negative: out of range -> 400."],
    rel: ["locations.location", "shipments.delivery.location_index"], rules: ["location-index-range", "pickup-delivery-precedence"] });

F("shipments.delivery.location_index",
  "Index into locations.location for the shipment's delivery step. Required.",
  "Required integer in [0, len(location)). May equal the pickup index (zero-distance leg).",
  { c: ["Required.", "Range [0, len(location))."],
    b: ["Delivery step must occur AFTER the pickup step on the same vehicle (C4)."],
    v: ["Missing/out of range -> 400."],
    t: ["Positive: delivery index differs from pickup.", "Boundary: delivery index == pickup index (valid, zero-distance).",
        "Infeasible: delivery window earlier than pickup window -> precedence infeasible -> unassigned."],
    rel: ["locations.location", "shipments.pickup.location_index"], rules: ["location-index-range", "pickup-delivery-precedence"] });

F("shipments.pickup.time_windows",
  "Allowed start windows for the pickup step.",
  "Array of [start,end] Unix-second pairs; non-overlapping.",
  { c: ["Each start <= end; non-overlapping."],
    b: ["Pickup must start within a window; couples with delivery windows for precedence feasibility."],
    t: ["Infeasible: pickup window strictly after delivery window -> unassigned (precedence)."],
    rel: ["shipments.delivery.time_windows"], rules: ["pickup-delivery-precedence", "time-window-feasibility"] });

F("shipments.delivery.time_windows",
  "Allowed start windows for the delivery step.",
  "Array of [start,end] Unix-second pairs; non-overlapping.",
  { c: ["Each start <= end; non-overlapping."],
    b: ["Delivery window must be reachable after the pickup for the pair to be feasible."],
    t: ["Infeasible: delivery window unreachable after pickup+travel -> whole pair unassigned."],
    rel: ["shipments.pickup.time_windows"], rules: ["pickup-delivery-precedence", "time-window-feasibility"] });

F("shipments.pickup.sequence_order",
  "Ordering value of the pickup step; must be <= its delivery's sequence_order.",
  "Integer in [0,100]. pickup.sequence_order <= delivery.sequence_order.",
  { c: ["[0,100]; pickup value <= delivery value."],
    v: ["pickup.sequence_order > delivery.sequence_order -> 400."],
    t: ["Negative: pickup order greater than delivery order -> 400."],
    rel: ["shipments.delivery.sequence_order"], rules: ["pickup-delivery-precedence"] });

F("shipments.load_types",
  "Load-type tags on the shipment.",
  "Array of string tags. Combine with incompatible_load_types.",
  { t: ["Infeasible: shipment load type incompatible with onboard cargo -> deferred."],
    rel: ["shipments.incompatible_load_types"], rules: ["load-type-compatibility"] });

F("shipments.zones",
  "Zone IDs constraining eligible vehicles; both steps' zones are considered.",
  "Array of integer zone IDs.",
  { b: ["A vehicle must be allowed in the zones of BOTH pickup and delivery."],
    t: ["Infeasible: pickup and delivery in different zones with no vehicle allowed in both -> unassigned."],
    rel: ["vehicles.allowed_zones"], rules: ["zone-eligibility"] });

// ---------- ZONES ----------------------------------------------------------
F("zones.geometry.type",
  "GeoJSON geometry type for a zone polygon.",
  "Enum: Polygon | MultiPolygon.",
  { v: ["A type outside {Polygon, MultiPolygon} -> 400."],
    t: ["Positive: type 'Polygon' with valid coordinates.", "Negative: type 'Point' -> 400."],
    rel: ["zones.geometry.coordinates"] });

F("zones.geofence_id",
  "ID of a pre-created geofence, as an alternative to inline geometry.",
  "String id of an existing geofence. Each zone needs geometry OR geofence_id.",
  { c: ["A zone must provide exactly one of geometry / geofence_id."],
    v: ["A zone with neither geometry nor geofence_id -> 400."],
    t: ["Positive: zone via geofence_id.", "Negative: zone with neither geometry nor geofence_id -> 400."] });

// ---------- RULES (C2–C8 + zone/load/index invariants) ---------------------
const rules = [
  { id: "time-window-feasibility",
    summary: "A stop is feasible only if the vehicle can start it within a window (or within lateness tolerance) and still fit the shift; early arrival waits.",
    applies_to: ["jobs.time_windows", "vehicles.time_window", "jobs.max_visit_lateness", "jobs.service", "vehicles.max_working_time"],
    rule: "Arrival must fall inside one of a task's time_windows, or within max_visit_lateness after it; early arrival waits (inflating elapsed/working time). The whole route including service and waiting must finish within the vehicle's time_window. An impossible window (ends before the earliest reachable arrival, beyond tolerance) sends the task to result.unassigned (time-window reason); HTTP stays 200.",
    testingGuidance: [
      "Infeasible: job window [09:00,09:30], max_visit_lateness 0, nearest vehicle arrives 09:45 -> unassigned.",
      "Interaction: a long wait for a late window pushes route end past the shift -> unassigned (couples with max-duration-distance-cap)." ] },
  { id: "skills-superset",
    summary: "A task is assignable to a vehicle only if the vehicle's skills contain ALL of the task's required skills.",
    applies_to: ["jobs.skills", "vehicles.skills", "shipments.skills"],
    rule: "Assignment is allowed iff task.skills is a subset of vehicle.skills (superset match). A task requiring a skill no vehicle has always goes to result.unassigned (skill reason), even when capacity and time are ample. Empty task skills match any vehicle.",
    testingGuidance: [
      "Infeasible: job needs skill 3, no vehicle has 3 -> unassigned.",
      "Positive: job needs [2]; only the vehicle whose skills include 2 serves it." ] },
  { id: "pickup-delivery-precedence",
    summary: "A shipment's pickup and delivery must be served by the same vehicle, pickup before delivery, with carried amount respected as load and max_time_in_vehicle honored.",
    applies_to: ["shipments.pickup.location_index", "shipments.delivery.location_index", "shipments.amount", "shipments.max_time_in_vehicle", "shipments.pickup.sequence_order", "shipments.delivery.sequence_order"],
    rule: "Both steps are mandatory and co-assigned to one vehicle; the delivery step occurs after the pickup step. Load is added at pickup and removed at delivery, honoring capacity cumulatively (couples with capacity-dimension-consistency). If the pair cannot be co-scheduled feasibly (window precedence, capacity, or max_time_in_vehicle), BOTH steps go to result.unassigned.",
    testingGuidance: [
      "Infeasible: delivery time window earlier than the pickup window -> precedence infeasible -> both unassigned.",
      "Infeasible: two amount [3] shipments onboard together on capacity [5] -> one deferred by capacity." ] },
  { id: "max-stops-tasks-cap",
    summary: "Per-vehicle hard caps on stops/tasks; demand beyond the cap is reassigned or unassigned.",
    applies_to: ["vehicles.max_stops", "vehicles.max_tasks"],
    rule: "Served stops must be <= max_stops and served tasks <= max_tasks (a shipment consumes two stops). Tasks beyond the caps are assigned to other vehicles or returned unassigned. A cap of 0 makes the vehicle serve nothing. When fleet-wide caps fall below eligible demand, the surplus is necessarily unassigned.",
    testingGuidance: [
      "Boundary: max_tasks 5 with 6 eligible jobs -> the 6th is reassigned or unassigned.",
      "Combination: two vehicles each max_tasks 5, 12 jobs -> >=2 unassigned." ] },
  { id: "max-duration-distance-cap",
    summary: "Per-vehicle hard caps on driving time, working time, and distance (and the shift end) bound each route.",
    applies_to: ["vehicles.max_travel_time", "vehicles.max_working_time", "vehicles.max_distance", "vehicles.time_window"],
    rule: "Route driving time <= max_travel_time; total working time (service+wait+setup+driving) <= max_working_time; distance <= max_distance; route end <= time_window[1]. An insertion that would breach any cap is rejected, routing the task elsewhere or leaving it unassigned. Waiting for a late window can breach max_working_time / the shift even when driving time is small.",
    testingGuidance: [
      "Infeasible: nearest task's leg alone exceeds max_travel_time -> vehicle serves nothing.",
      "Interaction: a 40-min wait for a late window pushes route end past the shift -> unassigned." ] },
  { id: "multi-depot-reachability",
    summary: "Vehicles may start/end at different depots (by index or depot IDs); tasks restricted by depot_ids need a vehicle whose depots match.",
    applies_to: ["vehicles.start_index", "vehicles.end_index", "vehicles.start_depot_ids", "vehicles.end_depot_ids", "jobs.depot_ids", "vehicles.max_depot_runs"],
    rule: "With no start/end anchor a vehicle starts at its first task and ends at its last (open route). With multiple depots the solver picks the geographically closest per cluster. A job's depot_ids must intersect an available vehicle's depots, else it is unassigned. Pickup-type jobs need a vehicle with start depots; delivery-type jobs need end depots. max_depot_runs allows reloads but conflicts with layover_config/relations/deadhead caps.",
    testingGuidance: [
      "Positive: two depots north/south, demand split by region -> each vehicle serves its nearby cluster.",
      "Infeasible: job depot_ids incompatible with any vehicle's depots -> unassigned." ] },
  { id: "zone-eligibility",
    summary: "A zoned task can only be served by a vehicle allowed in that zone (and not restricting it); shipments consider both steps' zones.",
    applies_to: ["jobs.zones", "shipments.zones", "vehicles.allowed_zones", "vehicles.restricted_zones"],
    rule: "A task in zone Z is assignable only to a vehicle whose allowed_zones include Z (or omits allowed_zones) and whose restricted_zones exclude Z. Empty allowed_zones restricts a vehicle to zone-less tasks. If any job sets zones, all jobs must. A zoned task with no eligible vehicle goes to result.unassigned.",
    testingGuidance: [
      "Infeasible: job in zone 2 with every vehicle restricting or not allowing zone 2 -> unassigned.",
      "Positive: job zones [1], vehicle allowed_zones [1] -> served." ] },
  { id: "load-type-compatibility",
    summary: "Incompatible load types cannot share a vehicle's cargo history.",
    applies_to: ["jobs.load_types", "jobs.incompatible_load_types", "shipments.load_types", "shipments.incompatible_load_types"],
    rule: "A task whose incompatible_load_types intersects the load types already carried (or scheduled) on a vehicle cannot be co-assigned to it. Load types are effective only with a pickup/delivery step and ignored for a route's first task.",
    testingGuidance: [
      "Behavioral: a job incompatible with 'raw' cannot ride a vehicle that carried 'raw'.",
      "Positive: compatible load types share a vehicle without issue." ] },
  { id: "location-index-range",
    summary: "Every location_index / start_index / end_index must resolve within the request's own locations.location array.",
    applies_to: ["locations.location", "jobs.location_index", "vehicles.start_index", "vehicles.end_index", "shipments.pickup.location_index", "shipments.delivery.location_index"],
    rule: "All index references must be integers in [0, len(locations.location)). An index >= len or < 0, or a non-integer index, is an input validation error (HTTP 400) at submit — distinct from an infeasible-but-valid request.",
    testingGuidance: [
      "Negative: a job location_index equal to len(location) -> 400.",
      "Negative: a non-integer index like \"first\" -> 400 type error." ] },
];

// ---------- write ----------------------------------------------------------
let fw = 0, rw = 0, skip = 0;
for (const f of feats) {
  const fp = join(ENRICH, f.path + ".json");
  if (existsSync(fp)) {                        // never clobber a ratified/existing file
    const prior = JSON.parse(readFileSync(fp, "utf8"));
    if (prior.status !== "proposed") { skip++; continue; }
  }
  writeFileSync(fp, JSON.stringify(f, null, 2) + "\n"); fw++;
}
for (const r of rules) {
  const fp = join(RULES, r.id + ".json");
  if (existsSync(fp)) { skip++; continue; }     // don't overwrite existing rule files (capacity/priority already shipped)
  writeFileSync(fp, JSON.stringify({ ...r, status: "proposed" }, null, 2) + "\n"); rw++;
}
console.log(`✓ Tier 1: wrote ${fw} proposed enrichment file(s) + ${rw} rule file(s)${skip ? `, skipped ${skip} existing` : ""}.`);
console.log(`  review enrichment/*.json (status:"proposed"), ratify by removing "status", then: node qa-studio/compile.mjs`);
