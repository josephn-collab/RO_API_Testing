#!/usr/bin/env node
// =============================================================================
// Tier 1 FILL — the remaining Tier-1-area features missed in the first pass
// =============================================================================
// Completes enrichment coverage for vehicles / jobs / shipments / locations / zones:
// container objects + costs/breaks/layover/volume/deadhead leaves + all shipment
// step + shipment-level fields. All status:"proposed" (parked until ratified).
// Grounded in RouteOptimizationOverview.md §3.2–3.4 + OptimizationConstraints.md.
// Run: node qa-studio/tier1-fill.mjs   then  node qa-studio/compile.mjs
// =============================================================================
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const ENRICH = join(DIR, "enrichment");
mkdirSync(ENRICH, { recursive: true });

const feats = [];
const F = (path, summary, range, o = {}) => feats.push({
  path, summary, range,
  constraints: o.c || [], businessRules: o.b || [], validationRules: o.v || [],
  testingGuidance: o.t || [], related: o.rel || [], rules: o.rules || [],
  status: "proposed", _source: o.src || "RouteOptimizationOverview.md §3.2–3.4 + OptimizationConstraints.md",
});

// ---------- CONTAINER OBJECTS (array/object parents) -----------------------
F("locations", "The container object holding the coordinate array (and optional per-location approaches). Required.",
  "Object: { id?, location (required), approaches? }.",
  { c: ["Required.", "Must contain a non-empty location array."],
    v: ["Missing locations -> 400.", "Empty location array -> 400."],
    t: ["Positive: locations with a valid location array.", "Negative: request without locations -> 400."],
    rel: ["locations.location", "locations.approaches"] });

F("vehicles", "The fleet array; at least one vehicle is required. Each entry is a vehicle with capacity/skills/shift/anchors.",
  "Array of vehicle objects; length >= 1. Each requires id.",
  { c: ["Required.", "At least one vehicle."],
    v: ["Missing or empty vehicles -> 400.", "A vehicle without id -> 400."],
    t: ["Positive: one well-formed vehicle.", "Negative: empty vehicles array -> 400."],
    rel: ["vehicles.capacity", "vehicles.skills", "vehicles.time_window"] });

F("jobs", "Array of single-location tasks. Provide jobs and/or shipments (at least one of the two required).",
  "Array of job objects. Each requires id + location_index.",
  { c: ["At least one of jobs / shipments must be present.", "Each job requires id and location_index."],
    v: ["Neither jobs nor shipments present -> 400.", "A job without location_index -> 400."],
    t: ["Positive: a few feasible jobs.", "Negative: request with neither jobs nor shipments -> 400."],
    rel: ["jobs.location_index", "shipments"] });

F("shipments", "Array of paired pickup+delivery tasks bound to one vehicle (pickup before delivery). Provide jobs and/or shipments.",
  "Array of shipment objects. Each requires pickup and delivery sub-objects.",
  { c: ["At least one of jobs / shipments must be present.", "Each shipment requires both pickup and delivery."],
    v: ["A shipment missing pickup or delivery -> 400."],
    t: ["Positive: a feasible pickup->delivery shipment.", "Negative: a shipment with only a pickup -> 400."],
    rel: ["shipments.pickup", "shipments.delivery", "shipments.amount"], rules: ["pickup-delivery-precedence"] });

F("shipments.pickup", "The pickup step of a shipment: where/when the load is collected. Required.",
  "Object: { id (req), location_index (req), service?, time_windows?, setup?, sequence_order?, max_visit_lateness? }.",
  { c: ["Required.", "Requires id and location_index."],
    b: ["Served by the same vehicle as its delivery, and BEFORE the delivery step (C4)."],
    v: ["Missing pickup -> 400.", "Duplicate pickup/delivery id -> 400."],
    t: ["Positive: pickup with a valid location_index and window.",
        "Infeasible: pickup window strictly after the delivery window -> pair unassigned."],
    rel: ["shipments.delivery", "shipments.pickup.location_index"], rules: ["pickup-delivery-precedence"] });

F("shipments.delivery", "The delivery step of a shipment: where/when the load is dropped. Required, occurs after the pickup.",
  "Object: { id (req), location_index (req), service?, time_windows?, setup?, sequence_order?, max_visit_lateness? }.",
  { c: ["Required.", "Requires id and location_index."],
    b: ["Occurs after the pickup on the same vehicle; may share the pickup's location_index (zero-distance)."],
    v: ["Missing delivery -> 400."],
    t: ["Positive: delivery reachable after pickup.",
        "Infeasible: delivery window unreachable after pickup+travel -> both steps unassigned."],
    rel: ["shipments.pickup", "shipments.delivery.location_index"], rules: ["pickup-delivery-precedence"] });

F("zones", "Array of geographic zone definitions; tasks/vehicles reference zones by integer id for eligibility.",
  "Array of zone objects. Each requires id + (geometry OR geofence_id).",
  { c: ["Each zone requires id and exactly one of geometry / geofence_id."],
    v: ["A zone with neither geometry nor geofence_id -> 400."],
    t: ["Positive: a Polygon zone referenced by a job's zones.", "Negative: a zone missing both geometry and geofence_id -> 400."],
    rel: ["zones.geometry", "zones.geofence_id", "jobs.zones"], rules: ["zone-eligibility"] });

F("zones.geometry", "Inline GeoJSON geometry for a zone (alternative to geofence_id).",
  "Object: { type (Polygon|MultiPolygon), coordinates }. coordinates use [longitude, latitude] (GeoJSON order — the one lon/lat exception).",
  { c: ["type is Polygon or MultiPolygon.", "coordinates are [lon, lat] GeoJSON rings."],
    v: ["A type outside {Polygon, MultiPolygon} -> 400.", "Malformed coordinate ring -> 400."],
    t: ["Positive: a closed Polygon ring.", "Negative: an unclosed ring / wrong type -> 400."],
    rel: ["zones.geometry.type", "zones.geometry.coordinates"] });

F("zones.geometry.coordinates", "The coordinate rings of a zone polygon, in GeoJSON [longitude, latitude] order.",
  "Nested arrays of [lon, lat] pairs forming closed rings. NOTE: lon/lat order (opposite of locations.location).",
  { c: ["Each position is [longitude, latitude] (GeoJSON), not \"lat, lon\".", "Rings must be closed (first point == last)."],
    v: ["A non-closed ring -> 400.", "Out-of-range lon/lat -> 400."],
    t: ["Positive: a valid closed square ring.", "Negative: an open ring -> 400.",
        "Gotcha: authoring [lat, lon] here (wrong order) places the zone incorrectly."],
    rel: ["zones.geometry.type"] });

// ---------- VEHICLES: breaks (C2-adjacent) ---------------------------------
F("vehicles.breaks", "Mandatory driver breaks scheduled within permitted windows; appear as break steps in the route.",
  "Array of break objects. Only ONE of breaks / layover_config allowed per vehicle.",
  { c: ["Cannot be combined with layover_config on the same vehicle."],
    b: ["Each break must be scheduled inside one of its time_windows, which must lie within the vehicle's shift."],
    v: ["Both breaks and layover_config set -> 400."],
    t: ["Positive: one lunch break inside the shift.", "Negative: breaks + layover_config together -> 400.",
        "Infeasible: a break window outside the vehicle's time_window -> unschedulable."],
    rel: ["vehicles.breaks.time_windows", "vehicles.time_window", "vehicles.layover_config"], rules: ["time-window-feasibility"] });

F("vehicles.breaks.time_windows", "Allowed start slots for a driver break; must sit inside the vehicle's shift. Required on a break.",
  "Required array of [start,end] Unix-second pairs; non-overlapping; each within the vehicle's time_window.",
  { c: ["Required on each break.", "Non-overlapping; each window within vehicles.time_window."],
    v: ["A break window outside the shift -> unschedulable / infeasible.", "Overlapping break windows -> 400."],
    t: ["Positive: break window [43200,46800] inside a 09:00–17:00 shift.",
        "Infeasible: break window entirely outside the shift."],
    rel: ["vehicles.time_window", "vehicles.breaks.service"], rules: ["time-window-feasibility"] });

F("vehicles.breaks.service", "Duration of a driver break (seconds).",
  "Non-negative integer seconds. Default 0.",
  { c: ["Non-negative integer seconds."],
    b: ["Break duration adds to elapsed/working time and can push the route past the shift or max_working_time."],
    t: ["Positive: service 1800 (30-min break).",
        "Interaction: a long break inflates working time and can breach max_working_time (C6)."],
    rel: ["vehicles.max_working_time"], rules: ["max-duration-distance-cap"] });

// ---------- VEHICLES: costs -----------------------------------------------
F("vehicles.costs", "Per-vehicle cost configuration shaping which vehicle the solver prefers (soft — never forces infeasibility).",
  "Object: { fixed?, per_hour?, per_km?, per_order?, min_stop_load_*_penalty?, deadhead_*_penalty? }.",
  { b: ["Costs steer selection/ordering but never violate a hard constraint or force an otherwise-servable task unassigned."],
    t: ["Positive: fixed + per_km cost makes a cheaper vehicle preferred.",
        "Behavioral: raising fixed cost discourages using an extra vehicle."],
    rel: ["vehicles.costs.fixed", "vehicles.costs.per_km", "vehicles.costs.per_hour"] });

F("vehicles.costs.fixed", "Fixed cost of using the vehicle at all (added once if the vehicle is used).",
  "Integer. Default 0.",
  { b: ["Discourages using an extra vehicle unless it reduces total cost enough."],
    t: ["Behavioral: high fixed cost -> solver consolidates onto fewer vehicles.", "Boundary: fixed 0 (no usage penalty)."],
    rel: ["vehicles.costs"] });

F("vehicles.costs.per_hour", "Cost per hour of drive time; effective only when options.objective.travel_cost = duration.",
  "Integer. Default 3600. Mutually exclusive with per_km.",
  { c: ["Effective only when travel_cost = duration.", "Mutually exclusive with per_km."],
    v: ["per_hour and per_km both set -> 400."],
    t: ["Positive: per_hour cost with travel_cost=duration.", "Negative: per_hour + per_km together -> 400."],
    rel: ["vehicles.costs.per_km", "options.objective"] });

F("vehicles.costs.per_km", "Cost per km of distance; effective only when options.objective.travel_cost = distance.",
  "Integer. Mutually exclusive with per_hour.",
  { c: ["Effective only when travel_cost = distance.", "Mutually exclusive with per_hour."],
    v: ["per_km and per_hour both set -> 400."],
    t: ["Positive: per_km cost with travel_cost=distance.", "Negative: per_km + per_hour together -> 400."],
    rel: ["vehicles.costs.per_hour", "options.objective"] });

F("vehicles.costs.per_order", "Cost per fulfilled order (job or shipment); always added to route cost.",
  "Integer.",
  { t: ["Behavioral: per_order cost balances serving more orders against the extra cost."],
    rel: ["vehicles.costs"] });

F("vehicles.costs.min_stop_load_fixed_penalty", "Fixed penalty applied when any delivery stop's load is below min_stop_load.",
  "Integer.",
  { b: ["Triggered per stop that falls short of vehicles.min_stop_load; soft — does not force unassignment."],
    t: ["Behavioral: a delivery below min_stop_load still served but incurs this fixed penalty."],
    rel: ["vehicles.min_stop_load"] });

F("vehicles.costs.min_stop_load_unit_penalty", "Per-unit shortfall penalty vs min_stop_load (per dimension).",
  "Array of integers, one per capacity dimension.",
  { c: ["Same dimension count as min_stop_load / capacity."],
    b: ["Scales with how far below min_stop_load a delivery falls."],
    t: ["Behavioral: larger shortfall -> proportionally larger penalty."],
    rel: ["vehicles.min_stop_load"] });

F("vehicles.costs.deadhead_duration_penalty", "Penalty per unit of deadhead (empty-leg) duration beyond max_deadhead_duration.",
  "Integer. Default 0.",
  { b: ["Soft: discourages long empty first/last legs; pairs with max_deadhead_duration."],
    t: ["Behavioral: high penalty pushes vehicles to start/end nearer demand."],
    rel: ["vehicles.max_deadhead_duration"] });

F("vehicles.costs.deadhead_distance_penalty", "Penalty per unit of deadhead (empty-leg) distance beyond max_deadhead_distance.",
  "Integer. Default 0.",
  { b: ["Soft: discourages long empty first/last legs; pairs with max_deadhead_distance."],
    t: ["Behavioral: high penalty reduces empty-travel distance."],
    rel: ["vehicles.max_deadhead_distance"] });

// ---------- VEHICLES: layover / deadhead / volume / profile ----------------
F("vehicles.layover_config", "Continuous-driving limit plus a mandatory rest; alternative to breaks.",
  "Object: { max_continuous_time (req), layover_duration (req), include_service_time? }. Only ONE of breaks / layover_config.",
  { c: ["Requires max_continuous_time and layover_duration.", "Cannot combine with breaks."],
    v: ["Both layover_config and breaks set -> 400.", "Missing max_continuous_time or layover_duration -> 400."],
    t: ["Positive: rest after each max_continuous_time of driving.",
        "Negative: layover_config together with breaks -> 400."],
    rel: ["vehicles.layover_config.max_continuous_time", "vehicles.breaks"] });

F("vehicles.layover_config.max_continuous_time", "Max continuous driving time before a mandatory rest. Required within layover_config.",
  "Required non-negative integer seconds.",
  { c: ["Required.", "Non-negative integer seconds."],
    b: ["After this much continuous driving, a layover_duration rest is inserted."],
    t: ["Positive: max_continuous_time 16200 (4.5h) triggers a rest on long routes.",
        "Boundary: a route just under the limit takes no rest."],
    rel: ["vehicles.layover_config.layover_duration"] });

F("vehicles.layover_config.layover_duration", "Rest duration inserted after max_continuous_time. Required within layover_config.",
  "Required non-negative integer seconds.",
  { c: ["Required.", "Non-negative integer seconds."],
    b: ["Adds to elapsed/working time and can push a route past the shift or max_working_time."],
    t: ["Positive: layover_duration 2700 (45-min rest).",
        "Interaction: rest time can breach max_working_time on long routes (C6)."],
    rel: ["vehicles.layover_config.max_continuous_time", "vehicles.max_working_time"], rules: ["max-duration-distance-cap"] });

F("vehicles.layover_config.include_service_time", "Whether service time also counts toward continuous working time for layover.",
  "Boolean. Default false.",
  { t: ["Boundary: default false (only driving counts).", "Positive: true makes service count toward the continuous-time limit."],
    rel: ["vehicles.layover_config.max_continuous_time"] });

F("vehicles.max_deadhead_distance", "Soft cap on empty-travel distance on the first/last leg (meters).",
  "Integer meters. Cannot combine with max_depot_runs.",
  { c: ["Cannot combine with max_depot_runs."],
    b: ["Soft: overruns are penalized via costs.deadhead_distance_penalty, not hard-rejected."],
    v: ["max_deadhead_distance together with max_depot_runs -> 400."],
    t: ["Positive: modest deadhead cap keeps vehicles near demand.",
        "Negative: combined with max_depot_runs -> 400."],
    rel: ["vehicles.costs.deadhead_distance_penalty", "vehicles.max_depot_runs"] });

F("vehicles.max_deadhead_duration", "Soft cap on empty-travel duration on the first/last leg (seconds).",
  "Integer seconds. Cannot combine with max_depot_runs.",
  { c: ["Cannot combine with max_depot_runs."],
    b: ["Soft: overruns penalized via costs.deadhead_duration_penalty."],
    v: ["max_deadhead_duration together with max_depot_runs -> 400."],
    t: ["Positive: deadhead-duration cap.", "Negative: combined with max_depot_runs -> 400."],
    rel: ["vehicles.costs.deadhead_duration_penalty", "vehicles.max_depot_runs"] });

F("vehicles.profile", "Routing profile the vehicle uses; must be defined in options.routing.profiles.",
  "String profile name. Defaults to the default profile if omitted.",
  { c: ["If set, must match a profile defined under options.routing.profiles."],
    v: ["A profile name not defined in options.routing.profiles -> 400."],
    t: ["Positive: profile 'truck' defined in options.routing.profiles.",
        "Negative: an undefined profile name -> 400."],
    rel: ["options.routing"] });

F("vehicles.volume", "Loading-compartment dimensions of the vehicle; required for it to carry tasks that specify volume.",
  "Object: { width, depth, height } in meters.",
  { b: ["A vehicle WITHOUT volume cannot serve tasks that specify volume."],
    t: ["Positive: vehicle volume covers a job's volume.",
        "Infeasible: a job with volume but every vehicle lacks volume -> unassigned."],
    rel: ["vehicles.volume.width", "jobs.volume"] });

F("vehicles.volume.width", "Vehicle compartment width (meters).", "Number, meters.",
  { c: ["Non-negative number."], t: ["Boundary: width just fitting the widest cargo."], rel: ["vehicles.volume"] });
F("vehicles.volume.depth", "Vehicle compartment depth (meters).", "Number, meters.",
  { c: ["Non-negative number."], t: ["Boundary: depth just fitting the deepest cargo."], rel: ["vehicles.volume"] });
F("vehicles.volume.height", "Vehicle compartment height (meters).", "Number, meters.",
  { c: ["Non-negative number."], t: ["Boundary: height just fitting the tallest cargo."], rel: ["vehicles.volume"] });

F("vehicles.depot", "DEPRECATED — use start_depot_ids / end_depot_ids instead.",
  "Integer. Deprecated legacy depot reference.",
  { b: ["Deprecated: prefer start_depot_ids/end_depot_ids. Retained for backward compatibility."],
    t: ["Regression: confirm a legacy request using depot still behaves; migrate to start/end_depot_ids."],
    rel: ["vehicles.start_depot_ids"] });

F("vehicles.max_travel_cost", "DEPRECATED — use max_distance / max_travel_time instead.",
  "Integer. Deprecated legacy cap.",
  { b: ["Deprecated: prefer max_distance / max_travel_time."],
    t: ["Regression: legacy max_travel_cost still parsed; migrate to the modern caps."],
    rel: ["vehicles.max_distance", "vehicles.max_travel_time"] });

// ---------- JOBS: volume ----------------------------------------------------
F("jobs.volume", "Volumetric demand of the job; needs a vehicle that declares volume to be served.",
  "Object: { width, depth, height (meters), alignment }.",
  { b: ["A job with volume can only be served by a vehicle that declares volume large enough."],
    t: ["Positive: job volume fits a vehicle's compartment.",
        "Infeasible: job volume larger than any vehicle's -> unassigned."],
    rel: ["jobs.volume.width", "jobs.volume.alignment", "vehicles.volume"] });

F("jobs.volume.width", "Job cargo width (meters).", "Number, meters.",
  { c: ["Non-negative number."], t: ["Boundary: width equal to vehicle width fits; wider -> unassigned."], rel: ["jobs.volume"] });
F("jobs.volume.depth", "Job cargo depth (meters).", "Number, meters.",
  { c: ["Non-negative number."], t: ["Boundary: depth equal to vehicle depth fits."], rel: ["jobs.volume"] });
F("jobs.volume.height", "Job cargo height (meters).", "Number, meters.",
  { c: ["Non-negative number."], t: ["Boundary: height equal to vehicle height fits."], rel: ["jobs.volume"] });

// ---------- SHIPMENTS: step sub-fields -------------------------------------
F("shipments.pickup.service", "Service/dwell time at the pickup step (seconds).", "Non-negative integer seconds. Default 0.",
  { c: ["Non-negative integer seconds."], b: ["Extends pickup occupancy; counts toward working time and shipment onboard timing."],
    t: ["Positive: pickup service 300.", "Interaction: large pickup service can breach max_time_in_vehicle."],
    rel: ["shipments.max_time_in_vehicle"] });
F("shipments.pickup.setup", "One-time setup time at the pickup location (seconds).", "Non-negative integer seconds.",
  { c: ["Non-negative integer seconds."], t: ["Positive: pickup setup 60 applied once per location."], rel: ["shipments.pickup.service"] });
F("shipments.pickup.max_visit_lateness", "Tolerated lateness for the pickup step; overrides the global value.",
  "Non-negative integer seconds.",
  { c: ["Non-negative integer seconds."], b: ["Lateness beyond it makes the pickup (and the pair) infeasible."],
    t: ["Infeasible: pickup unreachable within its window + tolerance -> pair unassigned."],
    rel: ["shipments.pickup.time_windows"], rules: ["time-window-feasibility"] });

F("shipments.delivery.service", "Service/dwell time at the delivery step (seconds).", "Non-negative integer seconds. Default 0.",
  { c: ["Non-negative integer seconds."], t: ["Positive: delivery service 300."], rel: ["shipments.delivery.time_windows"] });
F("shipments.delivery.setup", "One-time setup time at the delivery location (seconds).", "Non-negative integer seconds.",
  { c: ["Non-negative integer seconds."], t: ["Positive: delivery setup 60."], rel: ["shipments.delivery.service"] });
F("shipments.delivery.sequence_order", "Ordering value of the delivery step; must be >= the pickup's sequence_order.",
  "Integer in [0,100]. delivery.sequence_order >= pickup.sequence_order.",
  { c: ["[0,100]; delivery value >= pickup value."],
    v: ["delivery.sequence_order < pickup.sequence_order -> 400."],
    t: ["Negative: delivery order less than pickup order -> 400."],
    rel: ["shipments.pickup.sequence_order"], rules: ["pickup-delivery-precedence"] });
F("shipments.delivery.max_visit_lateness", "Tolerated lateness for the delivery step; overrides the global value.",
  "Non-negative integer seconds.",
  { c: ["Non-negative integer seconds."], b: ["Lateness beyond it makes the delivery (and the pair) infeasible."],
    t: ["Infeasible: delivery unreachable within window + tolerance -> pair unassigned."],
    rel: ["shipments.delivery.time_windows"], rules: ["time-window-feasibility"] });

// ---------- SHIPMENTS: shipment-level fields (the ones you flagged) ---------
F("shipments.incompatible_load_types", "Load types that cannot share the vehicle's cargo history with this shipment.",
  "Array of string tags.",
  { b: ["If any onboard/scheduled load matches an incompatible type, the shipment can't be co-assigned."],
    t: ["Behavioral: a shipment incompatible with 'chemical' can't ride a vehicle carrying 'chemical'."],
    rel: ["shipments.load_types"], rules: ["load-type-compatibility"] });

F("shipments.revenue", "Revenue from completing the shipment; used in the profit trade-off. Cannot combine with outsourcing_cost.",
  "Integer. Mutually exclusive with outsourcing_cost.",
  { c: ["Cannot be set together with outsourcing_cost."],
    v: ["Both revenue and outsourcing_cost set -> 400."],
    t: ["Positive: revenue 800.", "Negative: revenue + outsourcing_cost together -> 400."],
    rel: ["shipments.outsourcing_cost"] });

F("shipments.outsourcing_cost", "Cost of leaving the shipment unassigned; overrides priority. Cannot combine with revenue.",
  "Integer. Overrides priority. Mutually exclusive with revenue.",
  { c: ["Cannot be set together with revenue."],
    b: ["A high outsourcing_cost makes the solver prefer serving this shipment over a higher-priority one."],
    v: ["Both outsourcing_cost and revenue set -> 400."],
    t: ["Behavioral: high outsourcing_cost shipment preferred over a higher-priority one for the last slot."],
    rel: ["shipments.priority", "shipments.revenue"], rules: ["priority-tiebreaker"] });

F("shipments.follow_lifo_order", "Enforce last-in-first-out loading/unloading for the shipment.",
  "Boolean. Default false.",
  { t: ["Positive: follow_lifo_order true respected across concurrent shipments.", "Boundary: default false."] });

F("shipments.volume", "Volumetric demand of the shipment; needs a vehicle that declares volume.",
  "Object: { width, depth, height (meters), alignment }.",
  { b: ["A shipment with volume can only ride a vehicle that declares sufficient volume."],
    t: ["Positive: shipment volume fits the vehicle.", "Infeasible: shipment volume larger than any vehicle's -> unassigned."],
    rel: ["shipments.volume.alignment", "vehicles.volume"] });

F("shipments.volume.width", "Shipment cargo width (meters).", "Number, meters.",
  { c: ["Non-negative number."], t: ["Boundary: width equal to vehicle width fits."], rel: ["shipments.volume"] });
F("shipments.volume.depth", "Shipment cargo depth (meters).", "Number, meters.",
  { c: ["Non-negative number."], t: ["Boundary: depth equal to vehicle depth fits."], rel: ["shipments.volume"] });
F("shipments.volume.height", "Shipment cargo height (meters).", "Number, meters.",
  { c: ["Non-negative number."], t: ["Boundary: height equal to vehicle height fits."], rel: ["shipments.volume"] });
F("shipments.volume.alignment", "Cargo alignment rule for the shipment's volumetric packing.",
  "Enum: strict | parallel | fixed_bottom | \" \" (default = skip check).",
  { v: ["A value outside the enum set -> 400."],
    t: ["Positive: alignment 'strict'.", "Boundary: default ' ' skips the check."],
    rel: ["shipments.volume"] });

F("shipments.joint_order", "Joint-order group ID; all tasks in the group are assigned together or none.",
  "Integer group ID.",
  { b: ["Atomic group: if any member is infeasible, the whole group is unassigned."],
    t: ["Positive: two shipments sharing joint_order 3 both assigned.",
        "Infeasible: one member of the group infeasible -> the whole group unassigned."] });

// ---------- write (never clobber a ratified file) --------------------------
let w = 0, skip = 0;
for (const f of feats) {
  const fp = join(ENRICH, f.path + ".json");
  if (existsSync(fp)) { const prior = JSON.parse(readFileSync(fp, "utf8")); if (prior.status !== "proposed") { skip++; continue; } }
  writeFileSync(fp, JSON.stringify(f, null, 2) + "\n"); w++;
}
console.log(`✓ Tier 1 fill: wrote ${w} proposed enrichment file(s)${skip ? `, skipped ${skip} ratified` : ""}.`);
console.log(`  then: node qa-studio/compile.mjs`);
