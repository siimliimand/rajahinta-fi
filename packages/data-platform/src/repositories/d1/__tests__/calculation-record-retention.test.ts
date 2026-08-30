/**
 * D1CalculationRecordRetentionService — real-SQLite tests (task 2.5,
 * design D4 as amended by gate review G1). Proves the anonymous 30-day
 * semantics, the ALL-records age cap (default 180, config-driven),
 * bounded batch deletes (batchSize respected, loop terminates), and the
 * sweep of both calculation-record tables.
 *
 * @module D1CalculationRecordRetentionTest
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1CalculationRecordRetentionService } from '../calculation-record-retention';

// Fresh migrated DB per test: the sweeps delete broadly, so a shared
// database would let one test's leftovers bleed into the next counts.
let db: ReturnType<typeof openMigratedD1>['db'];
let d1: ReturnType<typeof openMigratedD1>['d1'];
let retention: D1CalculationRecordRetentionService;

beforeEach(() => {
  ({ db, d1 } = openMigratedD1());
  retention = new D1CalculationRecordRetentionService(d1);
});

const NOW = new Date('2026-08-28T04:30:00.000Z');

afterEach(() => {
  delete process.env.CALCULATION_RECORD_RETENTION_DAYS;
  delete process.env.CALCULATION_RECORD_AGE_CAP_DAYS;
});

let productSeq = 900;
function seedProduct(): number {
  const id = ++productSeq;
  db.prepare(
    `INSERT INTO product_master (id, name, manufacturer, brand, category, unit_volume, container_type, regulatory_classification)
     VALUES (?, ?, 'm', 'b', 'beer', 0.5, 'can', 'beer')`,
  ).run(id, `product-${id}`);
  return id;
}

let recordSeq = 0;
function seedRecord(overrides: {
  sessionId?: string | null;
  calculatedAt: string;
  basket?: boolean;
}): void {
  const productId = seedProduct();
  if (overrides.basket) {
    db.prepare(
      `INSERT INTO basket_calculation_records (id, session_id, destination, transport_arrangement, input_basket, shipment_breakdown, total_cents, confidence, disclaimer, created_at)
       VALUES (?, ?, 'FI', 'delivery', '[]', '[]', 500, 'HIGH', 'd', ?)`,
    ).run(++recordSeq, overrides.sessionId ?? null, overrides.calculatedAt);
  } else {
    db.prepare(
      `INSERT INTO calculation_records (id, product_master_id, total_cents, breakdown, confidence, quantity, destination, disclaimer, session_id, calculated_at)
       VALUES (?, ?, 500, '{}', 'HIGH', 1, 'FI', 'd', ?, ?)`,
    ).run(++recordSeq, productId, overrides.sessionId ?? null, overrides.calculatedAt);
  }
}

function countRows(table: string, where = ''): number {
  return (db.prepare(`SELECT count(*) AS n FROM ${table} ${where}`).get() as { n: number }).n;
}

describe('D1CalculationRecordRetentionService', () => {
  it('prunes anonymous rows with the default 30-day window, keeping everything newer', async () => {
    seedRecord({ calculatedAt: '2026-06-01T00:00:00.000Z' }); // anonymous, 88 days old → pruned
    seedRecord({ calculatedAt: '2026-08-20T00:00:00.000Z' }); // anonymous, fresh → kept
    seedRecord({ sessionId: 'sess-old', calculatedAt: '2026-06-01T00:00:00.000Z' }); // session-bearing → kept by anon pass

    const result = await retention.runRetention({ now: NOW });

    const expectedCutoff = new Date(NOW.getTime() - 30 * 86_400_000);
    expect(result.anonymousCutoff.toISOString()).toBe(expectedCutoff.toISOString());
    expect(result.prunedAnonymous['calculation_records']).toBe(1);
    expect(result.prunedAnonymous['basket_calculation_records']).toBe(0);
    expect(countRows('calculation_records')).toBe(2);
  });

  it('honours the configured anonymous window from the environment', async () => {
    process.env.CALCULATION_RECORD_RETENTION_DAYS = '7';
    seedRecord({ calculatedAt: new Date(NOW.getTime() - 8 * 86_400_000).toISOString() });
    seedRecord({ calculatedAt: new Date(NOW.getTime() - 6 * 86_400_000).toISOString() });

    const result = await retention.runRetention({ now: NOW });
    expect(result.anonymousCutoff.toISOString()).toBe(
      new Date(NOW.getTime() - 7 * 86_400_000).toISOString(),
    );
    expect(result.prunedAnonymous['calculation_records']).toBe(1);
  });

  it('falls back to the defaults on invalid environment values', async () => {
    process.env.CALCULATION_RECORD_RETENTION_DAYS = 'zero';
    process.env.CALCULATION_RECORD_AGE_CAP_DAYS = '-5';

    const result = await retention.runRetention({ now: NOW });
    expect(result.anonymousCutoff.toISOString()).toBe(
      new Date(NOW.getTime() - 30 * 86_400_000).toISOString(),
    );
    expect(result.ageCapCutoff.toISOString()).toBe(
      new Date(NOW.getTime() - 180 * 86_400_000).toISOString(),
    );
  });

  it('age-caps ALL records — session-bearing rows included (gate decision, replaces never-prune)', async () => {
    seedRecord({ sessionId: 'sess-ancient', calculatedAt: '2025-12-01T00:00:00.000Z' }); // 270 days old
    seedRecord({ sessionId: 'sess-recent', calculatedAt: new Date(NOW.getTime() - 100 * 86_400_000).toISOString() }); // inside the 180d cap

    const result = await retention.runRetention({ now: NOW });

    expect(result.ageCapCutoff.toISOString()).toBe(
      new Date(NOW.getTime() - 180 * 86_400_000).toISOString(),
    );
    expect(result.ageCapped['calculation_records']).toBe(1);
    expect(countRows('calculation_records', "WHERE session_id = 'sess-ancient'")).toBe(0);
    expect(countRows('calculation_records', "WHERE session_id = 'sess-recent'")).toBe(1);
  });

  it('honours a configured age cap', async () => {
    process.env.CALCULATION_RECORD_AGE_CAP_DAYS = '90';
    seedRecord({ sessionId: 'sess-90', calculatedAt: new Date(NOW.getTime() - 91 * 86_400_000).toISOString() });
    seedRecord({ sessionId: 'sess-89', calculatedAt: new Date(NOW.getTime() - 89 * 86_400_000).toISOString() });

    const result = await retention.runRetention({ now: NOW });
    expect(result.ageCapped['calculation_records']).toBe(1);
    expect(countRows('calculation_records', "WHERE session_id = 'sess-89'")).toBe(1);
  });

  it('sweeps both calculation-record tables', async () => {
    seedRecord({ calculatedAt: '2026-05-01T00:00:00.000Z' });
    seedRecord({ calculatedAt: '2026-05-01T00:00:00.000Z', basket: true });

    const result = await retention.runRetention({ now: NOW });
    expect(result.prunedAnonymous['calculation_records']).toBe(1);
    expect(result.prunedAnonymous['basket_calculation_records']).toBe(1);
    expect(countRows('calculation_records')).toBe(0);
    expect(countRows('basket_calculation_records')).toBe(0);
  });

  it('deletes in bounded batches and terminates when a batch comes back short', async () => {
    // 7 rows past every window; batchSize 3 → batches of 3+3+1.
    for (let i = 0; i < 7; i++) {
      seedRecord({ calculatedAt: '2026-05-01T00:00:00.000Z' });
    }

    const result = await retention.runRetention({ now: NOW, batchSize: 3 });
    expect(result.batchSize).toBe(3);
    expect(result.prunedAnonymous['calculation_records']).toBe(7);
    expect(countRows('calculation_records')).toBe(0);
  });

  it('rejects a non-positive batch size up front', async () => {
    await expect(retention.runRetention({ now: NOW, batchSize: 0 })).rejects.toThrow(RangeError);
  });

  it('is idempotent — a second sweep deletes nothing', async () => {
    seedRecord({ calculatedAt: '2026-05-01T00:00:00.000Z' });
    await retention.runRetention({ now: NOW });
    const second = await retention.runRetention({ now: NOW });

    expect(second.prunedAnonymous['calculation_records']).toBe(0);
    expect(second.ageCapped['calculation_records']).toBe(0);
  });
});
