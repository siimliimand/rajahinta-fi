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

