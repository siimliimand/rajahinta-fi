# fx-rate-dataset Specification Delta

## ADDED Requirements

### Requirement: Versioned FX rate dataset

The system SHALL maintain foreign-exchange rates as a dated, versioned dataset with the same governance treatment as tax rules: each rate carries source provenance, effective date, currency pair, and the dataset version it belongs to. Dataset versions SHALL never be auto-published; a recurring job SHALL detect newly available rates and create a human confirmation task before any version becomes effective. Historical rate versions SHALL remain queryable after a new version is published.

#### Scenario: Rate resolves by observation date

- **WHEN** an offer observed on a past date needs conversion
- **THEN** the conversion SHALL use the rate from the dataset version effective on that observation date, not the newest rate

#### Scenario: Never auto-published

- **WHEN** a new FX rate source payload is ingested
- **THEN** the system SHALL create a confirmation task for a human operator and SHALL NOT mark the resulting dataset version effective without explicit confirmation

### Requirement: Conversion at ingestion with provenance

Every offer ingested in a currency other than EUR SHALL be converted to EUR cents at ingestion using the effective rate version, and the ingested record SHALL carry the original amount, the original currency, the converted EUR cents, and the FX dataset version used. Offers whose currency cannot be converted with an effective rate on the observation date SHALL be rejected at ingestion with a recorded reason.

#### Scenario: SEK offer converted

- **WHEN** a Systembolaget offer in SEK is ingested and an effective SEK/EUR rate exists for the observation date
- **THEN** the stored offer SHALL include EUR cents converted at that rate alongside the original SEK amount and the FX dataset version

#### Scenario: Unconvertible offer rejected

- **WHEN** an offer arrives in a currency with no effective rate on the observation date
- **THEN** ingestion SHALL reject the offer and record the rejection reason rather than storing a sum of unconverted amounts

### Requirement: Calculator sums converted currency only

The landed-cost calculation SHALL sum only EUR-converted amounts. Offers lacking a valid conversion SHALL be excluded from the total and the exclusion SHALL be visible as a reason on the result, never silently dropped.

#### Scenario: Mixed-currency offers

- **WHEN** a calculation draws on offers in multiple currencies
- **THEN** every amount entering the total SHALL be EUR cents produced by a recorded conversion, and the total SHALL be labelled EUR truthfully

### Requirement: FX dataset version invalidates caches

Idempotency and calculation caches keyed on dataset versions SHALL invalidate when the effective FX dataset version changes, matching the tax-dataset versioning convention.

#### Scenario: New effective version invalidates

- **WHEN** a confirmed FX dataset version becomes effective
- **THEN** cached calculations that used the previous version SHALL be invalidated rather than served stale
