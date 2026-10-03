# Spec Delta: event-calculator

## MODIFIED Requirements

### Requirement: V2 cross-border sourcing plan

The V2 sourcing plan SHALL compare domestic purchase against foreign sourcing over the versioned sourcing-country set, which after this change SHALL be Finland, Estonia, Latvia, Lithuania, and Germany. Sweden SHALL NOT appear in the canonical country order, in validation, in fixtures, or in the user-facing country labels in either locale. All sourcing countries except Finland SHALL be EUR markets, consistent with the single-currency invariant. The consumer-facing label for the foreign-comparison control SHALL describe the capability without a version suffix; the V2 identifier remains internal to code, configuration, and documentation.

#### Scenario: Sweden is not a selectable market

- **WHEN** the sourcing plan validates country inputs or the event page renders the country selector
- **THEN** `SE` is rejected as invalid and no Swedish label exists in the message catalogs

#### Scenario: No version suffix in consumer labels

- **WHEN** the event calculator renders the foreign-comparison toggle in either locale
- **THEN** the label describes the capability (comparing against foreign stores) and contains no version marker

#### Scenario: Deterministic tie-breaks preserved

- **WHEN** two sourcing candidates tie on cost
- **THEN** the fixed country order (FI, EE, LV, LT, DE) resolves the tie exactly as the previous order did for the remaining countries
