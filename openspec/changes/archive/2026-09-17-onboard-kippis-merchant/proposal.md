# Onboard kippis merchant

## Why

The catalog has two live scraped merchants (alks/DE, longero/EE) beside the Alko domestic reference. Kippis (kippis.net) grants documented scraping rights to its public WooCommerce Store API (`https://www.kippis.net/wp-json/wc/store/v1/products`, 677 products), making it the third live source — and the first **domestic Finnish** retailer. Its products carry the same Finnish retail EANs as the Alko-derived catalog, so its offers match existing `product_master` rows directly through the upsert's EAN tier instead of creating parallel foreign-catalog products.

A 300-row probe (X-WP-Total 677) shows the same Store API payload shape as alks/longero: EUR minor-unit prices with the effective (sale) price in `prices.price` (25 rows on sale), all rows `type: simple`, `X-WP-TotalPages` pagination, name-embedded ABV/volume with Finnish comma decimals (`41,7% 70 cl`). The one real difference is the SKU vocabulary: 82% bare 13-digit EANs and 7% GTIN-14 (`06412700071701`), which the shared parser's `^[a-z]{2}-\d{13}$` pattern does not accept today — a bounded parser extension, not a new parser.

Kippis is the third WooCommerce Store API merchant — the exact "rule of three" point the longero adapter reserved for walk generalization.

## What Changes

### Catalog sweep before any wiring

- A read-only sweep script (`scripts/kippis-catalog-sweep.ts`, cloned from the longero sweep) walks all 677 products through the parser and measures the drop-rate, per-category error distribution, the SKU/EAN gap, multipack name-parsing behavior (`33cl x 24 tölkkiä` case pricing), and the Finnish category vocabulary coverage.
- Category-vocabulary extension in `mapSourceCategory` is scoped by the sweep — data-driven, never speculative.

### Bounded parser + shared-adapter work

- `readEanFromSku` additionally accepts bare 13-digit SKUs and 14-digit leading-zero (GTIN-14) SKUs; everything else stays EAN-less with a correction error (no fabricated EANs).
- The Store API walk (sequential pages, `per_page=100`, first usable `X-WP-TotalPages` caps the walk, per-page/per-row errors never thrown) is extracted into a shared module; alks, longero, and a new `KippisFeedAdapter` become thin subclasses.
- ~12 additive Finnish category keys in `SWEDISH_SOURCE_CATEGORY_MAP` (plural forms and kippis group terms), each mapping to an existing canonical category.

### Progressive rollout: local → staging → production

- **Local**: registry row (`kippis`, country `FI`, json, daily) plus a `RETAILER_API`/`GRANTED` governance record in local D1; producer + workflow run end-to-end locally against the live feed (read-only GETs).
- **Staging**: PR merge auto-deploys the worker; registry + governance granted; first ingest verified via a manual Workflow instance. Staging alks stays `REVOKED` — kippis does not un-pause it.
- **Production**: gated deploy, registry + governance granted, first ingest verified, first scheduled 00:00 UTC enqueue observed once.

## Non-goals (this change)

- No EAN recovery from image filenames (e.g. `6413600387930.png`) — the parser reads no image data (design D4, alks-feed-and-import-vat); empty-SKU rows stay EAN-less in the correction queue.
- No multipack price-per-unit semantics change — case-priced rows (`33cl x 24`) keep per-container volume with the case price; the sweep quantifies the skew and the data-quality pass owns classification.
- No remediation of 12-digit or internal-code SKUs beyond the deterministic GTIN-14 form.
- No upsert chunk-size tuning (standing follow-up from onboard-longero-merchant 4.2; kippis' 677-product catalog is smaller than longero's 985).
- No frontend changes — kippis products flow through the existing catalog, product pages, and search unchanged.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `data-acquisition`: Permitted-source ingestion gains kippis as the fourth live adapter (registry row, `RETAILER_API` governance, daily cadence); EAN-from-SKU gains the bare 13-digit and GTIN-14 shapes.

## Impact

- `packages/data-acquisition` (parser SKU shapes, shared Store API walk, new kippis adapter), `packages/core-domain` (category mapper vocabulary), `apps/api-worker` (two adapter-map composition sites), `scripts/kippis-catalog-sweep.ts` (new).
- Data: `merchant_registry` + `source_governance` rows per environment (local, staging, production). No schema migrations; `retail_offers`/`product_master` gain rows only through the normal upsert path.
- No frontend, API-contract, or dependency changes.
