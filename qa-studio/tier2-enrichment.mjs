#!/usr/bin/env node
// =============================================================================
// Tier 2 enrichment — options.* / depots / relations / matrices
// =============================================================================
// Grounded in RouteOptimizationOverview.md §3.6–3.8 (+ ENUM_REFERENCE / API facts).
// All status:"proposed" (parked until ratified). Adds 4 cross-feature rules.
// Run: node qa-studio/tier2-enrichment.mjs   then  node qa-studio/compile.mjs
// (Re-optimization/output echoes — solution.* / unassigned.* — are Tier 3.)
// =============================================================================
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const ENRICH = join(DIR, "enrichment");
const RULES = join(DIR, "rules");
mkdirSync(ENRICH, { recursive: true });
mkdirSync(RULES, { recursive: true });

const feats = [];
const F = (path, summary, range, o = {}) => feats.push({
  path, summary, range,
  constraints: o.c || [], businessRules: o.b || [], validationRules: o.v || [],
  testingGuidance: o.t || [], related: o.rel || [], rules: o.rules || [],
  status: "proposed", _source: o.src || "RouteOptimizationOverview.md §3.6–3.8",
});

// ---------- OPTIONS (containers) -------------------------------------------
F("options", "Solver configuration container: objective, constraint, routing, grouping, webhook. All optional.",
  "Object with optional sub-objects. Omitting options uses solver defaults.",
  { t: ["Positive: omit options entirely -> defaults (travel_cost=duration, mode=car)."],
    rel: ["options.objective", "options.constraint", "options.routing", "options.grouping"] });

F("options.objective", "Defines what the solver optimizes (cost basis + custom min/min-max terms + early-arrival behavior).",
  "Object: { travel_cost?, custom?, allow_early_arrival?, solving_time_limit? }.",
  { t: ["Positive: travel_cost=distance to minimize kilometers."],
    rel: ["options.objective.travel_cost", "options.objective.custom"] });

F("options.objective.travel_cost", "Basis the solver uses to cost travel between stops.",
  "Enum: duration (default) | distance | air_distance | customized. 'customized' requires cost_matrix.",
  { c: ["travel_cost=customized requires a cost_matrix.", "per_km costs need travel_cost=distance; per_hour costs need travel_cost=duration."],
    v: ["travel_cost=customized without cost_matrix -> 400.", "A value outside the enum -> 400."],
    t: ["Positive: each enum value (duration/distance/air_distance).",
        "Negative: customized without cost_matrix -> 400."],
    rel: ["cost_matrix", "vehicles.costs.per_km", "vehicles.costs.per_hour"], rules: ["objective-cost-mode-consistency"] });

F("options.objective.custom", "Custom objective: a { type, value } pair (both required when custom is used).",
  "Object: { type (required), value (required) }.",
  { c: ["Both type and value required when custom is present.", "value domain depends on type (see custom.value)."],
    v: ["custom with only type or only value -> 400."],
    t: ["Positive: {type:min, value:vehicles} minimizes vehicle count.",
        "Negative: custom missing value -> 400."],
    rel: ["options.objective.custom.type", "options.objective.custom.value"] });

F("options.objective.custom.type", "Custom-objective aggregation type. Required within custom.",
  "Required enum: min | min-max.",
  { c: ["Required."],
    v: ["A value outside {min, min-max} -> 400."],
    b: ["type=min pairs with value in {vehicles, completion_time}; type=min-max with value in {tasks, travel_cost}."],
    t: ["Positive: type=min-max, value=travel_cost (balance the worst route).",
        "Negative: type=min with value=tasks (mismatched pairing) -> 400."],
    rel: ["options.objective.custom.value"] });

F("options.objective.custom.value", "Metric the custom objective acts on. Required within custom.",
  "Required enum: for type=min -> vehicles | completion_time; for type=min-max -> tasks | travel_cost.",
  { c: ["Required.", "Must be valid for the chosen type."],
    v: ["value not valid for the chosen type -> 400."],
    t: ["Positive: type=min, value=completion_time (finish everything as early as possible)."],
    rel: ["options.objective.custom.type"] });

F("options.objective.allow_early_arrival", "Whether the driver waits AT the task (true) or at the previous stop and departs just-in-time (false).",
  "Boolean. Default true.",
  { b: ["Affects where waiting time accrues, not feasibility; interacts with time windows."],
    t: ["Positive: true — driver waits at the task location.", "Behavioral: false — waits at previous stop, arrives just in time."],
    rel: ["jobs.time_windows"] });

F("options.objective.solving_time_limit", "Target solve time budget (seconds); the solver may exceed it to find any solution.",
  "Integer seconds. >= 300–420s recommended for large inputs.",
  { c: ["Positive integer seconds."],
    b: ["Soft target — solver can run longer to return a feasible solution for large problems."],
    t: ["Positive: solving_time_limit 420 for a 500-job problem.",
        "Boundary: very small limit may yield a lower-quality but valid solution."] });

// ---------- OPTIONS.CONSTRAINT (soft) --------------------------------------
F("options.constraint", "Soft-constraint penalties shaping trade-offs (overtime, lateness, sequence). Ineffective when relations is used.",
  "Object of penalty/limit integers. All soft.",
  { b: ["These are SOFT — they penalize, never force infeasibility. Entirely ineffective when relations is present."],
    t: ["Positive: raise visit_lateness_penalty to discourage late visits.",
        "Interaction: with relations set, these penalties have no effect."],
    rel: ["options.constraint.max_visit_lateness", "relations"], rules: ["relations-supersede-soft"] });

F("options.constraint.max_vehicle_overtime", "Max overtime allowed after a vehicle's shift window ends (seconds).",
  "Integer seconds. Default 0.",
  { c: ["Non-negative integer seconds."],
    b: ["Overtime beyond this is penalized via vehicle_overtime_penalty (soft)."],
    t: ["Positive: allow 1800s overtime to serve one more task.", "Boundary: default 0 (no overtime)."],
    rel: ["options.constraint.vehicle_overtime_penalty"] });

F("options.constraint.vehicle_overtime_penalty", "Penalty per unit of vehicle overtime.",
  "Integer. Default 200.",
  { b: ["Scales the cost of exceeding the shift; higher discourages overtime."],
    t: ["Behavioral: high penalty keeps routes within the shift."],
    rel: ["options.constraint.max_vehicle_overtime"] });

F("options.constraint.max_visit_lateness", "Global max lateness after a task window (seconds); per-task max_visit_lateness overrides it.",
  "Integer seconds. Default 0.",
  { c: ["Non-negative integer seconds."],
    b: ["A task's own max_visit_lateness overrides this global value."],
    t: ["Positive: global tolerance 600s.", "Interaction: a job with its own max_visit_lateness ignores this."],
    rel: ["jobs.max_visit_lateness", "options.constraint.visit_lateness_penalty"] });

F("options.constraint.visit_lateness_penalty", "Penalty per unit of lateness within tolerance.",
  "Integer. Default 10.",
  { b: ["Higher discourages late visits without forbidding them."],
    t: ["Behavioral: raise to prefer on-time routes."],
    rel: ["options.constraint.max_visit_lateness"] });

F("options.constraint.sequence_order_penalty", "Penalty when a task is not fulfilled at its sequence_order.",
  "Integer. Default 10000.",
  { b: ["Soft enforcement of sequence_order; relations outrank and disable this."],
    t: ["Behavioral: lower to let the solver reorder for efficiency."],
    rel: ["jobs.sequence_order"] });

// ---------- OPTIONS.ROUTING ------------------------------------------------
F("options.routing", "Road-network routing configuration: mode, avoid/exclude, truck attributes, profiles, traffic.",
  "Object of routing options. mode defaults to car.",
  { t: ["Positive: mode=truck with truck_size/weight for HGV routing."],
    rel: ["options.routing.mode", "options.routing.avoid", "options.routing.exclude"] });

F("options.routing.mode", "Travel mode determining the road network and which routing attributes apply.",
  "Enum: car (default) | truck | motorcycle | bike | walk. Non-car may be region-limited.",
  { v: ["A value outside the enum -> 400."],
    b: ["truck_size/truck_weight/hazmat_type/truck_axle_load require mode=truck; allow=taxi requires mode=car."],
    t: ["Positive: each mode value.", "Negative: truck_weight set with mode=car -> 400 (truck-only attribute)."],
    rel: ["options.routing.truck_size", "options.routing.hazmat_type"], rules: ["routing-mode-gating"] });

F("options.routing.traffic_timestamp", "Unix time whose traffic conditions the solver should use.",
  "Integer Unix seconds.",
  { c: ["Non-negative Unix seconds."],
    t: ["Positive: a rush-hour timestamp yields slower travel times.", "Behavioral: differing timestamps change ETAs."] });

F("options.routing.truck_size", "Truck dimensions \"height,width,length\" in cm. mode=truck only.",
  "String \"H,W,L\" in centimeters. Requires mode=truck.",
  { c: ["Requires mode=truck.", "Format \"height,width,length\" in cm."],
    v: ["truck_size with mode != truck -> 400.", "Malformed size string -> 400."],
    t: ["Positive: \"400,250,1600\" with mode=truck.", "Negative: truck_size with mode=car -> 400."],
    rel: ["options.routing.mode"], rules: ["routing-mode-gating"] });

F("options.routing.truck_weight", "Total truck weight in kg (incl. trailers/goods). mode=truck only.",
  "Integer kg. Requires mode=truck.",
  { c: ["Requires mode=truck.", "Positive integer kg."],
    v: ["truck_weight with mode != truck -> 400."],
    t: ["Positive: 18000 kg with mode=truck.", "Negative: truck_weight with mode=bike -> 400."],
    rel: ["options.routing.mode"], rules: ["routing-mode-gating"] });

F("options.routing.avoid", "SOFT road features to avoid where possible (ferry avoided by default).",
  "Array enum: toll | highway | bbox | left_turn | right_turn | sharp_turn | uturn | service_road | ferry | none. Case-sensitive. bbox is a hard geo filter.",
  { c: ["Values from the enum set; case-sensitive."],
    b: ["Soft preference EXCEPT bbox, which hard-filters to a bounding box (min_lat,min_lon,max_lat,max_lon)."],
    v: ["A value outside the enum -> 400."],
    t: ["Positive: avoid [\"toll\",\"highway\"].", "Negative: avoid [\"Toll\"] (wrong case) -> 400."],
    rel: ["options.routing.exclude"] });

F("options.routing.exclude", "HARD road features to exclude; if no feasible route remains, the request fails.",
  "Array enum: toll | highway | ferry | service_road | uturn | sharp_turn | left_turn | right_turn | none. ferry excluded by default.",
  { c: ["Values from the enum set."],
    b: ["Hard filter: unlike avoid, a route MUST honor it. If none exists -> 4xx."],
    v: ["A value outside the enum -> 400.", "No feasible route under the exclusions -> 4xx."],
    t: ["Positive: exclude [\"toll\"].", "Negative: exclusions that leave no route -> 4xx."],
    rel: ["options.routing.avoid"] });

F("options.routing.disable_cache", "If true, do not reuse the 60-minute cached travel matrix.",
  "Boolean. Default false.",
  { t: ["Boundary: default false (cache reused).", "Behavioral: true forces fresh matrix computation (slower, current data)."] });

F("options.routing.hazmat_type", "Hazardous-material categories for truck routing restrictions. mode=truck only.",
  "Array enum: explosives | gas | flammable_liquid | flammable_gas | organic | toxic | radioactive | corrosive | other. Requires mode=truck.",
  { c: ["Requires mode=truck.", "Values from the enum set."],
    v: ["hazmat_type with mode != truck -> 400.", "A value outside the enum -> 400."],
    t: ["Positive: [\"flammable_liquid\"] with mode=truck routes around restrictions.",
        "Negative: hazmat_type with mode=car -> 400."],
    rel: ["options.routing.mode"], rules: ["routing-mode-gating"] });

F("options.routing.profiles", "Named routing profiles; each holds any options.routing property. Vehicles reference one via vehicles.profile.",
  "Object mapping profile name -> routing config. 'default' reserved; no nesting. Profile-count limit scales down with location count (15/6/2/1).",
  { c: ["'default' name is reserved.", "No nested profiles.", "Profile count limited by problem size."],
    v: ["A vehicle referencing an undefined profile -> 400.", "Nested profiles -> 400."],
    t: ["Positive: profiles {\"truck\": {mode:truck}} referenced by vehicles.profile.",
        "Negative: vehicles.profile naming a profile not defined here -> 400."],
    rel: ["vehicles.profile"] });

F("options.routing.allow", "Road features the vehicle is allowed to use (e.g. taxi lanes). mode=car only.",
  "Array enum: taxi. Requires mode=car.",
  { c: ["Requires mode=car.", "Only 'taxi' supported."],
    v: ["allow with mode != car -> 400."],
    t: ["Positive: allow [\"taxi\"] with mode=car.", "Negative: allow with mode=truck -> 400."],
    rel: ["options.routing.mode"], rules: ["routing-mode-gating"] });

F("options.routing.cross_border", "Allow international border crossing (North America only by default).",
  "Boolean.",
  { t: ["Positive: cross_border true enables cross-country routes.", "Boundary: default (no crossing)."] });

F("options.routing.truck_axle_load", "Tonnes per axle for truck routing. mode=truck only.",
  "Number (tonnes). Requires mode=truck.",
  { c: ["Requires mode=truck.", "Positive number."],
    v: ["truck_axle_load with mode != truck -> 400."],
    t: ["Positive: 11.5 with mode=truck.", "Negative: with mode=walk -> 400."],
    rel: ["options.routing.mode"], rules: ["routing-mode-gating"] });

// ---------- OPTIONS.GROUPING ------------------------------------------------
F("options.grouping", "Task/route grouping: cluster nearby tasks or bias routes by zone/proximity.",
  "Object: { order_grouping?, route_grouping?, proximity_factor? }.",
  { t: ["Positive: proximity_factor 0.5 for tighter routes."],
    rel: ["options.grouping.order_grouping", "options.grouping.route_grouping", "options.grouping.proximity_factor"] });

F("options.grouping.order_grouping", "Merge nearby tasks into a single stop.",
  "Object: { grouping_diameter }.",
  { t: ["Positive: group tasks within a small diameter into one stop."],
    rel: ["options.grouping.order_grouping.grouping_diameter"] });

F("options.grouping.order_grouping.grouping_diameter", "Radius (meters) within which tasks are grouped into one stop.",
  "Number, meters. Default null (no grouping).",
  { c: ["Non-negative number (meters)."],
    t: ["Positive: grouping_diameter 50 merges same-building tasks.", "Boundary: null/absent -> no grouping."] });

F("options.grouping.route_grouping", "Bias routes to respect zones (system or custom).",
  "Object: { zone_source, zone_ids?, zone_diameter?, penalty_factor? }.",
  { c: ["zone_source=custom_definition requires zones[] to be defined."],
    t: ["Positive: route_grouping with system_generated zones."],
    rel: ["options.grouping.route_grouping.zone_source", "zones"] });

F("options.grouping.route_grouping.zone_source", "Where zone definitions come from for route grouping.",
  "Enum: system_generated (default) | custom_definition (requires zones[]).",
  { c: ["custom_definition requires a zones[] array."],
    v: ["zone_source=custom_definition without zones -> 400.", "A value outside the enum -> 400."],
    t: ["Positive: system_generated (no zones needed).", "Negative: custom_definition without zones -> 400."],
    rel: ["zones"] });

F("options.grouping.route_grouping.zone_ids", "Restrict route grouping to specific zone IDs.",
  "Array of integer zone IDs.",
  { t: ["Positive: limit grouping to zones [1,2]."], rel: ["zones"] });

F("options.grouping.route_grouping.zone_diameter", "Diameter (meters) for system-generated zones.",
  "Number, meters. Default 1000.",
  { c: ["Non-negative number (meters)."], t: ["Boundary: default 1000m; smaller -> more, tighter zones."] });

F("options.grouping.route_grouping.penalty_factor", "Penalty weight for crossing zone boundaries.",
  "Number. Default 0.",
  { t: ["Behavioral: higher penalty_factor keeps routes inside their zone."] });

F("options.grouping.proximity_factor", "Bias toward tighter neighbor distances; higher = more, tighter routes.",
  "Number in [0,10] (recommend [0,1]). Default 0.",
  { c: ["Range [0,10]."],
    v: ["proximity_factor outside [0,10] -> 400."],
    t: ["Boundary: 0 (off) and 1 (recommended max); 11 -> 400."] });

// ---------- OPTIONS.WEBHOOK -------------------------------------------------
F("options.webhook", "Async status callback configuration.",
  "Object: { url, events, timeout }.",
  { t: ["Positive: webhook to an HTTPS endpoint for JOB_COMPLETED."],
    rel: ["options.webhook.url", "options.webhook.events"] });

F("options.webhook.url", "HTTP(S) endpoint the solver POSTs status events to.",
  "String URL (HTTP or HTTPS).",
  { c: ["Must be a valid HTTP(S) URL."],
    v: ["A malformed URL -> 400."],
    t: ["Positive: https callback URL.", "Negative: not-a-url -> 400."],
    rel: ["options.webhook.events"] });

F("options.webhook.events", "Which lifecycle events trigger a webhook POST.",
  "Array enum: JOB_COMPLETED | JOB_FAILED (docs also mention JOB_CREATED).",
  { v: ["A value outside the enum set -> 400."],
    t: ["Positive: [\"JOB_COMPLETED\",\"JOB_FAILED\"].", "Negative: an unknown event -> 400."],
    rel: ["options.webhook.url"] });

F("options.webhook.timeout", "Webhook request timeout (seconds); up to 3 retries.",
  "Integer seconds. Default 10. Range [1,60].",
  { c: ["Range [1,60]."],
    v: ["timeout outside [1,60] -> 400."],
    t: ["Boundary: 1 and 60 valid; 0 / 61 -> 400."] });

// ---------- DEPOTS (C7) ----------------------------------------------------
F("depots", "Depot definitions used as start/end anchors and pickup/delivery sources for jobs.",
  "Array of depot objects. Each requires id + location_index.",
  { c: ["Each depot requires id and location_index."],
    v: ["A depot without location_index -> 400."],
    t: ["Positive: two depots referenced by vehicles' start/end_depot_ids.",
        "Negative: a depot missing location_index -> 400."],
    rel: ["depots.location_index", "vehicles.start_depot_ids"], rules: ["multi-depot-reachability"] });

F("depots.location_index", "Index into locations.location where the depot sits. Required.",
  "Required integer in [0, len(location)).",
  { c: ["Required.", "Range [0, len(location))."],
    v: ["Missing/out of range -> 400."],
    t: ["Positive: valid index.", "Negative: out of range -> 400."],
    rel: ["locations.location"], rules: ["location-index-range"] });

F("depots.time_windows", "Operational windows during which the depot can be used.",
  "Array of [start,end] Unix-second pairs; non-overlapping.",
  { c: ["Each start <= end; non-overlapping."],
    b: ["A vehicle must start/reload at the depot within one of its windows."],
    t: ["Infeasible: a reload needed outside all depot windows -> task unassigned."],
    rel: ["depots.service"], rules: ["time-window-feasibility"] });

F("depots.service", "Load/unload time incurred each time a vehicle starts or arrives at the depot.",
  "Non-negative integer seconds. Default 0.",
  { c: ["Non-negative integer seconds."],
    b: ["Adds to route time on each depot visit; interacts with duration/shift caps on reloads."],
    t: ["Positive: depot service 600.", "Interaction: with max_depot_runs, service accrues per run."],
    rel: ["vehicles.max_depot_runs"] });

F("depots.throughput", "Depot loading-rate limits (soft). Ineffective with max_depot_runs or relations.",
  "Object: { handling_duration?, max_vehicles?, vehicle_penalty?, max_load?, load_penalty? }.",
  { c: ["Ineffective when max_depot_runs or relations is used."],
    b: ["max_vehicles needs vehicle_penalty; max_load needs load_penalty — both soft."],
    t: ["Positive: throughput limiting concurrent vehicles at a depot.",
        "Interaction: with max_depot_runs set, throughput has no effect."],
    rel: ["depots.throughput.max_vehicles", "vehicles.max_depot_runs"] });

F("depots.throughput.handling_duration", "Per-vehicle handling time at the depot (seconds).",
  "Integer seconds. Default 0.",
  { c: ["Non-negative integer seconds."], t: ["Positive: handling_duration 300 per vehicle."],
    rel: ["depots.throughput"] });

F("depots.throughput.max_vehicles", "Soft cap on concurrent vehicles at the depot; needs vehicle_penalty.",
  "Integer. Soft — requires vehicle_penalty to take effect.",
  { c: ["Requires vehicle_penalty to be effective."],
    t: ["Behavioral: exceeding max_vehicles incurs vehicle_penalty, not rejection."],
    rel: ["depots.throughput.vehicle_penalty"] });

F("depots.throughput.vehicle_penalty", "Penalty per vehicle over max_vehicles at the depot.",
  "Integer.",
  { t: ["Behavioral: higher penalty spreads vehicles across depots/time."],
    rel: ["depots.throughput.max_vehicles"] });

F("depots.throughput.max_load", "Soft cap on total load handled at the depot (per dimension); needs load_penalty.",
  "Array of integers, dimensions match capacity. Soft — requires load_penalty.",
  { c: ["Dimension count matches capacity.", "Requires load_penalty."],
    t: ["Behavioral: load beyond max_load incurs load_penalty."],
    rel: ["depots.throughput.load_penalty", "vehicles.capacity"] });

F("depots.throughput.load_penalty", "Per-unit penalty for load over max_load (per dimension).",
  "Array of integers, dimensions match max_load.",
  { c: ["Dimension count matches max_load."],
    t: ["Behavioral: scales with load overshoot at the depot."],
    rel: ["depots.throughput.max_load"] });

// ---------- RELATIONS ------------------------------------------------------
F("relations", "Hard ordering/grouping relations between tasks; disable soft constraints and can force unassignment.",
  "Array of relation objects. type + steps required. An unsatisfiable relation flags all its tasks unassigned.",
  { c: ["Each relation requires type and steps.", "A vehicle can't be reused across relations."],
    b: ["When relations are present, options.constraint soft penalties are ineffective.",
        "If a relation cannot be satisfied, ALL its tasks go to result.unassigned."],
    v: ["A relation missing type or steps -> 400."],
    t: ["Positive: in_sequence relation over three jobs.",
        "Infeasible: a precedence relation whose order can't be met -> all its tasks unassigned."],
    rel: ["relations.type", "relations.steps", "options.constraint"], rules: ["relations-supersede-soft"] });

F("relations.type", "The kind of relation constraint. Required.",
  "Required enum: in_same_route | in_sequence | in_direct_sequence | precedence (exactly 2 steps) | pinned (requires vehicle).",
  { c: ["Required.", "precedence needs exactly 2 steps.", "pinned requires a vehicle."],
    v: ["A value outside the enum -> 400.", "precedence with != 2 steps -> 400.", "pinned without vehicle -> 400."],
    t: ["Positive: each type with valid steps.", "Negative: pinned without vehicle -> 400."],
    rel: ["relations.steps", "relations.vehicle"] });

F("relations.steps", "The ordered task steps the relation binds. Required.",
  "Required array of { type, id } objects. Step type: start | end | job | pickup | delivery (id required except start/end).",
  { c: ["Required.", "Each step needs a type; id required except for start/end."],
    v: ["A job/pickup/delivery step without id -> 400."],
    t: ["Positive: steps [{type:job,id:J1},{type:job,id:J2}].", "Negative: a job step missing id -> 400."],
    rel: ["relations.steps.type"] });

F("relations.steps.type", "The type of an individual step within a relation.",
  "Required enum: start | end | job | pickup | delivery.",
  { c: ["Required."],
    v: ["A value outside the enum -> 400."],
    t: ["Positive: pickup/delivery steps referencing a shipment.", "Negative: an unknown step type -> 400."] });

F("relations.vehicle", "Vehicle ID the relation is pinned to; mandatory for type=pinned.",
  "String vehicle id. Required when type=pinned. A vehicle can't be reused across relations.",
  { c: ["Required for pinned.", "Same vehicle can't appear in more than one relation."],
    v: ["pinned without vehicle -> 400.", "A vehicle reused across relations -> 400."],
    t: ["Positive: pinned relation binding tasks to V1.", "Negative: two relations pinning the same vehicle -> 400."],
    rel: ["relations.type"] });

F("relations.max_duration", "Max allowed duration between the related steps (seconds).",
  "Integer seconds.",
  { c: ["Non-negative integer seconds.", "max_duration >= min_duration when both set."],
    t: ["Positive: cap the gap between a pickup and its delivery.",
        "Infeasible: max_duration smaller than the unavoidable gap -> tasks unassigned."],
    rel: ["relations.min_duration"] });

F("relations.min_duration", "Min required duration between the related steps (seconds).",
  "Integer seconds.",
  { c: ["Non-negative integer seconds.", "min_duration <= max_duration when both set."],
    v: ["min_duration > max_duration -> 400."],
    t: ["Positive: enforce a minimum dwell between steps.", "Negative: min_duration > max_duration -> 400."],
    rel: ["relations.max_duration"] });

// ---------- MATRICES -------------------------------------------------------
F("cost_matrix", "Custom N×N travel-cost matrix over the location array; used only when travel_cost=customized.",
  "Array of integer arrays, N×N where N = len(locations.location). Effective only with options.objective.travel_cost=customized.",
  { c: ["Square N×N over locations.location.", "Effective only when travel_cost=customized."],
    v: ["Non-square / wrong-N matrix -> 400.", "cost_matrix without travel_cost=customized is ignored."],
    t: ["Positive: N×N cost_matrix with travel_cost=customized.", "Negative: N×(N-1) matrix -> 400."],
    rel: ["options.objective.travel_cost"], rules: ["objective-cost-mode-consistency"] });

F("distance_matrix", "Custom N×N distances (meters) overriding real distances; REQUIRES duration_matrix.",
  "Array of integer arrays, N×N (meters). Must be accompanied by duration_matrix.",
  { c: ["Square N×N over locations.location.", "Requires duration_matrix to also be provided."],
    v: ["distance_matrix without duration_matrix -> 400.", "Non-square matrix -> 400."],
    t: ["Positive: distance_matrix + duration_matrix together.", "Negative: distance_matrix alone -> 400."],
    rel: ["duration_matrix"], rules: ["matrix-pairing"] });

F("duration_matrix", "Custom N×N durations (seconds) overriding real travel times.",
  "Array of integer arrays, N×N (seconds).",
  { c: ["Square N×N over locations.location."],
    v: ["Non-square / wrong-N matrix -> 400."],
    t: ["Positive: duration_matrix overrides computed times.",
        "Boundary: matrix dimension must equal len(locations.location)."],
    rel: ["distance_matrix"], rules: ["matrix-pairing"] });

// ---------- NEW RULES (Tier 2) ---------------------------------------------
const rules = [
  { id: "objective-cost-mode-consistency",
    summary: "The travel_cost mode must be consistent with the cost inputs: customized needs cost_matrix; per_km needs distance; per_hour needs duration.",
    applies_to: ["options.objective.travel_cost", "cost_matrix", "vehicles.costs.per_km", "vehicles.costs.per_hour"],
    rule: "options.objective.travel_cost=customized requires a cost_matrix (else 400). vehicles.costs.per_km is effective only when travel_cost=distance; vehicles.costs.per_hour only when travel_cost=duration; per_km and per_hour are mutually exclusive on a vehicle.",
    testingGuidance: [
      "Negative: travel_cost=customized without cost_matrix -> 400.",
      "Behavioral: per_km cost ignored unless travel_cost=distance." ],
    status: "proposed" },
  { id: "matrix-pairing",
    summary: "Custom matrices must be square N×N over the location array; a distance_matrix requires a duration_matrix.",
    applies_to: ["distance_matrix", "duration_matrix", "cost_matrix", "locations.location"],
    rule: "Every custom matrix must be N×N where N = len(locations.location). Providing distance_matrix WITHOUT duration_matrix is a validation error (400). A cost_matrix is honored only when travel_cost=customized.",
    testingGuidance: [
      "Negative: distance_matrix supplied alone -> 400.",
      "Negative: an N×(N-1) matrix -> 400." ],
    status: "proposed" },
  { id: "routing-mode-gating",
    summary: "Mode-specific routing attributes are only valid for their mode (truck attrs need mode=truck; allow=taxi needs mode=car).",
    applies_to: ["options.routing.mode", "options.routing.truck_size", "options.routing.truck_weight", "options.routing.hazmat_type", "options.routing.truck_axle_load", "options.routing.allow"],
    rule: "truck_size, truck_weight, hazmat_type, and truck_axle_load require options.routing.mode=truck; allow=[taxi] requires mode=car. Supplying a mode-specific attribute under the wrong mode is a validation error (400).",
    testingGuidance: [
      "Negative: truck_weight with mode=car -> 400.",
      "Negative: allow=[taxi] with mode=truck -> 400." ],
    status: "proposed" },
  { id: "relations-supersede-soft",
    summary: "When relations are present, options.constraint soft penalties (and sequence_order/throughput) become ineffective; an unsatisfiable relation unassigns all its tasks.",
    applies_to: ["relations", "options.constraint", "jobs.sequence_order", "depots.throughput"],
    rule: "Relations are hard constraints. While any relation is present, options.constraint soft penalties, jobs.sequence_order soft enforcement, and depots.throughput limits are ineffective. If a relation cannot be satisfied, ALL tasks referenced by that relation are placed in result.unassigned (still HTTP 200).",
    testingGuidance: [
      "Interaction: with a relation set, raising visit_lateness_penalty has no effect.",
      "Infeasible: an in_direct_sequence relation whose ordering is impossible -> all its tasks unassigned." ],
    status: "proposed" },
];

// ---------- write ----------------------------------------------------------
let fw = 0, rw = 0, skip = 0;
for (const f of feats) {
  const fp = join(ENRICH, f.path + ".json");
  if (existsSync(fp)) { const prior = JSON.parse(readFileSync(fp, "utf8")); if (prior.status !== "proposed") { skip++; continue; } }
  writeFileSync(fp, JSON.stringify(f, null, 2) + "\n"); fw++;
}
for (const r of rules) {
  const fp = join(RULES, r.id + ".json");
  if (existsSync(fp)) { skip++; continue; }
  writeFileSync(fp, JSON.stringify(r, null, 2) + "\n"); rw++;
}
console.log(`✓ Tier 2: wrote ${fw} proposed enrichment file(s) + ${rw} rule file(s)${skip ? `, skipped ${skip} existing` : ""}.`);
console.log(`  then: node qa-studio/compile.mjs`);
