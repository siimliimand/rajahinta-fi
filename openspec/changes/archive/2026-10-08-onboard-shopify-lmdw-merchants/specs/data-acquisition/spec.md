# data-acquisition Specification

## MODIFIED Requirements

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
