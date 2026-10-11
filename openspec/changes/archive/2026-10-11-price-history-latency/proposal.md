# Price-history latency

## Why

An explore session (2026-10-11) traced the product detail page's 2–3 s load to its data path and measured production live:

| Hop | Measured TTFB (2026-10-11) |
|---|---|
| Product page HTML (cold render) | **14.6 s** |
| Product page HTML (warm render) | **3.9 s** |
| `GET /api/v1/products/:id` | 1.3–1.5 s |
| `GET /api/v1/products/:id/price-history` | **6–12 s** (7-day and 365-day windows cost the same) |
| `GET /api/v1/products/:id/price-context` | 0.6–0.75 s |
| `GET /api/v1/products/:id/dupes` | 0.5–0.6 s |

The dominant cost is structural, not data volume. The price-history handler (`apps/api-worker/src/routes/historical.routes.ts`) reads the raw R2 observation log on the request path:

1. `findEarliestObservedAt` lists **every day-partition ever written** and reads + JSON-parses every line of every file — across all products — to answer one product's earliest observation date. It is unbounded and grows by one partition per day forever.
2. `findObservationsByProductRange` performs a second, serial `readObject` loop over the in-range partitions (each a whole-day file for all products) to build tax-change attribution.
3. There is no caching anywhere in the reader path; the endpoint's only shield is the frontend's 15-minute Next data cache, and every cache miss exposes the full cost to a visitor.

The spec already declares the intent this violates in spirit ("Charts never recompute raw history"): the materialized aggregates that can replace the scan already exist — verified live: `price_history_summaries` holds 75,126 daily buckets spanning the full log range (2026-09-07 → 2026-10-11) in the EU-located D1, indexed per product.

Secondary costs on the same page path: the product detail handler awaits five independent D1 queries sequentially; the product page's server render awaits four independent API fetches mostly serially.

## What Changes

- **Earliest date from summaries:** `GET /api/v1/products/:id/price-history` derives `earliestAvailableObservationDate` from `price_history_summaries` (`MIN(period_start)` for the product) instead of scanning the raw log. Precision becomes calendar-day (bucket start), which is how every consumer renders it.
- **Attribution becomes opt-in:** the endpoint accepts `attribution=none|auto` (default `auto`, backwards compatible — the calculator's history panel keeps its tax-rule markers). `attribution=none` returns `attribution: []` and performs **zero raw-log reads**; the product page's server-side fetch sends `attribution=none` (the page never renders attribution markers — only the calculator chart does).
- **Bounded concurrency for the attribution path:** when `attribution=auto`, the in-range partition read runs with bounded concurrency instead of one serial `await` per day-file.
- **Detail handler concurrency:** `getProduct` runs `findById ∥ findOffers`, then `merchantDisplayNames ∥ getMerchantWarnings ∥ getMerchantReliabilityMap` — five sequential awaits become two waves.
- **SSR fetch concurrency:** the product page starts all four server fetches (detail, history, price-context, dupes) immediately and awaits them where needed; `ProductPriceContextLine` and `ProductDupesPanel` receive their data via props instead of fetching themselves.

## Non-goals

- **API-layer response caching** — with the scan gone the endpoint is served from two indexed EU-D1 queries; the existing Next data cache (`revalidate: 900`) remains the shield. Revisit only if production traces disagree.
- **Rate-limiter Durable Object placement** — the 564 ms DO ping was measured from a North-American vantage; EU traffic likely pays much less. Verify with Grafana traces after this change; act only on EU-user numbers.
- **R2 `appendLine` write path** — the read-modify-write of the whole day-file per appended line is its own (pre-existing) inefficiency; a separate change.
- **Moving observations into D1** — unnecessary once the request path stops reading the log; the attribution path keeps bounded R2 range reads.

## Impact

- **Code:** `apps/api-worker/src/routes/historical.routes.ts`, `apps/api-worker/src/routes/search.routes.ts`, `packages/data-platform/src/repositories/d1/price-history-summary.repository.ts` (+ its test), product page `page.tsx` + `ProductPriceContextLine.tsx` + `ProductDupesPanel.tsx` (+ frontend tests). No schema changes, no migrations.
- **Specs:** delta on `historical-price-intelligence` — MODIFIED `Historical data API` (attribution parameter, summary-derived earliest date), ADDED `Request path aggregates only` (the raw log never serves series/earliest; attribution reads are range-bounded and concurrent).
- **Expected outcome:** price-history 6–12 s → ~50–150 ms (two indexed queries); product page cold 14.6 s → ~1–2 s, warm 3.9 s → ~1–2 s; and the endpoint's cost curve flattens from O(log age) to O(1) as the log grows.
