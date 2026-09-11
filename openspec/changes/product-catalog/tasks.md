# Tasks: product-catalog

## 1. Data platform

- [ ] 1.1 Export the canonical category value set as a shared constant in the D1 schema module (build the existing `productMaster` CHECK constraint from it) and add the catalog listing read to `D1ProductSearchRepository`: filtered `(id, name)` key selection, app-side Finnish-collation sort (`localeCompare(…, 'fi')`, the existing contract comparator), page slice, full-row fetch for the page's ids, exact total, plus the per-page offer aggregation (`MIN(price_cents)`, `COUNT(DISTINCT merchant)` over `retail_offers` by product-id IN-list); null price / zero merchant count for offer-less products. Unit tests on the node:sqlite D1 harness: >100-row fixtures proving uncapped totals and deep pages, category filtering, deterministic FI ordering, page slicing, offer-less products, empty category. <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/d1/schema.ts, packages/data-platform/src/repositories/d1/product-search.repository.ts, packages/data-platform/src/repositories/d1/__tests__/product-search.repository.test.ts] -->

## 2. API worker

- [ ] 2.1 Rework the browse path of `GET /api/v1/products` in the Hono route: validate `category` against the shared constant (400 on unknown), delegate the blank-query/no-ids path to the new repository listing (true pagination, category filter, populated `lowestPriceCents`/`merchantCount`), keep the `ids` and ranked-`q` paths byte-identical including the additive merchant-warnings join. Route tests: canonical/unknown/absent category, totals beyond the legacy cap, price fields populated, search-path contracts unchanged. <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [apps/api-worker/src/routes/search.routes.ts, apps/api-worker/src/routes/__tests__/search.routes.test.ts] -->

## 3. Frontend

- [ ] 3.1 `/products` catalog page: server component reading `category`/`page` searchParams, server fetch of the listing API (900 s revalidate, fixed page size 24), category filter link row (all products + six canonical values, localized labels, filtering resets to page 1), card grid (name, brand, category badge, ABV, volume, from-price, merchant count) linking to `/products/[id]`, pagination controls over the true total, honest empty state, forgiving unknown-category handling; Testing Library tests for rows, filter links, pagination, and empty state. <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [apps/frontend/src/app/[locale]/products/page.tsx, apps/frontend/src/app/[locale]/products/__tests__/**] -->
- [ ] 3.2 Discoverability + i18n: "Tuotteet / Products" SiteHeader entry, per-category `generateMetadata` with canonical URLs, FI + EN message catalogs for all new copy (factual, content-lint clean), sitemap additions (base + six category URLs, page ≥ 2 excluded). <!-- agent: platform-engineer.fast, depends_on: [3.1], touches: [apps/frontend/src/app/[locale]/components/SiteHeader.tsx, apps/frontend/src/app/[locale]/products/page.tsx, apps/frontend/src/messages/fi.json, apps/frontend/src/messages/en.json, apps/frontend/src/app/sitemap.ts] -->

## 4. Verification

- [ ] 4.1 Full verification run: typecheck, lint, content lint, unit, golden, compliance, e2e, api-worker e2e, OpenNext build; fix fallout. <!-- agent: platform-engineer.fast, depends_on: [2.1, 3.2], touches: [] -->
