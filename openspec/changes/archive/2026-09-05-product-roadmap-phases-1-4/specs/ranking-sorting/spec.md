# ranking-sorting Specification

## ADDED Requirements

### Requirement: €/g as a neutral sort option

The comparison sort options SHALL include €/g ethanol price, resolved through the shared unit-price module. The option SHALL behave under the same neutrality rules as every other sort: deterministic ordering, objective input data only, and no code path that reads billing, promotion, or merchant-preference state.

#### Scenario: Sort option registered

- **WHEN** the comparison sort options are enumerated and the unit-price flag is on
- **THEN** €/g SHALL appear as a selectable sort with a stable, documented ordering

#### Scenario: Flag off removes the option

- **WHEN** `enable_unit_price_eur_per_gram` is off
- **THEN** the €/g sort option SHALL NOT be offered by the API or rendered in the UI
