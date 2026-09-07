# QA Studio Skills v2 --- Output Contract (`skills/test-cases/output-contract.md`)

## Purpose

This document defines the canonical output structure for all generated
API Test Cases.

The Test Case Generator must conform to this contract exactly.

The Output Contract defines **structure only**.

It does **not** define product knowledge, business rules, coverage
allocation or authoring workflow.

------------------------------------------------------------------------

# General Rules

-   Produce exactly the number of test cases allocated by the Planner
    (or fewer if instructed by the Planner because authored coverage is
    exhausted).
-   Return only the agreed output format.
-   Preserve field ordering.
-   Never omit required fields.
-   Every test case must be self-contained.

------------------------------------------------------------------------

# Required Test Case Fields

Each generated test case shall contain the following fields in this
order:

1.  Test Case ID
2.  Title
3.  Objective
4.  Category
5.  Priority
6.  Severity
7.  Test Subject
8.  Supporting Fields
9.  Preconditions
10. Request Payload (JSON)
11. Validation / Assertions
12. Expected Result
13. Cleanup / Postcondition (optional)
14. Tags (optional)

------------------------------------------------------------------------

# Field Definitions

  -----------------------------------------------------------------------
  Field                  Requirement
  ---------------------- ------------------------------------------------
  Test Case ID           Unique within the suite

  Title                  Short, descriptive and action-oriented

  Objective              One primary behaviour under test

  Category               Must match Planner allocation (Positive,
                         Negative, Boundary, Combination, etc.)

  Priority               Follow project convention

  Severity               Follow project convention

  Test Subject           Primary feature being validated

  Supporting Fields      Fields included only to create a realistic
                         request

  Preconditions          Environment and setup required

  Request Payload        Complete, schema-valid JSON

  Validation /           Observable checks only
  Assertions             

  Expected Result        Measurable outcome derived from supplied
                         knowledge
  -----------------------------------------------------------------------

------------------------------------------------------------------------

# Payload Requirements

Every payload must:

-   be valid JSON
-   satisfy the supplied schema
-   include all mandatory fields
-   include Supporting Fields where applicable
-   exercise the intended Test Subject
-   avoid unrelated complexity

------------------------------------------------------------------------

# Assertion Requirements

Assertions must:

-   verify documented behaviour
-   reference supplied business rules where applicable
-   be observable
-   be deterministic
-   avoid implementation details

Never assert undocumented behaviour.

------------------------------------------------------------------------

# Identifier Rules

Test Case IDs must:

-   be unique
-   follow the project naming convention
-   remain stable across regeneration when required by the Planner

------------------------------------------------------------------------

# Output Quality Requirements

Every generated suite must satisfy:

-   Consistent terminology
-   No duplicate intent
-   One primary objective per test case
-   Realistic request data
-   Measurable expected results
-   Internally consistent payloads

------------------------------------------------------------------------

# Prohibited Output

Do not:

-   invent undocumented fields
-   invent undocumented API behaviour
-   change the output schema
-   omit required sections
-   reorder required fields
-   embed explanations outside the agreed output structure

------------------------------------------------------------------------

# Compliance

The Test Case Generator must validate its output against this contract
before returning the final suite.

Any deviation from this contract is considered an invalid generation.
