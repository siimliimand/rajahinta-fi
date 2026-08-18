## ADDED Requirements

### Requirement: Billing deferral recorded

Third-party subscription billing SHALL be explicitly deferred to Phase 2 and recorded as such, with the billing service kept as a stable interface stub rather than silently claiming completion.

#### Scenario: Stable stub interface

- **WHEN** billing is queried in Phase 1
- **THEN** a stable, documented stub response SHALL be returned for all tiers

#### Scenario: Deferral documented

- **WHEN** the Phase 1 task list is reviewed
- **THEN** the billing integration task SHALL be marked deferred to Phase 2, not complete

### Requirement: Billing-ranking separation retained

The billing module SHALL have no code path connecting a merchant account to the Ranking & Sorting Module inputs, regardless of the deferral.

#### Scenario: No shared write path

- **WHEN** billing and ranking modules are inspected
- **THEN** no shared write path SHALL exist between them
