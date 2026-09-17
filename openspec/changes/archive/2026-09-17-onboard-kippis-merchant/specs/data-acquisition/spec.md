# data-acquisition Specification

## MODIFIED Requirements

### Requirement: Permitted-source ingestion

The pipeline SHALL ingest only merchants with `GRANTED` governance status. The adapter registry SHALL contain four live feed adapters: the Alko domestic reference feed, the alks.fi WooCommerce Store API feed, the longero.fi WooCommerce Store API feed, and the kippis.net WooCommerce Store API feed. The kippis merchant SHALL be registered in the merchant registry (feedUrl `https://www.kippis.net`, json, daily cadence, country `FI`) with its governance source recorded as `RETAILER_API` (operator holds documented scraping rights to the public Store API), and SHALL NOT be fetched until an operator grants it through the governance gate. The Alko, alks, and longero adapters' behavior SHALL remain unchanged.

#### Scenario: Registry holds all live merchants

- **WHEN** the ingestion scheduler enumerates permitted merchants
- **THEN** `alko`, `alks`, `longero`, and `kippis` are the registry rows, each resolved to its own adapter through the adapter map

#### Scenario: Ungranted longero is skipped

- **WHEN** the longero source has no `GRANTED` governance record
- **THEN** the pipeline performs no fetch for it and persists no data

#### Scenario: Ungranted kippis is skipped

- **WHEN** the kippis source has no `GRANTED` governance record
- **THEN** the pipeline performs no fetch for it and persists no data

#### Scenario: Longero catalog is fetched page-bounded

- **WHEN** a permitted longero ingestion runs against the Store API collection
- **THEN** the walk fetches sequential pages at `per_page=100`, capped by the first usable `X-WP-TotalPages` header, and maps rows through the existing Store API parser — records with non-EAN SKUs are kept EAN-less and correction-flagged, not dropped

#### Scenario: Kippis catalog is fetched page-bounded

- **WHEN** a permitted kippis ingestion runs against the Store API collection
- **THEN** the walk fetches sequential pages at `per_page=100`, capped by the first usable `X-WP-TotalPages` header, and maps rows through the existing Store API parser — records with non-EAN SKUs are kept EAN-less and correction-flagged, not dropped

#### Scenario: Daily longero ingest fires once per day

- **WHEN** the longero registry interval is 86,400,000 ms and the hourly tick runs through a full day
- **THEN** exactly one ingestion message is enqueued for `longero`, at the first tick after the 24-hour bucket boundary

#### Scenario: Daily kippis ingest fires once per day

- **WHEN** the kippis registry interval is 86,400,000 ms and the hourly tick runs through a full day
- **THEN** exactly one ingestion message is enqueued for `kippis`, at the first tick after the 24-hour bucket boundary

### Requirement: EAN from SKU prefix

The WooCommerce Store API adapters (alks.fi, longero.fi, kippis.net) SHALL derive the EAN from the SKU in three accepted forms: a two-letter-prefixed 13-digit SKU (`^[a-z]{2}-\d{13}$`, prefix stripped), a bare 13-digit SKU (`^\d{13}$`), and a 14-digit SKU beginning with zero (`^0\d{13}$` — the GTIN-14 form of a 13-digit EAN, leading zero stripped). Any other non-empty SKU SHALL yield a record without an EAN and a per-row correction error; the adapters SHALL NOT fabricate an EAN.

#### Scenario: Matching prefixed SKU

- **WHEN** a row has SKU `de-4740077005916`
- **THEN** the record carries EAN `4740077005916`

#### Scenario: Matching bare 13-digit SKU

- **WHEN** a row has SKU `6412700071701`
- **THEN** the record carries EAN `6412700071701`

#### Scenario: Matching GTIN-14 SKU

- **WHEN** a row has SKU `06412700071701`
- **THEN** the record carries EAN `6412700071701`

#### Scenario: Non-matching SKU

- **WHEN** a row has SKU `promo-123`
- **THEN** the record carries no EAN and the row's error names the SKU
