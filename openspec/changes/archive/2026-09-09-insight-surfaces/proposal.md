# Insight surfaces: savings discovery, price context, allowance explorer, guides

## Why

The site already computes the facts users want — landed costs against the Alko reference, 90-day price history, versioned traveller allowances — but the surfaces that would surface them are missing. A first-time visitor has no discovery answer ("what is actually worth importing right now"), product pages show history charts but no at-a-glance context, and the official allowance rules are buried inside the trip calculator while the exact search query that leads people to this subject ("how much can I bring to Finland") has no landing page. All three gaps close with read-side display surfaces over data that already exists, so they are low-effort, high-trust wins for professional usefulness.

## What Changes

Four features, one per new capability, plus one small discriminator on the blog schema:

1. **Savings discovery page** — a public, deterministic per-category listing of the largest landed-cost gaps versus the Alko domestic reference, materialized daily by a scheduled cron pass that runs the real calculator per qualifying product. Every row carries reliability, confidence, and an as-of date. Purely informational; ordering is a pure function of the materialized numbers.
2. **Price context line** — a factual sentence on product pages and a `price-context` API: how the current best observed price compares to its trailing 90-day median, in cents and basis points, with the window, bucket count, and as-of date in the payload. A minimum-bucket threshold gates any percentage; insufficient history renders an honest "not enough history yet" state. No advice, no prediction.
3. **Allowance explorer** — a public page and API browsing the published traveller-allowance datasets: pick a date, see the caps effective then, per category, with the dataset version, effective window, and verbatim source citations rendered as evidence links, plus the version history. Strictly read-side over the existing append-only repository.
4. **Guides hub** — evergreen, human-published FI + EN guides under `/guides`, reusing the blog publication pipeline through a new `kind` discriminator (RATE_CHANGE | GUIDE) on `blogPosts`. Ops console gains create/edit draft + publish actions for guides; public listing is kind-filtered; cross-links connect guides to the allowance explorer and trip calculator.

## Capabilities

### New Capabilities

- `savings-discovery`: daily materialized landed-cost-vs-Alko gap listing with public API and `/savings` page
- `price-context`: trailing-window price statistics per product with public API and product-page rendering
- `allowance-explorer`: public date-addressable browsing of published traveller-allowance versions with citations
- `guides-hub`: evergreen human-published guide pages on the blog publication pipeline

### Modified Capabilities

- `content-publication`: `blogPosts` gains a `kind` (RATE_CHANGE default, GUIDE); the human-publication requirement extends to operator-created guide drafts; public listing becomes kind-filtered

## Impact

- **Schema:** two migrations. One adds `savingsSnapshots` (asOf-keyed daily rows, `unique(asOf, productId)`, integer cents and basis points, reliability/confidence/tax-version provenance). One adds `blogPosts.kind` (TEXT NOT NULL DEFAULT 'RATE_CHANGE', CHECK in RATE_CHANGE | GUIDE). No existing column changes meaning.
- **API:** new public routes `GET /api/v1/savings`, `GET /api/v1/products/:id/price-context`, `GET /api/v1/allowances?date=`, `GET /api/v1/allowances/versions`, all age-gated with their own or existing rate-limit profiles. Ops routes for guide draft create/edit/publish behind OpsAccessGuard, audited. Existing blog endpoints become kind-aware; the blog index stays RATE_CHANGE-only, `/guides` lists GUIDE only.
- **Background jobs:** one new pass in the existing aggregation cron handler group, after time-series aggregation, off the request path, idempotent per as-of day, per-product failure isolation.
- **Frontend:** new `/savings`, `/allowances`, `/guides`, `/guides/[slug]` pages; one context line on product pages; sitemap additions; FI + EN message catalogs throughout.
- **Neutrality:** all four surfaces are display-only. A compliance test proves calculator, ranking, and basket outputs byte-identical with savings snapshots present, mirroring the unit-price isolation test. The allowance explorer has no mutation path to PUBLISHED datasets. Content-lint additions ban advice phrasing ("best deal", "good time to buy") on all new surfaces.
- **No feature flags:** everything ships enabled per the 2026-09-07 owner decision.

## Non-goals

- Personalized recommendations, "buy signal" advice, or any prediction
- Multi-country tax engines or new merchant feeds (separate, larger efforts)
- Web push notifications and the partner API (independent future changes)
- Any paid placement or manual ordering influence on the new pages
