# unit-price-metrics Specification

## Purpose
TBD - created by archiving change product-roadmap-phases-1-4. Update Purpose after archive.
## Requirements
### Requirement: Price per gram of pure ethanol

The system SHALL compute a unit price in euro per gram of pure ethanol for every product offer as price divided by the product of unit volume in litres, alcohol fraction, and ethanol density (789 g/l). The metric SHALL be derived at read time from stored offer and product fields and SHALL NOT be persisted as a column.

#### Scenario: Metric computed from complete inputs

- **WHEN** an offer has a price and the product has both unit volume and alcohol percentage
- **THEN** the API SHALL return the €/g value computed by the pure function, with the offer's price reliability status attached

#### Scenario: Missing alcohol data

- **WHEN** a product has no alcohol percentage
- **THEN** the metric SHALL be reported as unavailable with an explicit status, and no value SHALL be silently substituted

### Requirement: Status consistency with the reliability framework

The €/g metric SHALL inherit its reliability from its inputs: an offer price that is not VERIFIED yields an ESTIMATED metric, and the status SHALL be surfaced wherever the value is shown.

#### Scenario: Estimated price produces estimated metric

- **WHEN** the underlying offer price carries an ESTIMATED status
- **THEN** the €/g metric SHALL be labeled ESTIMATED in the API response and the UI

### Requirement: €/g sorting is objective and deterministic

Where the metric is exposed, sorting by €/g SHALL order strictly by metric value with product id as the tiebreaker, producing the same order on every request for the same data. The sort SHALL NOT accept any commercial or promotion signal.

#### Scenario: Stable ordering

- **WHEN** two products share the same €/g value
- **THEN** they SHALL be ordered by product id, identically on every request

### Requirement: Formula transparency in the UI

The compare view SHALL present the €/g metric with a tooltip that states the formula, the ethanol density constant, and the reliability status of the inputs, consistent with the VERIFIED/ESTIMATED presentation used elsewhere.

#### Scenario: Tooltip explains the calculation

- **WHEN** a user views the €/g column
- **THEN** an accessible tooltip SHALL show the formula and the status of the underlying price, volume, and alcohol inputs

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

