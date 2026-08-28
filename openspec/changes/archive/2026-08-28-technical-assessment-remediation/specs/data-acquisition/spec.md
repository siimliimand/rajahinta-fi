# data-acquisition Specification Delta

## ADDED Requirements

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
