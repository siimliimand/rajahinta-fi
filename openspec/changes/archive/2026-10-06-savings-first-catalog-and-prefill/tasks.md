# Tasks: savings-first-catalog-and-prefill

## 1. API contract (api-worker)

- [x] 1.1 Attach the display-only `savings` embed (landedTotalCents, alkoReferenceCents, gapCents, gapBasisPoints, reliability, confidence) to every `/api/v1/products` item with a latest-day snapshot row, for all sort orders; response carries `savingsAsOf`; compose at route level from `D1SavingsSnapshotRepository.findLatestDay()` (one read, map lookup for the page's rows) — the product-search repository imports no savings module; extend the frontend `ProductSearchItem` type; contract tests for embed presence/omission and `savingsAsOf` <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/api-worker/src/routes/search.routes.ts, apps/frontend/src/lib/types.ts] -->
- [x] 1.2 Add `BIGGEST_SAVING` to `CATALOG_SORT_ORDERS` and flip the absent-sort default: gap bps ascending (largest saving first), FI `localeCompare` name, product id tie-break; no-snapshot rows last, alphabetical; full-set app-side sort before the page slice; contract tests for determinism, tie-break, nulls-last, and unknown-sort 400 <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [apps/api-worker/src/routes/search.routes.ts] -->
- [x] 1.3 `GET /api/v1/savings/best-per-merchant` — latest-day rows grouped by `bestMerchant`, argmax |gapCents| per merchant with product-id tie-break, `alko` excluded, byte-identical body per D1 state, 200 + empty list + null `asOf` before first materialization; same age-gate + SAVINGS limiter chain; route tests <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/api-worker/src/routes/savings.routes.ts] -->

## 2. Catalog page (frontend)

- [x] 2.1 Cards render landed cost + Alko reference + gap beside the existing "from" price, reusing the /savings vocabulary ("Kokonaishinta Suomeen" / "Alkon vertailuhinta"); dearer-than-Alko gaps stated factually; nothing renders when the embed is absent (€/g chip precedent); page tests <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [apps/frontend/src/app/[locale]/products/page.tsx] -->
- [x] 2.2 No-reference tier: in the default order only, covered rows list first, then a quiet divider ("Ei Alko-vertailua" / "No Alko reference") with uncovered rows alphabetical after it; page tests for tier ordering and divider presence <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [apps/frontend/src/app/[locale]/products/page.tsx] -->
- [x] 2.3 Windowed pagination: prev/next + first/last + ±2 window with ellipsis spans, replacing the render-every-page control; page-status sentence retained; out-of-range links stay disabled; page tests pin the anchor budget <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/frontend/src/app/[locale]/products/page.tsx] -->
- [x] 2.4 Page default sort becomes `BIGGEST_SAVING`; sort dropdown gains the option; FI/EN keys for the new catalog copy under `ProductsPage` <!-- agent: platform-engineer.fast, depends_on: [1.2], touches: [apps/frontend/src/app/[locale]/products/page.tsx, apps/frontend/messages/fi.json, apps/frontend/messages/en.json] -->

## 3. Tool prefill (frontend)

- [x] 3.1 Calculator: example cards from best-per-merchant rendering snapshot figures (no calculation call, no calculation records); selection loads the product into the existing selector flow; example-labeled with /savings link; component tests <!-- agent: platform-engineer.build, depends_on: [1.3], touches: [apps/frontend/src/app/[locale]/calculator/calculator-view.tsx, apps/frontend/src/app/[locale]/calculator/components] -->
- [x] 3.2 Compare: opens with one best-deal column per cross-border merchant, example-labeled, /savings link; add-tile retained; responsive grid wraps; component tests <!-- agent: platform-engineer.build, depends_on: [1.3], touches: [apps/frontend/src/app/[locale]/compare/compare-view.tsx, apps/frontend/src/app/[locale]/compare/components/ComparisonView.tsx] -->
- [x] 3.3 Basket: empty state lists per-merchant best deals with per-item add + one-click example-basket fill; no auto-add; component tests <!-- agent: platform-engineer.build, depends_on: [1.3], touches: [apps/frontend/src/app/[locale]/basket/basket-view.tsx, apps/frontend/src/app/[locale]/basket/components/BasketBuilder.tsx] -->
- [x] 3.4 FI/EN keys for all prefill copy under the existing page namespaces <!-- agent: platform-engineer.fast, depends_on: [3.1, 3.2, 3.3], touches: [apps/frontend/messages/fi.json, apps/frontend/messages/en.json] -->

## 4. Compliance and verification

- [x] 4.1 Extend `savings-snapshot-isolation`: register the products route and best-per-merchant route as sanctioned display readers in the static scan's documentation; re-run the dynamic output-identity claims (calculation, €/g ranking, basket optimization byte-identical across zero/one/many snapshot rows) <!-- agent: platform-engineer.build, depends_on: [1.1, 1.3], touches: [tests/compliance/savings-snapshot-isolation.test.ts] -->
- [x] 4.2 Run typecheck, lint, unit suites, and the compliance suite; fix fallout <!-- agent: platform-engineer.fast, depends_on: [2.4, 3.4, 4.1], touches: [] -->
