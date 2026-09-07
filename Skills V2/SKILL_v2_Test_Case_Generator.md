# QA Studio Skills v2 --- Test Case Generator (`skills/test-cases/SKILL.md`)

## Purpose

This skill generates production-quality API test cases using the runtime
context supplied by QA Studio.

It is responsible for **authoring** test cases.

It is **not** responsible for:

-   deciding coverage
-   allocating test cases
-   inventing product behaviour
-   interpreting undocumented API behaviour
-   creating business rules

Those responsibilities belong to the Compiler, Planner and Prompt
Builder.

------------------------------------------------------------------------

# Responsibilities

  -----------------------------------------------------------------------
  Component                      Responsibility
  ------------------------------ ----------------------------------------
  Compiler                       Product facts, constraints,
                                 relationships and business rules

  Planner                        Coverage allocation and scenario
                                 planning

  Prompt Builder                 Supplies runtime generation context

  Test Case Generator            Converts runtime context into complete
                                 test cases

  Claude                         Produces the final authored artifacts
  -----------------------------------------------------------------------

------------------------------------------------------------------------

# Required Inputs

Before generation begins, verify the runtime prompt contains:

-   API Facts
-   Planner Allocation
-   Generation Scenario
-   Test Subjects
-   Supporting Fields
-   Feature Knowledge
-   Business Rules
-   Coordinate Pool (if applicable)
-   Existing Test Cases (optional)

If required context is missing, request clarification rather than
inventing information.

------------------------------------------------------------------------

# Core Concepts

## Test Subjects

These are the primary features under test.

Dedicated test cases are generated only for Test Subjects.

## Supporting Fields

Supporting Fields provide realistic request bodies.

They:

-   populate request payloads
-   satisfy schema requirements
-   improve realism

They **must not** become standalone test objectives unless they are
explicitly promoted to Test Subjects.

## Planner Allocation

The Planner determines:

-   total number of test cases
-   coverage distribution
-   scenario priorities
-   interaction scenarios

The generator follows this allocation exactly.

------------------------------------------------------------------------

# Generation Workflow

## Step 1 --- Validate Runtime Context

Verify all required inputs are present.

## Step 2 --- Understand the Plan

Review:

-   requested suite size
-   allocation
-   test subjects
-   supporting fields
-   business rules

Do not modify the plan.

## Step 3 --- Design Test Scenarios

For each allocated scenario:

-   identify the primary objective
-   determine applicable rules
-   identify required supporting fields
-   determine expected behaviour

## Step 4 --- Generate Request Payload

Build a complete request body that:

-   satisfies the schema
-   includes supporting fields where applicable
-   exercises the intended test subject
-   uses realistic values

## Step 5 --- Generate Assertions

Assertions should verify:

-   documented API behaviour
-   schema validation
-   business rules supplied at runtime
-   observable outcomes

Never assert undocumented behaviour.

## Step 6 --- Validate

Before returning:

-   verify payload validity
-   verify allocation compliance
-   verify uniqueness
-   verify output contract

------------------------------------------------------------------------

# Generation Rules

-   Respect Planner allocation.
-   Generate dedicated scenarios only for Test Subjects.
-   Include Supporting Fields in applicable request bodies.
-   Use only runtime knowledge.
-   Prefer realistic, business-oriented scenarios.
-   Avoid duplicate intent.
-   Keep one primary objective per test case.
-   Use measurable expected results.
-   Never predict optimisation or routing outcomes unless explicitly
    documented.

------------------------------------------------------------------------

# Output

Generate the artifact defined by the active Output Contract.

Do not change:

-   field ordering
-   required properties
-   identifier conventions
-   response format

------------------------------------------------------------------------

# References

This skill relies on the following shared standards:

-   output-contract.md
-   assertion-rubric.md
-   examples.md
-   validation-checklist.md

These documents define formatting and quality expectations and should
not be duplicated here.
