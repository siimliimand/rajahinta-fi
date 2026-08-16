## ADDED Requirements

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

The module's logic SHALL be describable in plain language on a public "how ranking works" page without omitting any actual factor.

#### Scenario: Methodology in lockstep

- **WHEN** the public ranking page is compared against the implementation
- **THEN** the documented methodology SHALL match the actual sorting behavior exactly