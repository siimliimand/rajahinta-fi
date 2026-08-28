# data-acquisition Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.
## Requirements
### Requirement: Permitted-source ingestion

The system SHALL acquire product and price data only from permitted feeds, retailer APIs, structured merchant feeds, licensed providers, or compliant crawling, and SHALL record the acquisition method for each source.

#### Scenario: New merchant source

- **WHEN** a new merchant source is onboarded
- **THEN** its acquisition method and permission status SHALL be recorded before any of its data enters the platform

### Requirement: Off-by-default enforcement

A merchant or data source SHALL be off (not queried, not displayed) until it has a recorded permission status.

#### Scenario: Unapproved source

- **WHEN** a source lacks a recorded permission status
- **THEN** the system SHALL NOT query it and SHALL NOT display any of its data

### Requirement: Source reliability status

Every externally sourced data point (price, transport, classification input) SHALL carry a reliability status of VERIFIED, STALE, UNAVAILABLE, or ESTIMATED.

#### Scenario: Stale detection

- **WHEN** a Retail Offer or Transport Offer exceeds its staleness threshold
- **THEN** the system SHALL flag it STALE, and it SHALL NOT be presented as VERIFIED

### Requirement: Scheduled rate review

The rate-review process SHALL run on a recurring scheduled job that checks for newly published official rate changes, rather than a hardcoded stub that always reports no changes.

#### Scenario: New rates detected

- **WHEN** the scheduled job detects newly published official rates
- **THEN** a manual/legal review entry SHALL be created before any dataset version goes live

#### Scenario: No auto-publish

- **WHEN** a rate change is detected
- **THEN** it SHALL never be published automatically; a confirmed review step is required

#### Scenario: Review task recorded

- **WHEN** a rate change review entry is created
- **THEN** it SHALL be persisted with a pending status for operators to inspect

### Requirement: Content linting pipeline step

The pipeline orchestrator SHALL include a content linting step after data mapping and before upsert. The step SHALL run the content linting service against every mapped product's name and description, and SHALL include results in the pipeline run report.

#### Scenario: Lint step runs after mapping

- **WHEN** the pipeline orchestrator executes a run for a merchant
- **THEN** after the DataMappingService maps raw records and before the UpsertPortAdapter persists them, the content linting service SHALL be invoked on the mapped product names

#### Scenario: Lint violations in pipeline report

- **WHEN** a product triggers a content vocabulary violation
- **THEN** the pipeline run report SHALL include the violation detail (pattern matched, matching text, product identifier) in its quality section

### Requirement: Currency normalization at ingestion

Adapters ingesting non-EUR offers SHALL convert to EUR cents through the FX rate dataset effective on the observation date, store the original amount and currency for display, and reject offers that cannot be converted. Ingestion SHALL NOT store foreign-currency amounts as if they were EUR.

#### Scenario: Systembolaget SEK offers

- **WHEN** the Systembolaget adapter ingests offers priced in SEK
- **THEN** each stored offer SHALL carry EUR cents converted via the effective FX dataset version plus the original SEK amount

### Requirement: Database-backed merchant registry

Merchant configuration SHALL live in a database-backed registry aligned with the governance records, replacing static configuration files. Onboarding or changing a permitted merchant SHALL NOT require a deployment.

#### Scenario: Registry-driven source list

- **WHEN** the ingestion pipeline enumerates merchant sources
- **THEN** the list SHALL come from the registry joined with governance permission state

### Requirement: Real carrier transport source

Transport-rate refresh SHALL obtain rates from at least one real carrier source (Posti first) through the same governance-gated pipeline used for prices. The system SHALL alert when the newest transport offer exceeds the 7-day freshness threshold.

#### Scenario: Rates refresh from carrier

- **WHEN** the scheduled transport refresh runs
- **THEN** transport offers SHALL be updated from carrier data and each offer SHALL carry observed timestamps that advance

#### Scenario: Stale transport detected

- **WHEN** no transport offer newer than 7 days exists for a lane
- **THEN** the alerting rule SHALL fire

### Requirement: Second merchant feed

At least one additional merchant feed beyond the initial source SHALL be ingested through the adapter interface and governance gate, providing the domestic reference price (Alko).

#### Scenario: Alko offers ingested

- **WHEN** the Alko adapter runs against the domestic feed
- **THEN** its offers SHALL pass the governance gate and enter comparison data with reliability status and provenance
