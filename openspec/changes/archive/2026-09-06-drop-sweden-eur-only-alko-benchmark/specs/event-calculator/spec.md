# event-calculator Specification

## MODIFIED Requirements

### Requirement: V2 cross-border sourcing plan

The V2 sourcing plan SHALL compare domestic purchase against foreign sourcing over the versioned sourcing-country set, which after this change SHALL be Finland, Estonia, Latvia, Lithuania, and Germany. Sweden SHALL NOT appear in the canonical country order, in validation, in fixtures, or in the user-facing country labels in either locale. All sourcing countries except Finland SHALL be EUR markets, consistent with the single-currency invariant.

#### Scenario: Sweden is not a selectable market

- **WHEN** the sourcing plan validates country inputs or the event page renders the country selector
- **THEN** `SE` is rejected as invalid and no Swedish label exists in the message catalogs

#### Scenario: Deterministic tie-breaks preserved

- **WHEN** two sourcing candidates tie on cost
- **THEN** the fixed country order (FI, EE, LV, LT, DE) resolves the tie exactly as the previous order did for the remaining countries
