# Funnel evidence and value surfaces

## Why

An external client analysis (2026-09-29) evaluated the site through a first-time-visitor / returning-customer / task-completion lens and proposed eight improvements. Six of the eight already shipped (price history and 90-day context, target-price alerts now spanning four kinds, multi-item basket optimization, saved scenarios with consent separation, compliance-grade trust surfacing, and — via `2026-09-27-client-experience-improvement` — the functional hero search). What the analysis asks the site to *prove* is unanswerable today: the client side is instrumentation-dark. No RUM, no funnel events, no repeat-visit signal exists; the only user-behavior signal is the outbound merchant-click counter. Task completion, time to result, and repeat usage — the analysis's own evaluation criteria — cannot be measured.

Three residual product gaps remain after the client-experience change:

1. The price-context line stops one factual rung short: it states the delta versus the 90-day median but not the two derived facts a visitor actually asks for — whether this is the lowest observed price in the window, and where the current price sits within the window's distribution.
2. The homepage surfaces one task (search) while five built task tools (basket, trip, event, what-if, savings) are reachable only through the header.
3. The Phase-4 mobile refinements shipped without viewport regression coverage — the e2e suite runs desktop viewports only.

## What Changes

### Track 1 — RUM and funnel events (client instrumentation)

- The Grafana Faro Web SDK loads in the Next.js frontend when its public endpoint configuration is present; without configuration it is a full no-op (the optional-METRICS-binding pattern). Vars are declared per environment in `apps/frontend/wrangler.jsonc` and `infra/environments/*.yaml`.
- Four named funnel events mark flow success: `calc_started`, `calc_result_seen`, `basket_optimized`, `alert_set`. The server-side outbound-click count remains the authoritative action-completion signal.
- Client-side time-to-result is measured from calculator submit to rendered result, complementing the existing server span.
- RUM is session-scoped and identity-free: no user identifiers, no account data, no form contents. Repeat usage is answered at cohort level (sessions returning across distinct days), never per user.
- The footer privacy copy gains one disclosure line in FI + EN; the funnel event dictionary and Grafana query snippets are documented in `METRICS.md` beside the AE re-point queries.

### Track 2 — Price-context factual rung

- `computePriceContextWindow` gains an integer percentile rank (share of window buckets strictly above the current price, in basis points, deterministic integer math) and a derived `isWindowLow` fact (current best equals the window minimum). Both respect the existing minimum-bucket gate and its honest unavailable state.
- `ProductPriceContextLine` renders the two new facts as factual sentences in FI + EN ("lowest observed price in this window"; "cheaper than X% of the days in this window"), carrying the window and as-of context. Advice phrasing remains banned and lint-enforced.

### Track 3 — Homepage task cards

- A static, server-rendered task-card section links basket, trip, event, what-if, and savings, styled from the design tokens in both locales. The hero search remains the homepage's only input; there is no origin selector (origin is merchant-derived in this domain, not user-chosen).

### Track 4 — Mobile-viewport e2e

- Playwright journeys for calculator, basket, and product pages run at 375×667 and 390×844 in the existing workers-config harness, asserting no horizontal overflow on result surfaces and ≥44 px touch targets on quantity controls; the `e2e-browser` workflow executes the new projects.

## Decisions

- **D1: identity-free, session-scoped analytics.** No user IDs, no PII, no form contents; repeat usage is cohort-level. This honors the data-minimization policy and needs no account linkage.
- **D2: analytics never feed calculations or rankings.** Funnel events and RUM are observability outputs only, isolated from the ranking path per the billing-ranking-isolation precedent.
- **D3: the verdict ladder stops at factual rungs.** Window-low and percentile are statistics about the observed window; "good time to buy" / "wait" phrasing stays prohibited on every public surface (content-policy lint, per the client-experience change's D5).
- **D4: one input per homepage.** Task cards are static links, not a form; the analysis's origin selector is rejected as domain-inverted (origin is a per-merchant fact in this data model).
- **D5: no feature flags.** Everything ships enabled (house rule since the flag-system removal, 2026-09-07); Faro's env-gated no-op is a configuration state, not a flag; rollback is `wrangler rollback`.
- **D6: extend existing harnesses only.** Mobile coverage lands in the current Playwright workers config and the `e2e-browser` workflow; funnel documentation lands in the existing `METRICS.md`.

## Non-goals (this change)

- No advice, prediction, or purchase-urging phrasing anywhere.
- No per-user analytics, identity joins, A/B testing infrastructure, or session-replay PII capture.
- No origin selector or full dashboard form on the homepage.
- No new notification or delivery channels.
- No Grafana Cloud dashboard UI provisioning — queries are documented in `METRICS.md`; dashboard assembly follows the existing re-point conventions.
- No server-side API changes for alert or outbound-click flows (the `alert_set` event is emitted client-side on the existing success response).

## Capabilities

### Added Capabilities

- `deployment-observability`: Real-user monitoring and funnel events — env-gated Faro loading, identity-free session-scoped RUM, the four named funnel events, client time-to-result, and the analytics-never-an-input isolation rule.

### Modified Capabilities

- `price-context`: The trailing-window computation additionally carries an integer percentile rank and an `isWindowLow` fact behind the same minimum-bucket gate; factual rendering extends to the two new phrasings with the advice ban unchanged.
- `web-application`: The homepage gains a static task-card section linking the five task tools in both locales with no new input surface.
- `mvp-testing`: The e2e suite executes mobile-viewport projects (375×667, 390×844) with overflow and touch-target assertions on the calculator, basket, and product journeys.

## Impact

- `apps/frontend`: Faro init module (`src/instrumentation-client.ts`), `src/lib/telemetry/` event helpers, funnel emit points in calculator/basket/alert flows, homepage task-card section, `ProductPriceContextLine` wording, footer disclosure, FI/EN message catalogs, `package.json` (Faro SDK dependency).
- `packages/core-domain`: `price-context` window-stats extension (percentile rank, `isWindowLow`) plus unit tests.
- `apps/api-worker`: the product read path serving the context line carries the new fields; `src/observability/METRICS.md` documents the funnel event dictionary and queries.
- `tests/e2e-browser`: mobile-viewport journey specs and project config.
- `.github/workflows/e2e-browser.yml`: mobile projects in the workflow matrix.
- `infra/environments/*.yaml`, `apps/frontend/wrangler.jsonc`: Faro public endpoint/app-key vars per environment.
- Docs: ARCHITECTURE.md frontend/observability/price-context rows.
