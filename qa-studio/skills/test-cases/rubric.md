# Assertion-Quality Rubric

How to turn an injected invariant into an Expected Result that a tester (or an automated checker)
can evaluate without judgment. This rubric is generator craft — it names **no** specific status
codes or field limits; take those from the injected API-facts and per-feature knowledge blocks.

## An assertion is good only if it is…

1. **Observable** — it names something in the response the tester can read: the HTTP status, a
   response field and its value, or the presence/absence of an item in a list with its reason.
2. **Invariant, not computed** — it constrains what must *always* hold, never a value the engine
   derives. Assert "the task is assigned XOR it appears in the unassigned list"; never "the route
   is depot→J2→J1" or "distance = 12.4 km".
3. **Singular** — it verifies one behavior. If you need "and", consider whether it should be two cases.
4. **Sourced** — the status code and the field come from the injected knowledge, not memory.
5. **Specific to the documented mechanism** — it names the actual reason / field / value from injected
   knowledge (e.g. "capacity dimension = [weight, volume]" or "time-window end = 18:00"), not a
   generic restatement (e.g. "capacity is respected" or "constraint is satisfied").

## Positive vs. Negative outcomes

- **Positive** — assert the success status from the injected facts plus the success invariants the
  feature's rule implies (e.g. the constrained quantity stays within its documented bound; the task
  ends up assigned).
- **Negative, malformed** — assert the rejection status from the injected facts and that **no**
  partial side effect occurred (no usable id / no partial result). The body must be invalid for
  exactly one reason.
- **Negative, infeasible-but-valid** — assert the accepted-but-unsatisfied outcome the injected
  rules describe (the task surfaces in the unassigned list with the documented reason, or the whole
  request is reported unsolvable). The body is structurally valid; only the *feasibility* fails.

## Quick examples (shape only — values illustrative)

| Weak (reject) | Strong (accept) |
|---|---|
| "Capacity is respected." | "`200`; `result.code==0`; job `J2` in the unassigned list with a capacity reason." |
| "Returns an error." | "`400`; no id returned; error names the offending `location_index`." |
| "The route is optimal." | "Every assigned task is served exactly once; onboard load never exceeds capacity on any dimension." |

## Anti-patterns to reject in self-critique

- Predicting the solver's chosen route, sequence, ETA, or distance.
- Compound assertions joined by "and/or" that hide two checks in one case.
- Any status code or limit not present in the injected knowledge.
- A negative case that is invalid for two reasons at once (ambiguous about what it tests).
- A generic or boilerplate scenario that ignores the specific structure (exact count, named dimension,
  near-boundary value) the injected testingGuidance described.
- Supporting fields omitted from a request body where they apply (e.g., no skills on vehicles).
- Identical field values across multiple test cases (e.g., all vehicles use capacity=1000). Values should
  vary meaningfully to reveal API behavior differences: low capacity in one case, high in another, boundary
  in a third.
- Combination cases that don't actually combine features in the same request body — instead testing them
  separately side-by-side. A true combination case exercises multiple features simultaneously in a single
  scenario.
