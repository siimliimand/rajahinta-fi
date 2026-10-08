# Proposal: sitemap-crawl-merchants

## Why

Merchant coverage rests on four WooCommerce Store API feeds (alks, longero,
kippis, mydrink). ARCHITECTURE §16 anticipates merchant feeds for further EUR
markets. Six candidate retailers with documented scraping rights were surveyed
(2026-10-07 reconnaissance, read-only): sitemaps total ≈ 4 MB across ≈ 9,900
product URLs, all EUR. No reachable product page challenged honest automated
access (one request per page, descriptive User-Agent), and the whole crawl can
run on Cloudflare Workers — the host's CPU is never used, satisfying the
"do not burden our server" constraint by construction.

Four sources expose rich structured product data — two with EAN/GTIN
(viinarannasta `GTIN13` microdata, licorea `gtin13` JSON-LD) — making them
ingestable into the existing governed pipeline with modest new code:

| source | products | structured data | EAN | lastmod |
|---|---|---|---|---|
| viinarannasta.eu | ~830 | schema.org microdata | ✅ | ✅ |
| viinikauppa.com | 944 | JSON-LD (thin) | ❌ | ✅ |
| licorea.com (en) | 2,351 | JSON-LD (complete) | ✅ | ✅ |
| drinkonline.eu | 1,838 | JSON-LD (offers array) | ❌ | ❌ |

Two sources are **parked**, recorded in governance but not scraped:

- `spritxxl.net` — Fastly JS client challenge on sitemap and robots.txt; the
  same egress-blocking class as the Posti precedent (ARCHITECTURE §6).
- `lazyshop.fi` — no structured data and no ABV, volume, EAN, or brand on the
  page; rows would be held by the non-alcoholic guard and unmatchable against
  `product_master`.

Sequencing: this change lands **after** `nonalcoholic-catalog-hygiene`
merges — that change edits the shared parser and category-mapping invariants
every crawl record flows through.

## What Changes

- **New sitemap-crawl adapter family** in `data-acquisition`: fetch the
  sitemap at most once per scheduled cycle, parse `loc` + `lastmod` (CDATA,
  namespaces, image-URL filtering), diff against a persisted per-merchant
  watermark, then crawl changed product pages politely — sequential per host,
  ≥ 1 s between requests, descriptive User-Agent, bounded by the sitemap URL
  set, page failures collected but never aborting the walk.
- **Structured-data-first extraction**: JSON-LD → schema.org microdata →
  OG/meta + bounded per-source normalizers (drinkonline `offers[]` array,
  viinikauppa store-brand override and ABV-from-description regex, title-based
  volume/ABV parsing). EAN captured where exposed. Product images and long
  descriptions are **not** ingested (data minimization).
- **Four v1 sources onboarded**: `merchant_registry` rows (`feedFormat` xml,
  daily `pollingIntervalMs`) and `source_governance` rows as
  `COMPLIANT_CRAWLING` / `GRANTED`. drinkonline flagged as full-refresh (no
  `lastmod`). No producer changes needed — the hourly producer already picks
  up new GRANTED merchants.
- **Parked sources**: spritxxl.net and lazyshop.fi recorded as
  `COMPLIANT_CRAWLING` / `PENDING` with machine-readable `statusReason` and no
  `feedUrl`, so the producer skips them by design.
- **Crawl chunking on the existing watermark pattern**: ≤ 300 detail-page
  fetches per workflow step, resumable across invocations — respects the
  measured 15-min scheduled wall budget and the ~1,000-subrequest limit.
- **Operability**: read-only crawl-sweep scripts per source (existing sweep
  precedent) and an ingestion-runbook section (onboarding sequence, politeness
  parameters, parked sources, first-crawl verification checklist).

## Capabilities

- `data-acquisition` — ADDED *Sitemap-driven compliant crawl sources*
  (polite discovery, lastmod-driven incremental sync, extraction tiering,
  parked-source governance).
