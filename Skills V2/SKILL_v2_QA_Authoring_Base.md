# QA Studio Skills v2 --- QA Authoring Base (`skills/_base/SKILL.md`)

## Purpose

This skill defines the **authoring framework** for all QA Studio
generators.

It teaches Claude **how to think, process information, author artifacts,
and validate its work**.

This skill **does not** contain product knowledge.

The following are outside the scope of this skill and must always be
supplied by the QA Studio runtime:

-   API facts
-   OpenAPI schema
-   Business rules
-   Constraints
-   Validation rules
-   Coverage allocation
-   Feature relationships
-   Scenario planning
-   Coordinate pools

Those responsibilities belong to the Compiler, Planner and Prompt
Builder.

------------------------------------------------------------------------

# Responsibilities

  -----------------------------------------------------------------------
  Component                      Responsibility
  ------------------------------ ----------------------------------------
  Compiler                       Product knowledge, business rules,
                                 constraints, relationships

  Planner                        Coverage planning and allocation

  Prompt Builder                 Runtime context assembly

  Generator Skill                Artifact-specific workflow

  QA Authoring Base              Universal QA authoring behaviour

  Claude                         Produce the requested artifact using
                                 supplied context
  -----------------------------------------------------------------------

------------------------------------------------------------------------

# Required Inputs

Verify that the runtime prompt provides the required context before
authoring.

Expected inputs (where applicable):

-   API Facts
-   Generation Scenario
-   Planner Allocation
-   Feature Knowledge
-   Business Rules
-   Supporting Fields
-   Test Subjects
-   Coordinate Pool
-   Existing Artifacts (optional)

If mandatory context is missing, request clarification rather than
inventing behaviour.

------------------------------------------------------------------------

# Knowledge Fidelity Contract

Treat the Compiler as the single source of truth.

Never:

-   invent API behaviour
-   invent undocumented business rules
-   infer hidden constraints
-   create unsupported validation logic
-   predict solver behaviour
-   contradict supplied runtime knowledge

When uncertain, state the limitation rather than guessing.

------------------------------------------------------------------------

# Universal Authoring Principles

Every QA artifact should:

-   be deterministic
-   cover one primary objective
-   be concise
-   avoid duplicate intent
-   produce measurable outcomes
-   use realistic data
-   maximise defect detection
-   minimise redundant coverage

------------------------------------------------------------------------

# Processing Workflow

## Step 1 --- Validate Inputs

Confirm all required runtime context is present.

## Step 2 --- Understand Context

Read the supplied feature knowledge, planner allocation and business
rules.

Do not expand beyond the supplied context.

## Step 3 --- Plan

Identify:

-   primary objective
-   applicable rules
-   supporting information
-   expected outcome

## Step 4 --- Author

Generate the requested artifact while strictly following:

-   runtime context
-   active generator skill
-   output contract

## Step 5 --- Validate

Perform an internal quality review before returning the result.

------------------------------------------------------------------------

# Authoring Rules

-   Prefer clarity over verbosity.
-   One primary behaviour per artifact.
-   Use observable assertions.
-   Use consistent terminology.
-   Avoid hidden assumptions.
-   Never contradict runtime knowledge.
-   Never generate placeholder facts unless explicitly instructed.

------------------------------------------------------------------------

# Validation Checklist

Before returning any artifact confirm:

-   [ ] Only supplied knowledge was used.
-   [ ] No undocumented behaviour was invented.
-   [ ] Output follows the active generator contract.
-   [ ] Duplicate scenarios were avoided.
-   [ ] Assertions are observable.
-   [ ] Expected results are measurable.
-   [ ] Runtime allocation was respected.
-   [ ] Output is internally consistent.

------------------------------------------------------------------------

# Relationship to Generator Skills

This skill defines **how** QA artifacts are authored.

Generator skills define:

-   artifact-specific workflow
-   artifact-specific rules
-   output format
-   references to templates and examples

The QA Authoring Base should remain generator-agnostic and reusable
across Test Cases, Test Plans, Playwright, BugBug, JSONata and future
generators.
