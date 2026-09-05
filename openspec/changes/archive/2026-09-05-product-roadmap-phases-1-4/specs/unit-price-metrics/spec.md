# unit-price-metrics Specification

## ADDED Requirements

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
