# calculation-outcomes Specification

## ADDED Requirements

### Requirement: Catalog coverage block on the accuracy response

The public accuracy response SHALL carry an additive `coverage` block computed read-time from stored catalog state: the distinct product count, the total offer observation count, and the last ingestion watermark timestamp. The block SHALL contain only true stored values — no estimates, no seeded counters. The user-reported statistic's shape and semantics SHALL be unchanged; the coverage block is additive and display-only, and SHALL NOT feed the calculator, ranking, or any basket input.

#### Scenario: Coverage block present and true

- **WHEN** the accuracy endpoint is requested with zero stored outcomes
- **THEN** the response carries `count: 0` exactly as before, plus the coverage block whose values equal the corresponding D1 counts and watermark

#### Scenario: Additive, display-only

- **WHEN** the coverage block is added to the response
- **THEN** calculator, ranking, and basket responses remain byte-identical (compliance-pinned), and no coverage value feeds any calculation input
