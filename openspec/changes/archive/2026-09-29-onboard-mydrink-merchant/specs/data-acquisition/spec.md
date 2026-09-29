# data-acquisition Specification

## MODIFIED Requirements

### Requirement: Permitted-source ingestion

The pipeline SHALL ingest only merchants with `GRANTED` governance status. The adapter registry SHALL contain five live feed adapters: the Alko domestic reference feed, the alks.fi WooCommerce Store API feed, the longero.fi WooCommerce Store API feed, the kippis.net WooCommerce Store API feed, and the mydrink.ee WooCommerce Store API feed. The mydrink merchant SHALL be registered in the merchant registry (feedUrl `https://mydrink.ee`, json, daily cadence, country `EE`) with its governance source recorded as `RETAILER_API` (operator holds documented scraping rights to the owner-operated site's public Store API), and SHALL NOT be fetched until an operator grants it through the governance gate. The Alko, alks, longero, and kippis adapters' behavior SHALL remain unchanged. The source-category mapper SHALL recognize the MyDrink Estonian storefront terms as additive exact keys (spirits section and its leaves to spirits/liqueur, wine leaf terms to wine or sparkling-wine, `õlu ▾` to beer, `siider` to cider, `alkoholivaba ▾` and `karastusjoogid` to non-alcoholic) and SHALL NOT map the wine parent term, heterogeneous promo sections, or non-beverage navigation terms. Records whose SKU matches no accepted EAN form SHALL be kept without an EAN and correction-flagged, not dropped.

#### Scenario: Registry holds all live merchants

- **WHEN** the ingestion scheduler enumerates permitted merchants
- **THEN** `alko`, `alks`, `longero`, `kippis`, and `mydrink` are the registry rows, each resolved to its own adapter through the adapter map

#### Scenario: Ungranted mydrink is skipped

- **WHEN** the mydrink source has no `GRANTED` governance record
- **THEN** the pipeline performs no fetch for it and persists no data

#### Scenario: Mydrink catalog is fetched page-bounded

- **WHEN** a permitted mydrink ingestion runs against the Store API collection
- **THEN** the walk fetches sequential pages at `per_page=100`, capped by the first usable `X-WP-TotalPages` header, and maps rows through the existing Store API parser — records with non-EAN SKUs are kept EAN-less and correction-flagged, not dropped

#### Scenario: Daily mydrink ingest fires once per day

- **WHEN** the mydrink registry interval is 86,400,000 ms and the hourly tick runs through a full day
- **THEN** exactly one ingestion message is enqueued for `mydrink`, at the first tick after the 24-hour bucket boundary

#### Scenario: Sparkling wine resolves from its leaf term

- **WHEN** a row's categories include `Vahuveinid` (or `Shampanjad`)
- **THEN** the record's canonical category is sparkling-wine with tax key `wine_sparkling`, regardless of any unmapped parent wine term on the row

#### Scenario: Still wine resolves from its leaf terms

- **WHEN** a row's categories include `Punased`, `Valged`, or `Pakiveinid`
- **THEN** the record's canonical category is wine with tax key `wine_still`

#### Scenario: Tax-ambiguous categories stay unmapped

- **WHEN** a row's only mappable-category candidates are `Kokteilijoogid`, `☝️ Lahja alkohol`, `Kingiideed ▾`, `Avaleht`, or a country name
- **THEN** the record is dropped with a correction error naming the missing canonical category, and no tax category is guessed
