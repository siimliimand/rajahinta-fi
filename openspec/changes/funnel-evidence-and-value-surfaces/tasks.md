# funnel-evidence-and-value-surfaces — Tasks

## Group 1 — Faro foundation and funnel events

- [x] 1.1 Add `@grafana/faro-web-sdk` (with web-tracing instrumentation) to the frontend as an env-gated init module that no-ops when `NEXT_PUBLIC_FARO_URL` is unset, following the optional-binding pattern of the AE metrics emitters <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/frontend/package.json, apps/frontend/src/instrumentation-client.ts, apps/frontend/src/lib/telemetry/**] -->
- [x] 1.2 Declare the Faro public endpoint and app-key env vars per environment in `apps/frontend/wrangler.jsonc` and `infra/environments/{dev,staging,prod}.yaml` (public client config, not a credential) <!-- agent: devops-engineer.fast, depends_on: [], touches: [apps/frontend/wrangler.jsonc, infra/environments/*.yaml] -->
- [x] 1.3 Emit the funnel events `calc_started`, `calc_result_seen`, `basket_optimized`, and `alert_set` at the four flow success points and measure client-side time-to-result from calculator submit to rendered result <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [apps/frontend/src/app/[locale]/calculator/**, apps/frontend/src/app/[locale]/basket/**, apps/frontend/src/app/[locale]/account/alerts/**, apps/frontend/src/lib/telemetry/**] -->
- [x] 1.4 Add the anonymous, session-scoped product-analytics disclosure line to the footer privacy copy in FI + EN, content-lint green <!-- agent: platform-engineer.fast, depends_on: [1.1], touches: [apps/frontend/src/app/[locale]/components/SiteFooter.tsx, apps/frontend/messages/**] -->
- [x] 1.5 Document the funnel event dictionary and the Grafana/Faro query snippets in `METRICS.md` beside the AE re-point queries <!-- agent: devops-engineer.fast, depends_on: [1.3], touches: [apps/api-worker/src/observability/METRICS.md] -->

## Group 2 — Price-context factual rung

- [x] 2.1 Extend `computePriceContextWindow` with an integer percentile rank (share of window buckets strictly above the current price, in basis points, deterministic integer arithmetic) and a derived `isWindowLow` fact (current best equals the window minimum), both behind the existing minimum-bucket gate; unit tests covering boundary ranks and the gated state <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/core-domain/src/price-context/**] -->
- [x] 2.2 Carry `percentileRankBasisPoints` and `isWindowLow` through the product read path that serves the context line, including the unavailable-state passthrough <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [apps/api-worker/src/routes/**, packages/core-domain/src/price-context/**] -->
- [x] 2.3 Render the window-low and percentile phrasings in `ProductPriceContextLine` (FI + EN) with the window and as-of context, update component tests, and pass the content-policy lint <!-- agent: platform-engineer.build, depends_on: [2.2], touches: [apps/frontend/src/app/[locale]/products/[id]/components/ProductPriceContextLine.tsx, apps/frontend/messages/**] -->

## Group 3 — Homepage task cards

- [x] 3.1 Add a static, server-rendered task-card section to the homepage linking basket, trip, event, what-if, and savings, styled from the design tokens in both locales with no new input surface <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/frontend/src/app/[locale]/page.tsx, apps/frontend/messages/**] -->
- [x] 3.2 Update the homepage unit tests for the new section <!-- agent: platform-engineer.fast, depends_on: [3.1], touches: [apps/frontend/src/app/[locale]/__tests__/**] -->

## Group 4 — Mobile-viewport e2e

- [x] 4.1 Add mobile-viewport (375×667 and 390×844) Playwright journeys for the calculator, basket, and product pages asserting no horizontal overflow on result surfaces and ≥44 px touch targets on quantity controls <!-- agent: platform-engineer.build, depends_on: [], touches: [tests/e2e-browser/**] -->
- [x] 4.2 Wire the mobile viewport projects into the `e2e-browser` workflow <!-- agent: devops-engineer.fast, depends_on: [4.1], touches: [.github/workflows/e2e-browser.yml] -->

## Group 5 — Verification and docs

- [ ] 5.1 Run typecheck, lint, unit, golden, compliance, and e2e suites; resolve all regressions <!-- agent: platform-engineer.fast, depends_on: [1.3, 2.3, 3.2, 4.2], touches: [] -->
- [ ] 5.2 Update ARCHITECTURE.md — frontend RUM row, price-context capability description, homepage description <!-- agent: platform-engineer.fast, depends_on: [5.1], touches: [ARCHITECTURE.md] -->
