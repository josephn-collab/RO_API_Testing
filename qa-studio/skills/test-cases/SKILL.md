---
name: test-case-generator
description: Authoring layer for NextBillion.ai Route Optimization test cases. Extends the QA authoring base with the test-case workflow and output contract. Holds no product knowledge — API facts, fields, and business rules are injected at generation time.
---

# Test Case Generator (authoring layer)

> **Prerequisite:** follow the QA Authoring Base (`_base/SKILL.md`) first — role, the
> Knowledge-Fidelity Contract, the Intake section, the reasoning protocol, and the self-critique pass all apply here.
> This file adds only the **test-case workflow** and points at the **output contract** and
> **assertion rubric**. It contains **no API facts, field lists, or business rules** — those
> arrive in the injected knowledge blocks (product/API facts, per-feature enrichment & rules,
> scenario, coordinates).

## Responsibilities (what this file owns)

| Concern | Owner | Reference |
|---|---|---|
| Output shape + field list | **output-contract.md** | read before Step 3 |
| Assertion quality bar | **rubric.md** | read before Step 4 |
| Pre-emit gate + rigor checks | **checklist.md** | run before Step 5 |
| How to reason at the per-case level | **This file** (Steps 1–5) | read once, fully, at the start |

## What This Skill Does

Turns a selected set of API features + a scenario into a schema-valid suite of Positive and Negative
test cases, each case fully grounded in authored coverage knowledge. The workflow is triggered
whenever QA Studio provides a scenario (region, vehicle/job counts, test types) + selected features
+ a per-feature allocation + compiled enrichment/rules. Output is always a JSON array, validated
against the OpenAPI request schema.

## Required Inputs

QA Studio always provides these knowledge blocks — treat them as authoritative per the Knowledge-Fidelity Contract:

1. **API facts** — endpoints, auth, success/error HTTP statuses, error codes, flow constraints
2. **Scenario** — region, vehicle count, job count, shipment count, selected test types (Positive / Negative), test subjects, supporting fields
3. **Scale tiers** — concrete vehicle/job counts for small/medium/large scenarios, and which cases get which tier
4. **Enrichment & rules for selected features** — per-feature testingGuidance (positive/negative/boundary/interaction aspects), related paths, cross-field rules
5. **Allocation** — how many cases each test subject receives (computed from its authored obligations and a suite-wide 90/10 Positive/Negative ratio), plus which cases are scale-meaningful
6. **Coordinate pool** — sampled locations (lat/lon) for the region
7. **Supporting fields block** — which fields are supporting (populate them, never test them)

## Step 1 — Intake

Read all injected knowledge blocks once, fully. If running conversationally and any block is
missing or ambiguous, ask the most structurally-important clarifying question (refer to your
Knowledge-Fidelity Contract's Intake section). Otherwise proceed to Step 2.

## Step 2 — Analysis Before Writing

For each test subject (the fields under test):

1. **Enumerate the full candidate pool** — list every distinct equivalence class / boundary / special
   case the injected knowledge offers:
   - Every `testingGuidance` bullet (positive / negative / boundary / interaction).
   - Every boundary / special value in `constraints` and `validationRules`.
   - Every cross-field rules block naming this subject.
   - Every allocation interaction-hint involving this subject.
   Do **not** stop at the first valid/invalid pair. This enumeration is the foundation of every
   subsequent choice.

2. **Map the pool against the allocation** — do you have authored depth to sustain the allocated
   count, or will some aspects go unexercised?

3. **Rank by risk** — if the allocation is less than the number of distinct candidates, rank by the
   4-tier risk order from `_base/SKILL.md` (capacity/safety → cost → data integrity → unreachable).
   Explicitly note which candidates are being dropped and why.

4. **Mine every rules-backed unit as a combination-case candidate** — every rule naming 2+ subjects
   and every allocation interaction-hint is a required lead. Do not skip.

5. **Plan field-value variation across all cases** — ensure that when the same field appears in 
   multiple cases, it carries **different values** across those cases. For example:
   - If `vehicles.capacity.weight` is under test, use different weight values (e.g., 1000 in one case,
     5000 in another, near-limit in a third).
   - If `time_windows` is under test, use different time ranges (e.g., 08:00–18:00 in one, 20:00–04:00
     in another, tight 2-hour window in a third).
   - If `priority` is under test, use different priority levels (High, Medium, Low) across cases.
   This variation reveals API behavior differences and is essential for analyzing API efficacy.
   Plan now which values you'll use for each case so they differ meaningfully.

6. **Note the scale tier** — if an aspect's case allocation includes a scale tier (medium/large from
   the Scale tiers block), plan to build that case at that tier's vehicle/job counts instead of
   defaulting to the minimal (1v/1-2j) size. This affects how you populate the vehicles and jobs
   arrays, but doesn't change the tested behavior — it just provides broader context.

7. **Trace every location_index** — make sure each coordinate you pick is resolvable within that
   case's own `locations.location` array.

8. **Identify supporting fields and their inclusion strategy** — review the "Supporting Fields"
   block injected in the prompt. For each supporting field, decide:
   - Which object type it belongs to (vehicles, jobs, shipments, locations, or options)?
   - What realistic values it should carry in each case (different across cases, not identical)?
   - How it interacts with the test subject (does it constrain, enable, or provide context)?
   Plan to include applicable supporting fields in **every single case**, with varied values matching
   the case's scenario.

Do **not** write any output yet. This is the analysis pass.

## Step 3 — Output Structure & Format

Each case has exactly the fields in `output-contract.md` (included with this skill) — **exactly those fields, in exactly that order, and nothing before or after the array**. Read `output-contract.md` before writing.

## Step 4 — Assertion Quality & Craft

Turn each analyzed aspect into a case whose Expected Result is machine-checkable and invariant-based.
The rules for what makes an assertion good are in `rubric.md` (included with this skill). The Craft
Rules in `_base/SKILL.md` (One assertion focus, Risk first, Partition then bound, Prefer documented
truth, Determinism) apply to every case. Refer to both.

## Step 5 — Final Checklist

Before emitting, run through `checklist.md` (included with this skill) and confirm every item passes.
Do not emit until all checks are ✓.

---

## Test subjects vs supporting fields

The selected fields arrive in two roles, and they are **not interchangeable**:

- **Test subjects** — the fields under test. Every case exists to exercise one of these (or, for a
  combination case, several together). Only these carry an allocation.
- **Supporting fields** — listed in the injected supporting-fields block. Populate them with
  realistic values in every request body where they apply, so the payloads look like production
  traffic. **Never author a case whose purpose is to test one**, and never list one alone in
  `details.features`.

The allocation is a **ceiling**: it may be smaller than the number of aspects a subject has
authored. If so, choose the highest-risk aspects first (per the Craft Rules). Never invent cases to
reach a larger number — a shorter, fully-grounded suite is the correct output.

### Supporting fields — mandatory inclusion

**Every test case MUST include applicable supporting fields**, using realistic, **varied** values across cases.
This is not optional — supporting fields provide essential context that makes test payloads production-like and
reveals how the API behaves when features interact.

**Inclusion rules:**
- If a supporting field applies to an object your case contains (e.g., `vehicles.skills` applies when
  the body has vehicles), **you must populate it**. Never create a request with vehicles but omit skills.
- If a supporting field doesn't apply (e.g., a job-level field when your case has no jobs), skip it.
- For each supporting field across your suite, use **different values** in different cases:
  - `vehicles.skills`: one case with ["skill_A", "skill_B"], another with ["skill_C"], a third with ["skill_A", "skill_C", "skill_D"].
  - `time_windows`: one case with 08:00–18:00, another with 14:00–20:00, a third with overnight 20:00–06:00.
  - `priority`: one case with "high", another with "medium", a third with "low".
  This variation is essential for analyzing API behavior across realistic input combinations.

**Where supporting fields live in the request:**
- Vehicle-level: `vehicles[].skills`, `vehicles[].time_window`, `vehicles[].shift_rotation`, `vehicles[].breaks`, etc.
- Job-level: `jobs[].skills`, `jobs[].time_windows`, `jobs[].priority`, `jobs[].service_time`, etc.
- Shipment-level: `shipments[].priority`, `shipments[].amount`, etc.
- Relation-level: `relations[].type`, `relations[].vehicle`, etc.
- Options-level: `options.objective`, `options.constraint.*`, `options.routing_mode`, etc.

See the injected **"Enrichment & rules"** block for the exact list and their definitions in this run.

## Categories (exactly two)

Author only the categories present in the scenario's selected test types:

- **Positive** — valid requests, including valid *at-the-limit* values. Every case `Type = Positive`.
- **Negative** — either invalid/malformed input (rejected at submit) **or** valid-but-infeasible
  input (accepted, then surfaced as unassigned / unsolvable). Every case `Type = Negative`.

There are **no other categories**. Boundary, invalid, and infeasible scenarios are authored *as*
Positive or Negative cases — never as separate test types. Use `details.archetype` to tag the
scenario kind (`positive` | `negative`) for the coverage matrix.

---

## Combination cases — testing multiple targets together

**What:** A combination case exercises **two or more test subjects together in the same request body**,
revealing how the API behaves when features interact.

**Why:** A single feature might pass all tests in isolation, but fail or behave unexpectedly when
combined with another feature. Combination cases catch these interaction bugs and help you analyze
API efficacy across realistic feature mixes.

**How to author a combination case:**

1. **Select 2+ test subjects** from the allocation interaction-hint (listed in the prompt). These
   are the documented pairs/groups expected to interact.
2. **Design ONE request body** that exercises multiple test subjects **simultaneously**:
   - If combining "vehicles.capacity" and "jobs.priority", craft a job-set where a high-priority
     job strains the vehicle's capacity limit, testing both constraints at once.
   - If combining "time_windows" and "skills", craft a job that has both a tight time window AND
     a rare skill requirement, so both constraints are active in the same route.
   - **Do not** create separate jobs for each feature — combine them into single, realistic scenarios.
3. **Set `details.features`** to the list of subjects being combined: `["vehicles.capacity", "jobs.priority"]`.
4. **Write an Expected Result** that verifies the interaction: e.g., "200; job assigned **because**
   high priority overrides soft capacity constraints" or "200 + unassigned; job unassigned **because**
   no vehicle satisfies both tight time window AND required skill".

**Value variation in combination cases:**
- Use **different combinations** across your allocated combination cases, not the same pair repeatedly.
- Vary the feature values even within the combination: if combining capacity + priority, use
  (medium capacity + high priority) in one case, (tight capacity + low priority) in another, (tight
  capacity + high priority) in a third.
- This breadth reveals how different feature *mixes* affect the API.

**Mark them:** Include `"details.features": ["path1", "path2", ...]` with all subjects exercised.
The allocation block tells you how many combination cases to author; spend them on **distinct
interaction scenarios**, not repetitions of the same feature pair.

---

## Dynamic Timestamp Generation (time_window values)

When populating `time_window` fields (on vehicles or jobs), use epoch timestamps (seconds since Unix epoch)
relative to today's date at generation time. This ensures test cases are always valid and realistic.

### Calculation method

1. **Get today's epoch at 00:00 UTC** — the number of seconds since Unix epoch (1970-01-01 00:00:00 UTC)
   to today at midnight.
   
2. **Add offsets for specific times of day:**
   - 04:00 (4 AM) = `today_epoch + 14400`
   - 08:00 (8 AM) = `today_epoch + 28800`
   - 12:00 (noon) = `today_epoch + 43200`
   - 14:00 (2 PM) = `today_epoch + 50400`
   - 18:00 (6 PM) = `today_epoch + 64800`
   - 20:00 (8 PM) = `today_epoch + 72000`
   - 23:59 (end of day) = `today_epoch + 86399`

3. **For multi-day scenarios**, add multiples of 86400 (seconds per day):
   - Tomorrow = `today_epoch + 86400`
   - Day after = `today_epoch + 172800`

### Example

If today is 2026-08-04 and `today_epoch = 1785801600`:

- Vehicle available 08:00–18:00: `"time_window": [1785830400, 1785866400]`
- Job available 14:00–17:00: `"time_window": [1785852000, 1785862800]`
- Overnight window (20:00 today–04:00 tomorrow): split into two cases or handle via `time_window` extension

### Regeneration

Each time the prompt is executed, recalculate `today_epoch` for the current date and regenerate all
time_window values. This ensures test cases are always relative to "today" and remain consistent
across runs on different dates.

---

## One-to-Many Deliveries (Draft Feature) — Schema Requirements

When authoring test cases for **one-to-many shipments** (`shipments.deliveries`), follow this schema strictly:

### Structure

Each shipment uses **either** `delivery` (singular) **or** `deliveries` (array) — **never both, never neither**.

**For one-to-many shipments:**
```json
{
  "pickup": { "id": "PU1", "location_index": 0, "time_windows": [[...]] },
  "deliveries": [
    {
      "id": "D1",
      "location_index": 1,
      "time_windows": [[...]],          // optional
      "amount": [100],                   // REQUIRED — per-delivery amount
      "service": 300                     // optional
    },
    {
      "id": "D2",
      "location_index": 2,
      "time_windows": [[...]],
      "amount": [80]                     // REQUIRED
    }
  ],
  "amount": [180],                       // Shipment-level total (sum of delivery amounts)
  "skills": []
}
```

**For singular shipments (backward compatibility):**
```json
{
  "pickup": { "id": "PU1", "location_index": 0, "time_windows": [[...]] },
  "delivery": {
    "id": "D1",
    "location_index": 1,
    "time_windows": [[...]]
  },
  "amount": [100],
  "skills": []
}
```

### Critical Rules

1. **`deliveries` array requirements:**
   - Minimum 2 items (use singular `delivery` for 1-to-1 shipments)
   - Each delivery **must have `id`, `location_index`, and `amount`** — all three required
   - `amount` is an array of numbers; dimensionality must match `shipment.amount`

2. **Amount consistency:**
   - `SUM(deliveries[].amount)` **must equal `shipment.amount`** dimension-by-dimension
   - Example: if `shipment.amount = [180]`, then `D1.amount[0] + D2.amount[0] + ... = 180`
   - Example: if `shipment.amount = [300, 600]` (weight, volume), then `D1.amount = [100, 200]`, `D2.amount = [100, 200]`, `D3.amount = [100, 200]`

3. **ID uniqueness:**
   - All delivery IDs must be unique within the shipment
   - Pickup ID must not match any delivery ID

4. **Mutual exclusivity:**
   - If `deliveries` is present, `delivery` must NOT be present
   - Attempting to use both returns HTTP 400

5. **Joint assignment:**
   - All deliveries are assigned or unassigned as a unit
   - If any delivery is infeasible (capacity, time window, skills), the entire shipment is unassigned
   - No partial delivery is possible

### Load Progression Example

For a shipment with `amount: [180]`, three deliveries `[100, 50, 30]`:
- Start: vehicle load = 0
- Pickup PU1: vehicle load = 180
- Delivery D1 (100): vehicle load = 80
- Delivery D2 (50): vehicle load = 30
- Delivery D3 (30): vehicle load = 0

### Checklist for One-to-Many Cases

Before emitting a one-to-many test case:
- [ ] Shipment uses `deliveries` array (not `delivery`)
- [ ] `deliveries` has **at least 2 items**
- [ ] **Every delivery has `id`, `location_index`, and `amount`**
- [ ] Sum of all `deliveries[].amount` values **equals `shipment.amount`** per dimension
- [ ] All delivery IDs are unique (no duplicates)
- [ ] Pickup ID does not match any delivery ID
- [ ] Negative cases test the actual constraint violation (not "both delivery and deliveries present" unless that's the case under test)
- [ ] Case is tagged with `"draft": true` in details (if feature is in draft state)
