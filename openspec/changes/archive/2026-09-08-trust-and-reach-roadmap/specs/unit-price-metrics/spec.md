# unit-price-metrics Specification

## MODIFIED Requirements

### Requirement: Category ranking by ethanol unit price

The system SHALL expose a public per-category listing ordered deterministically by ethanol €/g ascending, computed by the existing pure unit-price function. Each row SHALL carry its reliability status (VERIFIED or ESTIMATED); products whose unit price is unavailable SHALL be omitted from the listing rather than placed at an arbitrary position. Equal values SHALL resolve by a stable secondary key so the order is fully deterministic.

#### Scenario: Ranking is deterministic

- **WHEN** the ranking endpoint is queried twice for the same category and dataset state
- **THEN** both responses SHALL contain the products in identical order

#### Scenario: Status carried per row

- **WHEN** the ranking is rendered or returned
- **THEN** each row SHALL include its reliability status and the interface SHALL render it with the standard status components

#### Scenario: Unavailable prices omitted

- **WHEN** a product in the category has no computable unit price
- **THEN** it SHALL NOT appear in the ranking

### Requirement: Informational, non-editorial presentation

The ranking SHALL be presented as an informational listing. Copy SHALL NOT characterize products as best, recommended, or otherwise editorial, consistent with the content-policy lint, and the ranking SHALL NOT feed product default ordering, search order, or any calculation input.

#### Scenario: Neutral copy enforced

- **WHEN** the ranking page and its API responses are linted by the content-policy suite
- **THEN** no editorial or promotional phrasing SHALL be present

#### Scenario: No effect on other orderings

- **WHEN** the unit-price ranking is computed for a category
- **THEN** product search order, offer ordering, and calculation outputs SHALL remain unchanged
