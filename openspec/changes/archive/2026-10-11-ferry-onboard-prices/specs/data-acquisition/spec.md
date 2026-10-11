# data-acquisition Delta

## ADDED Requirements

### Requirement: Curated ferry onboard price source

Ferry onboard-shop prices SHALL enter the platform only through a manually curated in-repo dataset on the established curated-source model (Fransberg/Posti pattern): operator-transcribed rows carrying operator, route, display label, EUR minor-unit price, observation date, and a per-row source citation. Ingestion SHALL run on the monthly curated-rate-refresh cron, skip unchanged datasets by observation date, and remain gated by the source-governance store (an operator key per ferry operator, fail-closed `PENDING` until granted). No row without a citation and observation date SHALL be ingested, and no ingested row SHALL participate in any calculation input — the table feeds display-only reads.

#### Scenario: Monthly refresh ingests the curated dataset

- **WHEN** the monthly curated-rate-refresh cron runs after the dataset's `OBSERVED_AT` changed
- **THEN** the ferry price rows are upserted into `ferry_price_observations` and each stored row carries its citation and observation date

#### Scenario: Unchanged dataset is skipped

- **WHEN** the curated ferry dataset's observation date is unchanged since the last sync
- **THEN** the cron performs no append and reports the skip

#### Scenario: Ungoverned operator fails closed

- **WHEN** a ferry operator key has no `GRANTED` governance record
- **THEN** no rows for that operator are ingested

#### Scenario: Citation-less rows are refused

- **WHEN** a dataset row lacks a source citation or an observation date
- **THEN** ingestion refuses the row rather than storing an uncited price
