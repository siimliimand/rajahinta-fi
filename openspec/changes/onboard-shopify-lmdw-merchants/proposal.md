# Onboard Shopify and LMDW merchants

## Why

The catalog ingests six live sources today: the Alko domestic reference feed and five store-API adapters (alks/DE, longero/EE, kippis/FI, mydrink/EE, araxes/EE) — all WooCommerce-shaped. The operator grants the platform rights to three more storefronts, and the wave introduces the repo's **two new feed protocols**:

- **bottleofitaly.com** (Italy) — Shopify `products.json`. Read-only probes measured: EUR currency (cart.js), `custom-gradazione-XX-X` tag carrying ABV on **100 % of the page-1 sample**, volume-in-title on 39 %, `grams` on 100 %, **zero barcodes**, and a catalog far broader than alcohol (`Olio` 36 %, `Aceto` 5 % of page 1 alongside `Spirits`, `Vino Rosso/Bianco/Rosato`, `Bollicine`).
- **kuhns.shop** (Germany) — Shopify `products.json`. Titles embed ABV and volume in parseable German forms (`… 0,75l, alc. 12 Vol.-%`, comma decimals); `product_type` sends German terms (`Wein`); EUR (cart.js); `grams` present.
- **gateway.prod2.whisky.fr** (La Maison du Whisky, France) — a **Magento 2 GraphQL gateway**, the repo's first GraphQL feed. Probes verified EUR-native `price_range`, ~3,213 products reachable through the mandatory `category_id` filter walk (bare queries are rejected: *"L'argument « rechercher » ou « filtrer » est obligatoire"*), ABV embedded in `short_description.html` French prose (`embouteillé à 45% alc.`, `52%`), a clean low-cardinality `m3_family` taxonomy (`rhum`, `whisky`, …) for category mapping — and **no located volume field yet** (`volumeMl` is non-nullable in `RawFeedRecord`).

The live `nonalcoholic-catalog-hygiene` hold rule (alcohol-category rows need parsed ABV > 0 or they stay out of user-facing surfaces) makes the LMDW ABV/volume question a gating spike, not a detail: an adapter without a resolved ABV source would land its entire catalog held in correction review.

None of the three stores exposes EANs (Shopify variants carry no barcodes on the samples; LMDW SKUs are numeric codes), so all three onboards follow the accepted parallel-catalog behavior: records ingest EAN-less and correction-flagged, and cross-merchant joins (Alko reference savings) are honestly absent for these catalogs.

## What Changes

### Sweep before wiring (per merchant)

- Three read-only sweep scripts (mydrink/araxes precedent) walk each full catalog through prototype extraction and produce the numbers that scope the parsers and vocabulary: `bottleofitaly-catalog-sweep.ts` (tag-ABV share, title-volume fallback outcomes, merch census), `kuhns-catalog-sweep.ts` (German title parse shares, category census, ESTIMATED share), and `lmdw-catalog-sweep.ts` (GraphQL walk + the **ABV/volume spike**: ABV share in `short_description.html`, volume-source hunt across `lmdw_label`, packaging categories, and sampled product pages, `m3_family` census). The LMDW sweep's go/no-go output gates the LMDW adapter.

### Shared Shopify walk (extracted now)

- `ShopifyProductsFeedAdapter` (`shopify-products.walk.ts`) — the `WooStoreFeedAdapter` story repeats across a platform-fixed format, so the walk is shared at two merchants: sequential pages at `limit=250`, **short-page termination** (Shopify exposes no `X-WP-TotalPages` equivalent — documented divergence), per-page failures collected never thrown (a 429 costs one page, not the run — both stores rate-limit aggressively). BOI and kuhns adapters become thin subclasses; per-merchant parsers stay separate (different ABV/volume loci) and promote their sweep-proven extraction.

### Magento GraphQL adapter (LMDW)

- `LmdwFeedAdapter` (`merchantId: 'lmdw'`): `products(filter: { category_id }, pageSize, currentPage)` walk bounded by `total_count` with `sku` dedupe for multi-category rows; EUR `price_range.minimum_price.final_price` → minor units; `stock_status` → availability; ABV from the spike-decided source (`short_description.html` French `%` patterns on the measured evidence); `m3_family` as the mapper's category input; EAN-less numeric SKUs never guessed into EANs.

### Additive category vocabulary (IT + DE + FR)

- `SWEDISH_SOURCE_CATEGORY_MAP` gains the sweep-census-scoped exact keys: BOI `product_type` English terms (`Spirits`, `Vino Rosso/Bianco/Rosato`, `Bollicine`, …), kuhns German terms (`Wein`, `Bier`, `Sekt`, …), LMDW `m3_family` French terms (`rhum`, `whisky`, …). Deliberately unmapped: non-beverage merch (`Olio`, `Aceto`, and their census peers) — the correction queue owns them, no guessed tax category. Each mapping additive; existing store vocabularies untouched.

### Registry + progressive rollout: local → staging → production

- Three registry seed rows (alks pattern): `bottleofitaly`/IT, `kuhns`/DE, `lmdw`/FR — json, daily cadence 86,400,000 ms. Local and staging receive rows through the deploy seed step; production registers through the ops console (runbook §2.0, blanket-permission auto-grant, audited).
- **Workers-egress smoke at staging** is an explicit verification step per source (Posti 403/1031 precedent): the first real fetches from Cloudflare IPs happen there, before production trust.

## Non-goals (this change)

- No EAN or brand recovery from names, images, or meta fields — all three catalogs ingest EAN-less (zero fabricated EANs).
- No Shopify Storefront API / Admin API migration (`products.json` is the documented-permission public surface; the Storefront API needs a token and a new permission class).
- No LMDW `custom_attributesV2` usage — it returns internal server errors on probed products; the spike decides the ABV/volume sources among the fields that work.
- No `compare_at_price` consumption — Shopify's compare-at is marketing "was" pricing and does not map onto the platform's original-price/FX provenance semantics.
- No unification of the two Shopify parsers beyond the shared walk — different ABV/volume loci; merging them is a measured follow-up if the sweeps converge.
- No frontend changes — new merchants flow through the existing catalog, product pages, and search unchanged.
- No correction-queue remediation for the merch rows (`Olio`/`Aceto` land as review input by design).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `data-acquisition`: Permitted-source ingestion gains bottleofitaly, kuhns, and lmdw as live sources (registry rows, `RETAILER_API` governance, daily cadence); the adapter registry gains a shared Shopify products walk and the first Magento GraphQL adapter — the registered adapter map grows ten → thirteen (six store-API regulars, four sitemap-crawl merchants, three new). SKU/EAN rules unchanged — non-matching SKUs keep records EAN-less and correction-flagged. EUR-native only: all three stores are EUR (verified by probe/cart.js); a non-EUR drift fails the sweep re-check rather than triggering conversion work.

## Impact

- `packages/data-acquisition` (shared walk, three adapters, two new parsers), `packages/core-domain` (mapper vocabulary IT/DE/FR), `apps/api-worker` (two adapter-map composition sites), `packages/data-platform` (three registry seed rows), `scripts/` (three sweep scripts).
- Data: `merchant_registry` + `source_governance` rows per environment (local, staging, production). No schema migrations; `retail_offers`/`product_master` gain rows only through the normal upsert path.
- Interaction with live `nonalcoholic-catalog-hygiene`: LMDW rows whose ABV cannot be parsed ingest `ESTIMATED` and are held from user-facing surfaces by the live hold rule — expected behavior, measured in the sweeps, revisited if the spike finds a better source.
- No frontend, API-contract, or dependency changes. (`onboard-araxes-merchant` and `nonalcoholic-catalog-hygiene` both archived 2026-10-07 — this change builds on the landed six-adapter state.)
