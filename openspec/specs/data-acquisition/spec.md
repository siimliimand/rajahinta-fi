# data-acquisition Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.

## Requirements

### Requirement: Permitted-source ingestion

The pipeline SHALL ingest only merchants with `GRANTED` governance status. The adapter registry SHALL contain twelve registered feed adapters: the Alko domestic reference feed, the alks.fi, longero.fi, kippis.net, mydrink.ee, and araxes.ee WooCommerce Store API feeds, the viinarannasta.fi, viinikauppa.fi, licorea.com, and drinkonline.eu sitemap-crawl feeds, the bottleofitaly.com Shopify products feed, and the kuhns.shop Shopify products feed. The mydrink merchant SHALL be registered in the merchant registry (feedUrl `https://mydrink.ee`, json, daily cadence, country `EE`) with its governance source recorded as `RETAILER_API` (operator holds documented scraping rights to the owner-operated site's public Store API). The araxes merchant SHALL be registered in the merchant registry (feedUrl `https://araxes.ee`, json, daily cadence, country `EE`) with its governance source recorded as `RETAILER_API` (the operator holds usage rights to the site's public Store API), seeded into local and staging environments through the deploy seed step and registered through the ops console in production (never seeded there). The bottleofitaly merchant SHALL be registered in the merchant registry (`https://bottleofitaly.com`, json, daily cadence 86,400,000 ms, country `IT`) and the kuhns merchant (`https://kuhns.shop`, json, daily cadence 86,400,000 ms, country `DE`), each with its governance source recorded as `RETAILER_API` (the operator holds usage rights to each store's public products feed), seeded into local and staging environments through the deploy seed step and registered through the ops console in production (never seeded there). No merchant SHALL be fetched until an operator grants it through the governance gate. The Alko, alks, longero, kippis, araxes, and sitemap-crawl adapters' behavior SHALL remain unchanged. The two Shopify stores SHALL be fetched through a shared sequential page walk (`limit=250`, short-page termination — Shopify exposes no total-pages header; per-page failures including HTTP 429 collected, never thrown; a named crawler User-Agent header — Shopify edges hard-403 an empty-UA client). The source-category mapper SHALL recognize the MyDrink Estonian storefront terms as additive exact keys (spirits section and its leaves to spirits/liqueur, wine leaf terms to wine or sparkling-wine, `õlu ▾` to beer, `siider` to cider, `alkoholivaba ▾` and `karastusjoogid` to non-alcoholic), the Araxes bare Estonian terms as additive exact keys (the strong-alcohol section parent and its spirit-type leaves to spirits, `liköör` to liqueur, the still-wine leaf terms to wine, the sparkling leaf terms to sparkling-wine, the fortified leaf terms to fortified-wine, `õlu` to beer, `long drink` to long-drink, the non-alcoholic section and its children to non-alcoholic), the bottleofitaly `product_type` English terms as additive exact keys (`Spirits` to spirits, `Vino Rosso`/`Vino Bianco`/`Vino Rosato` to wine, `Bollicine` to sparkling-wine, `Birra` to beer), and the kuhns `product_type` German terms as additive exact keys (`Wein` to wine, `Bier` to beer, `Sekt` to sparkling-wine, `Whisky`/`Rum` to spirits — covering the typed minority; the untyped majority classifies through the parser's name-token fallback) and SHALL NOT map the wine parent terms (either store's spelling), the identically named Araxes wine leaf, heterogeneous promo sections, RTD cocktail terms, non-beverage merch terms (`Olio`, `Aceto`, `Altro`, `Gadget`, `Buoni regalo` among them), non-beverage navigation terms, or the kuhns juice/water/soft-drink/merch terms. Records whose SKU matches no accepted EAN form SHALL be kept without an EAN and correction-flagged, not dropped. Bottleofitaly ABV SHALL be parsed from the `custom-gradazione-XX-X` tag with volume resolved through the measured fallback chain (title token, then the whole-tag volume token, then honest `0 ml` + `ESTIMATED` for the wine majority); kuhns ABV/volume SHALL be parsed from the German title forms (`alc. N Vol.-%`, `0,75l` comma decimals, multipack `N×unit` tokens); records whose ABV or volume cannot be parsed SHALL ingest as `ESTIMATED` through the keyed-uncertainty path, never guessed. Both Shopify feeds are EUR-native: prices SHALL be stored as EUR minor units without conversion, `compare_at_price` unread, and a non-EUR currency row SHALL be a per-row correction error, never converted. No foreign deposit system SHALL imply Finnish pantti membership — `depositSystem` stays `false` on every bottleofitaly and kuhns record, as on every araxes record whose Estonian `Pant` attribute carries any value.

#### Scenario: Registry holds all live merchants

- **WHEN** the ingestion scheduler enumerates permitted merchants
- **THEN** `alko`, `alks`, `longero`, `kippis`, `mydrink`, `araxes`, `viinarannasta`, `viinikauppa`, `licorea`, `drinkonline`, `bottleofitaly`, and `kuhns` are the registered adapters, each resolved by merchantId through the adapter map

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

#### Scenario: Ungranted bottleofitaly and kuhns are skipped

- **WHEN** either the bottleofitaly or the kuhns source has no `GRANTED` governance record
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

#### Scenario: Shopify catalogs are fetched page-bounded

- **WHEN** a permitted bottleofitaly or kuhns ingestion runs against its products.json collection
- **THEN** the walk fetches sequential pages at `limit=250`, stops after the first short page (fewer products than the limit; an empty page is normal termination), and collects per-page failures (including HTTP 429) without throwing — records from successful pages are still returned

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

#### Scenario: Daily bottleofitaly and kuhns ingests fire once per day

- **WHEN** each of the bottleofitaly and kuhns registry intervals is 86,400,000 ms and the hourly tick runs through a full day
- **THEN** exactly one ingestion message is enqueued per merchant, at the first tick after the 24-hour bucket boundary (00:00 UTC)

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

#### Scenario: Non-beverage merch categories stay unmapped

- **WHEN** a bottleofitaly row's only mappable-category candidate is `Olio`, `Aceto`, `Altro`, `Gadget`, `Buoni regalo`, or the bare wine parent `Vino`, or a kuhns row's only candidate is a juice/water/soft-drink/merch term from the census
- **THEN** the record is dropped with a correction error naming the missing canonical category, and no tax category is guessed

#### Scenario: BottleofItaly tag-ABV resolves to structured ABV

- **WHEN** a row carries a `custom-gradazione-40-0` tag
- **THEN** the record's `alcoholByVolume` is 0.40; a row whose tags carry no gradation token ingests with unparsed ABV through the ESTIMATED path

#### Scenario: BottleofItaly volume resolves through the measured fallback chain

- **WHEN** a row's title carries a volume token (`20cl`, `0,75 l`)
- **THEN** the record's `volumeMl` is the parsed value; a title-less row with a whole-tag volume token (`150cl`-shaped) resolves from the tag; a row with neither (the wine majority) ingests with `0 ml` volume as `ESTIMATED`, never a guessed value

#### Scenario: German title forms resolve ABV and volume

- **WHEN** a kuhns row's title carries `alc. 12 Vol.-%` and `0,75l`
- **THEN** the record's `alcoholByVolume` is 0.12 and `volumeMl` is 750 (comma decimals normalized); a title matching neither form (including range forms like `40,5-46 Vol.-%`) ingests as `ESTIMATED`

#### Scenario: Untyped kuhns rows classify through the name-token fallback

- **WHEN** a kuhns row's `product_type` is empty (the 93.7 % sweep-measured majority)
- **THEN** the record's canonical category resolves through the parser's name-token path (categories-first, name-tokens-second, contradiction gate), and a row with no inferable beverage type drops with a correction error naming the missing canonical category

#### Scenario: Both Shopify feeds are EUR-native without conversion

- **WHEN** a record is built from either feed
- **THEN** `priceCents` and `originalPriceCents` carry the EUR minor-unit price, `currency` is `'EUR'`, `originalCurrency` is `'EUR'`, and no `fxDatasetVersion` is set; a row advertising another currency produces a per-row correction error and persists no offer

#### Scenario: Estonian pant never implies Finnish pantti membership

- **WHEN** an araxes record is built from a row whose `Pant` attribute carries any value (including `0€`)
- **THEN** the record's `depositSystem` is `false`, never assumed from the feed attribute

#### Scenario: No foreign deposit implies Finnish pantti membership

- **WHEN** a bottleofitaly or kuhns record is built
- **THEN** the record's `depositSystem` is `false`, never assumed from the feed

#### Scenario: EAN-less Shopify catalogs stay EAN-less

- **WHEN** a row's SKU or identifier matches no accepted EAN form (Shopify local codes; barcodes are absent from both stores)
- **THEN** the record is kept without an EAN and correction-flagged, not dropped, and repeat runs converge through the compound-key tier without duplicate product rows

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

Merchant configuration SHALL live in a database-backed registry aligned with the governance records, replacing static configuration files. Onboarding, changing, or re-cadencing a permitted merchant SHALL NOT require a deployment: the scheduler SHALL honor each merchant's registry `polling_interval_ms` as its scrape interval. The hourly scheduling tick SHALL remain; a merchant SHALL be enqueued on a tick only when an interval boundary was crossed since the previous tick. Intervals below one hour SHALL NOT be schedulable (the tick cannot honor them). Existing hourly-interval merchants SHALL keep their current behavior.

#### Scenario: Registry-driven source list

- **WHEN** the ingestion pipeline enumerates merchant sources
- **THEN** the list SHALL come from the registry joined with governance permission state

#### Scenario: Daily merchant fires once per day

- **WHEN** a merchant's registry interval is 86,400,000 ms and the hourly tick runs through a full day
- **THEN** exactly one ingestion message is enqueued for that merchant, at the first tick after the 24-hour bucket boundary

#### Scenario: Hourly merchant unchanged

- **WHEN** a merchant's registry interval is 3,600,000 ms
- **THEN** the merchant is enqueued on every hourly tick exactly as before the gate existed

#### Scenario: Missed tick self-heals

- **WHEN** the tick that would cross an interval boundary fails to run
- **THEN** the next successful tick enqueues the merchant once, and the hourly dedupe key prevents duplication

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

### Requirement: Feed record mapping

`DataMappingService.mapToProductAndOffer` SHALL convert source millilitres to litres before persisting `unitVolume`, and SHALL decode HTML entities (named and numeric, e.g. `&#038;`, `&amp;`, `&#8221;`, `&#215;`) in source-provided `productName` and `brand` strings before persisting them. Persisted display text SHALL contain no undecoded entities; render-time output escaping SHALL remain unchanged.

#### Scenario: Millilitre source value lands as litres

- **WHEN** a feed record with `volumeMl = 750` is mapped
- **THEN** the persisted `unitVolume` is `"0.75"`

#### Scenario: Encoded catalog names are stored decoded

- **WHEN** a feed record's product name contains `&#038;` or `&#8221;`
- **THEN** the persisted name contains `&` or the typographic quote respectively and no entity literal

#### Scenario: Entity decoding does not double-decode or corrupt plain text

- **WHEN** a product name contains no entities (or already-decoded ampersands)
- **THEN** the persisted name is byte-identical to the source name

### Requirement: Offer price plausibility gate

Ingestion SHALL reject any mapped offer whose price is not a positive integer cent amount. A price of `0` or less SHALL be treated as price drift: the offer is not published, the failure carries an explicit drift message naming the source value, and the rejection is counted in the data-quality metrics.

#### Scenario: Zero-priced feed product is rejected

- **WHEN** a WooCommerce feed product carries a minor-unit price of `"0"`
- **THEN** mapping fails with a price-drift error and no offer is published for that product

#### Scenario: Rejections are observable

- **WHEN** the ingestion pipeline rejects zero or negative prices
- **THEN** the rejection count is observable through the data-quality metrics

### Requirement: Category-bounded volume plausibility

The ingestion quality stage SHALL enforce per-category unit-volume ceilings (beer, cider, wine, spirits and the remaining catalog categories, bounds in one constants table). A product whose parsed unit volume exceeds its category bound SHALL have its volume stored as unavailable with a review flag — never published as a plausible value. The existing `0 < unit_volume < 100` invariant remains in force as the outer rail.

#### Scenario: Category-implausible volume is not published

- **WHEN** a beer product parses to a unit volume above the beer ceiling (e.g. "24×33 l")
- **THEN** the product's volume is unavailable, the row is flagged for review, and no plausible 33-litre beer appears in the catalog

#### Scenario: Plausible volumes pass unchanged

- **WHEN** a product's parsed unit volume is within its category bound
- **THEN** the volume is stored as before and no review flag is set

### Requirement: Multipack-aware volume parsing

The shared WooCommerce name parser SHALL parse multipack volume tokens (`24×0,33 l`, `24 x 33 cl`) into a deterministic unit volume and pack count rather than applying first-token-wins to a possibly mistyped token.

#### Scenario: Multipack token resolves to unit volume

- **WHEN** a feed product name contains `24×0,33 l`
- **THEN** the parser records a unit volume of 330 ml with pack count 24

### Requirement: Bundle names are held for review

A feed product whose name indicates a multi-product bundle (multi-brand concatenation such as "+ Jägermeister …") SHALL be held for review instead of being published as a single product with arbitrarily parsed ABV/volume.

#### Scenario: Bundle is not published as a product

- **WHEN** a feed row's name concatenates distinct products
- **THEN** the row is held for review and no product with a misattributed ABV/volume is published

### Requirement: Pipeline contract fixtures pin ingestion gates

Golden fixtures SHALL cover the observed failure shapes (zero price, category-implausible volume, bundle name) and a pipeline contract test SHALL assert that none of them publishes: the gates hold for the class, not only for the four recorded incidents.

#### Scenario: Contract test keeps the gates honest

- **WHEN** the fixture pipeline runs in CI
- **THEN** no fixture with a zero price, category-implausible volume, or bundle name produces a published product/offer

### Requirement: Non-alcoholic rows barred from alcohol categories

A feed row whose parsed ABV is zero, or for which no ABV could be parsed, SHALL NOT be assigned into any of the canonical alcohol categories during ingestion. Such rows SHALL still be ingested (the ESTIMATED-status contract for unparseable fields is unchanged) but SHALL be correction-flagged with a hold reason and SHALL NOT appear on any user-facing surface. A row with a parsed ABV greater than zero keeps today's behavior entirely.

#### Scenario: Zero-ABV row is held from alcohol categories

- **WHEN** a feed row parses to ABV 0 (e.g. an energy drink) whose storefront category would map into an alcohol category
- **THEN** the row is ingested with a correction flag and hold reason, and is not assigned into the alcohol category

#### Scenario: Unparseable-ABV row is held, status contract intact

- **WHEN** a feed row has no parseable ABV and would map into an alcohol category
- **THEN** the row ingests as ESTIMATED exactly as before, carries the correction flag and hold reason, and does not appear in the alcohol catalog

#### Scenario: Parsed non-zero ABV is unchanged

- **WHEN** a feed row parses to ABV greater than zero
- **THEN** category mapping and publication behave exactly as before this requirement

### Requirement: Sitemap crawl sources discover products politely

A sitemap-crawl source SHALL fetch its sitemap at most once per scheduled
cycle per merchant. Product detail pages SHALL be fetched sequentially per
host with at least 1 second between requests, under a descriptive User-Agent,
bounded by the URL set taken from the sitemap, and never re-fetched within the
same cycle. Individual page failures SHALL be collected and reported, and
SHALL NOT abort the walk (the `IFeedAdapter` must-not-throw contract).

#### Scenario: First crawl of a source

- **WHEN** a newly granted sitemap-crawl merchant's schedule first fires
- **THEN** the sitemap is fetched once, every product URL is crawled
  sequentially at ≥ 1 req/s, and page failures are collected without stopping
  the walk

#### Scenario: Sitemap contains non-product locs

- **WHEN** the sitemap includes image files, CMS pages, or controller routes
- **THEN** only product detail URLs are crawled

### Requirement: Incremental sync uses sitemap lastmod where available

For sources whose sitemap exposes `lastmod`, a cycle SHALL crawl only URLs
that are new or whose `lastmod` changed since the previous cycle, with the
comparison state persisted per merchant and resumable across invocations. For
sources without `lastmod`, every cycle SHALL be a full refresh. The first
crawl of any source is a full refresh.

#### Scenario: Steady-state incremental cycle

- **WHEN** a `lastmod`-bearing source's schedule fires and only a subset of
  entries changed
- **THEN** only the changed and new URLs are crawled, and unchanged URLs are
  skipped

#### Scenario: Source without lastmod

- **WHEN** a source configured as full-refresh fires
- **THEN** all product URLs are crawled, chunked and resumably

### Requirement: Extraction prefers structured data with bounded fallbacks

Extraction SHALL attempt JSON-LD `Product`, then schema.org microdata, then
OG/meta with per-source normalizers. EAN/GTIN SHALL be captured where the page
exposes it. ABV and volume SHALL come from structured fields first, with
per-source fallbacks (description prose, title parsing) configured per source.
Product images and long descriptions SHALL NOT be ingested.

#### Scenario: Complete JSON-LD product

- **WHEN** a licorea.com page exposes a complete JSON-LD `Product` with
  `gtin13`, price, currency, and availability
- **THEN** the record carries EAN, EUR price, and availability without
  fallback parsing

#### Scenario: Store-brand trap

- **WHEN** a viinikauppa.com JSON-LD `brand` equals the store name
- **THEN** the source config overrides it and ABV is parsed from the
  description prose per that source's normalizer

#### Scenario: Offers as array

- **WHEN** a drinkonline.eu page exposes `offers` as a JSON array
- **THEN** the extractor selects the valid offer rather than failing

### Requirement: Sources without viable attributes are parked, not scraped

A source that blocks platform egress or cannot yield the fields required for
alcohol-category eligibility SHALL be recorded in `source_governance` as
`PENDING` with a machine-readable `statusReason`, and SHALL have no `feedUrl`,
so the producer skips it by its existing empty-feedUrl rule. No adapter code
SHALL exist for a parked source.

#### Scenario: Parked sources are skipped

- **WHEN** the hourly producer reads the merchant registry with spritxxl.net
  and lazyshop.fi as `PENDING` rows without `feedUrl`
- **THEN** no queue messages are produced for them and no crawl code runs

### Requirement: Curated carrier rate fidelity

A curated carrier dataset SHALL transcribe every published price verbatim
from the carrier's own price page — never reconstructed from an inferred
formula — and each row SHALL trace to a source page and a dataset-level
observation timestamp set to the transcription date, so the freshness
threshold measures the data's age, not the refresh's. When a carrier prices
a transport tier by destination sub-zone (postal-code zone) and the transport
offer model has no zone dimension, the transcription SHALL use the most
expensive offered zone so the stored price is conservative, never optimistic,
for any destination within the route. A curated dataset refresh SHALL diff
the new transcription against the incumbent dataset and SHALL NOT append
rows when no published price has changed, keeping the append-only offer
history free of no-op generations.

#### Scenario: Zone-priced pallet transcribes at worst-case zone

- **WHEN** a carrier publishes one pallet price table per FI postal-code zone and the dataset is transcribed
- **THEN** each weight bracket is stored once at the most expensive zone's price, and no zone column or per-zone row duplication is introduced

#### Scenario: Observation timestamp reflects the source

- **WHEN** a dataset is first transcribed or later repriced
- **THEN** the dataset's observation constant is set to that transcription date, and the appended offer rows carry it as `observed_at` regardless of when the refresh cron runs

#### Scenario: Unchanged re-transcription appends nothing

- **WHEN** a refresh re-transcribes a carrier's price page and every price equals the incumbent dataset
- **THEN** the refresh skips the carrier for that cycle and no new rows are appended
