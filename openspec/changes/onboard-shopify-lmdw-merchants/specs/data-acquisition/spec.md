# data-acquisition Specification

## MODIFIED Requirements

### Requirement: Permitted-source ingestion

The pipeline SHALL ingest only merchants with `GRANTED` governance status. The adapter registry SHALL contain twelve registered feed adapters: the Alko domestic reference feed, the alks.fi, longero.fi, kippis.net, mydrink.ee, and araxes.ee WooCommerce Store API feeds, the viinarannasta.fi, viinikauppa.fi, licorea.com, and drinkonline.eu sitemap-crawl feeds, the bottleofitaly.com Shopify products feed, and the kuhns.shop Shopify products feed. The bottleofitaly and kuhns merchants SHALL be registered in the merchant registry (`('bottleofitaly', 'https://bottleofitaly.com', 'IT')`, `('kuhns', 'https://kuhns.shop', 'DE')` — json, daily cadence 86,400,000 ms each) with their governance sources recorded as `RETAILER_API` (the operator holds usage rights to each store's public feed surface), seeded into local and staging environments through the deploy seed step and registered through the ops console in production (never seeded there). No merchant SHALL be fetched until an operator grants it through the governance gate. The Alko, alks, longero, kippis, mydrink, araxes, and sitemap-crawl adapters' behavior SHALL remain unchanged. Both Shopify stores SHALL be fetched through a shared sequential page walk (`limit=250`, short-page termination — Shopify exposes no total-pages header; per-page failures collected, never thrown). The source-category mapper SHALL recognize the bottleofitaly `product_type` English terms and the kuhns `product_type` German terms as additive exact keys to existing canonical categories (per each sweep's census), and SHALL NOT map non-beverage merch terms (`Olio`, `Aceto`, and census peers). Records whose SKU or storefront identifier matches no accepted EAN form SHALL be kept without an EAN and correction-flagged, not dropped. Bottleofitaly ABV SHALL be parsed from the `custom-gradazione-XX-X` tag with volume from the title, falling back to the sweep-discovered whole-tag volume token (`150cl`-shaped), and honest `0 ml` + `ESTIMATED` where no source exists (the wine majority); kuhns ABV/volume SHALL be parsed from the German title forms (`alc. N Vol.-%`, `0,75l` comma decimals) with typed-`product_type` rows mapped through the vocabulary and untyped rows classified through the parser's name-token fallback; records whose ABV or volume cannot be parsed SHALL ingest as `ESTIMATED` through the keyed-uncertainty path, never guessed. Both feeds are EUR-native: prices SHALL be stored as EUR minor units without conversion, and a non-EUR currency row SHALL be a per-row correction error, never converted. `depositSystem` SHALL be `false` on every bottleofitaly and kuhns record — no foreign deposit system implies Finnish pantti membership.

#### Scenario: Registry holds all live merchants

- **WHEN** the ingestion scheduler enumerates permitted merchants
- **THEN** `alko`, `alks`, `longero`, `kippis`, `mydrink`, `araxes`, `viinarannasta`, `viinikauppa`, `licorea`, `drinkonline`, `bottleofitaly`, and `kuhns` are the registered adapters, each resolved by merchantId through the adapter map

#### Scenario: Ungranted new merchants are skipped

- **WHEN** either `bottleofitaly` or `kuhns` has no `GRANTED` governance record
- **THEN** the pipeline performs no fetch for it and persists no data

#### Scenario: Shopify catalogs are fetched page-bounded

- **WHEN** a permitted bottleofitaly or kuhns ingestion runs against its products.json collection
- **THEN** the walk fetches sequential pages at `limit=250`, stops after the first short page (fewer products than the limit; an empty page is normal termination), and collects per-page failures (including HTTP 429) without throwing — records from successful pages are still returned

#### Scenario: BottleofItaly tag-ABV resolves to structured ABV

- **WHEN** a row carries a `custom-gradazione-40-0` tag
- **THEN** the record's `alcoholByVolume` is 0.40; a row whose tags carry no gradation token ingests with unparsed ABV through the ESTIMATED path

#### Scenario: BottleofItaly volume resolves through the measured fallback chain

- **WHEN** a row's title carries a volume token (`20cl`, `0,75 l`)
- **THEN** the record's `volumeMl` is the parsed value; a title-less row with a whole-tag volume token (`150cl`-shaped) resolves from the tag; a row with neither (the wine majority) ingests with `0 ml` volume as `ESTIMATED`, never a guessed value

#### Scenario: German title forms resolve ABV and volume

- **WHEN** a kuhns row's title carries `alc. 12 Vol.-%` and `0,75l`
- **THEN** the record's `alcoholByVolume` is 0.12 and `volumeMl` is 750 (comma decimals normalized); a title matching neither form ingests as `ESTIMATED`

#### Scenario: Untyped kuhns rows classify through the name-token fallback

- **WHEN** a kuhns row's `product_type` is empty (the 93.7 % sweep-measured majority)
- **THEN** the record's canonical category resolves through the parser's name-token path (categories-first, name-tokens-second, contradiction gate), and a row with no inferable beverage type drops with a correction error naming the missing canonical category

#### Scenario: Merch categories stay unmapped

- **WHEN** a bottleofitaly row's only mappable-category candidate is `Olio` or `Aceto`
- **THEN** the record is dropped with a correction error naming the missing canonical category, and no tax category is guessed

#### Scenario: Both feeds are EUR-native without conversion

- **WHEN** a record is built from either feed
- **THEN** `priceCents` and `originalPriceCents` carry the EUR minor-unit price, `currency` is `'EUR'`, `originalCurrency` is `'EUR'`, and no `fxDatasetVersion` is set; a row advertising another currency produces a per-row correction error and persists no offer

#### Scenario: No foreign deposit implies Finnish pantti

- **WHEN** a bottleofitaly or kuhns record is built
- **THEN** the record's `depositSystem` is `false`

#### Scenario: EAN-less catalogs stay EAN-less

- **WHEN** a row's SKU or identifier matches no accepted EAN form (Shopify local codes; barcodes are absent from both stores)
- **THEN** the record is kept without an EAN and correction-flagged, not dropped, and repeat runs converge through the compound-key tier without duplicate product rows

#### Scenario: Daily ingest fires once per day per merchant

- **WHEN** each of the two registry intervals is 86,400,000 ms and the hourly tick runs through a full day
- **THEN** exactly one ingestion message is enqueued per merchant, at the first tick after the 24-hour bucket boundary (00:00 UTC)
