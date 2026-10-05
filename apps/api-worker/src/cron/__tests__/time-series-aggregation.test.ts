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
  type AggregationResult,
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

  it('a chunked backfill walk emits one global point per tick and the ratio climbs tick over tick', async () => {
    const catalog = 2 * AGGREGATION_CHUNK_PRODUCTS + 2; // chunks [N, N, 2]
    const { db, d1 } = openMigratedD1();
    seedProducts(db, Array.from({ length: catalog }, (_, i) => i + 1));
    const { store } = seedBackfillLog(catalog);
    // Mirror offer rows for EVERY product — the global denominator is
    // all products with observations, not the tick's chunk slice.
    for (let p = 1; p <= catalog; p++) {
      seedOffer(db, {
        productId: p,
        merchant: 'alko',
        observedAt: backfillObservedAt(p),
      });
    }
    const ae = fakeAnalyticsEngine();
    const env = { DB: d1, METRICS: ae.binding } as unknown as Env;

    const ratios: number[] = [];
    for (let tick = 0; tick < 16; tick++) {
      const before = ae.points.length;
      const result = await handleTimeSeriesAggregation(env, LOG, { store });
      const tickPoints = coveragePoints(ae.points.slice(before));
      // Exactly ONE coverage point per tick, emitted AFTER that tick's
      // chunk writes — the point already includes the chunk that just
      // landed (the climb below is only possible post-write).
      expect(tickPoints).toHaveLength(1);
      ratios.push(tickPoints[0].doubles?.[0] ?? NaN);
      if (result.watermark !== null) break;
    }

    // The GLOBAL pair (summarized / products with observations, both
    // cheap all-catalog D1 counts) after each tick: the ratio is the
    // chunk union's share, climbing tick over tick toward 1 — the
    // convergence signal the METRICS.md note documents and the coverage
    // alert rides (it fires by design until the walk completes).
    expect(ratios).toEqual([
      AGGREGATION_CHUNK_PRODUCTS / catalog,
      (2 * AGGREGATION_CHUNK_PRODUCTS) / catalog,
      1,
    ]);
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i]).toBeGreaterThan(ratios[i - 1]);
    }
  });

  it('the quiet-tick early-return path still emits (bounded window, settled watermark)', async () => {
    const { db, d1 } = openMigratedD1();
    seedProducts(db, [7]);
    const store = createFakeStore({
      'observations/2026-08-26.jsonl': [
        record({ id: 1, productId: 7, merchant: 'alko', observedAt: '2026-08-26T10:00:00.000Z', priceCents: 1000 }),
      ],
    });
    seedOffer(db, { productId: 7, merchant: 'alko', observedAt: '2026-08-26T10:00:00.000Z' });
    const ae = fakeAnalyticsEngine();
    const env = { DB: d1, METRICS: ae.binding } as unknown as Env;

    const first = await handleTimeSeriesAggregation(env, LOG, { store });
    expect(first.watermark).toBe('2026-08-26T10:00:00.000Z');
    expect(coveragePoints(ae.points)).toHaveLength(1);

    // The documented --restore end state (backfill-history-summaries.ts
    // writes the watermark row directly): a watermark ABOVE everything
    // the log holds. The scan keeps the Wednesday partition (readFrom is
    // the ISO Monday 08-24) but no observation is ≥ W — the quiet
    // early-return fires, and it still emits the bounded pair (1/1).
    db
      .prepare('UPDATE aggregation_watermarks SET watermark = ? WHERE job_name = ?')
      .run('2026-08-29T12:00:00.000Z', WATERMARK_KEY);

    const second = await handleTimeSeriesAggregation(env, LOG, { store });
    expect(second).toEqual({ products: 0, bucketsWritten: 0, watermark: null });
    const coverage = coveragePoints(ae.points);
    expect(coverage).toHaveLength(2);
    expect(coverage[1].doubles?.[0]).toBe(1);
    expect(coverage[1].blobs?.[1]).toBe('1');
  });

  it('emission never alters a multi-chunk walk — per-tick results byte-identical with, without, and against a throwing METRICS', async () => {
    const catalog = 2 * AGGREGATION_CHUNK_PRODUCTS + 2;
    async function walk(
      metrics?: AnalyticsEngineDataset,
    ): Promise<{ results: AggregationResult[]; db: DatabaseSync }> {
      const { db, d1 } = openMigratedD1();
      seedProducts(db, Array.from({ length: catalog }, (_, i) => i + 1));
      const { store } = seedBackfillLog(catalog);
      const env = (
        metrics ? { DB: d1, METRICS: metrics } : { DB: d1 }
      ) as unknown as Env;
      const results: AggregationResult[] = [];
      for (let tick = 0; tick < 16; tick++) {
        const result = await handleTimeSeriesAggregation(env, LOG, { store });
        results.push(result);
        if (result.watermark !== null) break;
      }
      return { results, db };
    }

    const ae = fakeAnalyticsEngine();
    const withMetrics = await walk(ae.binding);
    const noMetrics = await walk();
    const aeThrow = fakeAnalyticsEngine(() => {
      throw new Error('AE unavailable');
    });
    const throwing = await walk(aeThrow.binding);

    // A chunked walk is 3 invocations (N, N, tail) — every one of them
    // byte-identical across the three binding postures.
    expect(withMetrics.results).toHaveLength(3);
    expect(withMetrics.results).toEqual(noMetrics.results);
    expect(withMetrics.results).toEqual(throwing.results);
    for (const walk of [withMetrics, noMetrics, throwing]) {
      expect(watermarkOf(walk.db)).toBe(backfillObservedAt(catalog));
      expect(backfillCursorRowCount(walk.db)).toBe(0);
    }
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
    // 300: the measured wall-time envelope (task 1.2) — 300 products ≈
    // 28.8k statements ≈ 5-6 min of the 15-min wall that production
    // showed binding (~880 products/15 min, 1.0 s/product). The
    // ≤35,000-statement pin guards the envelope; a batched per-product
    // upsert in the summary repository is the recorded ~96× optimization
    // candidate.
    expect(AGGREGATION_CHUNK_PRODUCTS).toBe(300);
    expect(BACKFILL_CURSOR_KEY).toBe('time-series-backfill-cursor');
  });

  it('processes exactly one chunk slice per tick — cursor persisted, watermark withheld until the tail', async () => {
    const { env, db } = createEnv();
    const tail = AGGREGATION_CHUNK_PRODUCTS - 1;
    const catalog = AGGREGATION_CHUNK_PRODUCTS + tail;
    seedProducts(db, Array.from({ length: catalog }, (_, i) => i + 1));
    const { store } = seedBackfillLog(catalog);

    const first = await handleTimeSeriesAggregation(env, LOG, { store });
    expect(first.products).toBe(AGGREGATION_CHUNK_PRODUCTS);
    expect(first.bucketsWritten).toBe(AGGREGATION_CHUNK_PRODUCTS * 4);
    // The pass is not complete — no watermark, neither returned nor persisted.
    expect(first.watermark).toBeNull();
    expect(watermarkOf(db)).toBeNull();
    // Write-then-advance: the cursor sits at the chunk's last completed id.
    expect(backfillCursorOf(db)).toBe(String(AGGREGATION_CHUNK_PRODUCTS));

    const second = await handleTimeSeriesAggregation(env, LOG, { store });
    expect(second.products).toBe(tail);
    expect(second.bucketsWritten).toBe(tail * 4);
    expect(second.watermark).toBe(backfillObservedAt(catalog));
    expect(watermarkOf(db)).toBe(backfillObservedAt(catalog));
    expect(backfillCursorOf(db)).toBeUndefined();
  });

  it('the final chunk writes the watermark at the activity high water and deletes the cursor row', async () => {
    const { env, db } = createEnv();
    const catalog = AGGREGATION_CHUNK_PRODUCTS + 1;
    seedProducts(db, Array.from({ length: catalog }, (_, i) => i + 1));
    const { store } = seedBackfillLog(catalog);

    await handleTimeSeriesAggregation(env, LOG, { store });
    expect(backfillCursorOf(db)).toBe(String(AGGREGATION_CHUNK_PRODUCTS));

    const last = await handleTimeSeriesAggregation(env, LOG, { store });
    expect(last.products).toBe(1);
    expect(last.watermark).toBe(backfillObservedAt(catalog));
    expect(watermarkOf(db)).toBe(backfillObservedAt(catalog));
    // The cursor row is GONE, not zeroed — the watermark alone drives
    // every later tick.
    expect(backfillCursorRowCount(db)).toBe(0);
    expect(backfillCursorOf(db)).toBeUndefined();
  });

  it('resumes strictly after the persisted cursor — completed products are not re-aggregated', async () => {
    const { env, db } = createEnv();
    const tail = AGGREGATION_CHUNK_PRODUCTS - 1;
    const catalog = 2 * AGGREGATION_CHUNK_PRODUCTS + tail;
    seedProducts(db, Array.from({ length: catalog }, (_, i) => i + 1));
    const { store } = seedBackfillLog(catalog);

    const first = await handleTimeSeriesAggregation(env, LOG, { store });
    expect(first.products).toBe(AGGREGATION_CHUNK_PRODUCTS);
    expect(backfillCursorOf(db)).toBe(String(AGGREGATION_CHUNK_PRODUCTS));

    // The next tick starts AFTER cursor N: the upsert counter sees
    // exactly the N+1..2N slice — none of the completed 1..N products
    // re-appear in the bucket writes.
    const counter = { upserts: 0 };
    const second = await handleTimeSeriesAggregation(env, LOG, {
      store,
      summaries: countingSummaries(env.DB, counter),
    });
    expect(second.products).toBe(AGGREGATION_CHUNK_PRODUCTS);
    expect(second.bucketsWritten).toBe(AGGREGATION_CHUNK_PRODUCTS * 4);
    expect(counter.upserts).toBe(AGGREGATION_CHUNK_PRODUCTS * 4); // the slice only, no re-aggregation
    expect(second.watermark).toBeNull();
    expect(backfillCursorOf(db)).toBe(String(2 * AGGREGATION_CHUNK_PRODUCTS));

    const third = await handleTimeSeriesAggregation(env, LOG, { store });
    expect(third.products).toBe(tail);
    expect(third.watermark).toBe(backfillObservedAt(catalog));
    expect(backfillCursorOf(db)).toBeUndefined();

    // Convergence: every product has exactly its 4 buckets — no
    // duplicates from the chunked walk.
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM price_history_summaries').get(),
    ).toEqual({ n: catalog * 4 });
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
    const catalog = 2 * AGGREGATION_CHUNK_PRODUCTS + (AGGREGATION_CHUNK_PRODUCTS - 1);
    seedProducts(db, Array.from({ length: catalog }, (_, i) => i + 1));
    const { store } = seedBackfillLog(catalog);

    await handleTimeSeriesAggregation(env, LOG, { store });
    expect(backfillCursorOf(db)).toBe(String(AGGREGATION_CHUNK_PRODUCTS));
    expect(backfillCursorRowCount(db)).toBe(1); // INSERT

    await handleTimeSeriesAggregation(env, LOG, { store });
    expect(backfillCursorOf(db)).toBe(String(2 * AGGREGATION_CHUNK_PRODUCTS));
    expect(backfillCursorRowCount(db)).toBe(1); // UPDATE — never a second row

    await handleTimeSeriesAggregation(env, LOG, { store });
    expect(backfillCursorRowCount(db)).toBe(0); // DELETE on wrap
    // The watermark row is untouched by the cursor lifecycle beyond the
    // completion write itself.
    expect(watermarkOf(db)).toBe(backfillObservedAt(catalog));
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM aggregation_watermarks').get(),
    ).toEqual({ n: 1 });
  });
});

// ---------------------------------------------------------------------------
// Budget + monotonic-progress pins (task 1.2, aggregation-cursor-chunking
// design D2 + Risks — the counting-proxy mirror of the savings-cron budget
// regression pin, savings-snapshots.test.ts)
// ---------------------------------------------------------------------------

describe('budget + monotonic-progress pins (task 1.2)', () => {
  /**
   * Bucket rows the REALISTIC fixture produces per product: 21 daily
   * buckets + 3 ISO-weekly buckets (Mon 2026-08-03 .. Sun 2026-08-23),
   * one merchant → 2 rows (per-merchant + product-wide) per bucket.
   */
  const REALISTIC_ROWS_PER_PRODUCT = 48;

  /** Production-shaped cadence: one observation per product per day, 3 full ISO weeks. */
  function realisticBackfillStore(productCount: number): {
    store: R2ObservationLogStore;
    highWater: string;
  } {
    const objects: Record<string, ObservationLogRecord[]> = {};
    let highWater = '';
    for (let day = 0; day < 21; day++) {
      const key = `observations/2026-08-${String(3 + day).padStart(2, '0')}.jsonl`;
      objects[key] = [];
      for (let p = 1; p <= productCount; p++) {
        // Distinct instants via whole seconds from 10:00 (Date.UTC rolls
        // over cleanly for catalogs larger than a minute's worth).
        const observedAt = new Date(
          Date.UTC(2026, 7, 3 + day, 10, 0, p - 1),
        ).toISOString();
        objects[key].push(
          record({
            id: p * 100 + day,
            productId: p,
            merchant: 'alko',
            observedAt,
            priceCents: 1000 + p,
          }),
        );
        if (observedAt > highWater) highWater = observedAt;
      }
    }
    return { store: createFakeStore(objects), highWater };
  }

  const ids = (count: number): number[] =>
    Array.from({ length: count }, (_, i) => i + 1);

  /**
   * D1-statement counting wrapper — every `prepare` (and batch member)
   * is one subrequest against the budget. Invocations share the SAME
   * underlying fixture: the cursor state crosses invocations through the
   * `aggregation_watermarks` row, exactly as consecutive production
   * ticks share the real database.
   */
  function countingD1(
    d1: D1DatabaseLike,
    counter: { count: number },
  ): D1DatabaseLike {
    return {
      prepare(query: string) {
        counter.count++;
        return d1.prepare(query);
      },
      batch(statements) {
        counter.count += statements.length;
        return d1.batch(statements);
      },
    };
  }

  function summaryRowCountFor(db: DatabaseSync, productId: number): number {
    return (
      db
        .prepare(
          'SELECT COUNT(*) AS n FROM price_history_summaries WHERE product_id = ?',
        )
        .get(productId) as { n: number }
    ).n;
  }

  /** Upsert capture — which product ids the pass re-aggregated, in order. */
  function capturingSummaries(
    d1: D1DatabaseLike,
    sink: { productIds: number[] },
  ): D1PriceHistorySummaryRepository {
    const real = new D1PriceHistorySummaryRepository(d1);
    return {
      upsertBucket: async (
        summary: Parameters<typeof real.upsertBucket>[0],
      ) => {
        sink.productIds.push(summary.productId);
        return real.upsertBucket(summary);
      },
    } as unknown as D1PriceHistorySummaryRepository;
  }

  /** Invoke until the pass wraps (watermark written), collecting results. */
  async function walkToWrap(
    env: Env,
    store: R2ObservationLogStore,
    deps: {
      summaries?: D1PriceHistorySummaryRepository;
    } = {},
  ): Promise<AggregationResult[]> {
    const results: AggregationResult[] = [];
    for (let tick = 0; tick < 16; tick++) {
      const result = await handleTimeSeriesAggregation(env, LOG, {
        store,
        ...deps,
      });
      results.push(result);
      if (result.watermark !== null) return results;
    }
    throw new Error('pass did not wrap within 16 ticks');
  }

  /**
   * THE BUDGET PIN (task 1.2; evidence-based envelope, design Risks).
   * Multi-invocation walk over a production-shaped catalog (products
   * with ~3 weeks of DAILY observations, the density the R2 log
   * actually holds): every invocation must stay ≤35,000 D1 statements.
   *
   * Production envelope (2026-10-05 11:30 UTC tick, live tail): the
   * aggregation processed ~880 products (~84,000 statements at the
   * measured 96/product) and died at `exceededWallTime` — the 15-minute
   * WALL budget is the binding constraint, 1.0 s/product; no subrequest
   * cap was hit. This pin therefore guards the chunk's measured cost:
   * 300 products × 96 statements (48 bucket rows × the summary
   * repository's unbatched lookup+write pair) + 4 fixed (watermark find
   * + cursor read + cursor write + coverage read) = 28,804 max — ~18%
   * headroom under 35,000. A per-product statement-count increase is
   * exactly the regression that would push a 300-product tick past the
   * wall budget shared with the tick's sibling handlers.
   */
  it('walks a 3-week-realistic catalog across invocations with EVERY invocation inside the 35,000-statement wall envelope', async () => {
    const catalog = 3 * AGGREGATION_CHUNK_PRODUCTS + 7;
    const { env, db } = createEnv();
    seedProducts(db, ids(catalog));
    const { store } = realisticBackfillStore(catalog);

    const counter = { count: 0 };
    const countingEnv = (): Env =>
      ({ DB: countingD1(env.DB, counter) }) as unknown as Env;

    const invocationCounts: number[] = [];
    for (let tick = 0; tick < 64; tick++) {
      counter.count = 0;
      const result = await handleTimeSeriesAggregation(
        countingEnv(),
        LOG,
        { store },
      );
      invocationCounts.push(counter.count);
      if (result.watermark !== null) break;
    }
    // Multiple full chunks + a ragged tail — the chunking is load-bearing.
    expect(invocationCounts.length).toBeGreaterThanOrEqual(4);

    // EVERY invocation inside the envelope — the pin's assertion
    // (measured max on this fixture: 28,804 for a full chunk).
    for (const count of invocationCounts) {
      expect(count).toBeLessThanOrEqual(35_000);
      expect(count).toBeGreaterThan(0);
    }

    // Teeth: the FULL pass costs far more than one invocation's
    // envelope — the v1 single-walk shape of this catalog (~87k
    // statements in ONE invocation) fails the same pin ~2.5×.
    const passTotal = invocationCounts.reduce((sum, count) => sum + count, 0);
    expect(passTotal).toBeGreaterThan(35_000);

    // Exactly-once-semantics: the union of chunks covers every active
    // product with exactly its 48 buckets — no gaps, no duplicates.
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM price_history_summaries').get(),
    ).toEqual({ n: catalog * REALISTIC_ROWS_PER_PRODUCT });
    expect(
      db
        .prepare(
          'SELECT COUNT(DISTINCT product_id) AS n FROM price_history_summaries',
        )
        .get(),
    ).toEqual({ n: catalog });

    // Idempotent re-runs stay correct: a settled re-run re-upserts the
    // boundary product's buckets and the content is byte-identical.
    const before = summaryRows(db);
    await handleTimeSeriesAggregation(countingEnv(), LOG, { store });
    expect(summaryRows(db)).toEqual(before);
  }, 30_000);

  /**
   * KILLED-INVOCATION SIMULATION (spec: "Killed invocation resumes
   * without losing ground"): tick 2 dies mid-chunk at the D1 executor
   * (the budget kill). The cursor must still sit at chunk 1's last id
   * (write-then-advance held), the next tick must resume STRICTLY after
   * it (re-doing only the interrupted chunk's idempotent upserts), and
   * the pass sequence must converge — content byte-identical to a clean
   * uninterrupted walk.
   */
  it('a kill mid-pass holds the cursor at the last completed chunk; the next tick resumes strictly after it and the sequence converges', async () => {
    const catalog = 2 * AGGREGATION_CHUNK_PRODUCTS + 2; // chunks [N, N, 2]
    const { env, db } = createEnv();
    seedProducts(db, ids(catalog));
    const { store, highWater } = realisticBackfillStore(catalog);

    // Tick 1 completes chunk 1 cleanly.
    const first = await handleTimeSeriesAggregation(env, LOG, { store });
    expect(first.products).toBe(AGGREGATION_CHUNK_PRODUCTS);
    expect(backfillCursorOf(db)).toBe(String(AGGREGATION_CHUNK_PRODUCTS));

    // Tick 2 is killed mid-chunk: 149 statements execute, the 150th
    // throws at the D1 executor — inside the chunk's SECOND product
    // (per-product cost is 96 statements on this fixture).
    const capped = { count: 0 };
    const rawD1 = env.DB as unknown as D1DatabaseLike;
    const cappedD1: D1DatabaseLike = {
      prepare(query: string) {
        if (++capped.count > 149) {
          throw new Error('D1 budget exceeded — invocation killed mid-pass');
        }
        return rawD1.prepare(query);
      },
      batch: (statements) => rawD1.batch(statements),
    };
    await expect(
      handleTimeSeriesAggregation(
        { DB: cappedD1 } as unknown as Env,
        LOG,
        { store },
      ),
    ).rejects.toThrow('killed mid-pass');

    // Write-then-advance held: the cursor is STILL chunk 1's last id —
    // the interrupted chunk's partial writes never moved it, and the
    // watermark was never touched.
    expect(backfillCursorOf(db)).toBe(String(AGGREGATION_CHUNK_PRODUCTS));
    expect(watermarkOf(db)).toBeNull();
    // The chunk's first product completed before the kill point, the
    // interrupted product is partial (idempotent upserts), everything
    // above it is untouched.
    expect(summaryRowCountFor(db, AGGREGATION_CHUNK_PRODUCTS + 1)).toBe(
      REALISTIC_ROWS_PER_PRODUCT,
    );
    const interrupted = summaryRowCountFor(db, AGGREGATION_CHUNK_PRODUCTS + 2);
    expect(interrupted).toBeGreaterThan(0);
    expect(interrupted).toBeLessThan(REALISTIC_ROWS_PER_PRODUCT);
    for (let p = AGGREGATION_CHUNK_PRODUCTS + 3; p <= catalog; p++) {
      expect(summaryRowCountFor(db, p)).toBe(0);
    }

    // Tick 3 resumes STRICTLY after cursor N: the capture sees exactly
    // the interrupted chunk's products — completed products (1..N) are
    // never re-aggregated, the tail (2N+1..) is not touched early.
    const sink = { productIds: [] as number[] };
    const third = await handleTimeSeriesAggregation(env, LOG, {
      store,
      summaries: capturingSummaries(env.DB, sink),
    });
    expect([...new Set(sink.productIds)].sort((a, b) => a - b)).toEqual(
      Array.from(
        { length: AGGREGATION_CHUNK_PRODUCTS },
        (_, i) => AGGREGATION_CHUNK_PRODUCTS + 1 + i,
      ),
    );
    expect(third.products).toBe(AGGREGATION_CHUNK_PRODUCTS);
    expect(backfillCursorOf(db)).toBe(String(2 * AGGREGATION_CHUNK_PRODUCTS));

    // Tick 4 (the tail) wraps: watermark at the activity high water,
    // cursor deleted.
    const fourth = await handleTimeSeriesAggregation(env, LOG, { store });
    expect(fourth.products).toBe(catalog - 2 * AGGREGATION_CHUNK_PRODUCTS);
    expect(fourth.watermark).toBe(highWater);
    expect(watermarkOf(db)).toBe(highWater);
    expect(backfillCursorRowCount(db)).toBe(0);

    // The sequence converged, exactly-once: every active product has
    // exactly its 48 buckets — no duplicates from the re-done chunk.
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM price_history_summaries').get(),
    ).toEqual({ n: catalog * REALISTIC_ROWS_PER_PRODUCT });
    expect(
      db
        .prepare(
          'SELECT COUNT(DISTINCT product_id) AS n FROM price_history_summaries',
        )
        .get(),
    ).toEqual({ n: catalog });

    // ...and the CONTENT is byte-identical to a clean uninterrupted walk
    // of the same fixture — the re-done upserts converged on the same
    // values, nothing drifted while interrupted.
    const reference = createEnv();
    seedProducts(reference.db, ids(catalog));
    const { store: refStore, highWater: refHighWater } =
      realisticBackfillStore(catalog);
    const cleanWalk = await walkToWrap(reference.env, refStore);
    expect(cleanWalk).toHaveLength(3); // N, N, tail — no kill, no redo tick
    expect(cleanWalk[2].watermark).toBe(refHighWater);
    expect(summaryRows(db)).toEqual(summaryRows(reference.db));

    // An idempotent settled re-run over the converged state stays correct.
    await handleTimeSeriesAggregation(env, LOG, { store });
    expect(summaryRows(db)).toEqual(summaryRows(reference.db));
  }, 30_000);
});
