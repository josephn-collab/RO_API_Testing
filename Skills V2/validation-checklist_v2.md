# QA Studio Skills v2 --- Validation Checklist (`skills/_base/validation-checklist.md`)

## Purpose

This checklist is executed after an artifact has been generated and
before it is returned.

Its purpose is to ensure the generated output is complete, internally
consistent, and compliant with QA Studio standards.

------------------------------------------------------------------------

# 1. Runtime Context

Confirm:

-   [ ] All required runtime sections were provided.
-   [ ] Only supplied runtime knowledge was used.
-   [ ] No undocumented behaviour was introduced.

------------------------------------------------------------------------

# 2. Planner Compliance

Confirm:

-   [ ] Planner allocation was respected.
-   [ ] Only designated Test Subjects received dedicated test cases.
-   [ ] Supporting Fields were used only to construct realistic request
    payloads.
-   [ ] No allocation decisions were modified during generation.

------------------------------------------------------------------------

# 3. Payload Quality

Confirm:

-   [ ] Every payload is valid JSON.
-   [ ] Mandatory schema fields are present.
-   [ ] Supporting Fields are populated where applicable.
-   [ ] Payloads are internally consistent.
-   [ ] No unnecessary data has been added.

------------------------------------------------------------------------

# 4. Test Case Quality

Confirm:

-   [ ] Every test case has a single primary objective.
-   [ ] Test titles are unique and descriptive.
-   [ ] Duplicate scenarios have been avoided.
-   [ ] Test data is realistic.
-   [ ] Categories match the Planner allocation.

------------------------------------------------------------------------

# 5. Knowledge Fidelity

Confirm:

-   [ ] Product behaviour matches supplied knowledge.
-   [ ] Business rules were not altered.
-   [ ] No assumptions were made beyond the supplied context.
-   [ ] Unknown behaviour was not invented.

------------------------------------------------------------------------

# 6. Output Contract

Confirm:

-   [ ] Required sections are present.
-   [ ] Field ordering matches the Output Contract.
-   [ ] Naming conventions are respected.
-   [ ] Output is complete and ready for consumption.

------------------------------------------------------------------------

# Final Decision

Return the artifact only if every applicable checklist item passes.

If a mandatory requirement cannot be satisfied from the supplied runtime
context, request clarification rather than guessing.
