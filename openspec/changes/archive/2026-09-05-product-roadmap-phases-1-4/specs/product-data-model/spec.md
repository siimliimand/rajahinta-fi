# product-data-model Specification

## ADDED Requirements

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
