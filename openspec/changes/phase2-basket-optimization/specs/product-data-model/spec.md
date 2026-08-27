# product-data-model Specification

## ADDED Requirements

### Requirement: Merchant terms table

The Drizzle schema SHALL include a `merchantTerms` table keyed by merchant, storing the minimum-order value (nullable, currency-denominated) with a source URL, reliability status, and observation timestamp. Rows SHALL be upsertable for corrections but never silently overwritten without provenance.

#### Scenario: Threshold recorded with provenance

- **WHEN** a merchant's minimum-order threshold is recorded or corrected
- **THEN** the row SHALL carry the source URL, reliability status, and observation timestamp of the fact

#### Scenario: Missing row means no known threshold

- **WHEN** no `merchantTerms` row exists for a merchant
- **THEN** the system SHALL treat the merchant as having no known minimum-order threshold and SHALL NOT invent one

### Requirement: Basket calculation records table

The Drizzle schema SHALL include a `basketCalculationRecords` table persisting every optimizer result shown to a user: the input basket (product IDs and quantities), destination, transport arrangement, per-shipment breakdown, total, confidence level, structural disclaimer, session ID, and timestamp.

#### Scenario: Optimizer result persisted

- **WHEN** an optimization result is returned to a user
- **THEN** a `basketCalculationRecords` row SHALL be persisted that reconstructs the result's inputs and breakdowns

#### Scenario: Flagged basket result traceable

- **WHEN** a user flags a basket result as incorrect
- **THEN** staff SHALL be able to reconstruct the result from the recorded basket input, per-shipment breakdown, and dataset versions
