# transaction-classification — Delta Spec

## MODIFIED Requirements

### Requirement: Three-way classification

The Transaction Classification Module SHALL output one of three classifications — Distance Selling, Distance Buying, or Traveller Import (excluded from calculation) — together with a confidence level and a human-readable evidence summary. All three outcomes SHALL be reachable through the public calculator input (via the transport-arrangement input); no outcome SHALL exist only in unit tests.

#### Scenario: Direct delivery signal

- **WHEN** a merchant offers direct delivery to Finland
- **THEN** the module SHALL classify the transaction as likely Distance Selling with the delivery offer recorded as evidence

#### Scenario: Personal transport reachable via calculator

- **WHEN** a user submits a calculation with transport arrangement PERSONAL (buyer transports the goods themselves)
- **THEN** the module SHALL classify the transaction as Traveller Import, the result SHALL carry the excluded-from-this-calculator messaging, and the classification SHALL NOT be forced to a distance-selling/buying outcome
