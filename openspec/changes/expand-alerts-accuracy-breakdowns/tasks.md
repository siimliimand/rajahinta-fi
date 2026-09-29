# Expand alerts and accuracy breakdowns — Tasks

> Schema work (1.x) gates everything; the two accuracy tasks (4.1) and migration run in the first wave. Cron branches (2.x, 3.1) share `price-alert-evaluation.ts` and serialize on touches. Frontend, compliance, and observability land after their API dependencies. Verification last of all.

## 1. Schema and contract

- [ ] 1.1 Migration (D1 next after 0016, pg `drizzle/` parity): extend the `price_alerts` kind value set with `LANDED_COST` and `CATEGORY`, make `product_id` nullable, add a nullable category column; update the `PriceAlertKind` union and the kind-aware creation guards (PRICE/TAX_CHANGE unchanged; LANDED_COST requires productId + positive threshold; CATEGORY requires canonical category + positive threshold, forbids productId) with repository unit tests + D1 integration tests <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/d1/migrations/*, packages/data-platform/src/d1/schema.ts, packages/data-platform/src/repositories/d1/price-alert.repository.ts, packages/data-platform/drizzle/**, packages/data-platform/src/repositories/d1/__tests__/price-alert.repository.test.ts, tests/integration/d1/price-alerts.d1.test.ts] -->
- [ ] 1.2 Alerts API: extend create/list validation and `toAlertJson` for the two new kinds; unknown-category 400 naming the canonical set mirrors the search-route contract; route-level tests for all four kind contracts <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [apps/api-worker/src/routes/alerts.routes.ts] -->

## 2. LANDED_COST kind

- [ ] 2.1 `latestMaterializedLandedCostCents` reader: newest daily product-wide (`merchant IS NULL`) `landedCostCloseCents` within the 7-day lookback, null otherwise — parity with the price reader, unit tests <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [apps/api-worker/src/cron/price-alert-evaluation.ts] -->
- [ ] 2.2 LANDED_COST evaluator branch (kind-guard ownership) + `buildLandedCostAlertEmail`: cite retail price, transport offer + route, excise and container-duty dataset versions, confidence, observed-at, and the quantity=1-baseline/not-a-live-quote statement; factual wording only; email-builder unit tests pin every cited field and the content-lint-safe phrasing <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [apps/api-worker/src/cron/price-alert-evaluation.ts] -->

## 3. CATEGORY kind

- [ ] 3.1 CATEGORY sweep: deterministic min-`priceCloseCents` query over the category's products with fresh daily product-wide summaries (indexed join), lowest-`productId` tie-break; evaluator branch + email naming tripping product, price, category, threshold; unit + D1 integration tests <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [apps/api-worker/src/cron/price-alert-evaluation.ts, packages/data-platform/src/repositories/d1/price-history-summary.repository.ts] -->

## 4. Accuracy breakdowns

- [ ] 4.1 Breakdown support: filterable `findAccuracyStatistic` (category join outcome → calculation record → product category; carrier join → transport offer), `OutcomeAccuracyBreakdown` types in core-domain, aggregation extended under the existing honesty rules (null share exactly when count 0); unit tests <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/core-domain/src/outcomes/**, packages/data-platform/src/repositories/d1/calculation-outcome.repository.ts] -->
- [ ] 4.2 Breakdown endpoint (`groupBy=category|carrier`) with the min-N floor: cells n<10 render count-only, n=0 the empty state, n>=10 share + count; module-label wording only; route tests <!-- agent: platform-engineer.build, depends_on: [4.1], touches: [apps/api-worker/src/routes/outcomes.routes.ts] -->
- [ ] 4.3 Compliance test: breakdown read path display-only — calculator, ranking, and basket responses byte-identical with breakdowns active (precedent: accuracy-unitprice-input-isolation) <!-- agent: platform-engineer.build, depends_on: [4.2], touches: [tests/compliance/**] -->

## 5. Frontend

- [ ] 5.1 Alert UI: kind choice on the product page (PRICE / LANDED_COST), category alert entry on category browse, kind labels in the account alerts list; threshold inputs validate per kind; component tests <!-- agent: platform-engineer.build, depends_on: [1.2], touches: [apps/frontend/src/app/[locale]/product/**, apps/frontend/src/app/[locale]/account/**, apps/frontend/src/app/[locale]/components/**] -->
- [ ] 5.2 Accuracy breakdown display: category | carrier selector in the AccuracyStat section variant, floor/empty states rendered distinctly, fi/en message keys; home trust-row keeps the global figure <!-- agent: platform-engineer.build, depends_on: [4.2], touches: [apps/frontend/src/app/[locale]/components/AccuracyStat.tsx, apps/frontend/src/app/[locale]/ranking/ranking-view.tsx, apps/frontend/src/app/[locale]/page.tsx, apps/frontend/messages/**] -->

## 6. Observability

- [ ] 6.1 Per-kind evaluation counter points and failure-threshold coverage for the LANDED_COST and CATEGORY sweeps (same warning/critical ladder); metrics unit tests <!-- agent: platform-engineer.build, depends_on: [2.2, 3.1], touches: [apps/api-worker/src/observability/metrics.ts, apps/api-worker/src/observability/price-alert-thresholds.ts] -->

## 7. Verification

- [ ] 7.1 Full verification: rebuild `@rajahinta/core-domain` first, then typecheck, lint, content lint, unit suites, e2e, D1 integration suites; confirm the four-kind sweep evaluates mixed active rows once each, the floor/empty states render per spec, and no feature flag exists anywhere in the diff <!-- agent: platform-engineer.fast, depends_on: [1.1, 1.2, 2.2, 3.1, 4.3, 5.1, 5.2, 6.1], touches: [] -->
