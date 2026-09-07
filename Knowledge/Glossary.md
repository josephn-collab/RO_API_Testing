# NextBillion.ai Route Optimization — Glossary

Alphabetized reference of route-optimization and QA terminology used across this knowledge base. Scope is the **Route Optimization API** (`/optimization/v2`, `/optimization/v2/result`, `/optimization/re_optimization`). Definitions are intentionally concise (1–3 sentences).

- **Coordinates:** `"latitude, longitude"` strings in `locations.location`, WGS84, referenced by integer `location_index`.
- **Units:** meters (distance), seconds (duration/timestamps, Unix epoch).
- **Base URL:** `https://api.nextbillion.io`.
- **Auth:** `key` query parameter.

---

| Term | Definition | Related |
|---|---|---|
| Amount | The load moved between a shipment's pickup and delivery (`shipments[].amount`), matched per dimension against capacity. | Route Optimization |
| API Key | Secret token passed as the `key` **query parameter** (`?key=…`) to authenticate every request. | Route Optimization |
| Approaches | Per-location curbside setting (`unrestricted` / `curb` / `""`) on `locations.approaches`. | Route Optimization |
| Arrival | The `steps[].arrival` timestamp (epoch seconds) at which a vehicle reaches a stop. | Route Optimization |
| Asynchronous Flow | The submit-then-poll model: `POST /optimization/v2` returns an `id`; `GET /optimization/v2/result` fetches the solution. | Route Optimization |
| Break | A mandatory driver rest scheduled within permitted time windows; appears as a `type:"break"` step. | Route Optimization |
| Capacity | Multi-dimensional maximum load a vehicle can carry (e.g. `[weight, volume]`). | Route Optimization |
| Coordinate | A `"latitude, longitude"` string in WGS84 identifying a point; tasks reference it by `location_index`. | Route Optimization |
| Cost | Weighted engine value comparing routes/assignments; used for optimization, not billing (`result.summary.cost`). | Route Optimization |
| Delivery | Load dropped at a job (`jobs[].delivery`), or a shipment step that must follow its pickup. | Route Optimization |
| Demand | The load a job adds (`pickup`) or drops (`delivery`), matched per dimension against capacity. | Route Optimization |
| Depot | A start/end/reload location referenced via `start_depot_ids` / `end_depot_ids` / `jobs[].depot_ids` or `start_index`/`end_index`. | Route Optimization |
| Distance | Travel distance in meters (`result.routes[].distance`, `result.summary.distance`). | Route Optimization |
| Duration | Drive time in seconds, excluding service/setup/waiting (`result.summary.duration`). | Route Optimization |
| ETA | Estimated time of arrival at a stop; the `steps[].arrival` value. | Route Optimization |
| Epoch Time | Absolute time in seconds since 1970-01-01 UTC, used for time windows and arrivals. | Route Optimization |
| Geometry | The route path encoded as a polyline string (`result.routes[].geometry`) that decodes to ordered coordinates. | Route Optimization |
| Idempotency | Property whereby repeating an identical request produces the same result and no duplicate side effects. | QA / API |
| Job | A single-location task (`jobs[]`) served once, located via `location_index`. | Route Optimization |
| Latitude | North–south coordinate in degrees, `-90` to `90`; the **first** value in a `"lat, lon"` string. | Route Optimization |
| Layover | A rest/wait step (`type:"layover"`) inserted into a route. | Route Optimization |
| `location_index` | Integer index into `locations.location` identifying where a task or vehicle is. | Route Optimization |
| Longitude | East–west coordinate in degrees, `-180` to `180`; the **second** value in a `"lat, lon"` string. | Route Optimization |
| Matrix | Table of pairwise travel times/distances; can be supplied via `duration_matrix` / `distance_matrix` / `cost_matrix`. | Route Optimization |
| Max Distance | Per-vehicle cap on total route distance in meters (`max_distance`). | Route Optimization |
| Max Stops / Max Tasks | Per-vehicle caps on stops (`max_stops`) or tasks (`max_tasks`) on a route. | Route Optimization |
| Max Travel Time | Per-vehicle cap on cumulative drive time in seconds (`max_travel_time`). | Route Optimization |
| Max Visit Lateness | Tolerated lateness vs a time window (`max_visit_lateness`), in seconds. | Route Optimization |
| Multi-Depot | A configuration where vehicles start/end at different depots (indices or depot IDs). | Route Optimization |
| Optimization | Assigning jobs/shipments to vehicles and ordering stops to minimize cost under constraints. | Route Optimization |
| Pickup | Load collected at a job (`jobs[].pickup`), or a shipment step that must precede its delivery. | Route Optimization |
| Polyline | Compact encoded string representing an ordered list of coordinates; the route geometry format. | Route Optimization |
| Priority | Job/shipment importance `0`–`100` deciding which tasks are served first when over-subscribed. | Route Optimization |
| Priority (Defect) | Order in which a defect should be fixed: P1 (highest) through P4 (lowest). | QA |
| Profile | Routing profile influencing speeds/allowed roads (`vehicles[].profile`, `options.routing`). | Route Optimization |
| Rate Limit | Cap on requests per time window; exceeding it is throttled (exact behavior TBC). | Route Optimization / API |
| Regression | Testing that verifies previously working behavior still works after a change. | QA |
| Re-optimization | Re-planning an existing solution via `POST /optimization/re_optimization` using `existing_request_id` and change sets. | Route Optimization |
| `result.code` | Status code inside the result: `0` = success; non-zero = internal error. | Route Optimization |
| Route | An ordered sequence of stops served by one vehicle (`result.routes[]`), with geometry, distance, duration. | Route Optimization |
| Route Balancing | Soft objective distributing load/time evenly across vehicles, configured via `options.objective`/`options.constraint`. | Route Optimization |
| Service Time | Dwell time in seconds spent performing a job at its stop (`service`), distinct from travel time. | Route Optimization |
| Setup Time | One-time preparation time at a stop (`setup`), separate from `service`. | Route Optimization |
| Severity | Impact classification of a defect: Critical (S1), High (S2), Medium (S3), Low (S4). | QA |
| Shipment | A pickup–delivery pair bound to the same vehicle with pickup sequenced before delivery (`shipments[]`). | Route Optimization |
| Skill | A capability tag (refrigeration, hazmat, tail-lift); a vehicle's `skills` must be a superset of a task's. | Route Optimization |
| SLA / SLO | Committed / target availability, latency, or throughput levels (specific numbers TBC). | QA / API |
| Smoke Test | A quick shallow test confirming core functionality works before deeper testing. | QA |
| Status | The response `status` string; `Ok` on success at submit/result. | Route Optimization |
| Step | An individual stop entry (`start`/`job`/`pickup`/`delivery`/`break`/`layover`/`end`) within an output route. | Route Optimization |
| Summary | Aggregated totals (cost, distance, duration, routes, unassigned, …) in `result.summary`. | Route Optimization |
| Time Window | An allowed interval `[start, end]` (epoch seconds) during which a task may be serviced. | Route Optimization |
| Traceability Matrix | A grid mapping requirements (REQ) to test cases (TC) to prove coverage. | QA |
| TSP | Travelling Salesman Problem: ordering stops for a single vehicle to minimize total travel. | Route Optimization |
| Unassigned | A task the optimizer could not serve under the constraints, returned in `result.unassigned[]` with a `reason`. | Route Optimization |
| Vehicle | A fleet resource (truck, van, courier) with capacity, skills, shift, and start/end anchors (`vehicles[]`). | Route Optimization |
| VRP | Vehicle Routing Problem: assigning many tasks to a fleet under capacity, time, and skill constraints. | Route Optimization |
| Waiting Time | Idle time a vehicle spends before a time window opens, counted in route/working time, not travel. | Route Optimization |
| Warnings | Non-fatal input notes (`warnings[]`) returned on the submit acknowledgement. | Route Optimization |
| WGS84 | The World Geodetic System 1984 datum used for all coordinates. | Route Optimization |
