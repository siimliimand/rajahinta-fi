# Phase 2A — Historical Price Intelligence — Tasks

> Derived from Task 2A (T2.1 through T2.5) of `docs/tasks.md`.
> All tasks assigned to `platform-engineer` (TypeScript, NestJS, Drizzle, React scope). No `devops-engineer` tasks: the queue, scheduler entry, and worker skeleton already exist from T0.8.

---

## 1. Data model

- [x] 1.1 Add `priceObservations` table to `packages/data-platform/src/schema.ts` — product FK, merchant, retail-offer FK, observedAt, foreignRetailPriceCents, transportCostCents, excise/container-duty rule version FKs, landedCostCents, per-input reliability JSONB, confidence; Drizzle migration with indexes on (product, observedAt) and (merchant, product, observedAt) <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/schema.ts, packages/data-platform/drizzle/**] -->
- [x] 1.2 Add `priceHistorySummaries` table — granularity (daily/weekly), periodStart, product FK, merchant (nullable for product-wide), open/close/min/max/avg for price and landed cost, observationCount, strictest reliability; unique (granularity, periodStart, product, merchant) + index (granularity, product, periodStart); Drizzle migration <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [packages/data-platform/src/schema.ts, packages/data-platform/drizzle/**] -->
- [x] 1.3 Create `PriceObservationRepository` at `packages/data-platform/src/repositories/price-observation.repository.ts` — append-only insert plus range reads by product and by merchant offer; no update/delete operations <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [packages/data-platform/src/repositories/price-observation.repository.ts] -->
- [x] 1.4 Create `PriceHistorySummaryRepository` at `packages/data-platform/src/repositories/price-history-summary.repository.ts` — idempotent upsert on the unique key, range reads for the API <!-- agent: platform-engineer.build, depends_on: [1.2], touches: [packages/data-platform/src/repositories/price-history-summary.repository.ts] -->

## 2. Observation capture

- [x] 2.1 Create the history module at `packages/core-domain/src/history/` — `PriceObservationRecorderService` + `IPriceObservationPort`; resolves tax-rule versions effective at observedAt via the existing `ITaxRuleRepositoryPort`; selects the current transport offer; computes the quantity=1 baseline landed cost through the same engine code paths as `LandedCostCalculatorService`; snapshots per-input reliability statuses <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/core-domain/src/history/**] -->
- [x] 2.2 Wire the recorder into the price-ingestion background path (hook after offer upsert in the pipeline or price-ingestion worker) and register the port adapter in the `apps/backend` composition root — strictly off the request path; one observation per changed offer <!-- agent: platform-engineer.build, depends_on: [2.1, 1.3], touches: [packages/data-acquisition/src/**, apps/backend/src/**] -->

## 3. Aggregation and attribution

- [x] 3.1 Implement the stub `TimeSeriesAggregationWorker` at `packages/application-api/src/jobs/workers/time-series-aggregation.worker.ts` — incremental materialization from a persisted watermark, idempotent upsert of daily and weekly summaries, watermark advances only after successful writes, handles bucketStart/windowMinutes job data <!-- agent: platform-engineer.build, depends_on: [1.3, 1.4], touches: [packages/application-api/src/jobs/workers/time-series-aggregation.worker.ts] -->
- [x] 3.2 Create `TaxChangeAttributionService` at `packages/core-domain/src/history/services/` — pure classification of consecutive-observation steps into TAX_RULE_CHANGE / MERCHANT_PRICE_CHANGE / TRANSPORT_CHANGE / MIXED by joining against tax-rule effective windows; returns evidence (moved inputs, bounding versionLabels) <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [packages/core-domain/src/history/**] -->

## 4. Historical data API

- [x] 4.1 Create `HistoricalDataController` + module at `packages/application-api/src/historical/` — `GET /api/v1/products/:id/price-history` with metric (price|landed-cost), granularity (day|week), from/to capped at 365 days, optional merchant filter; reads summaries only; rate-limited via the existing `RateLimitGuard`; gated by `enable_historical_price_intelligence`; response carries series points, per-point reliability, attribution, and earliest available observation date <!-- agent: platform-engineer.build, depends_on: [1.4, 3.2], touches: [packages/application-api/src/historical/**] -->

## 5. Frontend

- [ ] 5.1 Add price-history types and fetch client under `apps/frontend/src/lib/` — mirror the API contract including reliability and attribution fields <!-- agent: platform-engineer.build, depends_on: [4.1], touches: [apps/frontend/src/lib/**] -->
- [ ] 5.2 Create `HistoryChart` component under `apps/frontend/src/app/calculator/components/` — pure SVG (no chart library), price and landed-cost series, tax-change markers with version labels, reliability/freshness badges, controlled-vocabulary labels, neutral equal-treatment merchant series <!-- agent: platform-engineer.build, depends_on: [5.1], touches: [apps/frontend/src/app/calculator/components/**] -->
- [ ] 5.3 Integrate charts into the calculator result view and the compare page — behind the feature flag; hide charts and skip the request when the flag is off; show "data available from" for truncated history <!-- agent: platform-engineer.build, depends_on: [5.2, 6.1], touches: [apps/frontend/src/app/calculator/**, apps/frontend/src/app/compare/**] -->

## 6. Feature flag, tests, verification

- [x] 6.1 Add the `enable_historical_price_intelligence` feature flag to the existing `FeatureFlagService`/`LaunchGate` infrastructure — default off; gates the API route and the UI <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/feature-flags/**] -->
- [ ] 6.2 Write unit tests — recorder (tax-version resolution at observedAt, engine reuse, reliability snapshot), attribution service (all four classifications plus evidence fields), aggregation worker (incremental, idempotent, watermark on failure), both repositories <!-- agent: platform-engineer.build, depends_on: [2.1, 2.2, 3.1, 3.2], touches: [packages/core-domain/src/history/__tests__/**, packages/application-api/src/__tests__/**] -->
- [ ] 6.3 Write the integration test at `tests/integration/` — observation append through aggregation run through API response with attribution, using real engine implementations and no mocks, per the golden-dataset convention <!-- agent: platform-engineer.build, depends_on: [4.1, 3.1], touches: [tests/integration/**] -->
- [ ] 6.4 Run typecheck, lint, unit tests, and golden-dataset regression tests; fix fallout <!-- agent: platform-engineer.fast, depends_on: [5.3, 6.2, 6.3], touches: [] -->
- [ ] 6.5 Update `docs/tasks.md` — mark T2.1 through T2.5 with completion notes referencing this change <!-- agent: platform-engineer.fast, depends_on: [6.4], touches: [docs/tasks.md] -->

---

## Summary

| Group | Tasks | Agent |
|-------|-------|-------|
| 1. Data model | 4 | platform-engineer |
| 2. Observation capture | 2 | platform-engineer |
| 3. Aggregation and attribution | 2 | platform-engineer |
| 4. Historical data API | 1 | platform-engineer |
| 5. Frontend | 3 | platform-engineer |
| 6. Flag, tests, verification | 6 | platform-engineer |
| **Total** | **18** | |

### Wave execution order (dependency-aware)

```
Wave 1 (3 tasks):   1.1, 2.1, 6.1
Wave 2 (3 tasks):   1.2, 1.3, 3.2
Wave 3 (2 tasks):   1.4, 2.2
Wave 4 (2 tasks):   3.1, 4.1
Wave 5 (3 tasks):   5.1, 6.2, 6.3
Wave 6 (1 task):    5.2
Wave 7 (1 task):    5.3
Wave 8 (1 task):    6.4
Wave 9 (1 task):    6.5
```

`ob-plan-apply` recomputes exact waves from the annotations; the sketch above is indicative only. Same-file serialization via `touches` (1.1/1.2 share `schema.ts`; 2.1/3.2 share the history module directory) is enforced regardless of `depends_on`.
