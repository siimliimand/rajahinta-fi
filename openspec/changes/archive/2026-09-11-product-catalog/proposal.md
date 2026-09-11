# Product catalog: browsable /products index with category filter and pagination

## Why

The site answers "what does this cost to import" (calculator), "how do these compare" (compare), and "what is the €/g value" (/value) — but it has no answer to "show me what is available". The only product entry points are free-text search inside the calculator and direct search-engine landings on `/products/[id]`. The product-listing API that would power a browsable surface cannot serve one today: it paginates by slicing at most ~100 in-memory rows (so `total` and `totalPages` are capped regardless of catalog size), the `category` parameter is declared in the contract but silently ignored by every implementation, and the response's `lowestPriceCents` / `merchantCount` fields have never been populated (always null / 0). A catalog is the missing discovery surface, and the backend gaps are contract debts this change pays down in the same motion.

## What Changes

1. **Honest listing API** — `GET /api/v1/products` gains a true database-level browse path: the `category` parameter is validated against the six canonical values the D1 schema already enforces (`beer`, `wine_still`, `wine_sparkling`, `intermediate_products`, `other_fermented`, `spirits`) and honored; pagination moves from in-memory slicing to keyed SQL reads with an exact total, so `total`/`totalPages` reflect the whole filtered catalog; and the listing populates `lowestPriceCents` and `merchantCount` from a per-page aggregation over `retail_offers`. The `ids` and `q` search paths keep their existing behavior byte-identical.

2. **`/products` catalog page** — a server-rendered, URL-state-driven (`?category=&page=`) grid of product cards: name, brand, category, ABV, unit volume, lowest "from" price and merchant count, each linking to the product's `/products/[id]` page. A link row filters by category (all products + the six canonical values); pagination controls page through results; an honest empty state covers zero-result combinations. FI + EN throughout, per-category metadata, base and category URLs in the sitemap, and a "Tuotteet / Products" entry in the site header.

## Capabilities

### New Capabilities

- `product-catalog`: browsable server-rendered `/products` catalog page — category filter over the six canonical values, paginated card grid with offer-derived prices, SEO/i18n/nav wiring

### Modified Capabilities

- `product-search`: `GET /api/v1/products` honors `category`, paginates at the database level with true totals, and populates the previously dead `lowestPriceCents` / `merchantCount` response fields

## Impact

- **Schema:** none. No migration; `productMaster.category` is already CHECK-constrained to the six canonical values, and the change exports that value set as a shared constant the route reuses for validation.
- **API:** the blank-query browse path of an existing public endpoint changes behavior (uncapped totals, category filtering, populated price fields — previously always null); the `ids` and `q` search paths are unchanged. No new routes, no new rate-limit or age-gate profiles.
- **Frontend:** one new page (`apps/frontend/src/app/[locale]/products/page.tsx`), SiteHeader nav entry, sitemap additions, FI + EN message catalogs.
- **Neutrality:** the catalog lists alphabetically (Finnish collation, the existing listing contract) and never ranks or weights by merchant; displayed prices are factual per-product offer aggregates. No ranking input changes, so the compliance suite surface is untouched.
- **No feature flags:** everything ships enabled per the 2026-09-07 owner decision.

## Non-goals

- Price, ABV/volume, container-type, or merchant/availability filters (explicitly deferred; category first)
- Faceted per-category counts and sorting beyond alphabetical
- Keyset pagination (OFFSET-free reads) — unnecessary at this catalog's scale
- Any change to ranked search relevance or ordering
- Cross-links from `/value` or the calculator into the catalog (follow-up polish)
