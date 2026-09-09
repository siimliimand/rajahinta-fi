# data-acquisition Specification

## MODIFIED Requirements

### Requirement: Permitted-source ingestion

The pipeline SHALL ingest only merchants with `GRANTED` governance status. The adapter registry SHALL contain two live feed adapters: the Alko domestic reference feed and the alks.fi WooCommerce Store API feed. The alks.fi merchant SHALL be registered in the merchant registry (feedUrl `https://alks.fi`, json, hourly cadence) with its governance source recorded as `RETAILER_API`, and SHALL NOT be fetched until an operator grants it through the governance gate. The Alko adapter's behavior SHALL remain unchanged.

#### Scenario: Registry holds both live merchants

- **WHEN** the ingestion scheduler enumerates permitted merchants
- **THEN** `alko` and `alks` are the registry rows, each resolved to its own adapter through the `FEED_ADAPTERS` map

#### Scenario: Ungranted alks is skipped

- **WHEN** the alks source has no `GRANTED` governance record
- **THEN** the pipeline performs no fetch for it and persists no data

## ADDED Requirements

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
