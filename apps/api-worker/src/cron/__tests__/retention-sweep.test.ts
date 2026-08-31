/**
 * Retention-sweep cron handler tests (task 4.3) — the D1 retention
 * service (task 2.5) driven through the cron handler over the fake-D1
 * harness: anonymous 30-day window, the 180-day age cap, and bounded
 * batch deletes (background-jobs spec: "Retention prunes in bounded
 * batches").
 *
 * @module RetentionSweepCronTest
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { handleRetentionSweep } from '../retention-sweep';
import { openMigratedD1 } from '../../analytics/__tests__/fake-d1';
import { createLogger } from '../../logger';
import type { Env } from '../../env';

const LOG = createLogger('error');

const NOW = new Date('2026-08-30T03:30:00.000Z');
const DAY = 86_400_000;

function createEnv(): { env: Env; db: DatabaseSync } {
  const { db, d1 } = openMigratedD1();
  // calculation_records.product_master_id carries an FK — seed the product.
  db.prepare(
    `INSERT INTO product_master
       (id, name, manufacturer, brand, category, unit_volume, container_type,
        regulatory_classification)
     VALUES (1, 'Product 1', 'Brewery', 'Brand', 'beer', 0.33, 'can', 'M500')`,
  ).run();
  return { env: { DB: d1 } as unknown as Env, db };
}

function seedCalculationRecord(
  db: DatabaseSync,
  id: number,
  opts: {
    sessionId: string | null;
    calculatedAt: Date;
  },
): void {
  db.prepare(
    `INSERT INTO calculation_records
       (id, product_master_id, total_cents, breakdown, confidence, quantity,
        destination, disclaimer, session_id, calculated_at)
     VALUES (?, 1, 100, '{}', 'HIGH', 1, 'FI', 'test', ?, ?)`,
  ).run(id, opts.sessionId, opts.calculatedAt.toISOString());
}

function rowIds(db: DatabaseSync, table = 'calculation_records'): number[] {
  return (
    db.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as { id: number }[]
  ).map((row) => row.id);
}

describe('handleRetentionSweep (D1CalculationRecordRetentionService)', () => {
  it('prunes anonymous rows past 30 days, keeps session rows inside the age cap', async () => {
    const { env, db } = createEnv();
    // Anonymous: 40 days old (prune), 1 day old (keep).
    seedCalculationRecord(db, 1, { sessionId: null, calculatedAt: new Date(+NOW - 40 * DAY) });
    seedCalculationRecord(db, 2, { sessionId: null, calculatedAt: new Date(+NOW - 1 * DAY) });
    // Session-bearing: 40 days old (KEEP — inside the 180-day cap).
    seedCalculationRecord(db, 3, { sessionId: 's-1', calculatedAt: new Date(+NOW - 40 * DAY) });

    const result = await handleRetentionSweep(env, LOG, { now: NOW, batchSize: 2 });

    expect(result.prunedAnonymous.calculation_records).toBe(1);
    expect(result.ageCapped.calculation_records).toBe(0);
    expect(rowIds(db)).toEqual([2, 3]);
  });

  it('age-caps ALL records (session-bearing included) past the configured cap', async () => {
    const { env, db } = createEnv();
    // Session-bearing: 200 days old (past the 180-day cap → delete),
    // 100 days old (inside → keep).
    seedCalculationRecord(db, 1, { sessionId: 's-old', calculatedAt: new Date(+NOW - 200 * DAY) });
    seedCalculationRecord(db, 2, { sessionId: 's-mid', calculatedAt: new Date(+NOW - 100 * DAY) });
    seedCalculationRecord(db, 3, { sessionId: null, calculatedAt: new Date(+NOW - 200 * DAY) });

    const result = await handleRetentionSweep(env, LOG, { now: NOW });

    expect(result.prunedAnonymous.calculation_records).toBe(1);
    expect(result.ageCapped.calculation_records).toBe(1);
    expect(rowIds(db)).toEqual([2]);
    expect(result.anonymousCutoff).toEqual(new Date(+NOW - 30 * DAY));
    expect(result.ageCapCutoff).toEqual(new Date(+NOW - 180 * DAY));
  });

  it('deletes in multiple bounded batches when more rows are past the window than one batch allows', async () => {
    const { env, db } = createEnv();
    // 7 anonymous rows past the window; batch size 2 → 2 full batches +
    // 1 short batch, no statement-limit failure.
    for (let i = 1; i <= 7; i++) {
      seedCalculationRecord(db, i, {
        sessionId: null,
        calculatedAt: new Date(+NOW - (40 + i) * DAY),
      });
    }

    const result = await handleRetentionSweep(env, LOG, { now: NOW, batchSize: 2 });

    expect(result.prunedAnonymous.calculation_records).toBe(7);
    expect(result.batchSize).toBe(2);
    expect(rowIds(db)).toEqual([]);
  });

  it('sweeps basket_calculation_records with the same windows', async () => {
    const { env, db } = createEnv();
    db.prepare(
      `INSERT INTO basket_calculation_records
         (id, session_id, destination, transport_arrangement, input_basket,
          shipment_breakdown, total_cents, confidence, disclaimer, created_at)
       VALUES (?, ?, 'FI', 'delivery', '[]', '[]', 100, 'HIGH', 'test', ?)`,
    ).run(1, null, new Date(+NOW - 60 * DAY).toISOString());
    db.prepare(
      `INSERT INTO basket_calculation_records
         (id, session_id, destination, transport_arrangement, input_basket,
          shipment_breakdown, total_cents, confidence, disclaimer, created_at)
       VALUES (?, 's-1', 'FI', 'delivery', '[]', '[]', 100, 'HIGH', 'test', ?)`,
    ).run(2, new Date(+NOW - 60 * DAY).toISOString());

    await handleRetentionSweep(env, LOG, { now: NOW });

    expect(rowIds(db, 'basket_calculation_records')).toEqual([2]);
  });

  it('honors wrangler-var overrides for both windows', async () => {
    const { env, db } = createEnv();
    // Anonymous row 10 days old: inside the default 30-day window but
    // past a 7-day override.
    seedCalculationRecord(db, 1, { sessionId: null, calculatedAt: new Date(+NOW - 10 * DAY) });

    const result = await handleRetentionSweep(env, LOG, {
      now: NOW,
      retentionDays: 7,
      ageCapDays: 90,
    });

    expect(result.prunedAnonymous.calculation_records).toBe(1);
    expect(result.anonymousCutoff).toEqual(new Date(+NOW - 7 * DAY));
    expect(result.ageCapCutoff).toEqual(new Date(+NOW - 90 * DAY));
  });
});
