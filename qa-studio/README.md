# QA Studio

A tiny, click-driven local page for authoring **NextBillion.ai Route Optimization** test cases.
No build step, no Node, no API key. The feature checkboxes are generated **live from `openapi.json`**,
so when the spec changes the tree updates automatically.

## Launch (minimal terminal)

**Double-click `start.command`.**
It starts a small local server (macOS's built-in `python3 -m http.server`) and opens
`http://localhost:8000` in your browser. To stop, close the Terminal window it opened.

> Why a launcher instead of double-clicking `index.html`? Browsers block a `file://` page from reading
> sibling files. The tiny server lets the page read `openapi.json` at runtime — which is what gives you
> automatic sync when the spec changes.
>
> First load needs internet: Tailwind and the AJV validator load from a CDN.

## The 5-step flow

1. **Scenario** — pick Region, number of Vehicles and Jobs, and which Test Types (Positive / Negative).
2. **Features** — tick the fields to cover. The tree (including every nested field like
   `vehicles.capacity`, `vehicles.costs.fixed`, `jobs.time_windows`, `options.routing.mode`) is built
   live from `openapi.json`. Ticking a parent ticks its children.
3. **Copy Claude prompt** — the page assembles a prompt from your selections + real coordinates from the
   region pool + the generation rules, and copies it to the clipboard.
4. **Paste into Claude**, then paste the **JSON array** it returns into the textarea.
5. **Validate & Render** — each case is shown in the 10-field template, and each `testData` payload is
   validated against the OpenAPI request schema (AJV) plus business rules (`location_index` in range,
   `vehicles` present, at least one of `jobs`/`shipments`). Badges:
   - **✅ valid** — positive body matches the spec.
   - **❌ invalid** — positive body has a defect (details listed) → this is the "backend validates /
     ask Claude to regenerate" signal.
   - **⚠ invalid (intended)** — a negative case whose body is deliberately malformed (expected).
   - **✔ valid (infeasible-type)** — a negative case that is structurally valid but semantically
     infeasible (returns `200` + `result.unassigned`).
   - **n/a (no body)** — a no-body case (e.g. `GET /result` without `id`).

The page does **not** call Claude and does **not** execute test cases — generation is copy/paste, and
execution is handled separately.

## Files

```
qa-studio/
├── start.command        # double-click launcher
├── index.html           # UI (Tailwind + AJV via CDN)
├── app.js               # tree build, prompt, AJV validation, render
├── openapi.json         # copy of ../Knowledge/openapi.json (served for live parse + validation)
├── enrichment/ rules/   # Compiler inputs — the single source of product truth
├── compile.mjs          # compiles the above into data/compiled/
├── skills/              # authoring layer (no product knowledge) — prepended to the prompt
│   ├── _base/           #   shared reasoning + knowledge-fidelity + self-critique
│   └── test-cases/      #   test-case workflow + output contract + rubric + exemplars
└── data/
    ├── compiled/        # generated knowledge (features.json, _graph.json, …)
    └── locations/
        └── USA.json     # coordinate pool (add India/Europe/Australia the same way)
```

The prompt Claude receives is assembled as: **skills/** (how to reason + output contract) →
**API facts + scenario + coordinates** (QA Studio) → **compiled knowledge for the selected
features** (Compiler) → a short per-run generation task. Product facts and business rules live
only in the Compiler; the skills reference them by role and never restate them (see
`skills/README.md`).

## Keeping it in sync

- **Spec change:** replace `qa-studio/openapi.json` with the new one (or copy from `../Knowledge/`), then
  reload the page — the tree and validation update automatically.
- **New region:** add `data/locations/<Region>.json` (same shape as `USA.json`) and add the name to the
  `REGIONS` array at the top of `app.js`.

## Notes / limitations

- Enum values in this spec are documentation artifacts (backtick-wrapped), so AJV validation drops
  `enum`/`format` checks and keeps structure/type/required/`additionalProperties`. The valid enum values
  are still given to Claude in the prompt.
- This is the lightweight authoring front end. The heavier "server calls Claude + executes" version is
  described in `../QA_Authoring_Studio_Architecture_Review.md`.
