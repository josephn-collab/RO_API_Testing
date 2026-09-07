# CLAUDE.md — QA Assistant / QA Authoring Studio

**Read [`PROJECT_REFERENCE.md`](./PROJECT_REFERENCE.md) before doing anything in this project.**
It is the maintained description of the whole system: architecture, file map, `app.js` code map,
the compiler, the skills layer, current compiled state, and known gaps.

## Standing rules for this project

1. **Keep the reference current.** Any change to this project — code, `enrichment/`, `rules/`,
   `skills/`, `Knowledge/`, UI, or workflow — must be reflected in `PROJECT_REFERENCE.md` in the
   same session, plus a row in its §12 change log.
2. **Scope is authoring only.** No test execution against the live API, no automatic Claude API
   calls. Generation is copy-prompt → paste-result.
3. **Product facts live in `qa-studio/enrichment/` and `qa-studio/rules/`** — never in `app.js`,
   never in `skills/`.
4. **`qa-studio/data/compiled/` is generated.** Edit the inputs, then run
   `node qa-studio/compile.mjs`.
5. **This folder is not a git repository.** There is no undo — confirm before deleting or
   overwriting anything.

## Quick commands

```bash
open "qa-studio/start.command"        # launch the app → http://localhost:8000/qa-studio/
node qa-studio/compile.mjs           # rebuild the knowledge base (hard-fails on spec drift)
node qa-studio/compile.mjs --lenient # tolerate orphaned enrichment during a spec update
```
