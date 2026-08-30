/**
 * Time-series aggregation cron handler tests (task 4.3) — the
 * write-then-advance scan over a FAKE R2 store seeded with observation
 * JSONL objects, summary persistence + watermark advance against the
 * real D1 repositories on the fake-D1 harness, idempotent re-runs, and
 * the watermark-unchanged failure guarantee (background-jobs spec:
 * "Aggregation survives restart").
 *
 * @module TimeSeriesAggregationCronTest
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import {
  handleTimeSeriesAggregation,
  WATERMARK_KEY,
} from '../time-series-aggregation';
import type { R2ObservationLogStore } from '../../adapters/r2-observation-log.store';
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

describe('handleTimeSeriesAggregation over a fake R2 log', () => {
  it('aggregates daily + weekly buckets (per-merchant + product-wide) and advances the watermark', async () => {
    const { env, db } = createEnv();
    seedProducts(db, [7, 8]);
    // Two days, two merchants, price move on day 2 (open 1000 → close 1100).
    const store = createFakeStore({
      'observations/2026-08-28.jsonl': [
        record({ id: 1, productId: 7, merchant: 'alko', observedAt: '2026-08-28T10:00:00.000Z', priceCents: 1000 }),
        record({ id: 2, productId: 7, merchant: 'systembolaget', observedAt: '2026-08-28T12:00:00.000Z', priceCents: 1200 }),
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
