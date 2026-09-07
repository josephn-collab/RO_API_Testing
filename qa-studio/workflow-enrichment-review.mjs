export const meta = {
  name: 'phase1-enrichment-deep-review',
  description: 'Generate Phase 1 enrichment review with deep spec analysis and comprehensive testingGuidance',
  phases: [
    { title: 'Analyze', detail: '8 parallel agents analyze spec deeply for each domain' },
    { title: 'Assemble', detail: 'Collect agent results and write 8 domain CSVs' },
  ],
}

// Phase 1: Analyze with parallel agents
phase('Analyze')

// Domain configs
const domainConfigs = {
  vehicles: { prefix: 'VEH', domainName: 'vehicles' },
  jobs: { prefix: 'JOB', domainName: 'jobs' },
  shipments: { prefix: 'SHP', domainName: 'shipments' },
  options: { prefix: 'OPT', domainName: 'options' },
  relations: { prefix: 'REL', domainName: 'relations' },
  depots: { prefix: 'DEP', domainName: 'depots' },
  zones: { prefix: 'ZON', domainName: 'zones' },
  'locations-matrices': { prefix: 'LOC', domainName: 'locations-matrices' },
}

const AGENT_PROMPT = (domain, prefix, pathList) => `
You are a QA domain expert analyzing the NextBillion.ai Route Optimization API specification to propose comprehensive enrichment for testing.

## Your Domain: ${domain.toUpperCase()}

Analyze the following ${pathList.length} enriched fields in the ${domain} domain. For each, propose COMPLETE replacement enrichment with deep testingGuidance coverage.

### The ${domain} Paths
${pathList.map(p => `- ${p}`).join('\n')}

### What to Generate for Each Path

For each path, return enrichment with these sections:

1. **summary** (1 row): One-liner based on OpenAPI spec description
2. **range** (1 row): Value bounds, cardinality, structure
3. **constraints** (3–8 rows): Hard limits from spec and relationships
4. **businessRules** (3–8 rows): Soft rules, best practices, interactions
5. **validationRules** (3–8 rows): Input validation errors (HTTP 400/422)
6. **testingGuidance** (12–25 rows): Test scenarios covering:
   - EVERY enum value if applicable
   - Range boundaries: min, max, zero, negative, non-integer
   - Required vs optional — what if field is missing?
   - Cross-field interactions and rule precedence
   - Format and pattern validation

### Tagging testingGuidance

Each guidance bullet MUST start with exactly ONE tag:
- **Positive:** Valid case that should succeed
- **Boundary:** Valid edge case (at limits, all-zeros, maximums)
- **Negative-validation:** Malformed input → HTTP 400 at submit
- **Negative-infeasible:** Valid structure but impossible to solve → HTTP 200 + result.unassigned or HTTP 422
- **Interaction:** Cross-field constraint — drives combination test cases

### Origin Values
- **kept** — existing text from enrichment, good as-is
- **reworded** — same idea, improved wording
- **new** — new scenario not in current enrichment

### Output Format

Return a valid JSON array (and ONLY the JSON, no preamble):

[
  {
    "path": "vehicles.capacity",
    "field": "summary",
    "items": [
      {
        "origin": "kept",
        "text": "Multi-dimensional maximum load a vehicle can carry."
      }
    ]
  },
  {
    "path": "vehicles.capacity",
    "field": "testingGuidance",
    "items": [
      {
        "origin": "kept",
        "text": "Positive: capacity [100] with single delivery [40]"
      },
      {
        "origin": "new",
        "text": "Boundary: zero capacity [0] - always accepts zero-quantity tasks"
      },
      {
        "origin": "new",
        "text": "Negative-validation: negative capacity [-5] → HTTP 400 input validation failed"
      },
      {
        "origin": "new",
        "text": "Interaction: capacity dimension count must match all delivery/pickup/amount arrays per capacity-dimension-consistency rule"
      }
    ]
  }
]

---

Think deeply. For testingGuidance:
- Cover EVERY enum value
- Cover ALL boundaries (min, max, zero, negative)
- Cover required vs optional
- Link to applicable rules
- Ensure variety: positive, boundary, negative-validation, negative-infeasible, interaction

Remember: you are proposing comprehensive testing coverage based on the OpenAPI spec. Be thorough.
`

// Path lists per domain
const pathsByDomain = {
  vehicles: ['vehicles', 'vehicles.allowed_zones', 'vehicles.alternative_capacities', 'vehicles.breaks', 'vehicles.breaks.service', 'vehicles.breaks.time_windows', 'vehicles.capacity', 'vehicles.costs', 'vehicles.costs.deadhead_distance_penalty', 'vehicles.costs.deadhead_duration_penalty', 'vehicles.costs.fixed', 'vehicles.costs.min_stop_load_fixed_penalty', 'vehicles.costs.min_stop_load_unit_penalty', 'vehicles.costs.per_hour', 'vehicles.costs.per_km', 'vehicles.costs.per_order', 'vehicles.depot', 'vehicles.end_depot_ids', 'vehicles.end_index', 'vehicles.layover_config', 'vehicles.layover_config.include_service_time', 'vehicles.layover_config.layover_duration', 'vehicles.layover_config.max_continuous_time', 'vehicles.max_deadhead_distance', 'vehicles.max_deadhead_duration', 'vehicles.max_depot_runs', 'vehicles.max_distance', 'vehicles.max_stops', 'vehicles.max_tasks', 'vehicles.max_travel_cost', 'vehicles.max_travel_time', 'vehicles.max_working_time', 'vehicles.min_stop_load', 'vehicles.profile', 'vehicles.restricted_zones', 'vehicles.skills', 'vehicles.speed_factor', 'vehicles.start_depot_ids', 'vehicles.start_index', 'vehicles.time_window', 'vehicles.volume', 'vehicles.volume.depth', 'vehicles.volume.height', 'vehicles.volume.width'],
  jobs: ['jobs', 'jobs.delivery', 'jobs.depot_ids', 'jobs.follow_lifo_order', 'jobs.incompatible_load_types', 'jobs.joint_order', 'jobs.load_types', 'jobs.location_index', 'jobs.max_visit_lateness', 'jobs.outsourcing_cost', 'jobs.pickup', 'jobs.priority', 'jobs.revenue', 'jobs.sequence_order', 'jobs.service', 'jobs.setup', 'jobs.skills', 'jobs.time_windows', 'jobs.volume', 'jobs.volume.alignment', 'jobs.volume.depth', 'jobs.volume.height', 'jobs.volume.width', 'jobs.zones'],
  shipments: ['shipments', 'shipments.amount', 'shipments.delivery', 'shipments.delivery.location_index', 'shipments.delivery.max_visit_lateness', 'shipments.delivery.sequence_order', 'shipments.delivery.service', 'shipments.delivery.setup', 'shipments.delivery.time_windows', 'shipments.follow_lifo_order', 'shipments.incompatible_load_types', 'shipments.joint_order', 'shipments.load_types', 'shipments.max_time_in_vehicle', 'shipments.outsourcing_cost', 'shipments.pickup', 'shipments.pickup.location_index', 'shipments.pickup.max_visit_lateness', 'shipments.pickup.sequence_order', 'shipments.pickup.service', 'shipments.pickup.setup', 'shipments.pickup.time_windows', 'shipments.priority', 'shipments.revenue', 'shipments.skills', 'shipments.volume', 'shipments.volume.alignment', 'shipments.volume.depth', 'shipments.volume.height', 'shipments.volume.width', 'shipments.zones'],
  options: ['options', 'options.constraint', 'options.constraint.max_vehicle_overtime', 'options.constraint.max_visit_lateness', 'options.constraint.sequence_order_penalty', 'options.constraint.vehicle_overtime_penalty', 'options.constraint.visit_lateness_penalty', 'options.grouping', 'options.grouping.order_grouping', 'options.grouping.order_grouping.grouping_diameter', 'options.grouping.proximity_factor', 'options.grouping.route_grouping', 'options.grouping.route_grouping.penalty_factor', 'options.grouping.route_grouping.zone_diameter', 'options.grouping.route_grouping.zone_ids', 'options.grouping.route_grouping.zone_source', 'options.objective', 'options.objective.allow_early_arrival', 'options.objective.custom', 'options.objective.custom.type', 'options.objective.custom.value', 'options.objective.solving_time_limit', 'options.objective.travel_cost', 'options.routing', 'options.routing.allow', 'options.routing.avoid', 'options.routing.cross_border', 'options.routing.disable_cache', 'options.routing.exclude', 'options.routing.hazmat_type', 'options.routing.mode', 'options.routing.profiles', 'options.routing.traffic_timestamp', 'options.routing.truck_axle_load', 'options.routing.truck_size', 'options.routing.truck_weight', 'options.webhook', 'options.webhook.events', 'options.webhook.timeout', 'options.webhook.url'],
  relations: ['relations', 'relations.max_duration', 'relations.min_duration', 'relations.steps', 'relations.steps.id', 'relations.steps.type', 'relations.type', 'relations.vehicle'],
  depots: ['depots', 'depots.location_index', 'depots.service', 'depots.throughput', 'depots.throughput.handling_duration', 'depots.throughput.load_penalty', 'depots.throughput.max_load', 'depots.throughput.max_vehicles', 'depots.throughput.vehicle_penalty', 'depots.time_windows'],
  zones: ['zones', 'zones.geofence_id', 'zones.geometry', 'zones.geometry.coordinates', 'zones.geometry.type'],
  'locations-matrices': ['locations', 'locations.approaches', 'locations.location', 'cost_matrix', 'distance_matrix', 'duration_matrix'],
}

const agents = await parallel(Object.entries(domainConfigs).map(([domain, config]) => () => {
  const pathList = pathsByDomain[domain] || []
  return agent(
    AGENT_PROMPT(domain, config.prefix, pathList),
    {
      label: `analyze:${domain}`,
      phase: 'Analyze',
      schema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            field: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  origin: { enum: ['kept', 'reworded', 'new'] },
                  text: { type: 'string' },
                },
                required: ['origin', 'text'],
              },
            },
          },
          required: ['path', 'field', 'items'],
        },
      },
    }
  )
    .then(result => result ? { domain, results: result } : null)
    .catch(err => {
      log(`Agent ${domain} failed`)
      return null
    })
}))

const validResults = agents.filter(Boolean)
log(`Got results from ${validResults.length} agents`)

// Phase 2: Assemble CSVs
phase('Assemble')

// Helper to escape CSV values
function escapeCSV(val) {
  if (val === null || val === undefined) return ''
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s
}

// Extract category tag from text
function extractTag(text) {
  const s = String(text || '').trim()
  if (/^Positive:/i.test(s)) return 'Positive'
  if (/^Boundary:/i.test(s)) return 'Boundary'
  if (/^Negative[-\s]*validation:/i.test(s)) return 'Negative-validation'
  if (/^Negative[-\s]*infeasible:/i.test(s) || /^Infeasible:/i.test(s)) return 'Negative-infeasible'
  if (/^Interaction:/i.test(s)) return 'Interaction'
  return ''
}

// Build CSVs
const csvOutput = {}
let totalRows = 0

for (const { domain, results } of validResults) {
  const config = domainConfigs[domain]
  if (!config) continue

  const rows = []
  let rowCounter = 1

  for (const fieldResult of results) {
    const { path, field, items } = fieldResult
    if (!Array.isArray(items)) continue

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const rowId = `${config.prefix}-${String(rowCounter).padStart(3, '0')}`
      const itemIndex = ['summary', 'range'].includes(field) ? 1 : i + 1

      rows.push({
        row_id: rowId,
        path,
        field,
        item_index: String(itemIndex),
        origin: item.origin || 'new',
        category_tag: field === 'testingGuidance' ? extractTag(item.text) : '',
        current_text: item.origin === 'kept' ? item.text : '',
        suggested_text: item.text,
        rationale: 'Deep spec analysis',
        decision: '',
        sme_notes: '',
      })
      rowCounter++
    }
  }

  // Write CSV
  const headers = [
    'row_id', 'path', 'field', 'item_index', 'origin', 'category_tag',
    'current_text', 'suggested_text', 'rationale', 'decision', 'sme_notes'
  ]

  const lines = [headers.join(',')]
  for (const row of rows) {
    const values = headers.map(h => escapeCSV(row[h]))
    lines.push(values.join(','))
  }

  const fileName = {
    vehicles: 'vehicles.csv',
    jobs: 'jobs.csv',
    shipments: 'shipments.csv',
    options: 'options.csv',
    relations: 'relations.csv',
    depots: 'depots.csv',
    zones: 'zones.csv',
    'locations-matrices': 'locations-matrices.csv',
  }[domain]

  csvOutput[fileName] = lines.join('\n') + '\n'
  totalRows += rows.length
}

log(`Generated ${totalRows} enrichment review rows`)

return csvOutput
