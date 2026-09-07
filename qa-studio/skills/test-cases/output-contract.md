# Test Case — Output Contract

Return **only** a single JSON **array**. No prose, no explanation, no markdown code fences — the
first character of your output is `[` and the last is `]`. Each element is one test case with
**exactly these fields, in this order**:

```json
{
  "testCaseId": "TC-RO-POS-001",
  "feature": "Capacity Constraint",
  "title": "Concise: action + condition + expected outcome",
  "description": "1–2 sentences: intent and what is verified.",
  "testData": { "…": "full request body object — or a request-line string for a no-body case" },
  "details": { "features": ["vehicles.capacity", "jobs.delivery"], "archetype": "positive" },
  "expectedResult": "exact HTTP status + result.code / field / unassigned reason (an invariant)",
  "priority": "P2",
  "type": "Positive"
}
```

## Field rules

- **testCaseId** — `TC-RO-<CAT>-<NNN>`, `<CAT>` is `POS` (Positive) or `NEG` (Negative), `<NNN>` a
  zero-padded 3-digit sequence per category, unique across the output. Continue from any IDs given
  in an add-more / incremental block; never reuse an existing ID.
- **feature** — the area under test, e.g. "Capacity Constraint", "Time Window", "Authentication".
- **title** — one line: action + condition + expected outcome.
- **description** — 1–2 sentences of intent.
- **testData** — the **complete, ready-to-send request body as a JSON object** (not a string):
  every required field present, and every `location_index` resolvable within that body's own
  `locations.location` array. For a case with no body (e.g. a result fetch missing its id), set
  `testData` to the exact request-line string instead. Positive cases = fully valid bodies;
  Negative cases = the exact malformed **or** infeasible body under test (change exactly one thing).
- **details.features** — the subset of selected feature paths this specific case exercises. Do
  **not** include location/vehicle/job counts; the tool derives those from `testData`.
- **details.archetype** — `positive` or `negative` (the scenario kind, used for the coverage matrix).
- **expectedResult** — concrete and machine-checkable: the exact HTTP status taken from the injected
  API-facts block, plus the assertable detail (`result.code`, a field value, or presence in the
  unassigned list with a reason). Assert **invariants only** — never a route, ETA, distance, or
  ordering the engine computes. See `rubric.md`.
- **priority** — `P1` | `P2` | `P3` | `P4` (business urgency).
- **type** — `Positive` or `Negative`, matching the ID category.

## Hard rules

- Output is valid JSON that parses as an array of objects and is saved to a file.
    - **Path:** `output-data/test-cases.json`
    - **Format:** Valid JSON array of test case objects
    - **No prose, no explanations — only the file write.**
- Exactly the fields above; no extra keys, no missing keys (use `To Be Confirmed (TBC)` for a
  genuinely unknown value, never a guess — but HTTP statuses come from the injected facts, so they
  are never TBC).
- Every value comes from the injected knowledge, the scenario, or the coordinate pool — never from
  outside it.
