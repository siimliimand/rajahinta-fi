/**
 * D1ProductDimensionsRepository — real-SQLite tests (task 3.1, change
 * product-roadmap-phases-1-4) on the node:sqlite harness with the
 * committed migrations applied. Covers the designed absence state, the
 * replace-on-observation upsert (one row per product), the batch load the
 * packing optimizer reads from, the provenance defaults, and the
 * schema-level guards (closed material/reliability sets, positive
 * dimensions, product FK).
 *
 * @module D1ProductDimensionsRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1ProductDimensionsRepository } from '../product-dimensions.repository';

const { db, d1 } = openMigratedD1();
const repo = new D1ProductDimensionsRepository(d1);

let productIdSeq = 700;
async function seedProduct(): Promise<number> {
  const id = ++productIdSeq;
  db.prepare(
    `INSERT INTO product_master (id, name, manufacturer, brand, category, unit_volume, container_type, regulatory_classification)
     VALUES (?, ?, 'm', 'b', 'beer', 0.5, 'glass', 'beer')`,
  ).run(id, `product-${id}`);
  return id;
}

describe('D1ProductDimensionsRepository', () => {
  it('returns null when no dimensions are known — absence is the normal state, never a default', async () => {
    await expect(repo.findByProductId(999_999)).resolves.toBeNull();
  });

  it('upserts a new row with full provenance and round-trips it', async () => {
    const productId = await seedProduct();
    const observedAt = new Date('2026-08-15T10:00:00.000Z');

    const row = await repo.upsert({
      productId,
      weightG: 520,
      heightMm: 235,
      diameterMm: 65,
      material: 'GLASS',
      source: 'operator-measured',
      reliabilityStatus: 'VERIFIED',
      observedAt,
    });

    expect(row.id).toBeGreaterThan(0);
    expect(row.productId).toBe(productId);
    expect(row.weightG).toBe(520);
    expect(row.heightMm).toBe(235);
    expect(row.diameterMm).toBe(65);
    expect(row.material).toBe('GLASS');
    expect(row.source).toBe('operator-measured');
    expect(row.reliabilityStatus).toBe('VERIFIED');
    expect(row.observedAt).toEqual(observedAt);

    await expect(repo.findByProductId(productId)).resolves.toEqual(row);
  });

  it('defaults reliabilityStatus to ESTIMATED and observedAt to the current instant', async () => {
    const productId = await seedProduct();
    const before = new Date();

    const row = await repo.upsert({
      productId,
      weightG: 190,
      heightMm: 122,
      diameterMm: 66,
      material: 'CAN',
      source: 'carrier-sheet',
    });

    expect(row.reliabilityStatus).toBe('ESTIMATED');
    expect(row.observedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 5_000);
  });

  it('replaces every observation column on conflict — a new observation supersedes, never appends', async () => {
    const productId = await seedProduct();
    await repo.upsert({
      productId,
      weightG: 520,
      heightMm: 235,
      diameterMm: 65,
      material: 'GLASS',
      source: 'operator-measured',
      reliabilityStatus: 'VERIFIED',
      observedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    const refreshed = new Date('2026-08-20T08:00:00.000Z');

    const updated = await repo.upsert({
      productId,
      weightG: 525,
      heightMm: 236,
      diameterMm: 65,
      material: 'GLASS',
      source: 're-measured',
      reliabilityStatus: 'STALE',
      observedAt: refreshed,
    });

    expect(updated.weightG).toBe(525);
    expect(updated.heightMm).toBe(236);
    expect(updated.source).toBe('re-measured');
    expect(updated.reliabilityStatus).toBe('STALE');
    expect(updated.observedAt).toEqual(refreshed);

    // Still exactly one row for the product — replace, not history.
    const count = db
      .prepare('SELECT count(*) AS n FROM product_dimensions WHERE product_id = ?')
      .get(productId) as { n: number };
    expect(count.n).toBe(1);
  });

  it('batch-loads by product ids: only known ids returned, deterministic order, empty input short-circuits', async () => {
    const first = await seedProduct();
    const second = await seedProduct();
    const third = await seedProduct();
    await repo.upsert({
      productId: first,
      weightG: 520,
      heightMm: 235,
      diameterMm: 65,
      material: 'GLASS',
      source: 'operator-measured',
    });
    await repo.upsert({
      productId: third,
      weightG: 190,
      heightMm: 122,
      diameterMm: 66,
      material: 'CAN',
      source: 'operator-measured',
    });

    // second has no row: it is simply absent from the result (design R3).
    const rows = await repo.findByProductIds([third, second, first, 999_999]);
    expect(rows.map((r) => r.productId)).toEqual([first, third]);

    await expect(repo.findByProductIds([])).resolves.toEqual([]);
  });

  it('rejects a material outside the closed value set at the schema level', async () => {
    const productId = await seedProduct();
    await expect(
      repo.upsert({
        productId,
        weightG: 520,
        heightMm: 235,
        diameterMm: 65,
        material: 'CARDBOARD' as never,
        source: 'operator-measured',
      }),
    ).rejects.toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO product_dimensions (product_id, weight_g, height_mm, diameter_mm, material, source)
           VALUES (?, 520, 235, 65, 'bottle', 'check-guard')`,
        )
        .run(productId),
    ).toThrow();
  });

  it('rejects a reliability status outside the shared vocabulary at the schema level', async () => {
    const productId = await seedProduct();
    expect(() =>
      db
        .prepare(
          `INSERT INTO product_dimensions (product_id, weight_g, height_mm, diameter_mm, material, source, reliability_status)
           VALUES (?, 520, 235, 65, 'GLASS', 'check-guard', 'EXACT')`,
        )
        .run(productId),
    ).toThrow();
  });

  it('rejects non-positive weight, height, and diameter at the schema level', async () => {
    const productId = await seedProduct();
    const base = {
      weightG: 520,
      heightMm: 235,
      diameterMm: 65,
      material: 'GLASS' as const,
      source: 'operator-measured',
    };
    for (const zeroed of [
      { ...base, weightG: 0 },
      { ...base, weightG: -1 },
      { ...base, heightMm: 0 },
      { ...base, diameterMm: 0 },
    ]) {
      await expect(repo.upsert({ productId, ...zeroed })).rejects.toThrow();
    }
  });

  it('rejects a dimension row for an unknown product (FK)', async () => {
    await expect(
      repo.upsert({
        productId: 999_998,
        weightG: 520,
        heightMm: 235,
        diameterMm: 65,
        material: 'GLASS',
        source: 'operator-measured',
      }),
    ).rejects.toThrow();
  });
});
