# Enum Reference — NextBillion.ai Route Optimization (`POST /optimization/v2`)

Every field in the optimization request that has a fixed set of allowed values. Generated from
`openapi.json` (backtick artifacts stripped). Use these exact values when authoring "specific" test
cases per enum value.

> The Studio shows these inline in the feature tree, and injects the enum values of your **selected**
> fields into the generated Claude prompt (so it produces one case per value). This file is a static
> copy for quick reference.

| # | Field path | Kind | Allowed values |
|---|---|---|---|
| 1 | `locations.approaches` | array of enum | `unrestricted` · `curb` · `""` (empty) |
| 2 | `jobs.volume.alignment` | enum | `strict` · `parallel` · `fixed_bottom` · `" "` (skip check) |
| 3 | `shipments.volume.alignment` | enum | `strict` · `parallel` · `fixed_bottom` · `" "` (skip check) |
| 4 | `options.objective.travel_cost` | enum | `duration` · `distance` · `air_distance` · `customized` |
| 5 | `options.objective.custom.type` | enum | `min` · `min-max` |
| 6 | `options.objective.custom.value` | enum | `vehicles` · `completion_time` · `travel_cost` · `tasks` |
| 7 | `options.routing.mode` | enum | `car` · `truck` · `motorcycle` · `bike` · `walk` |
| 8 | `options.routing.avoid` | array of enum | `toll` · `highway` · `bbox` · `left_turn` · `right_turn` · `sharp_turn` · `uturn` · `service_road` · `ferry` · `none` |
| 9 | `options.routing.exclude` | array of enum | `toll` · `highway` · `ferry` · `service_road` · `uturn` · `sharp_turn` · `left_turn` · `right_turn` · `none` |
| 10 | `options.routing.hazmat_type` | array of enum | `explosives` · `gas` · `flammable_liquid` · `flammable_gas` · `organic` · `toxic` · `radioactive` · `corrosive` · `other` |
| 11 | `options.routing.allow` | array of enum | `taxi` |
| 12 | `options.grouping.route_grouping.zone_source` | enum | `system_generated` · `custom_definition` |
| 13 | `options.webhook.events` | array of enum | `JOB_COMPLETED` · `JOB_FAILED` |
| 14 | `solution.steps.type` | enum | `start` · `end` · `job` · `pickup` · `delivery` · `break` |
| 15 | `relations.type` | enum | `in_same_route` · `in_sequence` · `in_direct_sequence` · `precedence` · `pinned` |
| 16 | `relations.steps.type` | enum | `start` · `end` · `job` · `pickup` · `delivery` |
| 17 | `zones.geometry.type` | enum | `Polygon` · `MultiPolygon` |

## Notes for test design

- **Positive per value:** for each enum field you select, generate one Positive case per allowed value
  (e.g. four cases for `travel_cost`, five for routing `mode`). The Studio's prompt now asks Claude for
  exactly this.
- **Negative (invalid enum):** send a value **outside** the list (e.g. `travel_cost: "fastest"`,
  `mode: "teleport"`) → expect **`400` input validation failed** at submit.
- **Mode-gated fields:** `truck_size`, `truck_weight`, `hazmat_type`, `truck_axle_load` are only effective
  when `options.routing.mode = "truck"`; `allow: ["taxi"]` only when `mode = "car"`. Pair them accordingly.
- **Array-of-enum** fields (`approaches`, `avoid`, `exclude`, `hazmat_type`, `allow`, `webhook.events`)
  take a list — a case can combine several values, and a negative case can include one invalid entry.
- **Coordinate-order caveat** (unrelated to enums): `zones.geometry.coordinates` use `[longitude, latitude]`
  (GeoJSON), unlike the `"latitude, longitude"` strings elsewhere.
