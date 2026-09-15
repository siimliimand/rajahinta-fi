# data-acquisition Specification

## MODIFIED Requirements

### Requirement: Permitted-source ingestion

The pipeline SHALL ingest only merchants with `GRANTED` governance status. The adapter registry SHALL contain three live feed adapters: the Alko domestic reference feed, the alks.fi WooCommerce Store API feed, and the longero.fi WooCommerce Store API feed. The longero merchant SHALL be registered in the merchant registry (feedUrl `https://longero.fi`, json, daily cadence, country `EE`) with its governance source recorded as `RETAILER_API` (operator holds documented scraping rights to the public Store API; the merchant is operated by TOVAGLUKE OÜ, Estonia — foreign-merchant tax model, `depositSystem` false), and SHALL NOT be fetched until an operator grants it through the governance gate. The Alko and alks adapters' behavior SHALL remain unchanged.

#### Scenario: Registry holds all live merchants

- **WHEN** the ingestion scheduler enumerates permitted merchants
- **THEN** `alko`, `alks`, and `longero` are the registry rows, each resolved to its own adapter through the adapter map

#### Scenario: Ungranted longero is skipped

- **WHEN** the longero source has no `GRANTED` governance record
- **THEN** the pipeline performs no fetch for it and persists no data

#### Scenario: Longero catalog is fetched page-bounded

- **WHEN** a permitted longero ingestion runs against the Store API collection
- **THEN** the walk fetches sequential pages at `per_page=100`, capped by the first usable `X-WP-TotalPages` header, and maps rows through the existing Store API parser — records with non-EAN SKUs are kept EAN-less and correction-flagged, not dropped

#### Scenario: Daily longero ingest fires once per day

- **WHEN** the longero registry interval is 86,400,000 ms and the hourly tick runs through a full day
- **THEN** exactly one ingestion message is enqueued for `longero`, at the first tick after the 24-hour bucket boundary
