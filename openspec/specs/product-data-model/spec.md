# product-data-model Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.
## Requirements
### Requirement: Canonical Product Master

The system SHALL maintain one Product Master record per canonical product, independent of how many merchants sell it, holding manufacturer, brand, product category, alcohol percentage, unit volume, container type, regulatory classification, and deposit-system status.

#### Scenario: Same product across merchants

- **WHEN** two foreign retailers sell the same physical product (same brand, vintage, and bottle size)
- **THEN** both merchant listings SHALL resolve to one canonical Product Master with two linked Retail Offers

### Requirement: Retail Offer linkage

Each Retail Offer SHALL reference exactly one Product Master and SHALL store merchant, country, current price, currency, availability, source URL, timestamp, and reliability status.

#### Scenario: Price refresh

- **WHEN** a merchant price changes
- **THEN** the Retail Offer SHALL be updated with the new price and a fresh timestamp, and the prior observation SHALL remain attributable to its own timestamp

### Requirement: Versioned Tax Rule

Tax Rule records SHALL be versioned with an effective date range and SHALL never be mutated in place. A rate change SHALL create a new version, leaving the prior version queryable.

#### Scenario: Rate change preserves history

- **WHEN** the Finnish Tax Administration publishes a new excise rate
- **THEN** a new Tax Rule version SHALL be created with its own effective period, and calculations dated before the change SHALL still resolve against the prior version

### Requirement: Calculation Record auditability

Every landed-cost result shown to a user SHALL be persisted in a Calculation Record referencing the exact Product Master, Retail Offer, Transport Offer, and Tax Rule versions used, plus the resulting confidence level.

#### Scenario: Reproduce a past result

- **WHEN** a user flags a past calculation as incorrect
- **THEN** staff SHALL be able to reconstruct the calculation from the recorded version references and the input values that produced it

### Requirement: Account and saved-basket persistence tables

The Drizzle schema SHALL include `accounts` and `savedBaskets` tables for persistent storage of account data, replacing the in-memory Map implementation used in Phase 1.

#### Scenario: Account created and persisted

- **WHEN** an account is created via AccountService
- **THEN** a row SHALL be inserted into the `accounts` table with a unique identifier and creation timestamp

#### Scenario: Basket saved and persisted

- **WHEN** a user saves a basket
- **THEN** a row SHALL be inserted into the `savedBaskets` table referencing the account ID and containing the product IDs and quantities

#### Scenario: Basket retrieved after restart

- **WHEN** the application restarts and a user queries their saved baskets
- **THEN** all previously saved baskets SHALL be returned from the database

### Requirement: price_observations table

The schema SHALL include a `price_observations` table with: product master FK, merchant identifier, retail offer FK, observation timestamp, foreign retail price (cents), transport cost (cents), excise rule version FK, container-duty rule version FK, landed cost (cents), per-input reliability snapshot (JSONB), and aggregate confidence. The table SHALL have indexes on (product, observedAt) and (merchant, product, observedAt).

#### Scenario: Append-only contract

- **WHEN** repositories are generated for `price_observations`
- **THEN** the data-platform repository SHALL expose insert and range-read operations only, with no update or delete API

### Requirement: price_history_summaries table

The schema SHALL include a `price_history_summaries` table with: granularity (daily or weekly), period start, product master FK, merchant (nullable for product-wide rows), open/close/min/max/avg for price and landed cost (cents), observation count, and strictest source reliability. A unique constraint SHALL exist on (granularity, period start, product, merchant), and an index SHALL cover (granularity, product, period start).

#### Scenario: Idempotent upsert key

- **WHEN** the aggregation job upserts a summary for the same granularity, period, product, and merchant twice
- **THEN** the second write SHALL update the existing row rather than duplicate it

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

