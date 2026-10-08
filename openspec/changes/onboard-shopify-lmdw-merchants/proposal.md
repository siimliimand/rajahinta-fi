# Onboard Shopify and LMDW merchants

## Why

The catalog ingests ten live sources today: the Alko domestic reference feed, five store-API adapters (alks/DE, longero/EE, kippis/FI, mydrink/EE, araxes/EE), and four sitemap-crawl merchants (viinarannasta, viinikauppa, licorea, drinkonline). The operator grants the platform rights to three more storefronts — two Shopify stores boarding in this change, and the third (LMDW) gated by a spike that this change ran to a measured NO-GO:

- **bottleofitaly.com** (Italy) — Shopify `products.json`. Read-only probes measured: EUR currency (cart.js), `custom-gradazione-XX-X` tag carrying ABV on **100 % of the page-1 sample**, volume-in-title on 39 %, `grams` on 100 %, **zero barcodes**, and a catalog far broader than alcohol (`Olio` 36 %, `Aceto` 5 % of page 1 alongside `Spirits`, `Vino Rosso/Bianco/Rosato`, `Bollicine`).
- **kuhns.shop** (Germany) — Shopify `products.json`. Titles embed ABV and volume in parseable German forms (`… 0,75l, alc. 12 Vol.-%`, comma decimals); `product_type` sends German terms (`Wein`); EUR (cart.js); `grams` present.
- **gateway.prod2.whisky.fr** (La Maison du Whisky, France) — a **Magento 2 GraphQL gateway**, the repo's first GraphQL feed candidate. Probes verified EUR-native `price_range`, ~3,213 products reachable through the mandatory `category_id` filter walk (bare queries are rejected: *"L'argument « rechercher » ou « filtrer » est obligatoire"*), ABV embedded in `short_description.html` French prose (`embouteillé à 45% alc.`, `52%`), a clean low-cardinality `m3_family` taxonomy (`rhum`, `whisky`, …) for category mapping — and **no located volume field yet** (`volumeMl` is non-nullable in `RawFeedRecord`).

The live `nonalcoholic-catalog-hygiene` hold rule (alcohol-category rows need parsed ABV > 0 or they stay out of user-facing surfaces) made the LMDW ABV/volume question a gating spike, not a detail: an adapter without a resolved ABV source would land its entire catalog held in correction review. The spike ran first and answered it (below).

None of the three stores exposes EANs (Shopify variants carry no barcodes on the samples; LMDW SKUs are numeric codes), so every onboarding follows the accepted parallel-catalog behavior: records ingest EAN-less and correction-flagged, and cross-merchant joins (Alko reference savings) are honestly absent for these catalogs.

## What Changes

### Sweep before wiring (per merchant)

- Three read-only sweep scripts (mydrink/araxes precedent) walk each full catalog through prototype extraction and produce the numbers that scope the parsers and vocabulary: `bottleofitaly-catalog-sweep.ts` (tag-ABV share, title-volume fallback outcomes, merch census), `kuhns-catalog-sweep.ts` (German title parse shares, category census, ESTIMATED share), and `lmdw-catalog-sweep.ts` (GraphQL walk + the **ABV/volume spike**: ABV share in `short_description.html`, volume-source hunt across `lmdw_label`, packaging categories, and sampled product pages, `m3_family` census). The LMDW sweep's go/no-go output gates the LMDW adapter.

### Shared Shopify walk (extracted now)

- `ShopifyProductsFeedAdapter` (`shopify-products.walk.ts`) — the `WooStoreFeedAdapter` story repeats across a platform-fixed format, so the walk is shared at two merchants: sequential pages at `limit=250`, **short-page termination** (Shopify exposes no `X-WP-TotalPages` equivalent — documented divergence), per-page failures collected never thrown (a 429 costs one page, not the run — both stores rate-limit aggressively). BOI and kuhns adapters become thin subclasses; per-merchant parsers stay separate (different ABV/volume loci) and promote their sweep-proven extraction.

### LMDW spike outcome (NO-GO for the GraphQL adapter)

- The `lmdw-catalog-sweep.ts` spike walked the full gateway catalog (6,814 distinct SKUs across 69 pages) and measured feed-side ABV coverage at **10.3 %** — the probe's "ABV everywhere" was whisky-search page-1 skew. The only full-coverage ABV/volume source is the product-page HTML (`"volume"`/`"strength"` state JSON, 100 % of the sampled pages), which is a crawl-scale mechanism, not a GraphQL field (all 76 `ProductInterface` fields introspected; `custom_attributesV2` internal-errors). Per design D5's accepted outcomes the adapter is **deferred**: LMDW onboards in a named follow-up change as a sitemap-crawl merchant (the viinarannasta/viinikauppa/licorea/drinkonline pattern) with the registry row and FR `m3_family` vocabulary landing there. This change ships the sweep script and the decision record as its LMDW deliverable.

### Additive category vocabulary (IT + DE)

- `SWEDISH_SOURCE_CATEGORY_MAP` gains the sweep-census-scoped exact keys: BOI `product_type` English terms (`Spirits`, `Vino Rosso/Bianco/Rosato`, `Bollicine`, …), kuhns German terms (`Wein`, `Bier`, `Sekt`, … — covering the typed minority; the 93.7 % untyped majority classifies through the parser's name-token fallback). Deliberately unmapped: non-beverage merch (`Olio`, `Aceto`, and their census peers) — the correction queue owns them, no guessed tax category. Each mapping additive; existing store vocabularies untouched.

### Registry + progressive rollout: local → staging → production

- Two registry seed rows (alks pattern): `bottleofitaly`/IT and `kuhns`/DE — json, daily cadence 86,400,000 ms. Local and staging receive rows through the deploy seed step; production registers through the ops console (runbook §2.0, blanket-permission auto-grant, audited).
- **Workers-egress smoke at staging** is an explicit verification step per source (Posti 403/1031 precedent): the first real fetches from Cloudflare IPs happen there, before production trust.

## Non-goals (this change)

- **LMDW onboarding is deferred** (spike NO-GO, above) — no `LmdwFeedAdapter`, no lmdw registry row, no FR mapper vocabulary in this change; the follow-up change owns them with the crawl-pattern design.
- No EAN or brand recovery from names, images, or meta fields — both catalogs ingest EAN-less (zero fabricated EANs).
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

- `data-acquisition`: Permitted-source ingestion gains bottleofitaly and kuhns as live sources (registry rows, `RETAILER_API` governance, daily cadence); the adapter registry gains a shared Shopify products walk — the registered adapter map grows ten → twelve (six store-API regulars, four sitemap-crawl merchants, two new). SKU/EAN rules unchanged — non-matching SKUs keep records EAN-less and correction-flagged. EUR-native only: both stores are EUR (verified by probe/cart.js); a non-EUR drift fails the sweep re-check rather than triggering conversion work.

## Impact

- `packages/data-acquisition` (shared walk, two adapters, two new parsers), `packages/core-domain` (mapper vocabulary IT/DE), `apps/api-worker` (two adapter-map composition sites), `packages/data-platform` (two registry seed rows), `scripts/` (three sweep scripts — the LMDW one as the spike decision record).
- Data: `merchant_registry` + `source_governance` rows per environment (local, staging, production). No schema migrations; `retail_offers`/`product_master` gain rows only through the normal upsert path.
- Interaction with live `nonalcoholic-catalog-hygiene`: rows whose ABV cannot be parsed ingest `ESTIMATED` and are held from user-facing surfaces by the live hold rule — expected behavior, measured in the sweeps (kuhns 5.4 % ESTIMATED; BOI wine volume rides honest `0 ml` + `ESTIMATED`).
- No frontend, API-contract, or dependency changes. (`onboard-araxes-merchant` and `nonalcoholic-catalog-hygiene` both archived 2026-10-07 — this change builds on the landed six-adapter state.)
