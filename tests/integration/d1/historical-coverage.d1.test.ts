/**
 * Integration test — coverage invariant of the time-series aggregation
 * on the node:sqlite D1 harness (task 1.4, change
 * watermark-isolation-history-backfill).
 *
 * Pins the historical-price-intelligence scenario "Coverage invariant
 * holds after a pass": WHEN the aggregation processes a range containing
 * observations for a product, THEN that product has at least one summary
 * bucket covering those observations, and a coverage check (products
 * with observations but zero summary rows) answers zero.
 *
 * The pass under test is the REAL TimeSeriesAggregationWorker over the
 * proven composition (mirrors historical-price-flow.d1.test.ts): the
 * REAL R2JsonlObservationStore for the observation log, the real
 * D1PriceHistorySummaryRepository and D1AggregationWatermarkRepository
 * over migrated SQLite. No mocks of the engines under test.
 *
 * The processed range is made real by seeding the aggregation watermark
 * through the real repository: a prior (simulated) pass consumed
 * everything up to the watermark instant, so the ONE pass below is a
 * genuine watermark-driven incremental scan [W, ∞) — which lets the
 * fixture carry a product whose observations lie strictly outside the
 * processed range. That product must stay unsummarized without turning
 * the coverage check non-zero: the check is scoped to the processed
 * range, exactly as the scenario states. (The documented backfill
 * procedure that would close such gaps is task 1.3's script — this test
 * deliberately pins the invariant on the job itself, independent of
 * that script.)
 *
 * @module HistoricalCoverageD1IntegrationTest
 */

import { describe, it, expect } from 'vitest';
import type { Job } from 'bullmq';

import { QUEUES } from '@rajahinta/data-acquisition';

// --- D1/R2 harness: migrated D1 + R2 JSONL observation store ---
import {
  openMigratedD1,
  R2JsonlObservationStore,
  observationFixture,
  seedProductRow,
} from './harness';
import { D1AggregationWatermarkRepository } from '../../../packages/data-platform/src/repositories/d1/aggregation-watermark.repository';
import { D1PriceHistorySummaryRepository } from '../../../packages/data-platform/src/repositories/d1/price-history-summary.repository';
// Worker class is not re-exported from the package index — deep import.
import {
  TimeSeriesAggregationWorker,
  type TimeSeriesAggregationJobData,
} from '../../../packages/application-api/src/jobs/workers/time-series-aggregation.worker';

// ---------------------------------------------------------------------------
// Range fixtures — the seeded watermark carves the processed range
// ---------------------------------------------------------------------------

/**
 * Watermark left by the simulated prior pass: everything strictly before
 * this instant is already consumed. The pass under test scans [W, ∞)
 * (findProductActivitySince lower bound is inclusive, so out-of-range
 * observations must lie strictly below it to stay out).
 */
const WATERMARK_INSTANT = new Date('2026-02-01T00:00:00Z');

/** Far-future horizon for half-open [from, to) reads over the whole log. */
const RANGE_END = new Date('2999-12-31T00:00:00Z');

function makeJob(
  data: TimeSeriesAggregationJobData,
): Job<TimeSeriesAggregationJobData> {
  return { data, attemptsMade: 0 } as unknown as Job<TimeSeriesAggregationJobData>;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Historical aggregation coverage invariant on D1/R2 — one pass ⇒ every in-range product summarized', () => {
  // Real SQLite D1 with committed migrations.
  const { db, d1 } = openMigratedD1();

  // The single graph the worker reads/writes — same wiring as the flow
  // suite: R2 JSONL observations, D1 summaries, D1 watermark.
  let idSeq = 0;
  const observations = new R2JsonlObservationStore(() => ++idSeq);
  const summaries = new D1PriceHistorySummaryRepository(d1);
  const watermarks = new D1AggregationWatermarkRepository(d1);
  const worker = new TimeSeriesAggregationWorker(observations, summaries, watermarks);

  /** In-range half-open read [W, RANGE_END) — the processed range itself. */
  const observationsInRange = (productId: number) =>
    observations.findByProductRange(productId, WATERMARK_INSTANT, RANGE_END);

  /** Whole-log read from the epoch — independent of the processed range. */
  const observationsEver = (productId: number) =>
    observations.findByProductRange(productId, new Date(0), RANGE_END);

  // --- direct SQL over the harness SQLite instance (the D1 half) ---

  /** Product ids with at least one materialized summary bucket. */
  const summarizedProductIds = (): Set<number> =>
    new Set(
      (
        db
          .prepare(
            'SELECT DISTINCT product_id FROM price_history_summaries',
          )
          .all() as unknown as { product_id: number }[]
      ).map((r) => Number(r.product_id)),
    );

  /** Total summary rows for one product, any granularity/merchant. */
  const summaryRowCount = (productId: number): number => {
    const row = db
      .prepare(
        'SELECT COUNT(*) AS n FROM price_history_summaries WHERE product_id = ?',
      )
      .get(productId) as unknown as { n: number | bigint };
    return Number(row.n);
  };

  /**
   * Observations of one product covered by daily product-wide buckets
   * (merchant IS NULL) anchored from `fromDay` on. Daily buckets
   * partition the timeline, so this sum counts every summarized
   * in-range observation exactly once.
   */
  const dailyCoveredObservations = (productId: number, fromDay: string): number => {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(observation_count), 0) AS covered
           FROM price_history_summaries
          WHERE product_id = ? AND granularity = 'daily'
            AND merchant IS NULL AND period_start >= ?`,
      )
      .get(productId, fromDay) as unknown as { covered: number | bigint };
    return Number(row.covered);
  };

  it('one watermark-driven pass: every product with in-range observations gets ≥1 summary bucket, coverage check answers 0', async () => {
    // -- Fixtures: three product shapes ----------------------------------
    const inRangeId = await seedProductRow(d1, 'Coverage Lager In Range 5%');
    const outOfRangeId = await seedProductRow(
      d1,
      'Coverage Lager Out Of Range 5%',
    );
    const neverObservedId = await seedProductRow(
      d1,
      'Coverage Lager Never Observed 5%',
    );

    // In-range product: two observations inside the processed range,
    // on different days (distinct daily buckets), same merchant.
    await observations.append(
      observationFixture(
        inRangeId,
        310,
        'coverage-merchant',
        new Date('2026-02-03T10:00:00Z'),
        210,
      ),
    );
    await observations.append(
      observationFixture(
        inRangeId,
        311,
        'coverage-merchant',
        new Date('2026-02-05T12:00:00Z'),
        250,
      ),
    );
    // Out-of-range product: observed, but strictly before the watermark —
    // the prior (simulated) pass consumed its history.
    await observations.append(
      observationFixture(
        outOfRangeId,
        312,
        'coverage-merchant',
        new Date('2026-01-15T09:00:00Z'),
        180,
      ),
    );
    // neverObservedId: no observations at all.

    // The prior pass's watermark — defines the processed range [W, ∞).
    await watermarks.save(QUEUES.TIME_SERIES_AGGREGATION, WATERMARK_INSTANT);

    // -- THE one aggregation pass under test -----------------------------
    await worker.process(makeJob({}));

    // The pass completed: write-then-advance persisted the watermark at
    // the last in-range observation — it moves only after ALL summary
    // writes succeeded, the precondition the invariant is stated on.
    expect(await watermarks.find(QUEUES.TIME_SERIES_AGGREGATION)).toEqual(
      new Date('2026-02-05T12:00:00Z'),
    );

    // -- (a) The invariant, literally: ≥1 summary bucket per in-range
    //        product -----------------------------------------------------
    expect(summaryRowCount(inRangeId)).toBeGreaterThanOrEqual(1);

    // Stronger: the daily product-wide buckets PARTITION the processed
    // range, so their observation_count sums to exactly the number of
    // in-range observations — nothing dropped, nothing double-counted.
    expect(await observationsInRange(inRangeId)).toHaveLength(2);
    expect(dailyCoveredObservations(inRangeId, '2026-02-01')).toBe(2);

    // Buckets anchor on each observed UTC day (2026-02-03 is a Tuesday,
    // 2026-02-05 a Thursday — one ISO week, Monday 2026-02-02).
    const daily = await summaries.findByProductRange(
      inRangeId,
      'daily',
      '2026-02-01',
      '2026-02-28',
    );
    expect(daily.map((r) => r.periodStart)).toEqual([
      '2026-02-03',
      '2026-02-05',
    ]);

    // A single weekly bucket covers both observations with their values.
    const weekly = await summaries.findByProductRange(
      inRangeId,
      'weekly',
      '2026-02-01',
      '2026-02-28',
    );
    expect(weekly).toHaveLength(1);
    expect(weekly[0]).toMatchObject({
      periodStart: '2026-02-02',
      observationCount: 2,
      priceOpenCents: 210,
      priceCloseCents: 250,
      priceMinCents: 210,
      priceMaxCents: 250,
      priceAvgCents: 230,
    });

    // -- (b) The coverage check: products with observations in the
    //        processed range but zero summary rows answers 0 -------------
    const fixtureProductIds = [inRangeId, outOfRangeId, neverObservedId];
    const summarized = summarizedProductIds();
    const inRangeCounts = new Map<number, number>();
    const everCounts = new Map<number, number>();
    for (const id of fixtureProductIds) {
      inRangeCounts.set(id, (await observationsInRange(id)).length);
      everCounts.set(id, (await observationsEver(id)).length);
    }
    const coverageGaps = fixtureProductIds.filter(
      (id) => inRangeCounts.get(id)! > 0 && !summarized.has(id),
    );
    expect(coverageGaps).toEqual([]);

    // -- Range scoping discriminators -------------------------------------
    // The out-of-range product genuinely has observations — but all of
    // them lie outside the processed range, so the pass correctly leaves
    // it without summary rows, and the range-scoped check must not count
    // it as a gap.
    expect(inRangeCounts.get(outOfRangeId)).toBe(0);
    expect(everCounts.get(outOfRangeId)!).toBeGreaterThan(0);
    expect(summaryRowCount(outOfRangeId)).toBe(0);

    // Fixture sanity: an UNSCOPED check (whole log) would flag exactly
    // this product — proving the zero above is meaningful because the
    // check reads the processed range, not because everything is
    // summarized.
    const unscopedGaps = fixtureProductIds.filter(
      (id) => everCounts.get(id)! > 0 && !summarized.has(id),
    );
    expect(unscopedGaps).toEqual([outOfRangeId]);

    // Empty case: the never-observed product has no rows and no gap —
    // excluded by the has-observations predicate, not by luck.
    expect(inRangeCounts.get(neverObservedId)).toBe(0);
    expect(summaryRowCount(neverObservedId)).toBe(0);
  });
});
