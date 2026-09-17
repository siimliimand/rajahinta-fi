# historical-price-intelligence Specification

## MODIFIED Requirements

### Requirement: Product page price history

Product pages SHALL render a price-history view for the observed price with 30/90/365-day ranges, served by the existing historical price API. The chart SHALL have a data-table alternative conveying the same observations, SHALL NOT rely on color alone to distinguish series, and SHALL state the observation dates. When no history exists for a product, the section SHALL be absent rather than empty.

#### Scenario: History renders with ranges

- **WHEN** a product with observed history renders its page
- **THEN** the history section offers 30, 90, and 365-day views backed by the existing API

#### Scenario: Table alternative

- **WHEN** the history section renders
- **THEN** an accessible table with the same observation values and dates is available

#### Scenario: No history, no section

- **WHEN** a product has no observed history
- **THEN** the page renders without the history section and without an empty-state error
