## Why

Phase 1 (MVP) is feature-complete: the calculator, tax engines, acquisition pipeline, and presentation layer all work against point-in-time data. Users can compare current offers but cannot see how a product's price developed or whether a price change came from the merchant or from a new tax-rule version. Task 2A in `docs/tasks.md` (Historical Price Intelligence) is the first Phase 2 growth item and closes that gap.

Most of the infrastructure already exists in stub or partial form:

- The BullMQ scheduler enqueues a time-series aggregation job every 30 minutes (T0.8), but `TimeSeriesAggregationWorker` is a logged no-op waiting for a repository layer.
- `retailOffers` already appends one row per (merchant, product, observedAt), giving raw price points.
- `taxRules` is an append-only versioned dataset queryable by effective window (`TaxRuleQueryService.getRateHistory`, `findHistoryRates`), so tax-driven changes can be identified by a join rather than by new machinery.
- `calculationRecords` already stores FK references to the excise and container-duty rule versions used per calculation.

This change turns those pieces into a complete historical price intelligence capability: an append-only observation log, periodically materialized aggregates, tax-change attribution, a historical data API, and charts in the frontend.

## What Changes

- **Observation log**: New `price_observations` table recording, per observation: foreign retail price, transport cost, applicable excise and container-duty rule versions, and the resulting quantity=1 baseline landed cost, with per-input reliability statuses. Appended by the price-ingestion background job, never on the request path.
- **Materialized aggregates**: New `price_history_summaries` table with daily and weekly rows (open/close/min/max/avg for price and landed cost, observation count). The existing stub `TimeSeriesAggregationWorker` implements incremental, idempotent materialization. Chart requests read aggregates only; no request recomputes full history.
- **Tax-change attribution**: New `TaxChangeAttributionService` classifies landed-cost changes as TAX_RULE_CHANGE, MERCHANT_PRICE_CHANGE, TRANSPORT_CHANGE, or MIXED by joining consecutive observations against tax-rule effective windows. Pure and unit-testable.
- **Historical data API**: New `GET /api/v1/products/:id/price-history` endpoint (metric, granularity, date range, optional merchant filter), rate-limited, range-capped at 365 days, returning per-point reliability, confidence, and attribution.
- **Frontend charts**: Pure SVG chart components (no new dependency) rendering historical price and landed-cost series with tax-change markers, freshness badges, and controlled-vocabulary labels, integrated into the calculator result view and compare page.
- **Feature flag**: `enable_historical_price_intelligence` gates both the API route and the UI, per the project rule that new user-facing data presentation rolls out behind a flag for instant rollback.
- **No synthetic backfill**: history accrues from rollout. The API response states the earliest available observation date so the UI can show "data available from".

## Capabilities

### New Capabilities
- `historical-price-intelligence`: Append-only observation log per canonical product and merchant offer, materialized daily/weekly aggregates, tax-change attribution, and a historical data API for chart rendering.

### Modified Capabilities
- `product-data-model`: Adds the `price_observations` and `price_history_summaries` tables with covering indexes.
- `background-jobs`: Implements the stub `TimeSeriesAggregationWorker` to materialize summaries incrementally and idempotently.
- `web-application`: Adds historical price and landed-cost charts to the calculator result view and compare page, behind a feature flag.
- `mvp-testing`: Adds unit tests for the recorder, attribution, worker, and repositories, plus an end-to-end integration test following the golden-dataset convention (real engines, no mocks).

## Impact

- **Code**: New files under `packages/core-domain/src/history/`, `packages/application-api/src/historical/`, `packages/data-platform/src/repositories/`. Modifications to `packages/data-platform/src/schema.ts`, `packages/application-api/src/jobs/workers/time-series-aggregation.worker.ts`, the price-ingestion path in `packages/data-acquisition/`, `apps/backend/src/` composition root, `packages/application-api/src/feature-flags/`, and `apps/frontend/src/`.
- **APIs**: New read-only `GET /api/v1/products/:id/price-history`. No breaking changes to existing endpoints.
- **Dependencies**: None. Charts are hand-rolled SVG; storage uses the existing PostgreSQL + Drizzle stack.
- **Data**: Two new tables, both append-oriented. Observation volume grows with ingestion frequency (hourly per merchant product); aggregates bound chart query cost. Indexes on (product, observedAt) and (merchant, product, observedAt).
- **Infrastructure**: None. The queue, scheduler entry, and worker skeleton already exist.
- **Documentation**: `docs/tasks.md` T2.1 through T2.5 updated with completion notes.

## Task mapping

| docs/tasks.md | Change tasks |
|---|---|
| T2.1 observation log | 1.1, 1.3, 2.1, 2.2 |
| T2.2 materialized aggregates | 1.2, 1.4, 3.1 |
| T2.3 tax-change attribution | 3.2 |
| T2.4 historical data API | 4.1 |
| T2.5 charts | 5.1, 5.2, 5.3 |
