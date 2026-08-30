/**
 * D1PriceHistorySummaryRepository — real-SQLite tests (task 2.3) on the
 * node:sqlite harness with the committed migrations applied.
 *
 * The load-bearing case is the product-wide bucket (merchant NULL): SQLite
 * has no UNIQUE NULLS NOT DISTINCT, so the repository's `merchant IS ?`
 * upsert compensation is what makes job re-runs converge — this is the
 * documented gap from the 2.1 schema comments, closed in the repository
 * upsert path.
 *
 * @module D1PriceHistorySummaryRepositoryTest
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1PriceHistorySummaryRepository } from '../price-history-summary.repository';
import type { PriceHistorySummaryUpsertInput } from '../../../abstracts';

const { d1 } = openMigratedD1();
const repo = new D1PriceHistorySummaryRepository(d1);

/** One fully computed bucket, as the aggregation pure functions emit it. */
function bucket(overrides: Partial<PriceHistorySummaryUpsertInput> = {}): PriceHistorySummaryUpsertInput {
  return {
    granularity: 'daily',
    periodStart: '2026-08-24',
    productId: 7,
    merchant: 'systembolaget',
    priceOpenCents: 1099,
    priceCloseCents: 1149,
    priceMinCents: 1099,
    priceMaxCents: 1149,
    priceAvgCents: 1124,
    landedCostOpenCents: 2531,
    landedCostCloseCents: 2581,
    landedCostMinCents: 2531,
    landedCostMaxCents: 2581,
    landedCostAvgCents: 2556,
    observationCount: 4,
    strictestReliability: 'ESTIMATED',
    ...overrides,
  };
}

beforeAll(async () => {
  // The summaries table carries an FK to product_master — seed the parents.
  await d1
    .prepare(
      `INSERT INTO product_master (id, name, manufacturer, brand, category,
          unit_volume, container_type, regulatory_classification)
       VALUES (7, 'Karhu III', 'Hartwall', 'Karhu', 'beer', 0.33, 'metal', 'beer')`,
    )
    .run();
  await d1
    .prepare(
      `INSERT INTO product_master (id, name, manufacturer, brand, category,
          unit_volume, container_type, regulatory_classification)
       VALUES (8, 'Koff III', 'Sinebrychoff', 'Koff', 'beer', 0.33, 'metal', 'beer')`,
    )
    .run();
});

describe('D1PriceHistorySummaryRepository.upsertBucket', () => {
  it('inserts a new bucket and returns the assigned id', async () => {
    const result = await repo.upsertBucket(bucket());
    expect(result.id).toBeGreaterThan(0);

    const rows = await repo.findByProductRange(7, 'daily', '2026-08-24', '2026-08-24', 'systembolaget');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: result.id,
      granularity: 'daily',
      periodStart: '2026-08-24',
      productId: 7,
      merchant: 'systembolaget',
      priceOpenCents: 1099,
      priceCloseCents: 1149,
      priceAvgCents: 1124,
      observationCount: 4,
      strictestReliability: 'ESTIMATED',
    });
  });

  it('re-running the same bucket converges: same id, aggregates overwritten (last write wins)', async () => {
    const first = await repo.upsertBucket(bucket({ priceAvgCents: 1124, observationCount: 4 }));
    const second = await repo.upsertBucket(bucket({ priceCloseCents: 1199, priceMaxCents: 1199, priceAvgCents: 1149, observationCount: 5 }));

    expect(second.id).toBe(first.id);
    const rows = await repo.findByProductRange(7, 'daily', '2026-08-24', '2026-08-24', 'systembolaget');
    expect(rows).toHaveLength(1); // no duplicate — the job re-run converged
    expect(rows[0].priceCloseCents).toBe(1199);
    expect(rows[0].priceAvgCents).toBe(1149);
    expect(rows[0].observationCount).toBe(5);
  });

  it('compensates the UNIQUE NULLS NOT DISTINCT gap: product-wide buckets (merchant null) converge too', async () => {
    // On SQLite a plain ON CONFLICT (…, merchant) never matches the NULL
    // row — this upsert path is what prevents duplicate product-wide rows.
    const first = await repo.upsertBucket(bucket({ merchant: null, observationCount: 6 }));
    const second = await repo.upsertBucket(bucket({ merchant: null, observationCount: 7 }));

    expect(second.id).toBe(first.id);
    const rows = await repo.findByProductRange(7, 'daily', '2026-08-24', '2026-08-24');
    expect(rows).toHaveLength(1);
    expect(rows[0].merchant).toBeNull();
    expect(rows[0].observationCount).toBe(7);
  });

  it('keeps merchant buckets and the product-wide bucket as separate rows', async () => {
    await repo.upsertBucket(bucket({ periodStart: '2026-08-25', merchant: 'alko', priceOpenCents: 999 }));
    await repo.upsertBucket(bucket({ periodStart: '2026-08-25', merchant: null, priceOpenCents: 1050 }));

    const alko = await repo.findByProductRange(7, 'daily', '2026-08-25', '2026-08-25', 'alko');
    const wide = await repo.findByProductRange(7, 'daily', '2026-08-25', '2026-08-25');
    expect(alko).toHaveLength(1);
    expect(alko[0].priceOpenCents).toBe(999);
    expect(wide).toHaveLength(1);
    expect(wide[0].merchant).toBeNull();
    expect(wide[0].priceOpenCents).toBe(1050);
  });

  it('treats buckets at different granularities, days, or products as distinct keys', async () => {
    const base = { periodStart: '2026-08-26', merchant: null };
    await repo.upsertBucket(bucket({ ...base }));
    const daily = await repo.upsertBucket(bucket({ ...base, granularity: 'weekly', priceOpenCents: 1 }));
    const otherProduct = await repo.upsertBucket(bucket({ ...base, productId: 8, priceOpenCents: 2 }));
    expect(daily.id).not.toBe(otherProduct.id);

    // Re-upserting the daily/7 row must still hit ITS row, not the others.
    const again = await repo.upsertBucket(bucket({ ...base }));
    const all = await repo.findByProductRange(7, 'daily', '2026-08-26', '2026-08-26');
    expect(again.id).toBe(all[0].id);
    expect(all).toHaveLength(1);
  });
});

describe('D1PriceHistorySummaryRepository.findByProductRange', () => {
  it('reads a closed [from, to] range in ascending period order', async () => {
    await repo.upsertBucket(bucket({ periodStart: '2026-06-15', observationCount: 1 }));
    await repo.upsertBucket(bucket({ periodStart: '2026-06-01', observationCount: 2 }));
    await repo.upsertBucket(bucket({ periodStart: '2026-06-30', observationCount: 3 }));
    await repo.upsertBucket(bucket({ periodStart: '2026-07-01', observationCount: 4 })); // outside
    await repo.upsertBucket(bucket({ periodStart: '2026-05-31', observationCount: 5 })); // outside

    const rows = await repo.findByProductRange(7, 'daily', '2026-06-01', '2026-06-30', 'systembolaget');
    expect(rows.map((r) => r.periodStart)).toEqual(['2026-06-01', '2026-06-15', '2026-06-30']);
    expect(rows.map((r) => r.observationCount)).toEqual([2, 1, 3]);
  });

  it('applies binary merchant semantics — omitted merchant reads ONLY product-wide rows', async () => {
    await repo.upsertBucket(bucket({ periodStart: '2026-06-10', merchant: null, observationCount: 10 }));
    await repo.upsertBucket(bucket({ periodStart: '2026-06-10', merchant: 'alko', observationCount: 11 }));

    const wide = await repo.findByProductRange(7, 'daily', '2026-06-10', '2026-06-10');
    expect(wide.map((r) => r.observationCount)).toEqual([10]);

    const alko = await repo.findByProductRange(7, 'daily', '2026-06-10', '2026-06-10', 'alko');
    expect(alko.map((r) => r.observationCount)).toEqual([11]);

    const explicitNull = await repo.findByProductRange(7, 'daily', '2026-06-10', '2026-06-10', null);
    expect(explicitNull.map((r) => r.observationCount)).toEqual([10]);
  });
});
