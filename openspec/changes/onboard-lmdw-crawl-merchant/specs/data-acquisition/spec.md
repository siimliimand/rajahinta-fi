# data-acquisition Specification

## MODIFIED Requirements

### Requirement: Permitted-source ingestion

The pipeline SHALL ingest only merchants with `GRANTED` governance status. The adapter registry SHALL contain thirteen registered feed adapters: the Alko domestic reference feed, the alks.fi, longero.fi, kippis.net, mydrink.ee, and araxes.ee WooCommerce Store API feeds, the viinarannasta.fi, viinikauppa.fi, licorea.com, and drinkonline.eu sitemap-crawl feeds, the bottleofitaly.com and kuhns.shop Shopify products feeds, and the lmdw crawl feed (whisky.fr product pages). The lmdw merchant SHALL be registered in the merchant registry (`('lmdw', 'La Maison du Whisky', 'FR', <feedUrl per the probe decision>, 'xml'|'json', daily cadence 86,400,000 ms)`) with its governance source recorded as `RETAILER_API` (the operator holds usage rights to the public product pages), seeded into local and staging environments through the deploy seed step and registered through the ops console in production (never seeded there). No merchant SHALL be fetched until an operator grants it through the governance gate. The Alko, alks, longero, kippis, araxes, sitemap-crawl, and Shopify adapters' behavior SHALL remain unchanged. The lmdw catalog SHALL be ingested through the shared crawl discipline (sequential per-host fetching, at least 1 s spacing, resumable chunks of at most 300 fetches, watermark/cursor diffing, per-page failures collected never thrown, a named crawler User-Agent) with its URL source per the probe decision (the merchant's product sitemap, or a GraphQL-seeded URL list that reads `url_key` values only — no product data from the GraphQL gateway, whose adapter design was spiked to NO-GO in the archived change `onboard-shopify-lmdw-merchants`). Product-page extraction SHALL read the whisky.fr state-JSON `volume` (litres → millilitres) and `strength` (ABV percent → decimal fraction) through a guarded per-source normalizer, JSON-LD price as EUR minor units (a non-EUR currency row SHALL be a per-row correction error, never converted), and category through the source-category mapper's additive French page-side terms (census spellings exact); records whose ABV or volume cannot be parsed SHALL ingest as `ESTIMATED` through the keyed-uncertainty path, never guessed. EANs SHALL be recorded only when the page attests a `gtin13` in its structured data — never fabricated; records without one stay EAN-less and correction-flagged. The source-category mapper SHALL NOT map gift-box, non-beverage, or merch terms. No foreign deposit system SHALL imply Finnish pantti membership — `depositSystem` stays `false` on every lmdw record.

#### Scenario: Registry holds all live merchants

- **WHEN** the ingestion scheduler enumerates permitted merchants
- **THEN** `alko`, `alks`, `longero`, `kippis`, `mydrink`, `araxes`, `viinarannasta`, `viinikauppa`, `licorea`, `drinkonline`, `bottleofitaly`, `kuhns`, and `lmdw` are the registered adapters, each resolved by merchantId through the adapter map

#### Scenario: Ungranted lmdw is skipped

- **WHEN** the lmdw source has no `GRANTED` governance record
- **THEN** the pipeline performs no fetch for it and persists no data

#### Scenario: LMDW catalog is crawled page-bounded

- **WHEN** a permitted lmdw ingestion runs
- **THEN** the crawl enumerates product URLs per the probe-decided source, fetches changed pages sequentially with at least 1 s spacing in resumable chunks of at most 300 fetches, diffs by `lastmod` against the job-scoped watermark (pure-sitemap path), and collects per-page failures without throwing — records from successful pages are still returned

#### Scenario: Page state-JSON resolves ABV and volume

- **WHEN** a product page's embedded state JSON carries `"strength": 45.8` and `"volume": 0.7`
- **THEN** the record's `alcoholByVolume` is 0.458 and `volumeMl` is 700; a page missing or carrying unparseable values ingests as `ESTIMATED` through the keyed-uncertainty path

#### Scenario: French page categories resolve through additive keys

- **WHEN** a crawled page's category signal (JSON-LD category or breadcrumbs) carries a census-mapped French term
- **THEN** the record's canonical category is the mapped canonical category with its established tax key; gift-box, non-beverage, and merch terms produce a correction error naming the missing canonical category, and no tax category is guessed

#### Scenario: GTIN13 is recorded only when the page attests it

- **WHEN** a product page's structured data carries a `gtin13` value matching an accepted EAN form
- **THEN** the record carries that EAN and joins by the EAN tier; a page without one ingests EAN-less and correction-flagged, never with a fabricated identifier

#### Scenario: LMDW feed is EUR-native without conversion

- **WHEN** a record is built from a crawled page
- **THEN** `priceCents` and `originalPriceCents` carry the EUR minor-unit price, `currency` is `'EUR'`, `originalCurrency` is `'EUR'`, and no `fxDatasetVersion` is set; a page advertising another currency produces a per-row correction error and persists no offer

#### Scenario: No foreign deposit implies Finnish pantti membership

- **WHEN** an lmdw record is built
- **THEN** the record's `depositSystem` is `false`, never assumed from the feed

#### Scenario: Daily lmdw ingest fires once per day

- **WHEN** the lmdw registry interval is 86,400,000 ms and the hourly tick runs through a full day
- **THEN** exactly one crawl message is enqueued for `lmdw`, at the first tick after the 24-hour bucket boundary (00:00 UTC)
