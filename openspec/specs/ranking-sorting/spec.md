# ranking-sorting Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.

## Requirements

### Requirement: Objective sort orders

The Ranking & Sorting Module SHALL implement only the objective sort orders defined in the business plan: lowest estimated landed cost, lowest €/litre, lowest €/unit, alphabetical, alcohol percentage, and product category.

#### Scenario: Allowed sort

- **WHEN** a user selects "lowest estimated landed cost"
- **THEN** results SHALL be ordered by that criterion and no other

### Requirement: Structural neutrality

The sorting function's input type SHALL have no field available for a merchant payment, promotional flag, or manually curated boost. No code path SHALL allow a paid or manual boost to a merchant's position.

#### Scenario: No boost field

- **WHEN** a developer inspects the sort input type
- **THEN** no field exists that could encode a paid or curated position, and the ranking result SHALL correlate with no commercial or payment signal

### Requirement: Documentable logic

The module's logic SHALL be describable in plain language on a public "how ranking works" page without omitting any actual factor. The consumer-facing transparency presentation SHALL state the neutrality facts in consumer language — without type-system names, internal field names, or build-time terminology — while the developer-facing documentation retains the full technical detail. Omitting the jargon SHALL NOT omit any factor: every enforcement fact remains stated.

#### Scenario: Methodology in lockstep

- **WHEN** the public ranking page is compared against the implementation
- **THEN** the documented methodology SHALL match the actual sorting behavior exactly

#### Scenario: Transparency copy is consumer-language

- **WHEN** the transparency section renders on the ranking page in either locale
- **THEN** it states the neutrality enforcement facts — no paid-placement field exists in the sort input, the input shape is pinned by tests, and unexpected fields are rejected at runtime — without naming sort-input interface types, internal flag fields, or compile-time verification

### Requirement: €/g as a neutral sort option

The comparison sort options SHALL include €/g ethanol price, resolved through the shared unit-price module. The option SHALL behave under the same neutrality rules as every other sort: deterministic ordering, objective input data only, and no code path that reads billing, promotion, or merchant-preference state.

#### Scenario: Sort option registered

- **WHEN** the comparison sort options are enumerated and the unit-price flag is on
- **THEN** €/g SHALL appear as a selectable sort with a stable, documented ordering

#### Scenario: Flag off removes the option

- **WHEN** `enable_unit_price_eur_per_gram` is off
- **THEN** the €/g sort option SHALL NOT be offered by the API or rendered in the UI
