# data-acquisition Specification

## MODIFIED Requirements

### Requirement: Permitted-source ingestion

The pipeline SHALL ingest only merchants with `GRANTED` governance status. The adapter registry SHALL contain six live feed adapters: the Alko domestic reference feed, the alks.fi WooCommerce Store API feed, the longero.fi WooCommerce Store API feed, the kippis.net WooCommerce Store API feed, the mydrink.ee WooCommerce Store API feed, and the araxes.ee WooCommerce Store API feed. The mydrink merchant SHALL be registered in the merchant registry (feedUrl `https://mydrink.ee`, json, daily cadence, country `EE`) with its governance source recorded as `RETAILER_API` (operator holds documented scraping rights to the owner-operated site's public Store API). The araxes merchant SHALL be registered in the merchant registry (feedUrl `https://araxes.ee`, json, daily cadence, country `EE`) with its governance source recorded as `RETAILER_API` (the operator holds usage rights to the site's public Store API), seeded into local and staging environments through the deploy seed step and registered through the ops console in production (never seeded there). No merchant SHALL be fetched until an operator grants it through the governance gate. The Alko, alks, longero, and kippis adapters' behavior SHALL remain unchanged. The source-category mapper SHALL recognize the MyDrink Estonian storefront terms as additive exact keys (spirits section and its leaves to spirits/liqueur, wine leaf terms to wine or sparkling-wine, `õlu ▾` to beer, `siider` to cider, `alkoholivaba ▾` and `karastusjoogid` to non-alcoholic) and the Araxes bare Estonian terms as additive exact keys (the strong-alcohol section parent and its spirit-type leaves to spirits, `liköör` to liqueur, the still-wine leaf terms to wine, the sparkling leaf terms to sparkling-wine, the fortified leaf terms to fortified-wine, `õlu` to beer, `long drink` to long-drink, the non-alcoholic section and its children to non-alcoholic) and SHALL NOT map the wine parent terms (either store's spelling), the identically named Araxes wine leaf, heterogeneous promo sections, RTD cocktail terms, non-beverage merch terms, or non-beverage navigation terms. Records whose SKU matches no accepted EAN form SHALL be kept without an EAN and correction-flagged, not dropped. The Araxes feed's Estonian `Pant` attribute SHALL NOT set Finnish deposit-system membership — `depositSystem` stays `false` on every araxes record.

#### Scenario: Registry holds all live merchants

- **WHEN** the ingestion scheduler enumerates permitted merchants
- **THEN** `alko`, `alks`, `longero`, `kippis`, `mydrink`, and `araxes` are the registry rows, each resolved to its own adapter through the adapter map

#### Scenario: Ungranted longero is skipped

- **WHEN** the longero source has no `GRANTED` governance record
- **THEN** the pipeline performs no fetch for it and persists no data

#### Scenario: Ungranted kippis is skipped

- **WHEN** the kippis source has no `GRANTED` governance record
- **THEN** the pipeline performs no fetch for it and persists no data

#### Scenario: Ungranted mydrink is skipped

- **WHEN** the mydrink source has no `GRANTED` governance record
- **THEN** the pipeline performs no fetch for it and persists no data

#### Scenario: Ungranted araxes is skipped

- **WHEN** the araxes source has no `GRANTED` governance record
- **THEN** the pipeline performs no fetch for it and persists no data

#### Scenario: Longero catalog is fetched page-bounded

- **WHEN** a permitted longero ingestion runs against the Store API collection
- **THEN** the walk fetches sequential pages at `per_page=100`, capped by the first usable `X-WP-TotalPages` header, and maps rows through the existing Store API parser — records with non-EAN SKUs are kept EAN-less and correction-flagged, not dropped

#### Scenario: Kippis catalog is fetched page-bounded

- **WHEN** a permitted kippis ingestion runs against the Store API collection
- **THEN** the walk fetches sequential pages at `per_page=100`, capped by the first usable `X-WP-TotalPages` header, and maps rows through the existing Store API parser — records with non-EAN SKUs are kept EAN-less and correction-flagged, not dropped

#### Scenario: Mydrink catalog is fetched page-bounded

- **WHEN** a permitted mydrink ingestion runs against the Store API collection
- **THEN** the walk fetches sequential pages at `per_page=100`, capped by the first usable `X-WP-TotalPages` header, and maps rows through the existing Store API parser — records with non-EAN SKUs are kept EAN-less and correction-flagged, not dropped

#### Scenario: Araxes catalog is fetched page-bounded

- **WHEN** a permitted araxes ingestion runs against the Store API collection
- **THEN** the walk fetches sequential pages at `per_page=100`, capped by the first usable `X-WP-TotalPages` header, and maps rows through the existing Store API parser — records with non-EAN SKUs are kept EAN-less and correction-flagged, not dropped

#### Scenario: Daily longero ingest fires once per day

- **WHEN** the longero registry interval is 86,400,000 ms and the hourly tick runs through a full day
- **THEN** exactly one ingestion message is enqueued for `longero`, at the first tick after the 24-hour bucket boundary

#### Scenario: Daily kippis ingest fires once per day

- **WHEN** the kippis registry interval is 86,400,000 ms and the hourly tick runs through a full day
- **THEN** exactly one ingestion message is enqueued for `kippis`, at the first tick after the 24-hour bucket boundary

#### Scenario: Daily mydrink ingest fires once per day

- **WHEN** the mydrink registry interval is 86,400,000 ms and the hourly tick runs through a full day
- **THEN** exactly one ingestion message is enqueued for `mydrink`, at the first tick after the 24-hour bucket boundary

#### Scenario: Daily araxes ingest fires once per day

- **WHEN** the araxes registry interval is 86,400,000 ms and the hourly tick runs through a full day
- **THEN** exactly one ingestion message is enqueued for `araxes`, at the first tick after the 24-hour bucket boundary (00:00 UTC)

#### Scenario: Sparkling wine resolves from its leaf term

- **WHEN** a row's categories include `Vahuveinid` (or `Shampanjad`) from mydrink, or `Vahuvein` (or `Šampanja`) from araxes
- **THEN** the record's canonical category is sparkling-wine with tax key `wine_sparkling`, regardless of any unmapped parent wine term on the row

#### Scenario: Still wine resolves from its leaf terms

- **WHEN** a row's categories include `Punased`, `Valged`, or `Pakiveinid` (mydrink) or `Punane vein`, `Valge vein`, `Roosa vein`, or `Puuvilja- ja marjavein` (araxes)
- **THEN** the record's canonical category is wine with tax key `wine_still`

#### Scenario: Fortified wine resolves from its leaf terms

- **WHEN** a row's categories include `Hõõgvein`, `Vermut`, or `Liköörvein, portvein, šerri`
- **THEN** the record's canonical category is fortified-wine with tax key `intermediate_products`

#### Scenario: Bare Estonian spirit leaves resolve to spirits

- **WHEN** a row's categories include `Viin`, `Brändi`, `Džinn`, `Tekiila`, `Kalvados`, `Armanjakk`, or `Absint` (or the bare parent `Kange alkohol`)
- **THEN** the record's canonical category is spirits with tax key `spirits`

#### Scenario: Bare beer and long-drink leaves resolve to their canonical categories

- **WHEN** a row's categories include `Õlu` or `Long drink`
- **THEN** the record's canonical category is beer (`beer`) or long-drink (`other_fermented`) respectively

#### Scenario: Non-alcoholic section resolves to non-alcoholic

- **WHEN** a row's categories include `Alkoholivaba` or one of its araxes children (`Energiajook`, `Karastusjook`, `Mahl`, `Vesi`, `Alkoholivaba õlu`, `Alkoholivaba vein`, `Alkoholivaba vahuvein`)
- **THEN** the record's canonical category is non-alcoholic with tax key `other_fermented`

#### Scenario: Tax-ambiguous categories stay unmapped

- **WHEN** a row's only mappable-category candidates are `Kokteilijoogid` or `☝️ Lahja alkohol` (mydrink), `Kokteilid`, the wine parent `Vein`, or its identically named leaf (araxes), `Suupisted`, `Kotid`, `Kommid`, or `Pakend`
- **THEN** the record is dropped with a correction error naming the missing canonical category, and no tax category is guessed

#### Scenario: Estonian pant never implies Finnish pantti membership

- **WHEN** an araxes record is built from a row whose `Pant` attribute carries any value (including `0€`)
- **THEN** the record's `depositSystem` is `false`, never assumed from the feed attribute
