# Onboard longero merchant

## Why

The catalog has exactly one live scraped merchant (alks, DE). Longero (longero.fi) grants documented scraping rights to its public WooCommerce Store API (`https://longero.fi/wp-json/wc/store/v1/products`, 994 products), making it the second live source. Exploration showed the payload is field-for-field compatible with the existing alks parser: EAN-shaped SKUs (`de-82896001453` matches `^[a-z]{2}-\d{13}$`), EUR minor-unit prices, name-embedded ABV/volume (`14.5% 0.75 l`), `X-WP-TotalPages` pagination, and `is_in_stock` availability — so onboarding is a thin adapter plus registry/governance rows, not new parsing code.

Merchant identity and tax model: Longero is operated by TOVAGLUKE OÜ, an **Estonian** company (registry country `EE` — the `.fi` domain is misleading). The merchant pays Estonian taxes; customers arrange shipping and self-handle Finnish import duties. This is the same foreign-merchant model the platform already computes for alks/DE, so `depositSystem: false` (Finnish pantti unknown, never assumed for a foreign merchant) stays correct.

## What Changes

### Catalog sweep before any wiring

- A read-only sweep script (`scripts/longero-catalog-sweep.ts`, cloned from the alks sweep) walks all 994 products through the existing parser and measures the drop-rate, per-category error distribution, the SKU/EAN gap (~32% of SKUs did not match the EAN pattern in a 100-row probe), and the coverage of the Finnish category vocabulary (`Väkevä`, `Glögg`, `Long drink`, `Juomasekoitus`, …).
- Category-vocabulary extension in `mapSourceCategory` happens **only if** the sweep shows category-driven drops — data-driven, never speculative.

### Thin longero adapter

- `LongeroFeedAdapter` (`merchantId: 'longero'`) mirrors the alks adapter's walk discipline (sequential pages, `per_page=100`, first usable `X-WP-TotalPages` caps the walk, per-page/per-row errors never thrown) and reuses `parseAlksStoreProducts` unchanged. No parser rename or extraction — generalization waits for a third WooCommerce merchant.
- Registered in both adapter maps: `composeIngestionStageServices` (api-worker workflow) and `composeIngestionPipeline` (data-acquisition).

### Progressive rollout: local → staging → production

- **Local**: registry row (`longero`, country `EE`, json, `86_400_000` ms — daily, mirroring alks) plus a `RETAILER_API`/`GRANTED` governance record in local D1; producer + workflow run end-to-end locally.
- **Staging**: merge deploys the worker; registry + governance granted through the ops path; first ingest verified (workflow instance, `retail_offers`, API). Staging alks stays `REVOKED` (paused 2026-09-14) — longero does not un-pause it.
- **Production**: gated deploy, registry + governance granted, first ingest verified at the next 00:00 UTC boundary.

## Non-goals (this change)

- No parser generalization/rename to a shared store-api module (rule of three).
- No `depositSystem` change — stays `false` for the Estonian merchant.
- No EE→FI transport offers — the total-price picture for longero may lack the shipping leg initially (open follow-up).
- No EAN remediation for the ~32% non-matching SKUs — records are kept EAN-less and correction-queued by design.
- No staging alks un-pause.
- No frontend changes — longero products flow through the existing catalog, product pages, and search unchanged.
