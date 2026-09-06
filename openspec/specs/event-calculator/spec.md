# event-calculator Specification

## Purpose
TBD - created by archiving change product-roadmap-phases-1-4. Update Purpose after archive.
## Requirements
### Requirement: Consumption computation from norms

Given guest count, duration, and event profile, the calculator SHALL compute expected consumption per drink type by resolving the PUBLISHED consumption norms effective on the event date, attaching the norms version to the result. All arithmetic SHALL be pure and deterministic.

#### Scenario: Norms version cited

- **WHEN** a calculation completes
- **THEN** the result SHALL name the consumption norms version used

### Requirement: Minimal-surplus shopping list

The calculator SHALL convert computed consumption into a shopping list rounded to realistic retail units with a minimal-surplus rule, and SHALL show the surplus per line so the rounding is visible rather than hidden.

#### Scenario: Surplus shown per line

- **WHEN** a shopping list is produced
- **THEN** each line SHALL show the computed need, the suggested purchase quantity, and the resulting surplus

### Requirement: MVP simple mode

The MVP UI SHALL expose the simple mode (guests, duration, profile) without cross-border options, gated behind `enable_event_calculator`, with the norms-are-estimates disclaimer rendered structurally with the result.

#### Scenario: Simple mode calculation

- **WHEN** a user enters guests and duration in the simple mode
- **THEN** the page SHALL render the per-type list with surplus figures and the disclaimer

### Requirement: V2 cross-border sourcing plan

The V2 sourcing plan SHALL compare domestic purchase against foreign sourcing over the versioned sourcing-country set, which after this change SHALL be Finland, Estonia, Latvia, Lithuania, and Germany. Sweden SHALL NOT appear in the canonical country order, in validation, in fixtures, or in the user-facing country labels in either locale. All sourcing countries except Finland SHALL be EUR markets, consistent with the single-currency invariant.

#### Scenario: Sweden is not a selectable market

- **WHEN** the sourcing plan validates country inputs or the event page renders the country selector
- **THEN** `SE` is rejected as invalid and no Swedish label exists in the message catalogs

#### Scenario: Deterministic tie-breaks preserved

- **WHEN** two sourcing candidates tie on cost
- **THEN** the fixed country order (FI, EE, LV, LT, DE) resolves the tie exactly as the previous order did for the remaining countries

### Requirement: Norms dataset governance

A consumption norms row without a source citation SHALL never reach PUBLISHED, and publication SHALL require explicit manual confirmation through the operator path. Historical versions SHALL remain queryable.

#### Scenario: Manual confirmation required

- **WHEN** a new norms version is pending
- **THEN** it SHALL remain invisible to calculators until an operator confirms publication

