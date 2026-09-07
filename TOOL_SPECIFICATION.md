# QA Authoring Studio — Tool Specification & Release Document

**Product:** QA Authoring Studio (internal codename: *QA Studio*)
**Domain:** Test-case authoring for the NextBillion.ai **Route Optimization API** (`/optimization/v2`)
**Document type:** Feature & function specification / release notes
**Status:** Working build (local, no-server)
**Scope statement:** This tool **authors** test cases only. It does **not** execute them against the live API — execution is handled on a separate platform.

---

## 1. Executive summary

QA Studio is a lightweight, local, browser-based tool that turns a QA engineer's **feature selections** into a **complete, schema-valid suite of test cases** for the NextBillion.ai Route Optimization API.

It solves a specific problem: the Route Optimization API is enormous (**213 request fields**, deeply nested, with cross-field business rules), and hand-writing correct test cases for it is slow, inconsistent, and error-prone. QA Studio makes the API's own structure and rules the single source of truth, uses Claude to do the *reasoning* (which scenarios to write), and uses deterministic code to *validate* everything Claude produces.

**The three-part design principle:**
- **The Compiler owns the truth** — every product fact, field, constraint, and business rule.
- **Claude does the reasoning** — proposes which scenarios and values to test.
- **The app validates** — every generated payload is checked against the real API schema + business rules before a human trusts it.

---

## 2. The problem it solves (why it exists)

| Problem today | Consequence | How QA Studio addresses it |
|---|---|---|
| The API has 213 fields with complex interactions | Manual test design misses coverage and takes days | Feature tree + deterministic count plan drive complete, repeatable coverage |
| LLMs hallucinate field names, indices, enum values | "AI-generated" test data carries subtle defects found only at run time | Every payload is validated against the OpenAPI schema + business rules; defects are flagged before use |
| Product knowledge scattered across docs & people's heads | Test cases drift from the real API as it evolves | One machine-readable knowledge base compiled from the spec; the UI auto-syncs when the spec changes |
| Inconsistent test-case format across authors | Hard to review, import, or automate | A fixed 10-field output contract, enforced by the authoring layer |
| No record of *why* a suite looks the way it does | Cannot reproduce or audit a suite | Deterministic count plan + coverage matrix make coverage explicit and repeatable |

---

## 3. Architecture at a glance

```
   ┌──────────────────────────────────────────────────────────────┐
   │ COMPILER (single source of product truth)                     │
   │   openapi.json  +  enrichment/ (167 files)  +  rules/ (15)    │
   │        └── compile.mjs ──► data/compiled/ (features, graph)   │
   └───────────────────────────────┬──────────────────────────────┘
                                    │ compiled knowledge
                                    ▼
   ┌──────────────────────────────────────────────────────────────┐
   │ QA STUDIO APP (browser, no server/build)                      │
   │   Select features → Count plan → Assemble prompt →            │
   │   [paste into Claude] → Validate result → Render → Export CSV │
   └───────────────────────────────┬──────────────────────────────┘
                                    │ prepends
                                    ▼
   ┌──────────────────────────────────────────────────────────────┐
   │ SKILLS (authoring layer — how Claude reasons; no product facts)│
   │   _base/  +  test-cases/ (contract, rubric, exemplars)        │
   └──────────────────────────────────────────────────────────────┘
```

**End-to-end flow in one line:** pick features → app builds a versioned prompt from the compiled knowledge → Claude proposes cases → paste back → app validates against the real schema + rules → render + export.

---

## 4. Component-by-component specification

### 4.1 The Compiler — *owns all product knowledge*

**What it is:** the authoritative, machine-readable knowledge base of the API.

**Inputs:**
- **`openapi.json`** — the API's own OpenAPI spec (structure: fields, types, nesting). The source of truth for *shape*.
- **`enrichment/` (167 files)** — one file per testable field, adding what the spec can't express: plain-language summary, value ranges, constraints, business rules, validation rules, concrete testing guidance, and related fields. *Example — `vehicles.capacity`:* "cumulative onboard load must never exceed capacity on any dimension at any step; violation → task in `result.unassigned`, still HTTP 200."
- **`rules/` (15 files)** — cross-field invariants that span multiple fields.

**The 15 business rules (cross-field invariants):**
- `capacity-dimension-consistency` — load-dimension count consistent across capacity and every quantity field
- `location-index-range` — every index must resolve within the request's own location array
- `skills-superset` — a task goes to a vehicle only if the vehicle has *all* the task's skills
- `time-window-feasibility` — a stop is feasible only if reachable within its window (or lateness tolerance) and the shift
- `pickup-delivery-precedence` — pickup & delivery on the same vehicle, pickup first, load & max-time honored
- `max-duration-distance-cap` — per-vehicle caps on driving/working time and distance
- `max-stops-tasks-cap` — per-vehicle caps on stops/tasks
- `multi-depot-reachability` — tasks restricted by depot must match a vehicle's depots
- `zone-eligibility` — zoned tasks only served by vehicles allowed in that zone
- `load-type-compatibility` — incompatible load types can't share a vehicle's cargo history
- `matrix-pairing` — custom matrices must be square N×N; a distance matrix requires a duration matrix
- `objective-cost-mode-consistency` — travel-cost mode must match the cost inputs supplied
- `routing-mode-gating` — mode-specific routing attributes valid only for their mode
- `priority-tiebreaker` — priority orders preference but is subordinate to hard constraints
- `relations-supersede-soft` — when relations are present, soft penalties become ineffective

**Processor — `compile.mjs`:** reads the spec + enrichment + rules, **hard-fails if any enrichment references a field that doesn't exist in the spec** (drift protection), merges them, and emits the compiled layer:
- `features.json` — every feature with its merged knowledge
- `_graph.json` — feature relationships, rules, and clusters (for interaction testing)
- `_index.json` — counts + versioning (spec/knowledge hashes)
- `drift-report.json` — coverage gaps, orphaned enrichment, items needing review

**Current compiled state (from `_index.json`):**
- **213** total request features in the spec
- **167** in scope for testing (**enriched: 167 / gaps: 0**)
- **26** deliberately excluded (output echoes like `solution.*`, `unassigned.*` — not request fields)
- **0** orphaned enrichment, **0** drift — the knowledge base is fully in sync with the spec

**Scaling tools** (`bootstrap.mjs`, `tier1-enrichment.mjs`, `tier1-fill.mjs`, `tier2-enrichment.mjs`): help author enrichment for many fields at once, with an AI-assisted draft-then-human-ratify workflow — AI output is **never auto-trusted** (drafts are parked with `status:"proposed"` until a human approves).

**Why it matters:** because all facts live here and nowhere else, the test cases can never quietly drift from the real API. Update the spec, re-compile, and the whole tool updates.

---

### 4.2 QA Studio App — *selection, assembly, validation, export*

A single static page (`index.html` + `app.js`), no build step, no server code, no API key. Launched by double-clicking `start.command`, which starts Python's built-in local server so the page can read its sibling files.

**Function 4.2.1 — Scenario builder.** Pick Region, number of Vehicles, number of Jobs, and Test Types (**Positive / Negative**).

**Function 4.2.2 — Live feature tree.** A checkbox tree of every request field, **generated live from `openapi.json`**. Ticking a parent ticks its children. Because it's built from the spec at load time, *the tree updates automatically when the spec changes* — no manual UI maintenance. (Handles the spec's real-world quirks: `$ref` resolution, backtick-wrapped enum values, `[lon,lat]` GeoJSON exception, ~120+ nested leaf fields.)

**Function 4.2.3 — Deterministic count plan.** Computes an obligation-weighted allocation of the requested case count across selected features (90% Positive / 10% Negative globally). Each selected field gets a **role** — `target` (receives dedicated cases) or `support` (injected into bodies for realism) — and a count proportional to its authored coverage obligations. The count N is a **ceiling**, not a target; the suite may be smaller if the knowledge base doesn't support more. Shows a live "Planned totals" readout with explicit `dropped` fields and allocation breakdown.

**Function 4.2.4 — Prompt assembly (the "Prompt Builder").** Assembles a single copy-paste prompt in a deliberate order:
1. **Skills** (how to reason + the output contract)
2. **API facts + scenario + real coordinates** (from the region pool)
3. **Compiled knowledge for the selected features only** (their constraints, rules, testing guidance — not the whole 2.4 MB spec)
4. **The count plan + the exact generation task**
Buttons: *Copy Claude prompt*, *Show prompt*, *Maximize*. Supports **add-more / incremental mode**: attach an existing suite, and the prompt tells Claude to produce only new, non-duplicate cases and continue ID numbering.

**Function 4.2.5 — Validation engine (the credibility feature).** After pasting Claude's JSON back (or loading a `.json` file), each case is checked with:
- **AJV against the OpenAPI request schema** (structure, types, required fields, no unknown fields), and
- **business-rule checks** (indices in range, capacity dimensions consistent, vehicles present, at least one of jobs/shipments).

Per-case badges: **✅ valid** · **❌ invalid** (with the exact errors) · **⚠ invalid (intended)** for deliberately-malformed negatives · **✔ valid (infeasible-type)** for valid-but-unsatisfiable negatives · **n/a (no body)**. It also flags **duplicates** (vs. the loaded suite) and **draft fields** not yet in the spec.

**Function 4.2.6 — Results table.** Renders every case in the fixed 10-field template: *Test Case ID · Feature · Title · Description · Test Data · Details · Expected Result · Priority · Type · Validation*. "Details" is computed from the payload itself (locations/vehicles/jobs/shipments counts) for reliability.

**Function 4.2.7 — Coverage matrix.** A features × archetypes (**Positive / Negative**) grid showing filled cells vs. gaps, an overall coverage %, and a combination-scenario check. Gaps feed back into the next prompt as priorities. Turns "did we test enough?" into a visible, measurable answer.

**Function 4.2.8 — CSV export.** A **⬇ Download CSV** button exports the rendered suite (all 10 columns, including the real validation verdict) to an Excel-safe CSV (UTF-8 BOM, RFC-4180 quoting). Enabled once cases are rendered; filename derives from the scenario (e.g. `testcases_USA_2v10j_32cases.csv`).

**Function 4.2.9 — Region coordinate pools.** Real coordinates per region (`data/locations/USA.json` today; new regions added by dropping in a file). Ensures generated payloads use plausible, in-range coordinates.

---

### 4.3 Skills — *the authoring intelligence layer*

**What it is:** the layer that defines **how Claude reasons and shapes output** — deliberately containing **no product facts**. Fetched by the app and prepended to the prompt.

- **`_base/SKILL.md`** — persona (Senior QA Lead), the **Knowledge-Fidelity Contract** (treat injected knowledge as the sole source of truth; never invent facts; mark unknowns TBC), a reasoning protocol (restate the rule → design the minimal case → design the one-thing-wrong counter-case → assert an invariant), craft rules, and a self-critique pass.
- **`test-cases/`** — the test-case workflow, the **output contract** (the exact JSON shape the app parses), an **assertion-quality rubric** ("assert invariants, never the solver's computed route/ETA/distance"), and format-only exemplars.

**Why it's separated:** product knowledge lives once (in the Compiler); the skill raises Claude's output quality without ever being able to contradict the Compiler. Adding a future generator (e.g. Playwright scripts) means adding a thin skill folder — it inherits all the reasoning discipline for free.

---

### 4.4 Knowledge base (`Knowledge/`) — *human-readable source material*

The curated documents the enrichment was distilled from: the API facts sheet, product overviews, optimization constraints, glossary, QA rules (Positive/Negative testing), standards (test-case template, severity/priority guide), sample cases, and a "new features without spec" area (e.g. the Split Order feature PDF + an overlay that lets the tool author test cases for features *before* they're in the official spec).

---

## 5. Feature list (quick reference)

| # | Feature | What it does | Why |
|---|---|---|---|
| 1 | Spec-driven feature tree | Live checkbox tree from the OpenAPI spec | Zero UI maintenance; always current |
| 2 | Compiled knowledge base | 167 enriched fields + 15 cross-field rules | Single source of truth; no drift |
| 3 | Drift-protected compiler | Hard-fails on spec mismatch; reports gaps | Guarantees knowledge matches the API |
| 4 | Deterministic count plan | Exact, weighted per-feature case targets | Repeatable, explicit coverage |
| 5 | Versioned prompt assembly | Injects only relevant knowledge + coordinates | Accuracy + low cost (no 2.4 MB spec) |
| 6 | Authoring skills layer | Governs reasoning + output shape | Consistent, high-quality output |
| 7 | AJV + business-rule validation | Verifies every payload before trust | Catches AI defects at author time |
| 8 | Coverage matrix | Feature × Positive/Negative grid + gaps | Measurable "are we done?" |
| 9 | Add-more / incremental mode | Extends suites without duplication | Avoids re-generating existing cases |
| 10 | CSV export | One-click Excel-ready export | Hand-off to test management tools |
| 11 | Region coordinate pools | Real per-region coordinates | Plausible, valid test data |
| 12 | Draft-feature overlay | Author cases for not-yet-spec features | Test ahead of the spec |

---

## 6. Scope & boundaries

**In scope:** authoring Positive and Negative test cases; validating them against the real schema and business rules; measuring coverage; exporting.

**Out of scope (by design):**
- **Execution** against the live API (separate platform).
- **Test types beyond Positive/Negative** — boundary/invalid/infeasible are authored *within* those two types, not as separate categories.
- **Calling Claude automatically** — generation is manual copy/paste (no API key, no server); keeps the tool zero-cost and zero-setup.

---

## 7. Technical facts (for the record)

- **Runtime:** static HTML + vanilla JS; Tailwind + AJV via CDN; launched with Python's built-in HTTP server. No build, no Node runtime required to *use* it (Node is used only to *compile* the knowledge base).
- **Compiled state:** 213 features / 167 in scope / 167 enriched / 0 gaps / 0 drift / 26 out-of-scope.
- **Determinism:** no `Math.random`; coordinate sampling and counts are deterministic so the same selection reproduces the same plan.
- **Data ownership:** all product truth in `openapi.json` + `enrichment/` + `rules/`; the app and skills only consume it.

---

## 8. Roadmap candidates (optional talking points)

- Additional region pools (India, Europe, Australia).
- Additional generators reusing the skills base: **Test Plans, Playwright scripts, BugBug flows** (all authoring-only).
- Optional server variant that calls Claude directly + persists suites (SQLite) with versioned diff — described in the Architecture Review.
