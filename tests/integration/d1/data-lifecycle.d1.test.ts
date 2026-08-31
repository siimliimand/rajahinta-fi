/**
 * Integration test — data lifecycle on D1 + R2 (task 2.7, change
 * migrate-to-cloudflare). D1 port of tests/integration/data-lifecycle.test.ts;
 * the pg original stays untouched for the Postgres stack until cutover.
 *
 * Assertion-intent mapping (pg mechanic → Cloudflare mechanic, per design
 * D4 as amended by gate review G1):
 *
 *   1. Partition lifecycle (monthly partitions + DROP PARTITION + EXPLAIN
 *      pruning) → scheduled bounded batch DELETE over the calculation
 *      records (D1CalculationRecordRetentionService): anonymous 30-day
 *      pruning preserved; the "session-bearing rows are never pruned"
 *      rule is REPLACED by the gate-decision age cap (default 180 days);
 *      bounded batches and sweep idempotence take the place of partition
 *      DDL. priceHistorySummaries remains the long-term analytical
 *      record, so summary rows survive every sweep.
 *   2. Hypertable (timescaledb chunks + EXPLAIN chunk exclusion) → the
 *      append-only R2 JSONL observation log partitioned by UTC day
 *      (src/d1/observation-log.ts): partition-key scheme and round-trip
 *      parity stand in for chunk registration; observationKeysToScan's
 *      day-grained range check stands in for chunk exclusion.
 *   3. Watermark scan (real TimeSeriesAggregationWorker over Drizzle
 *      repositories) → the SAME worker over the R2-backed observation
 *      store (2.3 modules) with D1 summary + watermark repositories:
 *      null → high-water advance, incremental same-instant boundary
 *      re-scan, no regression, and summary-query equivalence between the
 *      materialized D1 buckets and independent recomputation from the
 *      R2 log.
 *
 * Runs on the node:sqlite D1 harness (migrations applied) — no external
 * infrastructure, no feature gate: the storage is self-contained.
 *
 * @module DataLifecycleD1IntegrationTest
 */

import { describe, it, expect, beforeAll } from 'vitest';

import {
  observationFixture,
  openMigratedD1,
  R2JsonlObservationStore,
  seedProductRow,
  seedRetailOfferRow,
} from './harness';

import {
  observationKeysToScan,
  observationObjectKey,
  parseObservationLine,
  serializeObservationLine,
} from '../../../packages/data-platform/src/d1/observation-log';
import { buildBucketSummaries } from '../../../packages/data-platform/src/d1/summary-aggregation';
import { D1AggregationWatermarkRepository } from '../../../packages/data-platform/src/repositories/d1/aggregation-watermark.repository';
import { D1BasketCalculationRecordRepository } from '../../../packages/data-platform/src/repositories/d1/basket-calculation-record.repository';
import { D1CalculationRecordRepository } from '../../../packages/data-platform/src/repositories/d1/calculation-record.repository';
import { D1CalculationRecordRetentionService } from '../../../packages/data-platform/src/repositories/d1/calculation-record-retention';
import { D1PriceHistorySummaryRepository } from '../../../packages/data-platform/src/repositories/d1/price-history-summary.repository';
// Worker class is not re-exported from the application-api package index —
// deep import (same convention as the pg suite this file ports).
import {
  TimeSeriesAggregationWorker,
  startOfUtcDay,
  type TimeSeriesAggregationJobData,
} from '../../../packages/application-api/src/jobs/workers/time-series-aggregation.worker';
import type { Job } from 'bullmq';
import { QUEUES } from '../../../packages/data-acquisition/src/index';

function makeJob(
  data: TimeSeriesAggregationJobData,
): Job<TimeSeriesAggregationJobData> {
  return { data, attemptsMade: 0 } as unknown as Job<TimeSeriesAggregationJobData>;
}

// ===========================================================================
// Suite 1 — calculation-record retention (partition lifecycle → batch DELETE)
// ===========================================================================

describe('calculation-record retention on D1 — anonymous window, age cap, bounded batches', () => {
  const { db, d1 } = openMigratedD1();
  const calcRepo = new D1CalculationRecordRepository(d1);
  const basketRepo = new D1BasketCalculationRecordRepository(d1);
  const retention = new D1CalculationRecordRetentionService(d1);

  /** Fixed clock — every fixture instant and cutoff derives from it. */
  const NOW = new Date('2026-08-28T04:30:00.000Z');
  const RETENTION_DAYS = 30;
  const AGE_CAP_DAYS = 180;

  const SESSION_ANCIENT = 'd1-lifecycle:auth-ancient';
  const SESSION_RECENT = 'd1-lifecycle:auth-recent';

  let productId: number;
  let run1: Awaited<ReturnType<D1CalculationRecordRetentionService['runRetention']>>;
  let run2: Awaited<ReturnType<D1CalculationRecordRetentionService['runRetention']>>;

  const count = (sql: string): number =>
    (db.prepare(sql).get() as { n: number }).n;

  const calcFixture = (calculatedAt: Date, sessionId: string | null) => ({
    productMasterId: productId,
    retailOfferIds: null,
    transportOfferId: null,
    exciseRuleVersionId: null,
    containerDutyRuleVersionId: null,
    totalCents: 100,
    breakdown: {},
    confidence: 'HIGH',
    quantity: 1,
    destination: 'FI',
    disclaimer: 'd1 lifecycle fixture',
    sessionId,
    calculatedAt,
  });

  const basketFixture = (createdAt: Date, sessionId: string | null) => ({
    sessionId,
    destination: 'd1-lifecycle-test',
    transportArrangement: 'SELF_ARRANGEMENT',
    inputBasket: {},
    shipmentBreakdown: {},
    totalCents: 100,
    confidence: 'HIGH',
    disclaimer: 'd1 lifecycle fixture',
    createdAt,
  });

  beforeAll(async () => {
    productId = await seedProductRow(d1, 'D1 Lifecycle Retention Fixture');

    // Four policy positions per table (the pg suite spread these across
    // monthly partitions; D1 holds them in one table — the sweep's WHERE
    // windows do the partitioning work now):
    //   - anonymous, 200 days old  → past window AND past cap → pruned, then age-capped (already gone)
    //   - anonymous, 40 days old   → past 30-day window, inside cap → pruned by the anonymous pass
    //   - authenticated, 200 days old → inside anon window is irrelevant; past cap → deleted by the cap pass
    //   - authenticated, fresh     → kept by both passes
    const day = (ms: number) => new Date(NOW.getTime() - ms * 86_400_000);
    const ANCIENT = 200;
    const EXPIRED = 40;

    await calcRepo.create(calcFixture(day(ANCIENT), null));
    await calcRepo.create(calcFixture(day(EXPIRED), null));
    await calcRepo.create(calcFixture(day(ANCIENT), SESSION_ANCIENT));
    await calcRepo.create(calcFixture(NOW, null));
    await calcRepo.create(calcFixture(NOW, SESSION_RECENT));

    await basketRepo.create(basketFixture(day(ANCIENT), null));
    await basketRepo.create(basketFixture(day(EXPIRED), null));
    await basketRepo.create(basketFixture(day(ANCIENT), SESSION_ANCIENT));
    await basketRepo.create(basketFixture(NOW, null));
    await basketRepo.create(basketFixture(NOW, SESSION_RECENT));

    // Materialize one summary row BEFORE the sweeps — priceHistorySummaries
    // is the long-term analytical record the retention sweeps must leave
    // alone (pg: summaries never lived in the partitioned tables either).
    await d1
      .prepare(
        `INSERT INTO price_history_summaries (id, granularity, period_start, product_id, merchant,
            price_open_cents, price_close_cents, price_min_cents, price_max_cents, price_avg_cents,
            landed_cost_open_cents, landed_cost_close_cents, landed_cost_min_cents,
            landed_cost_max_cents, landed_cost_avg_cents, observation_count, strictest_reliability)
         VALUES (1, 'daily', '2026-08-28', ?, NULL, 100, 100, 100, 100, 100,
                 200, 200, 200, 200, 200, 1, 'VERIFIED')`,
      )
      .bind(productId)
      .run();

    run1 = await retention.runRetention({
      now: NOW,
      retentionDays: RETENTION_DAYS,
      ageCapDays: AGE_CAP_DAYS,
      batchSize: 2,
    });
    run2 = await retention.runRetention({
      now: NOW,
      retentionDays: RETENTION_DAYS,
      ageCapDays: AGE_CAP_DAYS,
      batchSize: 2,
    });
  });

  it('prunes exactly the anonymous rows past the 30-day window, in both tables', () => {
    // Both expired anonymous rows per table (200-day AND 40-day — both
    // past the 30-day window; the 200-day one is then also age-capped in
    // the same sweep).
    expect(run1.prunedAnonymous['calculation_records']).toBe(2);
    expect(run1.prunedAnonymous['basket_calculation_records']).toBe(2);

    const cutoff = new Date(NOW.getTime() - RETENTION_DAYS * 86_400_000);
    expect(
      count(
        `SELECT COUNT(*) AS n FROM calculation_records
         WHERE session_id IS NULL AND calculated_at < '${cutoff.toISOString()}'`,
      ),
    ).toBe(0);
    expect(
      count(
        `SELECT COUNT(*) AS n FROM basket_calculation_records
         WHERE session_id IS NULL AND created_at < '${cutoff.toISOString()}'`,
      ),
    ).toBe(0);
  });

  it('age-caps ALL records past the cap — session-bearing included (gate decision 3)', async () => {
    // Replaces the pg assertion "expired authenticated history is kept
    // forever": D4-amended caps every record at the configured age.
    expect(run1.ageCapCutoff.toISOString()).toBe(
      new Date(NOW.getTime() - AGE_CAP_DAYS * 86_400_000).toISOString(),
    );
    // The anonymous-pass survivors were 2 per table; the cap pass removed
    // exactly the 200-day authenticated row from each.
    expect(run1.ageCapped['calculation_records']).toBe(1);
    expect(run1.ageCapped['basket_calculation_records']).toBe(1);

    expect(
      count(
        `SELECT COUNT(*) AS n FROM calculation_records WHERE session_id = '${SESSION_ANCIENT}'`,
      ),
    ).toBe(0);
    expect(
      count(
        `SELECT COUNT(*) AS n FROM basket_calculation_records WHERE session_id = '${SESSION_ANCIENT}'`,
      ),
    ).toBe(0);

    // Recent rows — anonymous and authenticated — survive both passes.
    expect(await calcRepo.findBySession(SESSION_RECENT)).toHaveLength(1);
    expect(
      count(
        `SELECT COUNT(*) AS n FROM calculation_records
         WHERE session_id IS NULL AND calculated_at >= '${new Date(NOW.getTime() - RETENTION_DAYS * 86_400_000).toISOString()}'`,
      ),
    ).toBe(1);
  });

  it('deletes in bounded batches (batchSize 2) that terminate on the short batch', async () => {
    expect(run1.batchSize).toBe(2);
    // 5 expired rows per table went through batches of 2+2+1 — the exact
    // per-table totals above (1 anon + 1 capped) sum with the pruned
    // counts to the seeded expired set.

    await expect(
      retention.runRetention({ now: NOW, batchSize: 0 }),
    ).rejects.toThrow(RangeError);
  });

  it('a second sweep is idempotent — nothing new deleted', async () => {
    expect(run2.prunedAnonymous['calculation_records']).toBe(0);
    expect(run2.prunedAnonymous['basket_calculation_records']).toBe(0);
    expect(run2.ageCapped['calculation_records']).toBe(0);
    expect(run2.ageCapped['basket_calculation_records']).toBe(0);

    // Recent history is still there after the second sweep.
    expect(await calcRepo.findBySession(SESSION_RECENT)).toHaveLength(1);
  });

  it('leaves price_history_summaries — the long-term analytical record — untouched', () => {
    expect(
      count('SELECT COUNT(*) AS n FROM price_history_summaries'),
    ).toBe(1);
  });
});

// ===========================================================================
// Suite 2 — R2 observation log: partition layout, parity, watermark scan
// ===========================================================================

describe('R2 observation log — day partitions, read parity, watermark scan', () => {
  const { d1 } = openMigratedD1();
  const summaries = new D1PriceHistorySummaryRepository(d1);
  const watermarks = new D1AggregationWatermarkRepository(d1);

  // Deterministic (observedAt, id) series order — sequential ids make the
  // same-instant late append sort last, exactly like the pg serial did.
  let idSeq = 0;
  const store = new R2JsonlObservationStore(() => ++idSeq);
  const worker = new TimeSeriesAggregationWorker(store, summaries, watermarks);

  const DAY_MS = 86_400_000;
  const ANCHOR = new Date('2026-08-28T12:00:00.000Z');
  const MARKER = 'D1 Lifecycle R2 Fixture';

  let productId: number;
  let offerId: number;

  beforeAll(async () => {
    productId = await seedProductRow(d1, MARKER);
    offerId = await seedRetailOfferRow(
      d1,
      productId,
      'lifecycle-fixture-merchant',
      'https://merchant.example.com/d1-lifecycle-fixture',
    );

    // Five observations spread across ≥ 3 UTC-day partitions (the pg
    // fixture spread 25 days across 7-day hypertable chunks; the R2
    // layout partitions per DAY — finer, and lexicographic key order is
    // chronological).
    const parityRows: readonly [number, string, number][] = [
      [25, 'parity-merchant-a', 200],
      [18, 'parity-merchant-b', 210],
      [11, 'parity-merchant-a', 220],
      [4, 'parity-merchant-b', 230],
      [0, 'parity-merchant-a', 240],
    ];
    for (const [daysAgo, merchant, price] of parityRows) {
      await store.append(
        observationFixture(
          productId,
          offerId,
          merchant,
          new Date(ANCHOR.getTime() - daysAgo * DAY_MS),
          price,
        ),
      );
    }
  });

  // ------------------------------------------------------------------
  // Layout — partition scheme + round-trip parity (chunk registration)
  // ------------------------------------------------------------------

  it('partitions the log by UTC day under observations/YYYY-MM-DD.jsonl, in ascending order', () => {
    const keys = store.bucket.keys();
    expect(keys.length).toBeGreaterThanOrEqual(4); // days -25, -18, -11, -4, 0 → 5 partitions

    const days = keys.map((key) => {
      const match = /^observations\/(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(key);
      expect(match, `key ${key} must follow the partition scheme`).not.toBeNull();
      return match![1];
    });
    expect([...days].sort()).toEqual(days); // lexicographic = chronological

    // The observation instants land in the partition of THEIR OWN UTC day.
    expect(keys).toContain(observationObjectKey(ANCHOR));
    expect(keys).toContain(
      observationObjectKey(new Date(ANCHOR.getTime() - 25 * DAY_MS)),
    );
  });

  it('round-trips every appended record byte-identically through the JSONL layout', () => {
    for (const key of store.bucket.keys()) {
      for (const line of (store.bucket.body(key) as string).trimEnd().split('\n')) {
        const parsed = parseObservationLine(line);
        // Re-serializing the parsed record reproduces the stored line
        // exactly (fixed field order → byte-stable lines).
        expect(serializeObservationLine(parsed)).toBe(line);
        // And the values survive: field set matches the pg row shape.
        expect(Object.keys(parsed).sort()).toEqual(
          [
            'confidence',
            'container_duty_rule_version_id',
            'excise_rule_version_id',
            'foreign_retail_price_cents',
            'id',
            'input_reliability',
            'landed_cost_cents',
            'merchant',
            'observed_at',
            'product_id',
            'retail_offer_id',
            'transport_cost_cents',
            'transport_offer_id',
          ].sort(),
        );
      }
    }
  });

  // ------------------------------------------------------------------
  // Partition-scan semantics (chunk exclusion → day-partition range check)
  // ------------------------------------------------------------------

  it('scans only the partitions from the watermark day onward — earlier days are excluded', () => {
    const keys = store.bucket.keys();
    const midWatermark = new Date(ANCHOR.getTime() - 12 * DAY_MS); // between -18 and -11

    const scanned = observationKeysToScan(keys, midWatermark);
    const scannedDays = scanned.map(
      (key) => key.replace('observations/', '').replace('.jsonl', ''),
    );
    // The watermark's own day is INCLUDED from its start (inclusive lower
    // bound, per-line filter downstream) — the -18 and -25 partitions are
    // excluded without being opened.
    expect(scannedDays).not.toContain(
      new Date(ANCHOR.getTime() - 18 * DAY_MS).toISOString().slice(0, 10),
    );
    expect(scannedDays).not.toContain(
      new Date(ANCHOR.getTime() - 25 * DAY_MS).toISOString().slice(0, 10),
    );
    for (const day of scannedDays) {
      expect(day >= midWatermark.toISOString().slice(0, 10)).toBe(true);
    }

    // A null watermark (first run) scans every partition.
    expect(observationKeysToScan(keys, null)).toEqual([...keys].sort());
  });

  // ------------------------------------------------------------------
  // Read parity — R2-backed store vs independent parse of the same log
  // ------------------------------------------------------------------

  it('returns watermark-shaped activity scans identical to an independent parse of the log', async () => {
    const since = new Date(ANCHOR.getTime() - 30 * DAY_MS);
    const fromLog = await store.findProductActivitySince(since);
    expect(fromLog).toHaveLength(1);

    // Independent reader: raw JSONL → raw JS aggregation.
    const records = store
      .allRecords()
      .filter((r) => new Date(r.observed_at).getTime() >= since.getTime());
    const expected = {
      productId,
      first: new Date(Math.min(...records.map((r) => new Date(r.observed_at).getTime()))),
      last: new Date(Math.max(...records.map((r) => new Date(r.observed_at).getTime()))),
    };
    expect(fromLog[0].productId).toBe(expected.productId);
    expect(fromLog[0].firstObservedAt.getTime()).toBe(expected.first.getTime());
    expect(fromLog[0].lastObservedAt.getTime()).toBe(expected.last.getTime());
  });

  it('returns range reads and the earliest observation identical to an independent parse of the log', async () => {
    const from = new Date(ANCHOR.getTime() - 30 * DAY_MS);
    const to = new Date(ANCHOR.getTime() + DAY_MS);

    const repoRows = await store.findByProductRange(productId, from, to);
    const rawRows = store
      .allRecords()
      .map((r) => ({
        id: r.id,
        merchant: r.merchant,
        observedAt: new Date(r.observed_at),
        price: r.foreign_retail_price_cents,
        landed: r.landed_cost_cents,
      }))
      .filter(
        (r) =>
          r.observedAt.getTime() >= from.getTime() &&
          r.observedAt.getTime() < to.getTime(),
      )
      .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime() || a.id - b.id);

    expect(repoRows.map((r) => [r.id, r.merchant, r.observedAt.toISOString(), r.foreignRetailPriceCents, r.landedCostCents]))
      .toEqual(rawRows.map((r) => [r.id, r.merchant, r.observedAt.toISOString(), r.price, r.landed]));

    // Merchant-filtered range read narrows to that merchant's rows only.
    const merchantRows = await store.findByProductRange(productId, from, to, 'parity-merchant-a');
    expect(merchantRows.every((r) => r.merchant === 'parity-merchant-a')).toBe(true);
    expect(merchantRows).toHaveLength(3);

    // Earliest-observation read — the API's attribution lower bound.
    const earliest = await store.findEarliestObservedAt(productId);
    expect(earliest!.getTime()).toBe(
      new Date(ANCHOR.getTime() - 25 * DAY_MS).getTime(),
    );
  });

  // ------------------------------------------------------------------
  // Watermark scan — real worker over the R2 store + D1 repositories
  // ------------------------------------------------------------------

  it('advances the watermark from null to the log high-water mark and materializes every daily bucket', async () => {
    expect(await watermarks.find(QUEUES.TIME_SERIES_AGGREGATION)).toBeNull();

    await worker.process(makeJob({}));

    const highWater = new Date(
      Math.max(...store.allRecords().map((r) => new Date(r.observed_at).getTime())),
    );
    const persisted = await watermarks.find(QUEUES.TIME_SERIES_AGGREGATION);
    expect(persisted!.getTime()).toBe(highWater.getTime());

    // Every fixture day has exactly one product-wide daily bucket with
    // one observation.
    const days = [
      ...new Set(
        store.allRecords().map((r) => r.observed_at.slice(0, 10)),
      ),
    ].sort();
    expect(days).toHaveLength(5);
    for (const day of days) {
      const rows = await summaries.findByProductRange(productId, 'daily', day, day);
      expect(rows, `daily bucket ${day}`).toHaveLength(1);
      expect(rows[0].observationCount).toBe(1);
    }
  });

  it('advances the watermark further as newer observations are appended', async () => {
    const before = (await watermarks.find(QUEUES.TIME_SERIES_AGGREGATION))!;

    const appended = await store.append(
      observationFixture(
        productId,
        offerId,
        'watermark-merchant',
        new Date(ANCHOR.getTime() + 30 * 60_000),
        250,
      ),
    );
    expect(appended.id).toBeGreaterThan(0);

    await worker.process(makeJob({}));

    const after = (await watermarks.find(QUEUES.TIME_SERIES_AGGREGATION))!;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
    expect(after.getTime()).toBe(
      Math.max(...store.allRecords().map((r) => new Date(r.observed_at).getTime())),
    );
  });

  it('picks up a same-instant late append via the inclusive boundary re-scan without regressing the watermark', async () => {
    const before = (await watermarks.find(QUEUES.TIME_SERIES_AGGREGATION))!;

    // Append at EXACTLY the watermark instant — strictly-bounded scans
    // would permanently miss it; the inclusive >= re-scan must not.
    await store.append(
      observationFixture(productId, offerId, 'watermark-merchant', before, 260),
    );

    await worker.process(makeJob({}));

    // Watermark neither regressed nor advanced past the instant.
    const after = (await watermarks.find(QUEUES.TIME_SERIES_AGGREGATION))!;
    expect(after.getTime()).toBe(before.getTime());

    // The bucket containing the instant absorbed the late row: the
    // product-wide daily summary reflects BOTH observations now, and the
    // late append (higher id) sets the close price.
    const day = startOfUtcDay(before);
    const dayStr = day.toISOString().slice(0, 10);
    const rows = await summaries.findByProductRange(productId, 'daily', dayStr, dayStr);
    const logCount = store
      .allRecords()
      .filter((r) => r.observed_at.slice(0, 10) === dayStr)
      .length;
    expect(rows).toHaveLength(1);
    expect(rows[0].observationCount).toBe(logCount);
    expect(rows[0].priceCloseCents).toBe(260);
  });

  it('leaves the watermark unchanged when a run finds no new observations', async () => {
    const before = (await watermarks.find(QUEUES.TIME_SERIES_AGGREGATION))!;
    await worker.process(makeJob({}));
    const after = (await watermarks.find(QUEUES.TIME_SERIES_AGGREGATION))!;
    expect(after.getTime()).toBe(before.getTime());
  });

  it('materialized summaries equal independent recomputation from the R2 log (summary-query equivalence)', async () => {
    // Independent expectation: bucket the log rows for one fixture day
    // with the pure 2.3 aggregation and compare every computed column
    // against what the worker materialized into D1.
    const day = new Date(ANCHOR.getTime() - 25 * DAY_MS);
    const dayStr = day.toISOString().slice(0, 10);
    const dayRecords = store.recordsIn(observationObjectKey(day));
    expect(dayRecords.length).toBe(1);

    const expected = buildBucketSummaries('daily', startOfUtcDay(day), dayRecords).find(
      (s) => s.merchant === null,
    )!;
    const rows = await summaries.findByProductRange(productId, 'daily', dayStr, dayStr);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      granularity: 'daily',
      periodStart: dayStr,
      productId,
      merchant: null,
      priceOpenCents: expected.priceOpenCents,
      priceCloseCents: expected.priceCloseCents,
      priceMinCents: expected.priceMinCents,
      priceMaxCents: expected.priceMaxCents,
      priceAvgCents: expected.priceAvgCents,
      landedCostOpenCents: expected.landedCostOpenCents,
      landedCostCloseCents: expected.landedCostCloseCents,
      landedCostMinCents: expected.landedCostMinCents,
      landedCostMaxCents: expected.landedCostMaxCents,
      landedCostAvgCents: expected.landedCostAvgCents,
      observationCount: expected.observationCount,
      strictestReliability: expected.strictestReliability,
    });
  });
});
