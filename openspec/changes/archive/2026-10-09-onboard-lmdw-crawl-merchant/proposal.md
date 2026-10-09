# Onboard LMDW crawl merchant

## Why

La Maison du Whisky (whisky.fr) is France's reference spirits retailer, and the operator grants the platform rights to its public product pages. The archived change `onboard-shopify-lmdw-merchants` spiked a GraphQL-products adapter and returned a measured **NO-GO**: across the full gateway catalog (6,814 distinct SKUs, 6,821 total_count), feed-side ABV covers only **10.3 %** of rows, volume is absent from every GraphQL field (all 76 `ProductInterface` fields introspected; `custom_attributesV2` internal-errors), and the only full-coverage ABV/volume source is the **product-page state JSON** — `"volume"` in litres and `"strength"` ABV, present on **100 % of the sampled pages** at `https://www.whisky.fr/<url_key>.html` (10/10 HTTP 200 under the honest crawler UA).

That is exactly the shape the repo's sitemap-crawl pattern already onboards: four live merchants (viinarannasta, viinikauppa, licorea, drinkonline) run one `SitemapCrawlFeedAdapter` that fetches a sitemap once per cycle, diffs `lastmod` against job-scoped watermark rows, crawls changed pages in resumable chunks, and extracts structured data (JSON-LD → microdata → OG/meta) with per-source normalizers. The gateway is EUR-native (EUR × 6,814, zero non-EUR, zero unparseable prices), and product pages may expose **GTIN13 in JSON-LD** — the exact field the `sitemap-crawl` GTIN13 fix (PR #107) exists to read — which would make LMDW the first cross-border merchant with real EANs since the Estonian Store-API stores, enabling Alko-reference joins the Shopify pair cannot make.

A further advantage over the spiked design: the GraphQL m3 taxonomy (137 `m3_family` labels) was the GraphQL-side category signal — the crawl pattern reads what pages actually carry (JSON-LD category, breadcrumbs), and this change censuses that page-side vocabulary before wiring any mapper keys.

## What Changes

### Probe before wiring

- `scripts/lmdw-crawl-probe.ts` (read-only, mydrink/araxes sweep discipline): decides the integration shape and scopes the parser — (a) **sitemap availability**: robots.txt sitemap directives, `sitemap.xml`, a product-sitemap index (the pure-crawl path's URL source); if absent, the variant is a **GraphQL-seeded URL list** (sku + url_key from the mandatory `category_id` walk feeding the crawl walker — designed in this change, not a new protocol); (b) **extraction coverage**: `volume`/`strength` state-JSON share across ~300 sampled pages; (c) **page-side category census**: JSON-LD category and breadcrumb terms (the mapper input); (d) **GTIN13-in-JSON-LD presence**; (e) EUR sanity. The probe's URL-source decision gates the adapter task.

### Adapter + extraction

- `LmdwFeedAdapter` (`merchantId: 'lmdw'`): per the probe decision, a `SitemapCrawlFeedAdapter` subclass (pure sitemap) or the GraphQL-seeded variant, over the shared crawl discipline (sequential per host, ≥ 1 s spacing, ≤ 300-fetch resumable chunks, watermark/cursor diffing, failures collected never thrown). A whisky.fr **per-source page normalizer** extracts the state-JSON `volume`/`strength` (guarded parsing; honest `0 ml`/null + `ESTIMATED` fallbacks), JSON-LD price to EUR minor units (non-EUR = per-row correction error, never converted), category through the probe-censused page terms, and GTIN13 **only if attested on the page** (never fabricated; EAN-less otherwise). `depositSystem` false — French consigne is not Finnish pantti.

### Additive category vocabulary (FR)

- `SWEDISH_SOURCE_CATEGORY_MAP` gains the probe-censused page-side French terms as additive exact keys (breadcrumbs/JSON-LD category → existing canonical categories). Deliberately unmapped: gift boxes, non-beverage terms, and anything the census shows as merch — the correction queue owns them. (The GraphQL-side 137-label `m3_family` census is NOT wired — no GraphQL surface exists in this change; the archived change's census stays as reference evidence.)

### Registry + progressive rollout: local → staging → production

- One registry seed row (`lmdw`/FR, daily cadence 86,400,000 ms; `feedFormat: 'xml'` when sitemap-driven, matching the crawl-row convention; feedUrl per the probe decision). Local and staging receive it through the deploy seed step; production registers through the ops console (runbook §2.0, blanket-permission auto-grant, audited). **Workers-egress smoke at staging** is an explicit verification step (Posti 403/1031 precedent; the crawl UA is already the measured-good shape).

## Non-goals (this change)

- No GraphQL adapter, no `products(search/filter …)` data path — spiked and archived (design D4/D5 of `onboard-shopify-lmdw-merchants`); the gateway is used only for the URL list if the probe picks the seeded variant.
- No GraphQL-side `m3_family` mapper keys — no GraphQL surface ships here; the page-side census is the vocabulary source.
- No GTIN fabrication: EANs only from page-attested `gtin13` values; no zero-padding, hashing, or inference.
- No full-catalog crawl in the probe — the probe samples (~300 pages); full-catalog convergence is the adapter's scheduled cadence.
- No upsert matching relaxation, no correction-queue remediation, no frontend changes.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `data-acquisition`: Permitted-source ingestion gains lmdw as a live source (registry row, `RETAILER_API` governance, daily cadence, crawl-pattern watermarks/cursors); the registered adapter map grows twelve → thirteen. SKU/EAN rules unchanged in shape — page-attested `gtin13` is an accepted EAN source for crawled products (the existing JSON-LD path); everything else stays EAN-less and correction-flagged. EUR-native only; a non-EUR drift fails the probe/sweep re-check rather than triggering conversion work.

## Impact

- `packages/data-acquisition` (lmdw adapter, whisky.fr normalizer), `packages/core-domain` (mapper vocabulary FR), `apps/api-worker` (composition wiring per the probe decision), `packages/data-platform` (registry seed row), `scripts/` (crawl probe).
- Data: `merchant_registry` + `source_governance` rows per environment; crawl watermark/cursor rows (`sitemap-crawl-lastmod-lmdw` / cursor) via the normal crawl runtime; no schema migrations; `retail_offers`/`product_master` gain rows only through the normal upsert path.
- The hold-rule interaction (`nonalcoholic-catalog-hygiene`): rows with unparseable ABV ingest `ESTIMATED` and stay out of user-facing surfaces — expected to be a small share (the spike measured 100 % state-JSON coverage on the sample; the probe re-measures at scale).
- No frontend, API-contract, or dependency changes. Correction-noise budget: worst case (zero GTINs) ≈ 6,814 EAN-less correction lines/run — accepted per the BOI precedent (22,937), with the registry-level filter as the named follow-up if operationally expensive.
