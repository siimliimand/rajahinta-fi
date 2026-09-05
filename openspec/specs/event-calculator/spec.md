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

The V2 extension SHALL compare sourcing per drink type across available countries by reusing the existing landed-cost engines, returning a purchase plan (domestic versus foreign store per line) under an optional budget, ordered deterministically by total cost.

#### Scenario: Foreign sourcing recommended when cheaper

- **WHEN** a drink type's landed cost from a foreign store undercuts the domestic price beyond the surplus cost of acquiring it
- **THEN** the plan SHALL assign that line to the foreign source with the figures shown

#### Scenario: Deterministic plan ordering

- **WHEN** two sourcing options tie on total cost
- **THEN** the plan SHALL order them by a documented deterministic tiebreaker, identically on every run

### Requirement: Norms dataset governance

A consumption norms row without a source citation SHALL never reach PUBLISHED, and publication SHALL require explicit manual confirmation through the operator path. Historical versions SHALL remain queryable.

#### Scenario: Manual confirmation required

- **WHEN** a new norms version is pending
- **THEN** it SHALL remain invisible to calculators until an operator confirms publication

