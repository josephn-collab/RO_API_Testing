# QA Studio Skills — the authoring layer

These skills are the **authoring-intelligence layer** for generation. They define *how Claude
reasons and shapes output*, and hold **no product knowledge**. All product facts, business rules,
constraints, and feature relationships live in the **Compiler** (`../openapi.json`, `../enrichment/`,
`../rules/` → `../data/compiled/`) and are injected into the prompt by QA Studio at generation time.

## Responsibilities (single owner per concern)

| Concern | Owner |
|---|---|
| Product facts, business rules, constraints, relationships | **Compiler** (`enrichment/`, `rules/` → `data/compiled/`) |
| Feature selection + prompt assembly | **QA Studio** (`app.js`) |
| How to reason / consume knowledge / self-verify | **`_base/`** (this folder) |
| Output shape + generator workflow + rubric | each generator skill (`test-cases/`, and future generators) |

A rule of thumb for what belongs here: *if editing the API or a business rule would force an edit
to a skill file, that content is in the wrong place — it belongs in the Compiler.* Skills only
contain material that survives any product change.

## Layout

```
skills/
├── _base/SKILL.md        # ownership table · persona · Knowledge-Fidelity Contract · Stage 1 (Intake) · Stage 2 (Reason) · Stage 3 (Self-critique)
└── test-cases/
    ├── SKILL.md          # responsibilities table · test-case workflow (extends _base): 5-step structure + scale-tier carve-out
    ├── output-contract.md# the JSON array shape QA Studio parses
    ├── rubric.md         # assertion-quality rubric (5 criteria + anti-patterns)
    ├── checklist.md      # final checklist before emitting
    └── examples/exemplars.md  # format-only examples: small + medium scale tiers, plus multi-dimension exemplar
```

## How they reach Claude

QA Studio has no filesystem access to Claude (the workflow is copy-paste). So a skill is **not a
file Claude opens** — QA Studio **fetches these fragments and prepends them to the generated
prompt** (`loadSkill()` in `app.js`), in this order:

```
[ _base/SKILL.md + <generator>/SKILL.md + output-contract.md + rubric.md + checklist.md + exemplars ]  ← this folder
+ [ API facts + scenario + scale tiers + coordinates ]                                                  ← QA Studio
+ [ compiled knowledge for the selected features ]                                                      ← Compiler
+ [ short per-run generation task ]                                                                     ← QA Studio
```

"Inheritance" of the base by a generator is just concatenation of `_base` + the generator's files.
The same files are also valid as conversational Claude Code skills if you ever use the conversational
path — one source, two consumers, no drift.

**Scale-tier behavior:** The planner (`buildPlan()`) determines which units are scale-meaningful
(interaction obligations or curated scale-sensitive rules), splits their allocated cases 40/40/20
across small/medium/large per the config mix, and returns tier counts. Claude uses the injected
Scale tiers block to build each case at its tier's vehicle/job counts instead of defaulting to
minimal. Cases whose aspect doesn't benefit from scale (e.g. "capacity value is -5") stay small.

## Adding a new generator (Playwright, BugBug, JSONata, …)

Create `skills/<generator>/` with a thin `SKILL.md` (workflow) and an `output-contract.md` (the
artifact shape). It inherits all reasoning discipline from `_base/` for free. Do **not** copy
product knowledge into it — reference the injected knowledge blocks by role.
