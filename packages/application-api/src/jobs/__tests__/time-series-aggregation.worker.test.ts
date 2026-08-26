/**
 * TimeSeriesAggregationWorker tests.
 *
 * Package test convention: no DB, no vi.fn() mocks — plain in-memory
 * implementations of the repository abstracts plus a minimal fake Job.
 *
 * Covers the three task-3.1 guarantees: UTC-day / ISO-week bucketing
 * (per-merchant + product-wide rows, open/close/min/max/avg, half-up
 * avg, strictest reliability), idempotent upsert under re-runs, and the
 * write-then-advance watermark protocol (advance only after all writes
 * succeed; never regress; bucketStart/windowMinutes payload handling).
 *
 * @module TimeSeriesAggregationWorkerTest
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { ReliabilityStatus } from '@rajahinta/core-domain';
import {
  PriceObservationRepository,
  PriceHistorySummaryRepository,
  AggregationWatermarkRepository,
  type PriceObservationRecord,
  type PriceHistorySummaryRecord,
  type PriceHistorySummaryUpsertInput,
  type ProductActivitySince,
} from '@rajahinta/data-platform';
import {
  TimeSeriesAggregationWorker,
  type TimeSeriesAggregationJobData,
  startOfUtcDay,
  startOfIsoWeek,
  averageCentsHalfUp,
  strictestReliability,
  buildBucketSummaries,
} from '../workers/time-series-aggregation.worker';

// ---------------------------------------------------------------------------
// In-memory repository fakes (plain classes per repo testing principle)
// ---------------------------------------------------------------------------

class InMemoryObservations extends PriceObservationRepository {
  readonly rows: PriceObservationRecord[] = [];

  async append(): Promise<{ id: number }> {
    throw new Error('append is not used by the aggregation worker');
  }

  async findByProductRange(
    productId: number,
    from: Date,
    to: Date,
    merchant?: string | null,
  ): Promise<PriceObservationRecord[]> {
    return this.rows
      .filter(
        (row) =>
          row.productId === productId &&
          row.observedAt.getTime() >= from.getTime() &&
          row.observedAt.getTime() < to.getTime() &&
          (merchant == null || row.merchant === merchant),
      )
      .sort(
        (a, b) =>
          a.observedAt.getTime() - b.observedAt.getTime() || a.id - b.id,
      );
  }

  async findByMerchantOfferRange(): Promise<PriceObservationRecord[]> {
    return [];
  }

  async findByMerchantProductRange(): Promise<PriceObservationRecord[]> {
    return [];
  }

  async findEarliestObservedAt(): Promise<Date | null> {
    return null;
  }

  async findProductActivitySince(since: Date): Promise<ProductActivitySince[]> {
    const inRange = this.rows.filter(
      (row) => row.observedAt.getTime() >= since.getTime(),
    );
    const byProduct = new Map<number, PriceObservationRecord[]>();
    for (const row of inRange) {
      const group = byProduct.get(row.productId);
      if (group) group.push(row);
      else byProduct.set(row.productId, [row]);
    }
    return [...byProduct.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([productId, group]) => ({
        productId,
        firstObservedAt: new Date(
          Math.min(...group.map((row) => row.observedAt.getTime())),
        ),
        lastObservedAt: new Date(
          Math.max(...group.map((row) => row.observedAt.getTime())),
        ),
      }));
  }
}

interface StoredBucket extends PriceHistorySummaryUpsertInput {
  id: number;
}

class InMemorySummaries extends PriceHistorySummaryRepository {
  readonly buckets = new Map<string, StoredBucket>();
  /** Cumulative upsert key log — tests slice between runs. */
  readonly upsertLog: string[] = [];
  /** 1-based upsert ordinal that throws (simulated write failure). */
  failOnUpsert: number | null = null;

  private key(summary: PriceHistorySummaryUpsertInput): string {
    return [
      summary.granularity,
      summary.periodStart,
      summary.productId,
      summary.merchant ?? '*',
    ].join('|');
  }

  async upsertBucket(summary: PriceHistorySummaryUpsertInput): Promise<{ id: number }> {
    if (this.failOnUpsert === this.upsertLog.length + 1) {
      throw new Error('simulated summary write failure');
    }
    const key = this.key(summary);
    this.upsertLog.push(key);
    const existing = this.buckets.get(key);
    const id = existing?.id ?? this.buckets.size + 1;
    // Overwrite semantics: key columns immutable, aggregate columns replaced.
    this.buckets.set(key, { ...summary, id });
    return { id };
  }

  async findByProductRange(): Promise<PriceHistorySummaryRecord[]> {
    // Stored rows are complete (id + merchant always set by upsertBucket);
    // the cast only reconciles the insert-type's optional merchant with
    // the select shape. Never called by the worker under test.
    return [...this.buckets.values()] as unknown as PriceHistorySummaryRecord[];
  }
}

class InMemoryWatermarks extends AggregationWatermarkRepository {
  readonly store = new Map<string, Date>();

  async find(jobName: string): Promise<Date | null> {
    return this.store.get(jobName) ?? null;
  }

  async save(jobName: string, watermark: Date): Promise<void> {
    this.store.set(jobName, watermark);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let nextRowId = 1;

function observation(
  overrides: Partial<PriceObservationRecord> &
    Pick<
      PriceObservationRecord,
      'productId' | 'merchant' | 'observedAt' | 'foreignRetailPriceCents' | 'landedCostCents'
    >,
): PriceObservationRecord {
  const id = nextRowId++;
  return {
    id,
    retailOfferId: 1000 + id,
    transportCostCents: 0,
    transportOfferId: null,
    exciseRuleVersionId: null,
    containerDutyRuleVersionId: null,
    inputReliability: { price: 'VERIFIED', transport: 'VERIFIED' },
    confidence: 'HIGH',
    ...overrides,
  };
}

/** ISO instants inside the ISO week anchored on Monday 2026-08-24. */
const T = {
  mon10: new Date('2026-08-24T10:00:00Z'),
  mon22: new Date('2026-08-24T22:00:00Z'),
  tue12: new Date('2026-08-25T12:00:00Z'),
  wed10: new Date('2026-08-26T10:00:00Z'),
  thu08: new Date('2026-08-27T08:00:00Z'),
};

/** Baseline observation log: two products, three merchants total. */
function baselineObservations(): PriceObservationRecord[] {
  return [
    observation({
      productId: 1,
      merchant: 'systembolaget',
      observedAt: T.mon10,
      foreignRetailPriceCents: 1000,
      landedCostCents: 1500,
    }),
    observation({
      productId: 1,
      merchant: 'systembolaget',
      observedAt: T.mon22,
      foreignRetailPriceCents: 1010,
      landedCostCents: 1510,
      inputReliability: { price: 'ESTIMATED', transport: 'VERIFIED' },
    }),
    observation({
      productId: 1,
      merchant: 'alko',
      observedAt: T.wed10,
      foreignRetailPriceCents: 2000,
      landedCostCents: 2500,
      inputReliability: { price: 'VERIFIED', transport: 'STALE' },
    }),
    observation({
      productId: 2,
      merchant: 'systembolaget',
      observedAt: T.tue12,
      foreignRetailPriceCents: 500,
      landedCostCents: 700,
    }),
  ];
}

function makeJob(data: TimeSeriesAggregationJobData): Job<TimeSeriesAggregationJobData> {
  return { data, attemptsMade: 0 } as unknown as Job<TimeSeriesAggregationJobData>;
}

function keyOf(
  granularity: string,
  periodStart: string,
  productId: number,
  merchant: string | null,
): string {
  return [granularity, periodStart, productId, merchant ?? '*'].join('|');
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

describe('TimeSeriesAggregationWorker', () => {
  let observations: InMemoryObservations;
  let summaries: InMemorySummaries;
  let watermarks: InMemoryWatermarks;
  let worker: TimeSeriesAggregationWorker;

  beforeEach(() => {
    observations = new InMemoryObservations();
    summaries = new InMemorySummaries();
    watermarks = new InMemoryWatermarks();
    worker = new TimeSeriesAggregationWorker(observations, summaries, watermarks);
    observations.rows.push(...baselineObservations());
  });

  // -----------------------------------------------------------------
  // Pure helpers
  // -----------------------------------------------------------------

  describe('bucket anchors', () => {
    it('anchors daily buckets at UTC midnight', () => {
      expect(startOfUtcDay(new Date('2026-08-26T23:59:59Z')).toISOString()).toBe(
        '2026-08-26T00:00:00.000Z',
      );
    });

    it('anchors weekly buckets on the ISO Monday', () => {
      // Sunday 2026-08-23 belongs to the week of Monday 2026-08-17.
      expect(startOfIsoWeek(new Date('2026-08-23T15:00:00Z')).toISOString()).toBe(
        '2026-08-17T00:00:00.000Z',
      );
      // Monday anchors to itself; Saturday rolls back five days.
      expect(startOfIsoWeek(new Date('2026-08-24T01:00:00Z')).toISOString()).toBe(
        '2026-08-24T00:00:00.000Z',
      );
      expect(startOfIsoWeek(new Date('2026-08-29T12:00:00Z')).toISOString()).toBe(
        '2026-08-24T00:00:00.000Z',
      );
    });

    it('rounds averages half-up in exact integer arithmetic', () => {
      expect(averageCentsHalfUp(5, 2)).toBe(3); // 2.5 → 3
      expect(averageCentsHalfUp(7, 2)).toBe(4); // 3.5 → 4
      expect(averageCentsHalfUp(7, 3)).toBe(2); // 2.33 → 2
      expect(averageCentsHalfUp(3001, 3)).toBe(1000); // 1000.33 → 1000
      expect(averageCentsHalfUp(0, 1)).toBe(0);
      expect(averageCentsHalfUp(1000 + 1001, 2)).toBe(1001); // 1000.5 → 1001
    });

    it('orders reliability by the canonical severity', () => {
      expect(strictestReliability(['VERIFIED', 'ESTIMATED'])).toBe('ESTIMATED');
      expect(strictestReliability(['VERIFIED', 'STALE', 'ESTIMATED'])).toBe('STALE');
      expect(strictestReliability(['STALE', 'UNAVAILABLE'])).toBe('UNAVAILABLE');
      expect(strictestReliability(['VERIFIED'])).toBe('VERIFIED');
    });
  });

  describe('buildBucketSummaries', () => {
    it('emits one row per merchant plus a product-wide row', () => {
      const rows = [
        observation({
          productId: 1,
          merchant: 'a',
          observedAt: T.mon10,
          foreignRetailPriceCents: 100,
          landedCostCents: 200,
        }),
        observation({
          productId: 1,
          merchant: 'b',
          observedAt: T.mon22,
          foreignRetailPriceCents: 300,
          landedCostCents: 400,
        }),
      ];
      const summariesForBucket = buildBucketSummaries('daily', startOfUtcDay(T.mon10), rows);

      expect(summariesForBucket.map((s) => s.merchant).sort()).toEqual(['a', 'b', null]);
      const productWide = summariesForBucket.find((s) => s.merchant === null)!;
      expect(productWide.observationCount).toBe(2);
      expect(productWide.priceOpenCents).toBe(100);
      expect(productWide.priceCloseCents).toBe(300);
      expect(productWide.priceMinCents).toBe(100);
      expect(productWide.priceMaxCents).toBe(300);
    });

    it('takes open/close from the series order and rounds avg half-up', () => {
      const rows = [
        observation({
          productId: 1,
          merchant: 'a',
          observedAt: T.mon10,
          foreignRetailPriceCents: 1000,
          landedCostCents: 1500,
        }),
        observation({
          productId: 1,
          merchant: 'a',
          observedAt: T.mon22,
          foreignRetailPriceCents: 1001,
          landedCostCents: 1501,
        }),
      ];
      const [row] = buildBucketSummaries('daily', startOfUtcDay(T.mon10), rows);
      expect(row.priceAvgCents).toBe(1001); // 1000.5 rounds up
      expect(row.landedCostAvgCents).toBe(1501);
      expect(row.priceOpenCents).toBe(1000);
      expect(row.priceCloseCents).toBe(1001);
    });

    it('composes strictest reliability per observation and per bucket', () => {
      const rows = [
        observation({
          productId: 1,
          merchant: 'a',
          observedAt: T.mon10,
          foreignRetailPriceCents: 100,
          landedCostCents: 200,
          // Per-input strictest: STALE beats VERIFIED.
          inputReliability: { price: 'VERIFIED', transport: 'STALE' },
        }),
        observation({
          productId: 1,
          merchant: 'a',
          observedAt: T.mon22,
          foreignRetailPriceCents: 100,
          landedCostCents: 200,
          inputReliability: { price: 'VERIFIED', transport: 'VERIFIED' },
        }),
      ];
      const [row] = buildBucketSummaries('daily', startOfUtcDay(T.mon10), rows);
      expect(row.strictestReliability).toBe('STALE');
    });

    it('degrades unknown reliability snapshots to UNAVAILABLE, never upgrades', () => {
      const rows = [
        observation({
          productId: 1,
          merchant: 'a',
          observedAt: T.mon10,
          foreignRetailPriceCents: 100,
          landedCostCents: 200,
          inputReliability: { price: 'VERIFIED' },
        }),
        observation({
          productId: 1,
          merchant: 'a',
          observedAt: T.mon22,
          foreignRetailPriceCents: 100,
          landedCostCents: 200,
          inputReliability: { price: 'garbage-status' },
        }),
      ];
      const [row] = buildBucketSummaries('daily', startOfUtcDay(T.mon10), rows);
      expect(row.strictestReliability).toBe('UNAVAILABLE');
    });
  });

  // -----------------------------------------------------------------
  // First run — full materialization from the epoch
  // -----------------------------------------------------------------

  it('materializes daily and weekly buckets for every product and merchant on first run', async () => {
    await worker.process(makeJob({}));

    const keys = [...summaries.buckets.keys()].sort();
    expect(keys).toEqual(
      [
        // Product 1 daily: Mon 24th (systembolaget ×2 + wide), Wed 26th (alko + wide)
        keyOf('daily', '2026-08-24', 1, 'systembolaget'),
        keyOf('daily', '2026-08-24', 1, null),
        keyOf('daily', '2026-08-26', 1, 'alko'),
        keyOf('daily', '2026-08-26', 1, null),
        // Product 2 daily: Tue 25th
        keyOf('daily', '2026-08-25', 2, 'systembolaget'),
        keyOf('daily', '2026-08-25', 2, null),
        // Weekly: ISO week Monday 2026-08-24 spans Mon..Wed observations
        keyOf('weekly', '2026-08-24', 1, 'systembolaget'),
        keyOf('weekly', '2026-08-24', 1, 'alko'),
        keyOf('weekly', '2026-08-24', 1, null),
        keyOf('weekly', '2026-08-24', 2, 'systembolaget'),
        keyOf('weekly', '2026-08-24', 2, null),
      ].sort(),
    );

    const monday = summaries.buckets.get(keyOf('daily', '2026-08-24', 1, 'systembolaget'))!;
    expect(monday.observationCount).toBe(2);
    expect(monday.priceOpenCents).toBe(1000);
    expect(monday.priceCloseCents).toBe(1010);
    expect(monday.priceAvgCents).toBe(1005);
    expect(monday.strictestReliability).toBe('ESTIMATED');

    const week = summaries.buckets.get(keyOf('weekly', '2026-08-24', 1, null))!;
    expect(week.observationCount).toBe(3);
    expect(week.priceOpenCents).toBe(1000);
    expect(week.priceCloseCents).toBe(2000);
    // (1000 + 1010 + 2000) / 3 = 1336.67 → 1337 (half-up)
    expect(week.priceAvgCents).toBe(1337);
    expect(week.landedCostAvgCents).toBe(1837);
    expect(week.strictestReliability).toBe('STALE');

    // Watermark advances to the latest scanned observation.
    expect(watermarks.store.get('time-series-aggregation')?.getTime()).toBe(
      T.wed10.getTime(),
    );
  });

  it('writes nothing and leaves the watermark unset when the log is empty', async () => {
    observations.rows.length = 0;
    await worker.process(makeJob({}));
    expect(summaries.buckets.size).toBe(0);
    expect(watermarks.store.size).toBe(0);
  });

  // -----------------------------------------------------------------
  // Idempotency — re-runs converge
  // -----------------------------------------------------------------

  it('is idempotent when the same run executes twice', async () => {
    await worker.process(makeJob({}));
    const snapshot: Array<[string, StoredBucket]> = [...summaries.buckets.entries()].map(
      ([key, value]) => [key, { ...value }],
    );

    await worker.process(makeJob({}));

    // Same bucket set, same values (boundary-instant re-scan overwrites
    // in place), no duplicate rows.
    expect(summaries.buckets.size).toBe(snapshot.length);
    for (const [key, value] of snapshot) {
      expect(summaries.buckets.get(key)).toEqual(value);
    }
    // Watermark is not re-saved / moved by a no-progress scan.
    expect(watermarks.store.get('time-series-aggregation')?.getTime()).toBe(
      T.wed10.getTime(),
    );
  });

  // -----------------------------------------------------------------
  // Incremental — only affected buckets are re-aggregated
  // -----------------------------------------------------------------

  it('re-aggregates only buckets overlapped by new observations', async () => {
    await worker.process(makeJob({}));
    const upsertsAfterFirstRun = summaries.upsertLog.length;

    observations.rows.push(
      observation({
        productId: 1,
        merchant: 'alko',
        observedAt: T.thu08,
        foreignRetailPriceCents: 2010,
        landedCostCents: 2510,
        inputReliability: { price: 'ESTIMATED', transport: 'VERIFIED' },
      }),
    );
    await worker.process(makeJob({}));

    const secondRunKeys = summaries.upsertLog.slice(upsertsAfterFirstRun);
    // Boundary instant (Wed 10:00) is re-scanned inclusively: Wed daily,
    // Thu daily, and the ISO week — never Mon's daily bucket, nor
    // product 2 (no observations in range).
    expect(secondRunKeys).toEqual([
      keyOf('daily', '2026-08-26', 1, 'alko'),
      keyOf('daily', '2026-08-26', 1, null),
      keyOf('daily', '2026-08-27', 1, 'alko'),
      keyOf('daily', '2026-08-27', 1, null),
      keyOf('weekly', '2026-08-24', 1, 'systembolaget'),
      keyOf('weekly', '2026-08-24', 1, 'alko'),
      keyOf('weekly', '2026-08-24', 1, null),
    ]);

    // Partial-period rows stayed correct: the weekly product-wide bucket
    // now aggregates four observations (1000+1010+2000+2010)/4 = 1505.
    const week = summaries.buckets.get(keyOf('weekly', '2026-08-24', 1, null))!;
    expect(week.observationCount).toBe(4);
    expect(week.priceAvgCents).toBe(1505);

    expect(watermarks.store.get('time-series-aggregation')?.getTime()).toBe(
      T.thu08.getTime(),
    );
  });

  // -----------------------------------------------------------------
  // Watermark protocol — advances only after successful writes
  // -----------------------------------------------------------------

  it('leaves the watermark untouched when a summary write fails mid-scan, then converges on retry', async () => {
    summaries.failOnUpsert = 2; // second upsert of the scan throws

    await expect(worker.process(makeJob({}))).rejects.toThrow(
      'simulated summary write failure',
    );

    // Failure ⇒ no watermark ⇒ the retry re-scans the same range.
    expect(watermarks.store.size).toBe(0);
    // Partial writes from the failed attempt are harmless leftovers.
    expect(summaries.buckets.size).toBe(1);

    summaries.failOnUpsert = null;
    await worker.process(makeJob({}));

    // Re-scan converged to the full, correct materialization.
    expect(summaries.buckets.size).toBe(11);
    const week = summaries.buckets.get(keyOf('weekly', '2026-08-24', 1, null))!;
    expect(week.observationCount).toBe(3);
    expect(week.priceAvgCents).toBe(1337);
    expect(watermarks.store.get('time-series-aggregation')?.getTime()).toBe(
      T.wed10.getTime(),
    );
  });

  // -----------------------------------------------------------------
  // Payload handling — bucketStart/windowMinutes
  // -----------------------------------------------------------------

  it('re-scans from an explicit bucketStart below the watermark without regressing it', async () => {
    await worker.process(makeJob({}));
    const upsertsAfterFirstRun = summaries.upsertLog.length;

    await worker.process(
      makeJob({ bucketStart: '2026-08-20T00:00:00Z', windowMinutes: 1440 }),
    );

    // The explicit window forced re-aggregation of Monday's daily bucket.
    const secondRunKeys = summaries.upsertLog.slice(upsertsAfterFirstRun);
    expect(secondRunKeys).toContain(keyOf('daily', '2026-08-24', 1, 'systembolaget'));
    expect(secondRunKeys).toContain(keyOf('weekly', '2026-08-24', 2, null));

    // No observation above the watermark ⇒ watermark unchanged (never
    // regressed to the window, never advanced).
    expect(watermarks.store.get('time-series-aggregation')?.getTime()).toBe(
      T.wed10.getTime(),
    );
  });

  it('ignores an invalid bucketStart and falls back to the watermark scan', async () => {
    await worker.process(makeJob({}));
    const upsertsAfterFirstRun = summaries.upsertLog.length;

    await worker.process(makeJob({ bucketStart: 'not-a-date', windowMinutes: 30 }));

    // Watermark-driven: only the boundary-instant buckets re-aggregate.
    const secondRunKeys = summaries.upsertLog.slice(upsertsAfterFirstRun);
    expect(secondRunKeys).toEqual([
      keyOf('daily', '2026-08-26', 1, 'alko'),
      keyOf('daily', '2026-08-26', 1, null),
      keyOf('weekly', '2026-08-24', 1, 'systembolaget'),
      keyOf('weekly', '2026-08-24', 1, 'alko'),
      keyOf('weekly', '2026-08-24', 1, null),
    ]);
  });

  it('accepts a scheduled-style payload with bucketStart and windowMinutes', async () => {
    // Scheduler shape: bucketStart ≈ now, window 30 minutes.
    await worker.process(
      makeJob({ bucketStart: '2026-08-26T10:30:00Z', windowMinutes: 30 }),
    );

    // bucketStart after the (absent) watermark ⇒ full first-run scan.
    expect(summaries.buckets.size).toBe(11);
    expect(watermarks.store.get('time-series-aggregation')?.getTime()).toBe(
      T.wed10.getTime(),
    );
  });

  it('uses the canonical reliability order for bucket severity', () => {
    const order: ReliabilityStatus[] = ['VERIFIED', 'ESTIMATED', 'STALE', 'UNAVAILABLE'];
    for (let i = 0; i + 1 < order.length; i++) {
      expect(strictestReliability([order[i], order[i + 1]])).toBe(order[i + 1]);
    }
  });
});
