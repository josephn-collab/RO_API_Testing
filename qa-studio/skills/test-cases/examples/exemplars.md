# Exemplars — FORMAT REFERENCE ONLY

The three elements below show the **shape and rigor** expected of output. Their field values are
**illustrative only** — do not copy them. Real values come from the injected knowledge, scenario,
and coordinate pool. (Coordinates here are placeholders; use the pool the prompt provides.)

The first two exemplars are at the **small** scale tier (1 vehicle, 1-2 jobs); the third demonstrates
the **medium** scale tier to show how cases scale when assigned a larger tier.

```json
[
  {
    "testCaseId": "TC-RO-POS-001",
    "feature": "Capacity Constraint",
    "title": "Single vehicle serves demand within capacity",
    "description": "A feasible single-vehicle plan is returned when total demand fits capacity.",
    "testData": {
      "locations": { "location": ["<lat, lon A>", "<lat, lon B>"] },
      "vehicles": [{ "id": "V1", "start_index": 0, "capacity": [100] }],
      "jobs": [{ "id": "J1", "location_index": 1, "delivery": [40] }]
    },
    "details": { "features": ["vehicles.capacity", "jobs.delivery"], "archetype": "positive" },
    "expectedResult": "200; result.code==0; J1 assigned; result.unassigned empty; onboard load <= 100 at every step",
    "priority": "P2",
    "type": "Positive"
  },
  {
    "testCaseId": "TC-RO-NEG-001",
    "feature": "Capacity Constraint",
    "title": "Demand exceeding every vehicle's capacity is unassigned",
    "description": "A single job whose demand exceeds all capacity is accepted but cannot be served.",
    "testData": {
      "locations": { "location": ["<lat, lon A>", "<lat, lon B>"] },
      "vehicles": [{ "id": "V1", "start_index": 0, "capacity": [50] }],
      "jobs": [{ "id": "J1", "location_index": 1, "delivery": [80] }]
    },
    "details": { "features": ["vehicles.capacity", "jobs.delivery"], "archetype": "negative" },
    "expectedResult": "200; result.code==0; J1 in result.unassigned with a capacity reason",
    "priority": "P2",
    "type": "Negative"
  },
  {
    "testCaseId": "TC-RO-POS-002",
    "feature": "Multi-Vehicle Load Balancing",
    "title": "Multiple vehicles share a larger fleet scenario within capacity bounds",
    "description": "With 3 vehicles and 8 jobs, the planner balances demand across the fleet. All jobs fit within per-vehicle capacities.",
    "testData": {
      "locations": { "location": ["<lat, lon A>", "<lat, lon B>", "<lat, lon C>", "<lat, lon D>"] },
      "vehicles": [
        { "id": "V1", "start_index": 0, "capacity": [100] },
        { "id": "V2", "start_index": 0, "capacity": [100] },
        { "id": "V3", "start_index": 0, "capacity": [100] }
      ],
      "jobs": [
        { "id": "J1", "location_index": 1, "delivery": [40] },
        { "id": "J2", "location_index": 2, "delivery": [35] },
        { "id": "J3", "location_index": 3, "delivery": [30] },
        { "id": "J4", "location_index": 1, "delivery": [25] },
        { "id": "J5", "location_index": 2, "delivery": [20] },
        { "id": "J6", "location_index": 3, "delivery": [15] },
        { "id": "J7", "location_index": 1, "delivery": [10] },
        { "id": "J8", "location_index": 2, "delivery": [5] }
      ]
    },
    "details": { "features": ["vehicles.capacity"], "archetype": "positive" },
    "expectedResult": "200; result.code==0; all 8 jobs assigned; onboard load on each vehicle <= 100 at every step",
    "priority": "P2",
    "type": "Positive"
  },
  {
    "testCaseId": "TC-RO-NEG-002",
    "feature": "Capacity Dimension Consistency",
    "title": "Job exceeds only volume dimension; weight within bounds",
    "description": "A job whose volume alone exceeds vehicle capacity, while weight stays within the same vehicle's weight limit, demonstrates that capacity is enforced per-dimension. Only the volume constraint is violated; the job is unassigned on that specific dimension violation.",
    "testData": {
      "locations": { "location": ["<lat, lon A>", "<lat, lon B>"] },
      "vehicles": [{ "id": "V1", "start_index": 0, "capacity": [150, 200] }],
      "jobs": [{ "id": "J1", "location_index": 1, "delivery": [80, 120] }]
    },
    "details": { "features": ["vehicles.capacity", "jobs.delivery", "capacity-dimension-consistency"], "archetype": "negative" },
    "expectedResult": "200; result.code==0; J1 in result.unassigned with a volume-dimension capacity reason; weight dimension (80) is within vehicle limit (150)",
    "priority": "P2",
    "type": "Negative"
  }
]
```

**Why exemplar 4 was added:** It demonstrates the enumerate-before-picking mechanism in Stage 2(b) of `_base/SKILL.md`. Rather than stopping at the simple "exceeds every vehicle" case (exemplar 2), this exemplar shows what emerges when you enumerate all dimension-combinations: single-dimension breach, multi-dimension breach, no breach. The case picks the one most specific to the injected `capacity-dimension-consistency` rule — a scenario where two distinct dimensions interact and only one breaches. The specificity (naming which dimension, why it fails, why the other succeeds) is what the new rubric criterion #5 ("specific to the documented mechanism") and the new Stage 3 self-critique check demand. This is the rigor win from a more systematic enumeration step.

---

## Exemplar 5 — Supporting Fields + Combination + Value Variation (Positive)

```json
{
  "testCaseId": "TC-RO-POS-003",
  "feature": "Skills + Time Window Interaction",
  "title": "High-priority job with rare skills fits tight time window with vehicle supporting both",
  "description": "A combination case testing skills requirement + time_window constraint together. Vehicle has skills [welding, electrical] and wide availability (08:00–18:00). Job requires [welding] within narrow window (10:00–12:00) AND high priority. This tests whether both constraints coexist correctly and priority doesn't override skill matching.",
  "testData": {
    "locations": { "location": ["<lat, lon A>", "<lat, lon B>"] },
    "vehicles": [
      {
        "id": "V1",
        "start_index": 0,
        "capacity": [500],
        "skills": ["welding", "electrical"],
        "time_window": [1785830400, 1785866400],
        "breaks": [{ "id": "break_1", "time_window": [1785848400, 1785852000] }],
        "priority": "high"
      }
    ],
    "jobs": [
      {
        "id": "J1",
        "location_index": 1,
        "delivery": [200],
        "skills": ["welding"],
        "time_windows": [[1785839200, 1785843600]],
        "priority": "high"
      }
    ],
    "options": {
      "objective": "minimize_cost",
      "constraint": { "vehicle_overtime_penalty": 50 }
    }
  },
  "details": { "features": ["vehicles.skills", "jobs.time_windows", "jobs.priority", "vehicles.breaks"], "archetype": "positive" },
  "expectedResult": "200; result.code==0; J1 assigned to V1; skill [welding] matched; service completes within job time_window [10:00–12:00]; vehicle respects break at 11:00–11:40",
  "priority": "P2",
  "type": "Positive"
}
```

**Why exemplar 5 was added:** It demonstrates all three reworked principles:

1. **Supporting fields included and varied**: The case includes `vehicles.breaks` (a supporting field for time-window cases), `vehicles.priority` (supporting context), and `options.constraint.vehicle_overtime_penalty` (supporting option). These are present **because** this is a realistic production request, not because they're under test.

2. **Combination case**: `details.features` lists four paths (`["vehicles.skills", "jobs.time_windows", "jobs.priority", "vehicles.breaks"]`), exercising multiple constraints **together in one request body**. The job's tight time window (10:00–12:00) overlaps with the vehicle's break (11:00–11:40), and both must be satisfied. This reveals whether the API correctly handles the interaction.

3. **Field value variation**: If this were part of a broader suite, subsequent cases would use:
   - Different time windows (e.g., overnight 20:00–04:00 in another case, full-day availability in a third).
   - Different priority values (low, medium in other cases, not all high).
   - Different skill combinations (one vehicle with no skills, another with all skills, this one with a subset).
   - Different break patterns (no breaks, multiple short breaks, one long break).
   This variation across cases reveals API behavior across the input space, not just one point.
