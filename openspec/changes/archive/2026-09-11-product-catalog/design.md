# Design: product-catalog

## Context

- `GET /api/v1/products` exists in both the legacy NestJS controller (`packages/application-api/src/search/search.controller.ts`) and the production Hono route (`apps/api-worker/src/routes/search.routes.ts`). Both fetch at most `MAX_PAGE_SIZE` rows via `searchByName`/`searchRanked` and paginate by in-memory `slice`; `category` is declared in `SearchProductsQuery` but ignored (`_category` in the controller, unread in the route); `toSearchItem` hard-codes `lowestPriceCents: null` and `merchantCount: 0`.
- `D1ProductSearchRepository` (`packages/data-platform/src/repositories/d1/product-search.repository.ts`) owns product reads; its alphabetical listing applies the Finnish collation app-side (`localeCompare(…, 'fi')`) because D1 has no custom collations.
- `productMaster.category` is CHECK-constrained in `packages/data-platform/src/d1/schema.ts` to exactly `('beer', 'wine_still', 'wine_sparkling', 'intermediate_products', 'other_fermented', 'spirits')`.
- `retailOffers` carries `priceCents` (EUR cents), `merchant`, `availability`, `observedAt`.
- Frontend: App Router `[locale]` segment, next-intl with Finnish default, message catalogs at `apps/frontend/src/messages/{fi,en}.json`, design-system primitives (`Card`, `Badge`, `EmptyState`), sitemap at `apps/frontend/src/app/sitemap.ts`, server fetches with `next: { revalidate }` (the product-page dupes fetch uses 900 s).
- Age gate renders from the root layout, so the new page is covered without its own wiring.

## Goals / Non-Goals

**Goals:**

- A neutral, crawlable discovery surface over the assortment that feeds `/products/[id]`
- Pay down the three listing-contract debts (ignored `category`, capped totals, dead price fields) in the same change
- Zero migrations; zero change to search relevance, ordering inputs, or any ranking input

**Non-Goals:**

- Filters beyond category (price, ABV, volume, merchant), faceted counts, alternative sort orders
- Client-side fetching or client filter state
- Any mutation path, personal data, or entitlement gating

## Decisions

### D1: Keys-then-page ordering — Finnish collation preserved without full-row scans

SQL-side `ORDER BY name` cannot reproduce the Finnish collation the listing contract already guarantees (D1 limitation; the existing repository documents this). The catalog read therefore: (1) selects only `(id, name)` for the filter, (2) sorts app-side with the same `localeCompare(…, 'fi')` comparator as the existing contract, (3) slices the page, (4) fetches full rows for the page's ids. `total` is exact — the key-list length — and the order is compatible with today's alphabetical listing.

*Alternative considered:* `ORDER BY name COLLATE NOCASE` in SQL (single query, but misorders ä/ö and breaks the documented collation contract); fetching all full rows per page view (simple, wasteful at catalog scale). The keys approach keeps the contract and reads two narrow queries per page view.

### D2: Category validation from one shared constant; API strict, page forgiving

Export `PRODUCT_CATEGORIES` from the D1 schema module and build the existing `productMaster` CHECK constraint from it, so validation and the schema can never drift. The API route validates `category` against the constant and returns 400 for unknown values (a contract-level parameter error — silent fallbacks are how the ignored-`category` debt started). The catalog *page*, facing humans and mistyped links, treats an unknown `?category=` value as absent and renders the unfiltered view.

### D3: Only the blank-query browse path changes; search paths are byte-identical

When `q` is absent/blank and `ids` is not supplied, the Hono route delegates to the new repository listing — category filter, true pagination, populated price fields. The `ids` lookup and ranked-`q` search paths keep the current fetch-and-slice behavior and exact response shape: existing consumers (calculator, compare, group-order, alerts) see no change. Populating `lowestPriceCents`/`merchantCount` on the browse path is additive — the fields already exist in the contract and were previously always null/0. The additive merchant-warnings join keeps running over the final page items.

### D4: Prices are a per-page aggregation, never a catalog-wide join

After the page's product ids are fixed, one `SELECT product_id, MIN(price_cents), COUNT(DISTINCT merchant) FROM retail_offers WHERE product_id IN (…) GROUP BY product_id` fills both fields. Products with no offers keep `lowestPriceCents: null` and `merchantCount: 0` — honest absence, never a guessed price. The join is bounded by page size regardless of catalog size, and no availability filtering is applied in v1 (documented: the aggregate reflects observed offers; availability filtering is a deferred filter, not silently smuggled in).

### D5: Server-rendered page, URL state, no client components

Category and page live in the URL query string; every filter and pagination control is a plain `<a>` link, so the page renders and crawls without JavaScript. The server component fetches the API with a 900 s revalidate (matching the product-page precedent; offer data refreshes hourly at most). Cards use design-system primitives; zero-result categories render the shared `EmptyState`. Page size for the catalog surface is fixed (24).

### D6: Discoverability — nav entry, per-category metadata, canonical URLs, sitemap

"Tuotteet / Products" joins the SiteHeader's page list. `generateMetadata` renders per-category FI/EN titles and descriptions, and each (category, page) state emits a canonical URL so parameter permutations do not fragment the index. The sitemap gains the base catalog URL plus the six category URLs; page ≥ 2 URLs stay out (infinite parameter space, no unique value). All new copy is factual and passes the content lint — "edullisin hinta / lowest price" is a statement of fact, not advice.
