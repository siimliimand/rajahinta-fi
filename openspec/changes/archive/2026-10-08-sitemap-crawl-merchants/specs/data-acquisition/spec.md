# data-acquisition Delta

## ADDED Requirements

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
