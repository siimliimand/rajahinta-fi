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

### Requirement: Price observations as a TimescaleDB hypertable

`price_observations` SHALL be converted to a TimescaleDB hypertable with the TimescaleDB extension enabled in migrations and the compose file. Aggregation and watermark scans SHALL continue to work with unchanged semantics on the hypertable.

#### Scenario: Extension present

- **WHEN** the database is provisioned through migrations
- **THEN** the TimescaleDB extension SHALL be installed and `price_observations` SHALL be registered as a hypertable

#### Scenario: Watermark scan unchanged

- **WHEN** the aggregation job scans for observations past the watermark
- **THEN** results SHALL be identical to the pre-conversion behavior

### Requirement: Price alert storage

The schema SHALL provide a `priceAlerts` table (account, product, threshold cents, status, timestamps) and an `alertNotifications` table (alert, observed price, channel, delivery status, timestamps) in D1. Notification rows SHALL be append-only records of delivery attempts and SHALL never be rewritten.

#### Scenario: Alert bound to account

- **WHEN** an alert row is created
- **THEN** it SHALL reference the owning account and exactly one product

### Requirement: Product physical dimensions with provenance

The schema SHALL provide a `productDimensions` table recording weight, height, diameter, and packaging material (GLASS, CAN, PLASTIC, OTHER) per product, each row carrying source, reliability status, and observedAt. Absence of a row SHALL be representable and meaningful; dimension data SHALL never be fabricated to fill gaps.

#### Scenario: Dimensions stored with provenance

- **WHEN** a dimension row is loaded
- **THEN** consumers SHALL be able to read its source and reliability status alongside the values

### Requirement: Carrier box reference data

The schema SHALL provide a `carrierBoxTypes` table seeded with standard box types per carrier, including internal dimensions and maximum weight, used by the packing module as its only source of box geometry.

#### Scenario: Box selection reads seed data

- **WHEN** the packing module selects a box
- **THEN** the selected box SHALL reference a `carrierBoxTypes` row

### Requirement: Versioned consumption norms dataset

The schema SHALL provide a `consumptionNorms` table with per-row drink type, event profile, norm value, source citation, and effective window. Rows SHALL be append-only, SHALL never be overwritten, and SHALL follow the PENDING_CONFIRMATION to PUBLISHED lifecycle with manual confirmation required before publication, mirroring the FX dataset discipline.

#### Scenario: Norm without source cannot publish

- **WHEN** a consumption norms row lacks a source citation
- **THEN** the system SHALL refuse to move it to PUBLISHED

#### Scenario: Effective-dated resolution

- **WHEN** the event calculator resolves norms for an event date
- **THEN** it SHALL use the PUBLISHED version effective on that date and record the version in the result

### Requirement: Versioned traveller allowance datasets

The schema SHALL provide `travellerAllowanceDatasets` and `travellerAllowanceLimits` tables holding EU personal-use indicative limits, versioned, append-only, effective-dated, each limit carrying a source citation, published only through manual review. Historical versions SHALL remain queryable after a new version is published.

#### Scenario: Past version remains queryable

- **WHEN** a new allowance dataset version is published
- **THEN** the previous version SHALL still resolve for dates within its effective window

### Requirement: Curated affiliate ferry offers

The schema SHALL provide a `ferryOffers` table for curated affiliate links (operator, label, URL, status), managed through the audited operator console. Rows SHALL carry no pricing or ranking fields; the table cannot influence any calculation.

#### Scenario: Affiliate data isolated from calculation

- **WHEN** the trip feasibility calculation runs
- **THEN** `ferryOffers` SHALL NOT be part of its inputs or outputs

### Requirement: Evidence-mandatory producer links

The schema SHALL provide a `producerLinks` table connecting an Alko product to a sibling product sold abroad, with NOT NULL evidence columns (producer key, manufacturer, source URL) plus reviewer and review date. The schema SHALL make an unevidenced link unrepresentable.

#### Scenario: Link without evidence rejected

- **WHEN** an insert omits any evidence column
- **THEN** the database SHALL reject the write

### Requirement: Curated editorial entries

The schema SHALL provide a `curatedEntries` table (list slug, product or external reference, mandatory rationale, evidence links, draft or published status, reviewer) so editorial lists are updated through data, not code changes.

#### Scenario: Only published entries served

- **WHEN** the public list endpoint reads a slug
- **THEN** it SHALL return only entries in the published state

### Requirement: Group order sessions without payment data

The schema SHALL provide `groupOrderSessions` (share token, expiry, owner account) and `groupOrderItems` (session, participant nickname, product, quantity). Neither table SHALL contain payment-adjacent columns; the accounting-only boundary is enforced at the schema level.

#### Scenario: No payment fields exist

- **WHEN** the group order tables are inspected
- **THEN** no column SHALL reference payment instruments, payment links, or transaction settlement

