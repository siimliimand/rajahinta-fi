# data-acquisition Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.
## Requirements
### Requirement: Permitted-source ingestion

The pipeline SHALL ingest only merchants with `GRANTED` governance status. The adapter registry SHALL contain two live feed adapters: the Alko domestic reference feed and the alks.fi WooCommerce Store API feed. The alks.fi merchant SHALL be registered in the merchant registry (feedUrl `https://alks.fi`, json, hourly cadence) with its governance source recorded as `RETAILER_API`, and SHALL NOT be fetched until an operator grants it through the governance gate. The Alko adapter's behavior SHALL remain unchanged.

#### Scenario: Registry holds both live merchants

- **WHEN** the ingestion scheduler enumerates permitted merchants
- **THEN** `alko` and `alks` are the registry rows, each resolved to its own adapter through the `FEED_ADAPTERS` map

#### Scenario: Ungranted alks is skipped

- **WHEN** the alks source has no `GRANTED` governance record
- **THEN** the pipeline performs no fetch for it and persists no data

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

### Requirement: WooCommerce Store API pagination

The alks.fi adapter SHALL fetch the full product catalog by walking the Store API collection (`per_page` 100) in sequential requests, bounded by `X-WP-TotalPages`. A page failure SHALL be reported in the adapter's error list without throwing, and records from successful pages SHALL still be returned.

#### Scenario: Full catalog across pages

- **WHEN** the adapter fetches with 2,856 products reported by `X-WP-Total`
- **THEN** it requests 29 pages in order and returns the union of their records

#### Scenario: One page fails mid-walk

- **WHEN** page 12 returns HTTP 500
- **THEN** the error is appended to the result, pages 13 onward are still fetched, and records from pages 1 to 11 are returned

### Requirement: EAN from SKU prefix

The alks.fi adapter SHALL derive the EAN from the SKU by stripping a two-letter prefix and validating the remainder as 13 digits (`^[a-z]{2}-\d{13}$` on the raw SKU). A non-matching SKU SHALL yield a record without an EAN and a per-row correction error; the adapter SHALL NOT fabricate an EAN.

#### Scenario: Matching SKU

- **WHEN** a row has SKU `de-4740077005916`
- **THEN** the record carries EAN `4740077005916`

#### Scenario: Non-matching SKU

- **WHEN** a row has SKU `promo-123`
- **THEN** the record carries no EAN and the row's error names the SKU

### Requirement: Unparseable alcohol fields ingest as ESTIMATED

The alks.fi adapter SHALL parse ABV, volume, and container type from the product name, with categories as the beverage-type source. A product whose name yields no ABV or volume SHALL still be ingested, with the unparsed field null, and the resulting offer SHALL carry reliability status ESTIMATED. No record SHALL be dropped for a parse failure. When name tokens and categories both yield a beverage type and disagree, the row SHALL be reported to the correction queue rather than silently resolved.

#### Scenario: Parse failure keeps the product

- **WHEN** a product name contains no recognizable ABV or volume
- **THEN** the record is ingested with the unparsed field null and its offer is ESTIMATED

#### Scenario: Contradicting sources

- **WHEN** the name implies one beverage type and the categories another
- **THEN** the row produces a correction error and no category is persisted for it

### Requirement: Feed product weight captured

The alks.fi adapter SHALL map the payload's product weight to `weightGrams`, and the mapping layer SHALL persist it on the product master. Feeds that carry no weight SHALL leave the column null without error.

#### Scenario: Weight stored

- **WHEN** a row reports weight `0.53` (kg)
- **THEN** the product master row stores `weight_grams = 530`

#### Scenario: Weight absent

- **WHEN** a row has no weight field
- **THEN** the product master row keeps `weight_grams` null and the ingestion reports no error

