# Proposal: unitprice-ranking-scale-fix

## Why

The `/value` page ("Arvo (€/g)", linked from the site footer) is 100 % dead in
production. `GET /api/v1/unitprice/ranking` hangs for every category:
beer, wine_still, and spirits all exceed 20 s client timeouts; a longer attempt
died at ~110 s (Cloudflare's ~100 s edge cutoff). Only the missing-param
validation answers (400 in ~0.1 s). A Finnish visitor clicking a footer feature
gets an eternal spinner.

Root cause (measured, see the exploration in session context):

- The ranking handler fetches the whole listing (`searchByName(null, 10_000)`)
  and then runs **one sequential `findOffers` D1 query per product in the
  category** — 3,384 queries for wine_still, 3,214 for spirits, 645 for beer.
- Production `retail_offers` is append-per-scrape (96,022 rows and growing
  every daily cron run), and its only index is `(merchant, product_id,
  observed_at)` — `product_id` is not the leading column, so every
  `findOffers` call cannot seek and scans.
- Wall time ≈ N × ~30 ms ≈ 100 s (wine_still) / ~19 s (beer) — exactly the
  observed failure profile. CPU is not the constraint; the cost is
  sequential I/O wait. The catalog doubling (4,414 → 8,700 products) pushed
  an O(catalog × offers-table) design past the edge it was always
  approaching, and it gets slower every day regardless of ingest.

The 10k-row listing fetch itself is innocent (one query, ~150 ms); the fix
targets the per-product offer sweep.

## What Changes

- `D1ProductSearchRepository` gains `listCategoryOfferCandidates(category)`:
  a single SQL JOIN returning the category's products with their
  latest-per-`(product, merchant)` offers inline (the `MAX(id) GROUP BY`
  recency rule `findOffers` already documents, moved into one query),
  with a defensive row cap replacing the handler-side
  `RANKING_MAX_PRODUCTS`.
- The ranking route drops the N+1 sweep and maps the one candidate list
  through the unchanged pure pipeline (`eurPerGram` → `rankUnitPrices`).
  Response shape, ordering semantics, reliability gating, and pack-from-name
  parsing are byte-identical; the metric is still computed at read time by
  the same pure function with the same parser.
- Migration 0025 adds `retail_offers(product_id, merchant, id)` so the
  dedup aggregate seeks instead of scanning, keeping the endpoint fast as
  the append-only offers table grows.
- The `/value` client fetch gets a 10 s `AbortSignal.timeout`, so any
  backend failure surfaces in the existing error/retry state in seconds
  instead of ~100 s.
- The offer-table data quirk found during exploration (one aggregate
  reported a single `product_id` bucket of 8,699 rows while the
  product_master join caps at 77) is settled with read-only production
  queries; if orphan offers exist, a cleanup SQL artifact is produced for
  owner review — never auto-applied.

## Capabilities

### New Capabilities

(none — this is a scale fix to an existing capability)

### Modified Capabilities

(none — `unit-price-metrics` requirements are preserved by design: the
metric stays a read-time pure-function derivation, pack size still comes
from the product name via the same parser, ordering stays deterministic
via the same pure policy, and status consistency is unchanged. The spec
pins no latency requirement; the regression guard is a test-level pin on
bounded repository calls, not a spec change.)

## Impact

- **Code:** `packages/data-platform` (repository method + migration),
  `apps/api-worker` (ranking route + tests), `apps/frontend` (value page
  client fetch).
- **Users:** the footer's `/value` page works again; every category answers
  in well under a second (measured candidate set for wine_still: 3,517 rows).
- **Ops:** migration 0025 applies in the standard gated deploy job; no
  backfill, no data migration, no secrets. Post-deploy live checks are
  curl-only.
- **Risk:** response-contract drift is the main hazard — pinned by the
  existing route fixtures plus a new bounded-query regression test.
