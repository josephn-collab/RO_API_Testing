# QA Studio Skills v2 --- Examples (`skills/test-cases/examples.md`)

## Purpose

This document provides representative examples that demonstrate the
expected quality of generated test cases.

These examples teach style, structure and intent.

They do **not** define product behaviour.

Product knowledge must always come from the runtime prompt.

------------------------------------------------------------------------

# Example 1 --- Good Test Case

## Characteristics

-   One primary objective
-   Clear title
-   Complete payload
-   Realistic data
-   Supporting fields included
-   No unrelated behaviour

Example

Title: Validate vehicle capacity accepts maximum configured value

Primary Test Subject: vehicles.capacity

Supporting Fields: vehicles.start_index vehicles.end_index
vehicles.description

Objective: Verify that a vehicle configured with the maximum supported
capacity is accepted.

Why this is good

✓ Single behaviour ✓ Clear objective ✓ Supporting fields improve realism
✓ No mixed concerns

------------------------------------------------------------------------

# Example 2 --- Poor Test Case

Title: Validate vehicle configuration

Problems

✗ Multiple objectives

✗ Unclear scope

✗ Unknown expected outcome

✗ Cannot determine failure reason

Lesson

Every test case should validate one primary behaviour.

------------------------------------------------------------------------

# Example 3 --- Supporting Fields

Incorrect

Primary Subject: vehicles.capacity

Also validating: start_index description location_index

Correct

Primary Subject: vehicles.capacity

Supporting Fields:

-   start_index
-   end_index
-   description
-   location_index

These fields exist only to produce a realistic request body.

------------------------------------------------------------------------

# Example 4 --- Payload Quality

Poor

-   Missing mandatory fields
-   Placeholder values
-   Empty arrays without purpose
-   Unrelated optional data

Good

-   Schema-valid JSON
-   Required fields populated
-   Supporting fields included
-   Data consistent with scenario
-   Minimal but realistic request

------------------------------------------------------------------------

# Example 5 --- Good Objective

Objective

Validate that the selected Test Subject behaves according to the
supplied runtime knowledge.

Avoid objectives that attempt to validate multiple unrelated behaviours.

------------------------------------------------------------------------

# Example 6 --- Category Alignment

Planner Allocation

Boundary

Generated Test

Boundary

Planner Allocation

Negative

Generated Test

Negative

The generator must not reinterpret Planner allocation.

------------------------------------------------------------------------

# Example 7 --- Knowledge Fidelity

Correct

Expected Result

Derived only from supplied runtime knowledge.

Incorrect

Expected Result

Introduces undocumented API behaviour or solver assumptions.

------------------------------------------------------------------------

# Summary

Every generated artifact should demonstrate:

-   one primary objective
-   realistic payloads
-   supporting fields used correctly
-   adherence to planner allocation
-   consistent terminology
-   measurable expected outcomes
-   no invented behaviour
