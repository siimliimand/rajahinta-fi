/**
 * Time-series aggregation cron handler tests (task 4.3) — the
 * write-then-advance scan over a FAKE R2 store seeded with observation
 * JSONL objects, summary persistence + watermark advance against the
 * real D1 repositories on the fake-D1 harness, idempotent re-runs, and
 * the watermark-unchanged failure guarantee (background-jobs spec:
 * "Aggregation survives restart"). Also the design-D4 coverage gauge
 * (watermark-isolation-history-backfill): ratio over the pass window,
 * the 0/0 +Inf sentinel, and emission that never alters pass semantics.
 * And the cursor-chunked pass (aggregation-cursor-chunking): bounded
 * id-ascending slices, write-then-advance cursor persistence, wrap
 * semantics, and resume after a mid-backfill cursor.
 *
 * @module TimeSeriesAggregationCronTest
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import {
  handleTimeSeriesAggregation,
  AGGREGATION_CHUNK_PRODUCTS,
  BACKFILL_CURSOR_KEY,
  WATERMARK_KEY,
} from '../time-series-aggregation';
import type { R2ObservationLogStore } from '../../adapters/r2-observation-log.store';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';
import {
  HISTORY_SUMMARY_COVERAGE_GAUGE,
  STALE_PRICE_SHARE_GAUGE,
  TRANSPORT_AGE_INFINITE,
} from '../../observability/metrics';
import {
  serializeObservationLog,
  type ObservationLogRecord,
} from '../../../../../packages/data-platform/src/d1/observation-log';
import { D1PriceHistorySummaryRepository } from '../../../../../packages/data-platform/src/repositories/d1/price-history-summary.repository';
import { openMigratedD1 } from '../../analytics/__tests__/fake-d1';
import { createLogger } from '../../logger';
import type { Env } from '../../env';

const LOG = createLogger('error');

/** Day-partition keys must match the log layout for the scan selector. */
function record(partial: {
  id: number;
  productId: number;
  merchant: string;
  observedAt: string;
  priceCents: number;
}): ObservationLogRecord {
  return {
    id: partial.id,
    product_id: partial.productId,
    merchant: partial.merchant,
    retail_offer_id: partial.id * 10,
    observed_at: partial.observedAt,
    foreign_retail_price_cents: partial.priceCents,
    transport_cost_cents: 500,
    transport_offer_id: null,
    excise_rule_version_id: null,
    container_duty_rule_version_id: null,
    landed_cost_cents: partial.priceCents + 500,
    input_reliability: {
      retailPrice: 'VERIFIED',
      transport: 'ESTIMATED',
      exciseRule: 'VERIFIED',
      containerDutyRule: 'VERIFIED',
    },
    confidence: 'HIGH',
  };
}

/** Fake R2 store: Map of key → JSONL body, satisfying the full surface. */
function createFakeStore(
  objects: Record<string, ObservationLogRecord[]>,
): R2ObservationLogStore {
  const bodies = new Map<string, string>();
  for (const [key, records] of Object.entries(objects)) {
    bodies.set(key, serializeObservationLog(records));
  }
  return {
    appendLine: async (key, line) => {
      const existing = bodies.get(key);
      bodies.set(key, (existing ?? '') + line + '\n');
    },
    listKeys: async (prefix) =>
      [...bodies.keys()].filter((key) => key.startsWith(prefix)).sort(),
    readObject: async (key) => bodies.get(key) ?? null,
  };
}

function createEnv(): {
  env: Env;
  db: DatabaseSync;
} {
  const { db, d1 } = openMigratedD1();
  return { env: { DB: d1 } as unknown as Env, db };
}

/**
 * price_history_summaries carries FKs to product_master — seed the
 * canonical product rows the observations reference.
 */
function seedProducts(db: DatabaseSync, productIds: number[]): void {
  const insert = db.prepare(
    `INSERT INTO product_master
       (id, name, manufacturer, brand, category, unit_volume, container_type,
        regulatory_classification)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const id of productIds) {
    insert.run(id, `Product ${id}`, 'Brewery', 'Brand', 'beer', 0.33, 'can', 'M500');
  }
}

function summaryRows(db: DatabaseSync): Array<{
  granularity: string;
  period_start: string;
  product_id: number;
  merchant: string | null;
  price_open_cents: number;
  price_close_cents: number;
  price_avg_cents: number;
  landed_cost_avg_cents: number;
  observation_count: number;
  strictest_reliability: string;
}> {
  return db
    .prepare(
      `SELECT granularity, period_start, product_id, merchant,
              price_open_cents, price_close_cents, price_avg_cents,
              landed_cost_avg_cents, observation_count,
              strictest_reliability
         FROM price_history_summaries
        ORDER BY granularity DESC, period_start, product_id, merchant`,
    )
    .all() as never;
}

function watermarkOf(db: DatabaseSync): string | null {
  const row = db
    .prepare('SELECT watermark FROM aggregation_watermarks WHERE job_name = ?')
    .get(WATERMARK_KEY) as { watermark: string } | undefined;
  return row?.watermark ?? null;
}

// ---------------------------------------------------------------------------
// Summary-coverage gauge fixtures (design D4,
// watermark-isolation-history-backfill)
// ---------------------------------------------------------------------------

/** One recorded writeDataPoint call. */
type RecordedPoint = AnalyticsEngineDataPoint;

/** Fake AE binding — the metrics.test.ts sink, minimal form. */
function fakeAnalyticsEngine(write?: (point: RecordedPoint) => void): {
  binding: AnalyticsEngineDataset;
  points: RecordedPoint[];
} {
  const points: RecordedPoint[] = [];
  return {
    points,
    binding: {
      writeDataPoint(event?: RecordedPoint): void {
        const point = event ?? {};
        points.push(point);
        write?.(point);
      },
    },
  };
}

let offerId = 500;

/**
 * retail_offers carries an FK to product_master — the observation mirror
 * row (the append every R2 log line mirrors via retail_offer_id).
 */
function seedOffer(
  db: DatabaseSync,
  partial: { productId: number; merchant: string; observedAt: string },
): void {
  db.prepare(
    `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents, observed_at)
     VALUES (?, ?, 'FI', ?, 1000, ?)`,
  ).run(++offerId, partial.merchant, partial.productId, partial.observedAt);
}

describe('handleTimeSeriesAggregation over a fake R2 log', () => {
  it('aggregates daily + weekly buckets (per-merchant + product-wide) and advances the watermark', async () => {
    const { env, db } = createEnv();
    seedProducts(db, [7, 8]);
    // Two days, two merchants, price move on day 2 (open 1000 → close 1100).
    const store = createFakeStore({
      'observations/2026-08-28.jsonl': [
        record({ id: 1, productId: 7, merchant: 'alko', observedAt: '2026-08-28T10:00:00.000Z', priceCents: 1000 }),
        record({ id: 2, productId: 7, merchant: 'eu-import', observedAt: '2026-08-28T12:00:00.000Z', priceCents: 1200 }),
      ],
      'observations/2026-08-29.jsonl': [
        record({ id: 3, productId: 7, merchant: 'alko', observedAt: '2026-08-29T09:00:00.000Z', priceCents: 1100 }),
        // Another product entirely — proves per-product grouping.
        record({ id: 4, productId: 8, merchant: 'alko', observedAt: '2026-08-29T15:00:00.000Z', priceCents: 3000 }),
      ],
      // Foreign key inside the bucket prefix — skipped by the scan selector.
      'notes/2026-08-29.jsonl': [],
    });

    const result = await handleTimeSeriesAggregation(env, LOG, { store });

    // Product 7: day-A (2 obs across 2 merchants → 3 rows), day-B (1 obs → 2 rows);
    // product 8: day-B (1 obs → 2 rows). Per day: 2 granularities.
    // daily: p7A=3, p7B=2, p8B=2 → 7; weekly (one ISO week): p7=3, p8=2 → 5.
    expect(result.bucketsWritten).toBe(12);
    expect(result.products).toBe(2);
    expect(result.watermark).toBe('2026-08-29T15:00:00.000Z');
    expect(watermarkOf(db)).toBe('2026-08-29T15:00:00.000Z');

    const rows = summaryRows(db);
    // Product-wide daily row for 2026-08-28: avg of 1000 and 1200.
    const p7WideDayA = rows.find(
      (row) =>
        row.granularity === 'daily' &&
        row.period_start === '2026-08-28' &&
        row.product_id === 7 &&
        row.merchant === null,
    );
    expect(p7WideDayA).toMatchObject({
      price_avg_cents: 1100,
      landed_cost_avg_cents: 1600,
      observation_count: 2,
      // The transport input's ESTIMATED snapshot degrades both
      // observations — the strictest-status rule doing its job.
      strictest_reliability: 'ESTIMATED',
    });
    // The alko daily row keeps only its own merchant series.
    const p7AlkoDayA = rows.find(
      (row) =>
        row.granularity === 'daily' &&
        row.period_start === '2026-08-28' &&
        row.product_id === 7 &&
        row.merchant === 'alko',
    );
    expect(p7AlkoDayA).toMatchObject({
      price_avg_cents: 1000,
      observation_count: 1,
    });
    // Weekly buckets anchor on ISO Monday 2026-08-24 and fold both days.
    const p7WideWeekly = rows.find(
      (row) =>
        row.granularity === 'weekly' &&
        row.product_id === 7 &&
        row.merchant === null,
    );
    expect(p7WideWeekly).toMatchObject({
      period_start: '2026-08-24',
      observation_count: 3,
      price_avg_cents: 1100, // (1000 + 1200 + 1100) / 3, exact
    });
  });

  it('is idempotent on re-run — upserts converge on the persisted rows', async () => {
    const { env, db } = createEnv();
    seedProducts(db, [7]);
    const store = createFakeStore({
      'observations/2026-08-28.jsonl': [
        record({ id: 1, productId: 7, merchant: 'alko', observedAt: '2026-08-28T10:00:00.000Z', priceCents: 1000 }),
      ],
    });

    await handleTimeSeriesAggregation(env, LOG, { store });
    const rowsAfterFirst = summaryRows(db);
    expect(rowsAfterFirst.length).toBeGreaterThan(0);

    // The watermark-inclusive lower bound re-upserts the boundary day's
    // buckets (2 daily + 2 weekly rows), but the CONTENT converges —
    // no duplicate rows, no changed values.
    const second = await handleTimeSeriesAggregation(env, LOG, { store });
    expect(second.bucketsWritten).toBe(4);
    expect(second.watermark).toBe('2026-08-28T10:00:00.000Z');
    expect(summaryRows(db)).toEqual(rowsAfterFirst);
  });

  it('re-scans the watermark week but filters per line for activity (inclusive lower bound)', async () => {
    const { env, db } = createEnv();
    seedProducts(db, [7]);
    // The boundary-day partition gains a late-appended line with an
    // earlier observed_at: the re-scan drops it from ACTIVITY (older than
    // watermark) without skipping the partition.
    const store = createFakeStore({
      'observations/2026-08-28.jsonl': [
        record({ id: 1, productId: 7, merchant: 'alko', observedAt: '2026-08-28T08:00:00.000Z', priceCents: 900 }),
        record({ id: 2, productId: 7, merchant: 'alko', observedAt: '2026-08-28T10:00:00.000Z', priceCents: 1000 }),
      ],
    });

    // First pass processes BOTH lines and puts the watermark at 10:00.
    await handleTimeSeriesAggregation(env, LOG, { store });
    const rowsAfterFirst = summaryRows(db);

    // Second pass over the SAME partition: only the 10:00 line is active
    // — the boundary day's buckets re-upsert from the FULL partition
    // (both lines, open still 900), converging to identical content.
    const second = await handleTimeSeriesAggregation(env, LOG, { store });
    expect(second.watermark).toBe('2026-08-28T10:00:00.000Z');
    expect(summaryRows(db)).toEqual(rowsAfterFirst);
    // The pre-watermark line still contributes to the bucket series.
    const dayRow = rowsAfterFirst.find(
      (row) => row.granularity === 'daily' && row.merchant === 'alko',
    );
    expect(dayRow).toMatchObject({
      period_start: '2026-08-28',
      price_open_cents: 900,
      price_close_cents: 1000,
      observation_count: 2,
    });
  });

  it('leaves the watermark unchanged when a summary write fails (redo the window)', async () => {
    const { env, db } = createEnv();
    const store = createFakeStore({
      'observations/2026-08-28.jsonl': [
        record({ id: 1, productId: 7, merchant: 'alko', observedAt: '2026-08-28T10:00:00.000Z', priceCents: 1000 }),
      ],
    });
    const failing = {
      upsertBucket: () => Promise.reject(new Error('D1 write failed')),
    } as never as D1PriceHistorySummaryRepository;

    await expect(
      handleTimeSeriesAggregation(env, LOG, { store, summaries: failing }),
    ).rejects.toThrow('D1 write failed');

    // No watermark row exists — the next run redoes the full window.
    expect(watermarkOf(db)).toBeNull();
  });

  it('no-ops when the scan range holds no observations', async () => {
    const { env, db } = createEnv();
    const store = createFakeStore({});
    const result = await handleTimeSeriesAggregation(env, LOG, { store });
    expect(result).toEqual({ products: 0, bucketsWritten: 0, watermark: null });
    expect(watermarkOf(db)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Summary-coverage gauge emission (design D4,
// watermark-isolation-history-backfill)
// ---------------------------------------------------------------------------

describe('summary-coverage gauge emission (design D4)', () => {
  /** Fresh migrated D1 + products + R2 store over the standard two-day fixture. */
  function seededFixture(productIds: readonly number[]): {
    db: DatabaseSync;
    d1: ReturnType<typeof openMigratedD1>['d1'];
    store: R2ObservationLogStore;
  } {
    const { db, d1 } = openMigratedD1();
    seedProducts(db, [...productIds]);
    // Only the seeded products' lines — an R2 record for an unseeded
    // product would trip the summaries table's product_master FK.
    const objects: Record<string, ObservationLogRecord[]> = {};
    if (productIds.includes(7)) {
      objects['observations/2026-08-28.jsonl'] = [
        record({ id: 1, productId: 7, merchant: 'alko', observedAt: '2026-08-28T10:00:00.000Z', priceCents: 1000 }),
      ];
    }
    if (productIds.includes(8)) {
      objects['observations/2026-08-29.jsonl'] = [
        record({ id: 2, productId: 8, merchant: 'alko', observedAt: '2026-08-29T15:00:00.000Z', priceCents: 3000 }),
      ];
    }
    const store = createFakeStore(objects);
    return { db, d1, store };
  }

  function coveragePoints(points: readonly RecordedPoint[]): RecordedPoint[] {
    return points.filter(
      (point) => point.indexes?.[0] === HISTORY_SUMMARY_COVERAGE_GAUGE,
    );
  }

  it('a healthy first pass writes the ratio 1 (every product with observations summarized)', async () => {
    const { db, d1, store } = seededFixture([7, 8]);
    seedOffer(db, { productId: 7, merchant: 'alko', observedAt: '2026-08-28T10:00:00.000Z' });
    seedOffer(db, { productId: 8, merchant: 'alko', observedAt: '2026-08-29T15:00:00.000Z' });
    const ae = fakeAnalyticsEngine();

    const result = await handleTimeSeriesAggregation(
      { DB: d1, METRICS: ae.binding } as unknown as Env,
      LOG,
      { store },
    );

    expect(result).toEqual({
      products: 2,
      bucketsWritten: 8,
      watermark: '2026-08-29T15:00:00.000Z',
    });
    const coverage = coveragePoints(ae.points);
    expect(coverage).toHaveLength(1);
    // 2 summarized / 2 with observations, over the whole log (first run —
    // no watermark, the processed window is everything).
    expect(coverage[0].doubles?.[0]).toBe(1);
    expect(coverage[0].blobs?.[1]).toBe('1');
  });

  it('drops below 1 when an in-window product lacks summary buckets (the alertable gap)', async () => {
    const { db, d1, store } = seededFixture([7, 8, 9]);
    seedOffer(db, { productId: 7, merchant: 'alko', observedAt: '2026-08-28T10:00:00.000Z' });
    seedOffer(db, { productId: 8, merchant: 'alko', observedAt: '2026-08-29T15:00:00.000Z' });
    // The gap: a mirrored offer append with NO R2 log line — the pass can
    // never summarize it, and the ratio must say so.
    seedOffer(db, { productId: 9, merchant: 'alko', observedAt: '2026-08-29T16:00:00.000Z' });
    const ae = fakeAnalyticsEngine();

    await handleTimeSeriesAggregation(
      { DB: d1, METRICS: ae.binding } as unknown as Env,
      LOG,
      { store },
    );

    const coverage = coveragePoints(ae.points);
    expect(coverage).toHaveLength(1);
    expect(coverage[0].doubles?.[0]).toBeCloseTo(2 / 3);
    expect(coverage[0].blobs?.[1]).toBe(String(2 / 3));
  });

  it('bounds the counts by the pass window (post-watermark ticks exclude pre-window products)', async () => {
    const { db, d1, store } = seededFixture([7, 8, 9]);
    seedOffer(db, { productId: 7, merchant: 'alko', observedAt: '2026-08-28T10:00:00.000Z' });
    seedOffer(db, { productId: 8, merchant: 'alko', observedAt: '2026-08-29T15:00:00.000Z' });
    // Old offer, long before the watermark's ISO-week Monday (08-24):
    // bounded ticks must not count product 9 — and it was never
    // summarized, so an UNbounded read would render a false 2/3 gap.
    seedOffer(db, { productId: 9, merchant: 'alko', observedAt: '2026-08-20T12:00:00.000Z' });
    const ae = fakeAnalyticsEngine();
    const env = { DB: d1, METRICS: ae.binding } as unknown as Env;

    await handleTimeSeriesAggregation(env, LOG, { store });
    const second = await handleTimeSeriesAggregation(env, LOG, { store });

    expect(second.watermark).toBe('2026-08-29T15:00:00.000Z');
    const coverage = coveragePoints(ae.points);
    expect(coverage).toHaveLength(2);
    // Second pass reads from ISO Monday 2026-08-24: window holds products
    // 7 and 8 only — summarized 2 / with observations 2.
    expect(coverage[1].doubles?.[0]).toBe(1);
    expect(coverage[1].blobs?.[1]).toBe('1');
  });

  it('renders a 0/0 window as the +Inf sentinel — honest empty state, result unchanged', async () => {
    const { env: emptyEnv } = createEnv();
    const d1 = emptyEnv.DB;
    const store = createFakeStore({});
    const ae = fakeAnalyticsEngine();

    const result = await handleTimeSeriesAggregation(
      { DB: d1, METRICS: ae.binding } as unknown as Env,
      LOG,
      { store },
    );

    expect(result).toEqual({ products: 0, bucketsWritten: 0, watermark: null });
    const coverage = coveragePoints(ae.points);
    expect(coverage).toHaveLength(1);
    expect(coverage[0].doubles?.[0]).toBe(TRANSPORT_AGE_INFINITE);
    expect(Number.isFinite(coverage[0].doubles?.[0])).toBe(true); // AE-safe
    expect(coverage[0].blobs?.[1]).toBe('+Inf');
  });

  it('no-ops the emission without the METRICS binding (dev/local)', async () => {
    const { db, d1, store } = seededFixture([7]);
    seedOffer(db, { productId: 7, merchant: 'alko', observedAt: '2026-08-28T10:00:00.000Z' });

    const result = await handleTimeSeriesAggregation(
      { DB: d1 } as unknown as Env,
      LOG,
      { store },
    );

    expect(result.watermark).toBe('2026-08-28T10:00:00.000Z');
    expect(result.products).toBe(1);
    expect(watermarkOf(db)).toBe('2026-08-28T10:00:00.000Z');
  });

  it('emission never alters pass semantics — results byte-identical with, without, and against a throwing METRICS', async () => {
    const withMetricsFixture = seededFixture([7, 8]);
    const ae = fakeAnalyticsEngine();
    const withMetrics = await handleTimeSeriesAggregation(
      { DB: withMetricsFixture.d1, METRICS: ae.binding } as unknown as Env,
      LOG,
      { store: withMetricsFixture.store },
    );

    const noMetricsFixture = seededFixture([7, 8]);
    const noMetrics = await handleTimeSeriesAggregation(
      { DB: noMetricsFixture.d1 } as unknown as Env,
      LOG,
      { store: noMetricsFixture.store },
    );

    const throwingFixture = seededFixture([7, 8]);
    const aeThrow = fakeAnalyticsEngine(() => {
      throw new Error('AE unavailable');
    });
    const throwing = await handleTimeSeriesAggregation(
      {
        DB: throwingFixture.d1,
        METRICS: aeThrow.binding,
      } as unknown as Env,
      LOG,
      { store: throwingFixture.store },
    );

    expect(withMetrics).toEqual(noMetrics);
    expect(withMetrics).toEqual(throwing);
    expect(withMetrics.watermark).toBe('2026-08-29T15:00:00.000Z');
    expect(watermarkOf(withMetricsFixture.db)).toBe(withMetrics.watermark);
    expect(watermarkOf(noMetricsFixture.db)).toBe(withMetrics.watermark);
    expect(watermarkOf(throwingFixture.db)).toBe(withMetrics.watermark);
  });

  it('a failing coverage read is logged and dropped — the pass completes (best-effort doctrine)', async () => {
    const { db, d1, store } = seededFixture([7]);
    seedOffer(db, { productId: 7, merchant: 'alko', observedAt: '2026-08-28T10:00:00.000Z' });
    const coverageBrokenD1: D1DatabaseLike = {
      prepare(query: string) {
        if (query.includes('retail_offers')) {
          throw new Error('coverage read failed');
        }
        return d1.prepare(query);
      },
      batch: (statements) => d1.batch(statements),
    };
    const ae = fakeAnalyticsEngine();

    const result = await handleTimeSeriesAggregation(
      { DB: coverageBrokenD1, METRICS: ae.binding } as unknown as Env,
      LOG,
      { store },
    );

    // The pass itself is untouched: watermark advanced, result returned.
    expect(result).toEqual({
      products: 1,
      bucketsWritten: 4,
      watermark: '2026-08-28T10:00:00.000Z',
    });
    expect(watermarkOf(db)).toBe('2026-08-28T10:00:00.000Z');
    // The coverage point is absent, but the sibling stale-share gauge
    // still wrote — only the broken measurement dropped.
    expect(coveragePoints(ae.points)).toHaveLength(0);
    expect(
      ae.points.filter(
        (point) => point.indexes?.[0] === STALE_PRICE_SHARE_GAUGE,
      ),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Cursor-chunked backfill pass (aggregation-cursor-chunking, design D2/D3)
// ---------------------------------------------------------------------------

/** Observation instant `second` seconds past 10:00 UTC on 2026-08-28. */
function backfillObservedAt(second: number): string {
  return new Date(Date.UTC(2026, 7, 28, 10, 0, second)).toISOString();
}

/** The backfill-cursor row's persisted value, read off the fixture. */
function backfillCursorOf(db: DatabaseSync): string | undefined {
  return (
    db
      .prepare('SELECT watermark FROM aggregation_watermarks WHERE job_name = ?')
      .get(BACKFILL_CURSOR_KEY) as { watermark: string } | undefined
  )?.watermark;
}

function backfillCursorRowCount(db: DatabaseSync): number {
  return (
    db
      .prepare('SELECT COUNT(*) AS n FROM aggregation_watermarks WHERE job_name = ?')
      .get(BACKFILL_CURSOR_KEY) as { n: number }
  ).n;
}

/**
 * Real summary repository wrapped with an upsert counter — the
 * savings-suite discipline: delegation stays real, only the call is
 * recorded. The count is the "no re-aggregation" observable.
 */
function countingSummaries(
  d1: D1DatabaseLike,
  counter: { upserts: number },
): D1PriceHistorySummaryRepository {
  const real = new D1PriceHistorySummaryRepository(d1);
  return {
    upsertBucket: async (summary: Parameters<typeof real.upsertBucket>[0]) => {
      counter.upserts++;
      return real.upsertBucket(summary);
    },
  } as unknown as D1PriceHistorySummaryRepository;
}

/**
 * One observation per product, ids 1..count, instants ascending with the
 * id — the activity high water is then always `backfillObservedAt(count)`.
 * One observation → 4 buckets per product (daily + weekly × merchant +
 * product-wide).
 */
function seedBackfillLog(count: number): {
  store: R2ObservationLogStore;
} {
  const records = Array.from({ length: count }, (_, i) => {
    const productId = i + 1;
    return record({
      id: productId,
      productId,
      merchant: 'alko',
      observedAt: backfillObservedAt(productId),
      priceCents: 1000,
    });
  });
  return { store: createFakeStore({ 'observations/2026-08-28.jsonl': records }) };
}

describe('cursor-chunked backfill (aggregation-cursor-chunking)', () => {
  it('pins the chunk cap and cursor row key the budget math depends on', () => {
    expect(AGGREGATION_CHUNK_PRODUCTS).toBe(300);
    expect(BACKFILL_CURSOR_KEY).toBe('time-series-backfill-cursor');
  });

  it('processes exactly the 300-product slice per tick — cursor persisted, watermark withheld until the tail', async () => {
    const { env, db } = createEnv();
    seedProducts(db, Array.from({ length: 320 }, (_, i) => i + 1));
    const { store } = seedBackfillLog(320);

    const first = await handleTimeSeriesAggregation(env, LOG, { store });
    expect(first.products).toBe(300);
    expect(first.bucketsWritten).toBe(1200); // 300 products × 4 buckets
    // The pass is not complete — no watermark, neither returned nor persisted.
    expect(first.watermark).toBeNull();
    expect(watermarkOf(db)).toBeNull();
    // Write-then-advance: the cursor sits at the 300th (last completed) id.
    expect(backfillCursorOf(db)).toBe('300');

    const second = await handleTimeSeriesAggregation(env, LOG, { store });
    expect(second.products).toBe(20);
    expect(second.bucketsWritten).toBe(80);
    expect(second.watermark).toBe(backfillObservedAt(320));
    expect(watermarkOf(db)).toBe(backfillObservedAt(320));
    expect(backfillCursorOf(db)).toBeUndefined();
  });

  it('the final chunk writes the watermark at the activity high water and deletes the cursor row', async () => {
    const { env, db } = createEnv();
    seedProducts(db, Array.from({ length: 301 }, (_, i) => i + 1));
    const { store } = seedBackfillLog(301);

    await handleTimeSeriesAggregation(env, LOG, { store });
    expect(backfillCursorOf(db)).toBe('300');

    const last = await handleTimeSeriesAggregation(env, LOG, { store });
    expect(last.products).toBe(1);
    expect(last.watermark).toBe(backfillObservedAt(301));
    expect(watermarkOf(db)).toBe(backfillObservedAt(301));
    // The cursor row is GONE, not zeroed — the watermark alone drives
    // every later tick.
    expect(backfillCursorRowCount(db)).toBe(0);
    expect(backfillCursorOf(db)).toBeUndefined();
  });

  it('resumes strictly after the persisted cursor — completed products are not re-aggregated', async () => {
    const { env, db } = createEnv();
    seedProducts(db, Array.from({ length: 620 }, (_, i) => i + 1));
    const { store } = seedBackfillLog(620);

    const first = await handleTimeSeriesAggregation(env, LOG, { store });
    expect(first.products).toBe(300);
    expect(backfillCursorOf(db)).toBe('300');

    // The next tick starts AFTER cursor 300: the upsert counter sees
    // exactly the 301..600 slice — none of the completed 1..300 products
    // re-appear in the bucket writes.
    const counter = { upserts: 0 };
    const second = await handleTimeSeriesAggregation(env, LOG, {
      store,
      summaries: countingSummaries(env.DB, counter),
    });
    expect(second.products).toBe(300);
    expect(second.bucketsWritten).toBe(1200);
    expect(counter.upserts).toBe(1200); // the slice only, no re-aggregation
    expect(second.watermark).toBeNull();
    expect(backfillCursorOf(db)).toBe('600');

    const third = await handleTimeSeriesAggregation(env, LOG, { store });
    expect(third.products).toBe(20);
    expect(third.watermark).toBe(backfillObservedAt(620));
    expect(backfillCursorOf(db)).toBeUndefined();

    // Convergence: every product has exactly its 4 buckets — no
    // duplicates from the chunked walk.
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM price_history_summaries').get(),
    ).toEqual({ n: 620 * 4 });
  });

  it('degenerates to the one-chunk shape on a settled watermark — cursor never appears, advance rule unchanged', async () => {
    const { env, db } = createEnv();
    seedProducts(db, [7, 8]);
    const store = createFakeStore({
      'observations/2026-08-28.jsonl': [
        record({ id: 1, productId: 7, merchant: 'alko', observedAt: '2026-08-28T10:00:00.000Z', priceCents: 1000 }),
      ],
      'observations/2026-08-29.jsonl': [
        record({ id: 2, productId: 8, merchant: 'alko', observedAt: '2026-08-29T15:00:00.000Z', priceCents: 3000 }),
      ],
    });

    // First pass: the whole active set fits one chunk — the final-chunk
    // branch fires and the result is byte-identical to the pre-chunking
    // handler's.
    const first = await handleTimeSeriesAggregation(env, LOG, { store });
    expect(first).toEqual({
      products: 2,
      bucketsWritten: 8,
      watermark: '2026-08-29T15:00:00.000Z',
    });
    expect(backfillCursorOf(db)).toBeUndefined();

    // The settled tick: one chunk, watermark held (never backwards), the
    // exact shape today's callers depend on.
    const second = await handleTimeSeriesAggregation(env, LOG, { store });
    expect(second).toEqual({
      products: 1,
      bucketsWritten: 4,
      watermark: '2026-08-29T15:00:00.000Z',
    });
    expect(backfillCursorOf(db)).toBeUndefined();
  });

  it('cursor row semantics: insert-or-update on the single keyed row, delete on completion', async () => {
    const { env, db } = createEnv();
    seedProducts(db, Array.from({ length: 620 }, (_, i) => i + 1));
    const { store } = seedBackfillLog(620);

    await handleTimeSeriesAggregation(env, LOG, { store });
    expect(backfillCursorOf(db)).toBe('300');
    expect(backfillCursorRowCount(db)).toBe(1); // INSERT

    await handleTimeSeriesAggregation(env, LOG, { store });
    expect(backfillCursorOf(db)).toBe('600');
    expect(backfillCursorRowCount(db)).toBe(1); // UPDATE — never a second row

    await handleTimeSeriesAggregation(env, LOG, { store });
    expect(backfillCursorRowCount(db)).toBe(0); // DELETE on wrap
    // The watermark row is untouched by the cursor lifecycle beyond the
    // completion write itself.
    expect(watermarkOf(db)).toBe(backfillObservedAt(620));
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM aggregation_watermarks').get(),
    ).toEqual({ n: 1 });
  });
});
