# Daily scrape cadence and current-offer views — Tasks

> All implementation goes to `platform-engineer` (TypeScript, D1/Drizzle, schedulers, reliability model); `devops-engineer` has no surface (wrangler cron unchanged). 1.x and 3.x are independent and parallel; 2.x needs 1.x's gate function only for the seed-value rationale, not the code; 4.x is independent of 1–3. Verification last. The registry interval change (2.2) is an ops step, not a deploy — the gate from 1.1 is what makes it effective.

## 1. Interval-bucket cadence gate

- [x] 1.1 api-worker producer gate: pure `intervalBucketFires(pollingIntervalMs, now, previousTick)` helper plus the call in `schedulePriceIngestions`; merchants enqueue only when an interval boundary was crossed since the prior tick; hourly-interval rows keep today's behavior byte-for-byte; unit tests with synthetic clocks (hourly, daily, 6 h, missed-tick self-heal, exactly-on-boundary) <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/api-worker/src/queues/ingestion-producer.ts, apps/api-worker/src/queues/__tests__/ingestion-producer.test.ts] -->
- [x] 1.2 BullMQ scheduler parity: same gate in `schedulePriceIngestion` (`JobsSchedulerService`), `@Cron(EVERY_HOUR)` unchanged; tests mirror 1.1 <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/jobs/jobs-scheduler.service.ts, packages/application-api/src/jobs/__tests__/jobs-scheduler.price-ingestion.test.ts] -->

## 2. Registry rows and seed

- [x] 2.1 Seed rows `alks` and `alko` move `pollingIntervalMs` 3,600,000 → 86,400,000 (pg seed, D1 seed, `scripts/seed-d1.ts`); runbook notes the 1 h minimum the hourly tick can honor <!-- agent: platform-engineer.fast, depends_on: [1.1], touches: [packages/data-platform/src/seed/merchant-registry.seed.ts, scripts/seed-d1.ts, docs/**] -->
- [x] 2.2 Staging/production registry update through the ops `registerMerchant` path (no deploy): alks `polling_interval_ms` = 86,400,000; record the executed command in notes.md <!-- agent: platform-engineer.fast, depends_on: [1.1], touches: [docs/**] -->

## 3. Price staleness threshold

- [x] 3.1 `DEFAULT_STALENESS_THRESHOLDS.price` 24 h → 48 h with the cadence-margin rationale in the comment; sweep dependents for pinned 24 h expectations (data-quality service, freshness-alert cron, confidence-framework tests) and update only where they encoded the old constant, not where they test the mechanism <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/core-domain/src/reliability/reliability.types.ts, packages/core-domain/src/reliability/__tests__/**, packages/data-acquisition/src/__tests__/data-quality.service.test.ts, apps/api-worker/src/cron/__tests__/freshness-alert.test.ts] -->

## 4. Current-offer collapse in findOffers

- [x] 4.1 D1 `findOffers`: latest row per (product, merchant) via the max-id-per-merchant sub-query (latest = max `observed_at`, `id` tiebreak — same ordering `upsertOffer` change detection uses); repository tests pin single-row-per-merchant on duplicate scrapes, price-move supersession, and multi-merchant products <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/repositories/d1/product-search.repository.ts, packages/data-platform/src/repositories/d1/__tests__/product-search.repository.test.ts] -->
- [x] 4.2 Drizzle `findOffers` parity with the same sub-query idiom (pg + shared abstract contract unchanged); repository tests mirror 4.1 <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/repositories/product.repository.ts, packages/data-platform/src/repositories/__tests__/**] -->
- [ ] 4.3 Consumer contract tests: product detail route, unit-price embeds, price-context, and group-order `resolveUnitValues` each assert the deduped input shape (one row per merchant, lowest-price and embed math unchanged); product page renders one Retail prices row per merchant with the latest observed date <!-- agent: platform-engineer.build, depends_on: [4.1], touches: [apps/api-worker/src/routes/__tests__/**, apps/frontend/src/app/[locale]/products/[id]/**] -->

## 5. Verification

- [ ] 5.1 Full sweep: typecheck, lint, content lint, unit suites, golden, compliance, e2e, D1 suites; staging evidence — one enqueue per alks per 24 h from the producer logs across two ticks, and a product page showing a single Retail prices row for alks after two daily runs <!-- agent: platform-engineer.build, depends_on: [1.1, 1.2, 2.1, 2.2, 3.1, 4.1, 4.2, 4.3], touches: [] -->
