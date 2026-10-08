# data-acquisition Specification

## MODIFIED Requirements

### Requirement: Permitted-source ingestion

The pipeline SHALL ingest only merchants with `GRANTED` governance status. The adapter registry SHALL contain thirteen registered feed adapters: the Alko domestic reference feed, the alks.fi, longero.fi, kippis.net, mydrink.ee, and araxes.ee WooCommerce Store API feeds, the viinarannasta.fi, viinikauppa.fi, licorea.com, and drinkonline.eu sitemap-crawl feeds, the bottleofitaly.com Shopify products feed, the kuhns.shop Shopify products feed, and the lmdw Magento GraphQL feed (gateway.prod2.whisky.fr). The bottleofitaly, kuhns, and lmdw merchants SHALL be registered in the merchant registry (`('bottleofitaly', 'https://bottleofitaly.com', 'IT')`, `('kuhns', 'https://kuhns.shop', 'DE')`, `('lmdw', 'https://gateway.prod2.whisky.fr', 'FR')` — json, daily cadence 86,400,000 ms each) with their governance sources recorded as `RETAILER_API` (the operator holds usage rights to each store's public feed surface), seeded into local and staging environments through the deploy seed step and registered through the ops console in production (never seeded there). No merchant SHALL be fetched until an operator grants it through the governance gate. The Alko, alks, longero, kippis, mydrink, and araxes adapters' behavior SHALL remain unchanged. The two Shopify stores SHALL be fetched through a shared sequential page walk (`limit=250`, short-page termination — Shopify exposes no total-pages header; per-page failures collected, never thrown) and the LMDW catalog through a Magento GraphQL walk (a `category_id` filter is mandatory — filter-less queries are rejected by the gateway; `pageSize/currentPage` bounded by `total_count`; `sku` dedupe for multi-category rows). The source-category mapper SHALL recognize the bottleofitaly `product_type` English terms, the kuhns `product_type` German terms, and the lmdw `m3_family` French terms as additive exact keys to existing canonical categories (per each sweep's census), and SHALL NOT map non-beverage merch terms (`Olio`, `Aceto`, and census peers). Records whose SKU or storefront identifier matches no accepted EAN form SHALL be kept without an EAN and correction-flagged, not dropped. Bottleofitaly ABV SHALL be parsed from the `custom-gradazione-XX-X` tag and kuhns ABV/volume from the German title forms (`alc. N Vol.-%`, `0,75l` comma decimals); lmdw ABV SHALL be parsed from the product's `short_description` text and its volume from the spike-located source; records whose ABV or volume cannot be parsed SHALL ingest as `ESTIMATED` through the keyed-uncertainty path, never guessed. All three feeds are EUR-native: prices SHALL be stored as EUR minor units without conversion, and a non-EUR currency row SHALL be a per-row correction error, never converted. `depositSystem` SHALL be `false` on every bottleofitaly, kuhns, and lmdw record — no foreign deposit system implies Finnish pantti membership.

#### Scenario: Registry holds all live merchants

- **WHEN** the ingestion scheduler enumerates permitted merchants
- **THEN** `alko`, `alks`, `longero`, `kippis`, `mydrink`, `araxes`, `viinarannasta`, `viinikauppa`, `licorea`, `drinkonline`, `bottleofitaly`, `kuhns`, and `lmdw` are the registry rows, each resolved to its own adapter through the adapter map

#### Scenario: Ungranted new merchants are skipped

- **WHEN** any of `bottleofitaly`, `kuhns`, or `lmdw` has no `GRANTED` governance record
- **THEN** the pipeline performs no fetch for it and persists no data

#### Scenario: Shopify catalogs are fetched page-bounded

- **WHEN** a permitted bottleofitaly or kuhns ingestion runs against its products.json collection
- **THEN** the walk fetches sequential pages at `limit=250`, stops after the first short page (fewer products than the limit; an empty page is normal termination), and collects per-page failures (including HTTP 429) without throwing — records from successful pages are still returned

#### Scenario: BottleofItaly tag-ABV resolves to structured ABV

- **WHEN** a row carries a `custom-gradazione-40-0` tag
- **THEN** the record's `alcoholByVolume` is 0.40; a row whose tags carry no gradation token ingests with unparsed ABV through the ESTIMATED path

#### Scenario: German title forms resolve ABV and volume

- **WHEN** a kuhns row's title carries `alc. 12 Vol.-%` and `0,75l`
- **THEN** the record's `alcoholByVolume` is 0.12 and `volumeMl` is 750 (comma decimals normalized); a title matching neither form ingests as `ESTIMATED`

#### Scenario: LMDW catalog is walked through the mandatory category filter

- **WHEN** a permitted lmdw ingestion runs against the GraphQL gateway
- **THEN** the walk pages `products(filter: { category_id }, pageSize, currentPage)` to `total_count`, dedupes rows by `sku`, and never issues a filter-less query

#### Scenario: LMDW ABV resolves from the product text

- **WHEN** a row's `short_description` text carries a French ABV form (`à 45% alc.`, `52%`, `45,8%`)
- **THEN** the record's `alcoholByVolume` is the parsed decimal fraction; rows with no parseable ABV ingest as `ESTIMATED` and are held from user-facing surfaces by the live catalog-hygiene rule

#### Scenario: Merch categories stay unmapped

- **WHEN** a bottleofitaly row's only mappable-category candidate is `Olio` or `Aceto`
- **THEN** the record is dropped with a correction error naming the missing canonical category, and no tax category is guessed

#### Scenario: All three feeds are EUR-native without conversion

- **WHEN** a record is built from any of the three feeds
- **THEN** `priceCents` and `originalPriceCents` carry the EUR minor-unit price, `currency` is `'EUR'`, `originalCurrency` is `'EUR'`, and no `fxDatasetVersion` is set; a row advertising another currency produces a per-row correction error and persists no offer

#### Scenario: No foreign deposit implies Finnish pantti

- **WHEN** a bottleofitaly, kuhns, or lmdw record is built
- **THEN** the record's `depositSystem` is `false`

#### Scenario: EAN-less catalogs stay EAN-less

- **WHEN** a row's SKU or identifier matches no accepted EAN form (Shopify local codes, LMDW numeric SKUs)
- **THEN** the record is kept without an EAN and correction-flagged, not dropped, and repeat runs converge through the compound-key tier without duplicate product rows

#### Scenario: Daily ingest fires once per day per merchant

- **WHEN** each of the three registry intervals is 86,400,000 ms and the hourly tick runs through a full day
- **THEN** exactly one ingestion message is enqueued per merchant, at the first tick after the 24-hour bucket boundary (00:00 UTC)
