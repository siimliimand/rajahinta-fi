# Design: insight-surfaces

## Context

Four read-side display features over data the platform already produces:

- `LandedCostCalculatorService` already computes a per-product landed cost and assembles a display-only `AlkoBenchmarkSnapshot` (`resolveAlkoBenchmark` in `packages/core-domain/src/calculator/landed-cost-calculator.service.ts`) from offers with an observation timestamp, using the deterministic newest-reference selection.
- `priceHistorySummaries` already materializes daily/weekly buckets per product; `findByProductRange` reads product-wide rows with the explicit "merchant IS NULL" semantics documented in `packages/data-platform/src/repositories/price-history-summary.repository.ts`.
- `travellerAllowanceDatasets` / `travellerAllowanceLimits` are append-only, effective-windowed, carry per-dataset and per-limit source citations, and `TravellerAllowancesRepository` already exposes `findPublishedEffectiveOn(date)` and `findDatasetByVersionLabel`.
- The blog pipeline (`blogPosts` D1 table, human DRAFT-to-PUBLISHED flow, ops console publish, per-locale slugs, sitemap, content lint) is live for rate-change posts.
- The `/value` €/g page is the established template for a public deterministic listing: pure core-domain module, status-carrying rows, unavailable omitted, compliance test proving output isolation.

Runtime is the Cloudflare Workers stack (API Worker on Hono, D1, cron handlers in `apps/api-worker/src/cron/`, frontend on OpenNext with next-intl FI/EN).

## Goals / Non-Goals

**Goals:**

- Turn already-computed facts into public, deterministic, neutral display surfaces
- Honest coverage and freshness states (as-of dates, reliability badges, zero states) on every surface
- Zero new ingestion sources; zero personal data; no read-time heavy scans

**Non-Goals:**

- Advice, predictions, or personalized anything
- New merchant/tax data acquisition
- Paywall, entitlement, or API-key work
- Any mutation path into PUBLISHED reference datasets

## Decisions

### D1: The savings gap is the full landed cost, not the retail price

The savings page compares the complete landed cost (foreign retail price + transport + excise + container duty, calculator quantity 1, destination FI, default transport arrangement) against the Alko domestic reference. A retail-only gap would mislead: excise dominates beverage pricing, so a page ranking by pre-tax price deltas would routinely suggest "savings" that vanish after duty — breaking the site's honesty contract on its most public new surface.

*Alternative considered:* retail-price-only gap (one cheap query, no calculator runs). Rejected as misleading, per the structural-disclaimer principle: the number users see must mean what they would actually pay.

### D2: Savings rows are materialized daily, not computed per request

A new pass in the existing aggregation cron handler group (runs after time-series aggregation, isolated in its own `waitUntil` like its siblings) evaluates every product that has an Alko reference offer, runs the real calculator per product, and upserts the day's `savingsSnapshots` rows keyed by `unique(asOf, productId)`. Re-runs are idempotent (last write wins on the key columns, mirroring the price-history summary upsert). Per-product failures are isolated: one product erroring must not drop the run.

*Alternative considered:* read-time computation behind the API. Rejected because the technical assessment's open items already flag that read-time trust surfaces (`/accuracy`, ranking) have no cache in front of D1 scans; a public discovery page must not start life as an uncached per-request aggregation.

### D3: Guides reuse `blogPosts` through a `kind` discriminator

One migration adds `blogPosts.kind` (TEXT NOT NULL DEFAULT 'RATE_CHANGE', CHECK in ('RATE_CHANGE','GUIDE')). Guides are operator-created drafts (new ops console create/edit actions) published through the existing human-publication path; public listing is kind-filtered (`/blog` = RATE_CHANGE, `/guides` = GUIDE). Slug uniqueness stays per (slug, locale), unaffected.

*Alternative considered:* a separate `guides` table. Rejected: it would duplicate the publication queue, slugs, sitemap wiring, lint coverage, and ops surface for zero behavioral gain.

### D4: Integer cents and basis points everywhere; floats never touch money or percentages

All stored and transmitted figures are integers: euro cents for amounts, basis points (1/10000) for percentages. Gap percent is computed as an integer ratio; the JSON payload exposes `gapBasisPoints` / `deltaVsMedianBasisPoints` and the frontend renders localized percentages from them. This follows the pg-numeric decimal-coercion precedent already centralized at the repository boundary.

### D5: Price context reads product-wide daily rows over a fixed 90-day window with a minimum-bucket gate

`GET /api/v1/products/:id/price-context` reads daily `priceHistorySummaries` rows with the merchant-IS-NULL product-wide semantics (never merchant rows — mixing would stack several series into one window). "Current best price" is the lowest `priceCents` among the product's current offers, the same figure the product page already shows, so the context line can never contradict the price panel next to it. With fewer than 14 daily buckets the result is `unavailable` with reason `INSUFFICIENT_HISTORY`; no percentage is ever rendered over thin data. The window (90 days), bucket count, and as-of date travel in every payload — the every-number-is-explainable invariant.

### D6: The allowance explorer is strictly read-side, citations rendered verbatim

New routes wrap the existing `TravellerAllowancesRepository` reads only. There is no write path: publication remains the operator dataset-confirmation flow. The page renders `sourceCitation` fields verbatim as evidence links rather than paraphrasing them into conclusions, and carries the standing "guidance, not legal advice" framing — the same discipline the declaration guidance and classification outputs follow (evidence-bearing patterns, never bare legal claims).

### D7: Neutrality is enforced by isolation tests and content lint, not by convention

- A compliance test (mirroring `tests/compliance/accuracy-unitprice-input-isolation.test.ts`) proves calculator, ranking, and basket outputs byte-identical with zero, one, and many savings snapshots present — savings data feeds nothing.
- Content-lint additions ban advice phrasing ("best deal", "good time to buy", "buy now") in the message catalogs and guide bodies of the new surfaces; the vocabulary is factual-comparative only ("lower than", "differs by").
- The `/savings` methodology copy states the ordering rule (largest gap first, name as tiebreaker) exactly as `/value` and the ranking page do.

## Risks / Trade-offs

[Daily savings coverage starts small — only products with an Alko reference qualify] → The API returns coverage counts (evaluated / with reference / listed) and the page shows them with an honest zero state, the same treatment as the accuracy statistic.

[Cron pass cost grows with catalog size] → The qualifying set is bounded (products with an Alko reference offer); the pass runs off request path with per-product failure isolation and can be split across runs with the watermark pattern if the catalog grows.

[Price-context figures drift from the chart if offer selection differs] → Both the context line and the product page's best price derive from the same lowest-current-offer rule; a shared helper makes one implementation the only one.

[GUIDE drafts could be mistaken for auto-generated rate posts] → `kind` defaults to RATE_CHANGE, guide creation is an explicit operator action, and `/guides` renders no rate-version provenance block because guides carry none.

[Basis points lose sub-0.01% precision] → Irrelevant at display precision; the raw cents are always present alongside, so nothing is rounded away that a user could act on.

## Migration Plan

Two forward-only D1 migrations (`savingsSnapshots` table; `blogPosts.kind`), applied by the deploy pipeline's `wrangler d1 migrations` step (staging automatic, production gated). `blogPosts.kind` is additive with a default, so existing rows need no backfill. Rollback is `wrangler rollback` (previous Workers Version); the migrations are additive and harmless to the prior version. No data backfill is needed — the first savings pass materializes the current day, and the price-context and allowance endpoints read existing tables only.

## Open Questions

- Savings pass cadence: daily is the design assumption; if operators want intraday freshness, the pass can ride the 30-minute aggregation tick at the cost of D1 write volume. Decide at operator review; the implementation makes cadence a constant.
- Guide editorial workflow (who drafts, review cadence) is an operator process question, out of technical scope; the console provides create/edit/publish and the audit trail.
