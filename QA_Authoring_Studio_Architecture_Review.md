# QA Authoring Studio — Architecture Review & Recommendations

> Critical review of `QA_Authoring_implementation_Plan.pdf` (the proposed local desktop QA Authoring Studio that evolves the current Claude Skills package into a GUI-driven app).
> Author: architecture review requested by the project owner. Date: 2026-07-17.
> **Scope note:** grounded in the actual existing project (`Knowledge/`, `Skills/`, `openapi.json`) built for the NextBillion.ai Route Optimization API.
>
> **SCOPE (locked, 2026-07):** This project is for **test-case authoring/generation only**. **Execution is permanently out of scope** — test cases are run on a separate platform. Execution-related design (executor, submit→poll loop, results storage) has been removed from this document. Endpoint/flow facts that appear in prompts and generated test cases are **descriptive documentation only** so the authored artifact reads correctly for the separate execution platform; this project never calls the API.

---

## Verdict up front

The **shape** is right: config-driven UI → backend owns prompts → Claude reasons → structured JSON → persist / version / export. Roughly **80% of the plan is sound.**

Two design decisions are **load-bearing and currently wrong or under-specified**. Fix these and the rest is straightforward:

1. Backend must **validate/assemble** the request payload — Claude only **proposes**.
2. Use **assertions/invariants**, not a fabricated `expectedResponse`.

---

## The 3 things that will hurt if left unchanged

### ① "Claude generates the request payload" → make it *propose*, backend *validates*

LLMs are non-deterministic. For test **data that must be exactly valid** against the schema (correct field names, `location_index` in range, consistent capacity dimensions), letting Claude emit the final JSON means a meaningful fraction of payloads will carry a subtle defect — a hallucinated field, an off-by-one index, a swapped `"lat, lon"`. It won't be caught until a tester runs it.

**Fix — a validation-and-repair loop:**
1. Claude proposes the **scenario** (which vehicles, which jobs, what values, what to assert).
2. Backend **assembles** the real request body deterministically (location pool + Claude's chosen values).
3. Backend **validates** with **AJV against the OpenAPI schema** + business rules (capacity dims match, indices in range).
4. On failure: auto-repair, or send errors back to Claude for one retry.

This is the highest-value addition. It converts "AI-generated, probably valid" into "verified valid" and closes the previously-flagged gap (no live validation).

### ② "Claude returns `expectedResponse: {}`" → it **cannot**, and shouldn't

The optimizer's real output (routes, ETAs, distances, which vehicle got which job) is computed by NextBillion's solver. Claude can't predict it — any concrete `expectedResponse` is **fiction** that fails against the real API.

What Claude *can* produce (and what the knowledge base already encodes) is **invariants / assertions**:
- HTTP `200` + `result.code == 0`
- every job assigned XOR in `unassigned`
- capacity never exceeded at any step
- pickup before delivery, same vehicle
- for negatives: exact `4xx`, or task in `result.unassigned` with a reason, or `422`.

So the output schema should carry `assertions[]` (structured, machine-checkable), **not** `expectedResponse{}`. Keep `expectedResponse` only as an *optional, non-authoritative* sample shape for docs.

> **Note:** the endpoint/flow facts (`POST /optimization/v2` → `GET /result`) still belong in the prompt and in generated test cases — but purely as **descriptive documentation** of the target, so the authored artifact reads correctly for the separate execution platform. This project does not execute.

---

## Answers to the 16 asks

### 3 / 4 / 5 / 6 — Folder structure, and Prompt / Knowledge / Config layers

The current `Knowledge/` and `Skills/` were built for **Claude Code** (filesystem skill invocation via `SKILL.md` frontmatter). Via the **Claude API** there is no auto-loading — the backend must assemble context itself. So `Skills/` as a concept mostly **dissolves into the backend's Prompt Builder**, and `Knowledge/` becomes **composable context fragments** the builder selects. Reuse the *content*, not the skill mechanism.

> **Update (2026-07):** this has been realized. The top-level `Skills/` folder was retired; the authoring layer now lives at **`qa-studio/skills/`** (a shared `_base/` reasoning skill + thin per-generator skills that hold **no** product knowledge). QA Studio's `loadSkill()` fetches these fragments and **prepends them to the generated prompt** — i.e. the skill is injected as text, exactly the "dissolves into the Prompt Builder" outcome predicted here. The Compiler (`enrichment/` + `rules/` → `data/compiled/`) remains the single source of product truth; see `qa-studio/skills/README.md`.

```
qa-authoring-studio/
├── apps/
│   ├── web/                     # React + Vite + TS + Tailwind
│   └── server/                  # Node + Fastify + TS
│       └── src/
│           ├── routes/          # HTTP API
│           ├── prompt/          # ← Prompt Builder (owns all prompt engineering)
│           │   ├── templates/   #   versioned .md/.hbs fragments
│           │   ├── assembler.ts #   selects fragments by config
│           │   └── registry.ts  #   template id + semver + hash
│           ├── knowledge/       # ← Knowledge Layer (curated fragments)
│           │   ├── facts.md          (from _NextBillion_Optimization_API_Facts.md)
│           │   ├── field-catalog.md  (from RouteOptimizationOverview.md §3–4)
│           │   ├── error-codes.md
│           │   ├── constraints.md
│           │   └── index.json    #   fragment metadata + version
│           ├── schema/           # ← Config Layer
│           │   ├── openapi.json   (source of truth)
│           │   ├── feature-tree.json (generated, cached)
│           │   └── scenario.schema.json (validates the config object)
│           ├── data/locations/   # USA.json, India.json, …
│           ├── generate/         # orchestration: build→call→validate→repair
│           ├── validate/         # AJV + business-rule checks
│           ├── export/           # md / xlsx / pdf / docx / csv renderers
│           └── db/               # SQLite + migrations
├── packages/shared/             # TS types shared FE/BE (Scenario, TestCase…)
└── prompts.lock.json            # pins active template + knowledge versions
```

Key idea: **`packages/shared`** holds the TypeScript types for `Scenario`, `TestCase`, `Assertion` — used by both ends so the config object and Claude output are typed contracts, not loose JSON.

- **Prompt Builder:** pure function `assemble(scenario, knowledgeVersion, templateVersion) → messages[]`. No I/O in the core; deterministic; unit-testable with snapshot tests.
- **Knowledge Layer:** small fragments with front-matter (`id`, `version`, `appliesTo`). Assembler pulls only what the selected features need (do **not** send everything — see cost note).
- **Config Layer:** `scenario.schema.json` validates the incoming config; `feature-tree.json` drives the checkbox UI.

### 7 — Frontend components

```
ScenarioBuilder/         # region, counts, testTypes, outputType
FeatureTree/             # recursive checkbox tree (virtualized)
  └─ TreeNode            # tri-state parent checkboxes
GenerationPanel/         # run button, streaming progress, token/cost meter
ResultsGrid/             # test cases table; row = TestCase
  ├─ TestCaseEditor      # edit/approve/reject; JSON + form view
  └─ ValidationBadge     # AJV / business-rule pass/fail per case
DiffView/                # compare two saved suites
SuiteLibrary/            # saved suites, metadata, versions
ExportMenu/              # md / xlsx / pdf / docx
```

- **React Query** for server state, **Zustand** for the builder's local selection state, **react-hook-form + Zod** for editing cases against the shared types.

### 8 — Backend APIs

```
GET  /api/feature-tree                 # cached tree from OpenAPI
GET  /api/regions                      # list + counts
POST /api/scenarios/validate           # AJV-check a config object
POST /api/generate                     # {scenario} → {runId}  (async, stream)
GET  /api/generate/:runId/stream       # progress + partial cases (SSE)
POST /api/suites                       # save approved suite (+ metadata/version)
GET  /api/suites   /api/suites/:id
GET  /api/suites/:id/diff/:otherId
POST /api/suites/:id/export?fmt=xlsx
GET  /api/health
```

Keep **`/generate` asynchronous with streaming** — a 20-job suite is many tokens; progressive rendering beats a 60s spinner.

### 9 — SQLite schema

```sql
-- immutable inputs/outputs, so comparison is meaningful
CREATE TABLE suite (
  id TEXT PRIMARY KEY,           -- uuid
  name TEXT,
  region TEXT, vehicle_count INT, job_count INT,
  features_json TEXT,            -- selected feature paths
  test_types_json TEXT,
  prompt_version TEXT,           -- template semver + hash
  knowledge_version TEXT,        -- knowledge bundle semver + hash
  api_version TEXT,              -- openapi version / hash
  model TEXT, temperature REAL,
  status TEXT,                   -- draft | approved
  created_at TEXT, parent_suite_id TEXT  -- lineage for re-gen
);

CREATE TABLE test_case (
  id TEXT PRIMARY KEY,
  suite_id TEXT REFERENCES suite(id),
  case_ref TEXT,                 -- TC-RO-POS-001
  category TEXT, type TEXT,      -- Positive|Negative|API ; Positive|Negative
  feature TEXT, title TEXT, description TEXT,
  request_json TEXT,             -- the validated body
  assertions_json TEXT,
  priority TEXT, severity TEXT,
  validation_status TEXT,        -- valid | invalid | unchecked
  review_status TEXT,            -- pending | approved | rejected
  seq INT
);

CREATE TABLE generation_run (    -- audit: raw prompt + raw response + cost
  id TEXT PRIMARY KEY, suite_id TEXT,
  request_messages_json TEXT, raw_response TEXT,
  input_tokens INT, output_tokens INT, cost_usd REAL,
  validation_errors_json TEXT, created_at TEXT
);
```

Store the **raw prompt + raw response** (`generation_run`) — needed to debug "why did this suite come out weird" and to reproduce.

### 10 — Feature tree from OpenAPI (feasible; 4 real gotchas)

Generating it is the right call, but naive traversal of *this* spec fails:

1. **`$ref` resolution** — the spec uses refs; dereference first (`@apidevtools/swagger-parser`).
2. **Backtick-wrapped enums** — NextBillion's enum values are literally `` "`duration`" ``, `` "`truck`" ``. Strip backticks or the UI shows garbage and payloads break. (Hit repeatedly during the knowledge build.)
3. **Depth & size** — the full tree is huge (`vehicles[].costs.*`, `options.routing.*` with 12 fields, nested `volume.alignment`). Cap depth; ship a **curated allow-list** of test-worthy fields; keep the raw tree behind an "advanced" toggle. Don't render ~120 leaf fields by default.
4. **Coordinate exception** — `zones[].geometry.coordinates` is `[lon, lat]` GeoJSON while everything else is `"lat, lon"` strings. Encode this in the tree/assembler or you'll generate invalid zones.

Build it as an **offline step** (`npm run build:tree`) emitting `feature-tree.json`, versioned with the spec — not parsed live per request.

### 11 — Prompt versioning

Treat prompts as code. Each template fragment has `id` + **semver** + a **content hash**. A `prompts.lock.json` pins the active set. Every `generation_run` records the exact `prompt_version` + `knowledge_version` + `api_version` (all hashes). To compare two suites fairly, require identical versions **and** pinned `temperature` (ideally 0–0.3 for reproducibility). Bump semver on any wording change; the hash catches accidental drift.

### 12 — How generated cases are stored

As **structured rows** (schema above), **not** Markdown blobs. Markdown / Excel / PDF / Word are **renderers over the rows**, generated on demand. This enables diffing, filtering, partial re-generation, and re-export. Never persist the export format as the source of truth.

### 13 — Future modules (Playwright, BugBug, JSONata, Test Plans, Benchmarking)

Make **generation a plugin interface**, keyed by "authoring target":

```ts
interface AuthoringModule {
  id: string;                       // "route-opt-test-cases"
  featureSource(): FeatureTree;     // from OpenAPI (or none)
  buildPrompt(scenario): Messages;
  outputSchema: JSONSchema;         // validates Claude's JSON
  validate(output): ValidationResult;
  render(output, fmt): Buffer;      // exporters
}
```

- **Test Plans** = another module (reuse the Test Plan skill content as its knowledge + template).
- **Playwright / BugBug** = modules whose `render()` *authors* test scripts/flows (code artifacts) instead of JSON test cases — still generation only; running them lives on the separate execution platform.
- **JSONata** = a *transform* utility used inside `render()`/export, not a top-level module.
- **CSV (UI-test data)** = an export renderer over the generated `test_case` rows.
- *Benchmarking is out of scope* — it depended on execution results, which this project does not produce.

The DB (`suite` / `test_case` / `generation_run`) is generic enough to hold all of them if `request_json` / `assertions_json` / `payload_json` stay free-form per module.

### 14 — Roadmap (milestones)

| Milestone | Duration | Deliverable |
|---|---|---|
| **M0 — Skeleton** | ~1 wk | Monorepo, Fastify, SQLite, Anthropic client, `/health`, one hardcoded generate call rendering to the grid. |
| **M1 — Config→Generate→Render** | ~2 wk | Scenario builder, location pools (1 region), prompt builder v1, structured JSON output, results grid. *No feature tree yet — hardcode a small feature list.* |
| **M2 — Validation loop** | ~1 wk | AJV + business rules + repair retry. **The credibility milestone.** |
| **M3 — Feature tree from OpenAPI** | ~1 wk | Offline generator, curated allow-list, checkbox UI. |
| **M4 — Persistence, versioning, diff, export** | ~2 wk | Suites, metadata, diff view, exporters (md/xlsx/pdf/docx/csv). |
| **M5+ — Plugin refactor & new authoring modules** | — | Test Plans, Playwright/BugBug script authoring, etc. (all generation only). |

Ship **M1–M2 before** the fancy tree; a working *validated* single-region generator is more useful than a beautiful tree over unvalidated output.

> Execution against NextBillion is intentionally **not** a milestone — out of scope (handled by a separate platform).

### 15 — What becomes hard to maintain

- **Prompt/knowledge drift vs. the API** — mitigate with version pinning + a "spec changed" diff check in CI.
- **The feature tree** if auto-generated without curation — it balloons and confuses.
- **Cost / context bloat** — the raw `openapi.json` is **2.4 MB**; never send it. Send the distilled facts sheet + field catalog, and use **prompt caching** on the stable knowledge block. Assemble only the fragments the selected features need.
- **Reproducibility** — non-zero temperature + evolving prompts make "compare two suites" degrade into noise unless everything is pinned.
- **Two sources of truth** — if the desktop app and the old Claude Code skills both exist, they diverge. Pick the app as canonical; keep `Knowledge/` as shared fragments only.

### 16 — Best practices

Typed contracts end-to-end (shared Zod/TS); deterministic pure prompt-builder with snapshot tests; validate everything the model returns; store raw runs; version prompts like code; keep Claude for *reasoning* and the backend for *assembling / validating* (not executing — out of scope); prefer **narrow modules over one god-generator**.

---

## End-to-end architecture & flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  React + Vite + TS + Tailwind  (local browser)                      │
│  ScenarioBuilder → FeatureTree(checkboxes) → GenerationPanel →      │
│  ResultsGrid(edit/approve/reject) → DiffView → ExportMenu           │
└───────────────▲──────────────────────────────────┬──────────────────┘
                │ typed Scenario (shared types)     │ SSE stream
                │                                    ▼
┌───────────────┴──────────────────────────────────────────────────────┐
│  Fastify backend (Node + TS)                                          │
│                                                                       │
│  /feature-tree ──◄ feature-tree.json ◄── (offline) OpenAPI parser     │
│                                                                       │
│  /generate:                                                           │
│    1 Config Layer   validate scenario (AJV)                           │
│    2 Location pool  pick N coords for region                          │
│    3 Prompt Builder assemble(templates@ver + knowledge@ver + config)  │
│    4 Claude API ───────────────────────────────►  (reasoning engine) │
│         returns structured JSON: cases + values + assertions          │
│    5 Assembler      build real request bodies from values + locations │
│    6 Validate       AJV(OpenAPI) + business rules → repair/retry ↺    │
│    7 persist        suite + test_case + generation_run (SQLite)       │
│                                                                       │
│  /export: rows → md / xlsx / pdf / docx / csv                         │
└───────────────┬───────────────────────────────────────────────────────┘
                ▼
        SQLite (suite, test_case, generation_run)
                │
                ▼
        Exporters (Markdown · Excel · PDF · Word · CSV)  +  Diff engine
```

**Flow in one line:** UI builds a typed `Scenario` → backend validates it, picks real coordinates, assembles a versioned prompt from existing knowledge → Claude returns structured JSON (scenario values + **assertions, not fabricated responses**) → backend assembles and **validates** the actual request bodies against the OpenAPI schema, repairing if needed → persists as versioned rows → UI renders for edit/approve → export / diff on demand. *(Running the exported test cases happens on a separate execution platform — out of scope here.)*

---

## Bottom line

Feasible, and a natural evolution — **~80% of the plan is right.** The two corrections that matter:

1. **Backend validates/assembles the payload; Claude only proposes.**
2. **Assertions, not a fabricated `expectedResponse`.**

Also: don't send the 2.4 MB spec — send the already-distilled fragments — and recognize that the "Skills" mechanism becomes the backend **Prompt Builder**. Scope is **generation only**; execution is handled by a separate platform.

---

## Reusable assets from the current project

| Existing asset | Reuse as |
|---|---|
| `Knowledge/_NextBillion_Optimization_API_Facts.md` | `knowledge/facts.md` context fragment |
| `Knowledge/Product Knowledge/RouteOptimizationOverview.md` (§3–4 field catalog) | `knowledge/field-catalog.md` |
| `Knowledge/RouteOptimizationKnowledge.md` (§7 error codes) | `knowledge/error-codes.md` |
| `Knowledge/Product Knowledge/OptimizationConstraints.md` | `knowledge/constraints.md` |
| `Skills/Test Cases/SKILL.md` (rules, categories, fields, error codes) | Prompt Builder template for the test-case module |
| `Skills/Test Plan/SKILL.md` | Prompt Builder template for the test-plan module |
| `Knowledge/openapi.json` | `schema/openapi.json` → offline feature-tree generator |
| Worked examples (`examples/RouteOptimization_TestCases.md`) | Few-shot fragments + output-schema validation fixtures |
