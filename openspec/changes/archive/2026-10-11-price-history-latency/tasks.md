# Tasks

## 1. Price-history request path

- [x] 1.1 Add `findEarliestPeriodStart(productId): Promise<string | null>` to `D1PriceHistorySummaryRepository` — `MIN(period_start)` for the product's daily buckets, null when the product has no buckets. Keep it on the D1 concrete class only (the `listCategoryOfferCandidates` precedent — the route binds the concrete type, no abstract-contract ripple); add repository tests for the hit and no-buckets cases <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/repositories/d1/price-history-summary.repository.ts, packages/data-platform/src/repositories/d1/__tests__/price-history-summary.repository.test.ts] -->
- [x] 1.2 Rewrite `getPriceHistory` in `historical.routes.ts`: derive `earliestAvailableObservationDate` from task 1.1 (delete the `findEarliestObservedAt` full-log scan); accept `attribution` query (`auto` | `none`, default `auto`, invalid values → 400); when `none`, return `attribution: []` and skip both R2 passes entirely; when `auto`, keep the current attribution semantics <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [apps/api-worker/src/routes/historical.routes.ts] -->
- [x] 1.3 Bound the `attribution=auto` partition read: replace the serial `for (key of keys) await readObject(key)` loop with a fixed-concurrency batched read (e.g. 8 in flight, `Promise.all` per batch), preserving per-line filtering and sort order <!-- agent: platform-engineer.build, depends_on: [1.2], touches: [apps/api-worker/src/routes/historical.routes.ts] -->
- [x] 1.4 Update the historical route tests: `attribution=none` performs zero observation-log reads (spy the reader), earliest date equals the summary-derived bucket start, `auto` keeps attribution output stable, 365-day cap and validation unchanged <!-- agent: platform-engineer.build, depends_on: [1.2, 1.3], touches: [apps/api-worker/src/routes/__tests__/historical-reports-merchants.routes.test.ts] -->

## 2. Product detail handler

- [x] 2.1 Parallelize `getProduct` in `search.routes.ts`: wave 1 `findById ∥ findOffers` (both depend only on the id), wave 2 `merchantDisplayNames ∥ getMerchantWarnings ∥ getMerchantReliabilityMap` (all depend only on the offers set) — response bytes and order identical <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/api-worker/src/routes/search.routes.ts] -->
- [x] 2.2 Run the search route tests and extend where they assert await ordering; the serialized contract (fields, merchantName fallback, warnings embed, reliability embed) must be asserted unchanged <!-- agent: platform-engineer.fast, depends_on: [2.1], touches: [apps/api-worker/src/routes/__tests__/search.routes.test.ts] -->

## 3. Product page SSR

- [x] 3.1 Make the product page's server fetches concurrent: start detail, history (now with `attribution=none` in the query), price-context, and dupes promises up front; await each where rendered. `ProductPriceContextLine` and `ProductDupesPanel` switch to receiving their fetched data via props (the page owns the fetches); keep the absent-from-HTML degradation contracts (null → renders nothing) exactly as today <!-- agent: platform-engineer.build, depends_on: [1.2], touches: [apps/frontend/src/app/[locale]/products/[id]/page.tsx, apps/frontend/src/app/[locale]/products/[id]/components/ProductPriceContextLine.tsx, apps/frontend/src/app/[locale]/products/[id]/components/ProductDupesPanel.tsx, apps/frontend/src/app/[locale]/products/[id]/price-context.ts, apps/frontend/src/app/[locale]/products/[id]/product-dupes.ts] -->
- [x] 3.2 Update the frontend tests for the props-based panels and the new fetch URL (`attribution=none`): page tests, panel tests, and the payload-budget test's server-read mocks <!-- agent: platform-engineer.build, depends_on: [3.1], touches: [apps/frontend/src/app/[locale]/__tests__/payload-budget.test.ts, apps/frontend/src/app/[locale]/products/[id]/page.test.tsx] -->

## 4. Verification

- [x] 4.1 Full check sweep: typecheck, lint, and the api-worker + frontend test suites green <!-- agent: platform-engineer.fast, depends_on: [1.4, 2.2, 3.2], touches: [] -->
- [x] 4.2 Deploy staging and measure: `GET /api/v1/products/:id/price-history` (both attribution modes) and the product page HTML TTFB, before (proposal table) vs after; record numbers and any deviation in notes.md <!-- agent: devops-engineer.fast, depends_on: [4.1], touches: [openspec/changes/price-history-latency/notes.md] -->
