/**
 * D1SavingsSnapshotRepository — real-SQLite tests (task 1.1, change
 * insight-surfaces) on the node:sqlite harness with the committed
 * migrations applied.
 *
 * The load-bearing case is upsert idempotence on (as_of, product_id):
 * re-running the daily job must converge (same id, computed columns
 * overwritten, no duplicate row) — the D2 contract the insight surface's
 * correctness rests on. The CHECK rejection cases pin the reliability
 * and confidence value sets at the SQL boundary, not just in TypeScript.
 *
 * @module D1SavingsSnapshotRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1SavingsSnapshotRepository } from '../savings-snapshot.repository';
import type { D1DatabaseLike } from '../../../d1/executor';
import type { SavingsSnapshotUpsertInput } from '../../../abstracts';

/** Fresh migrated database + repo per test — findLatestDay reads the
 *  global MAX(as_of), so tests must not share one database. */
function makeRepo(): { d1: D1DatabaseLike; repo: D1SavingsSnapshotRepository } {
  const { d1 } = openMigratedD1();
  return { d1, repo: new D1SavingsSnapshotRepository(d1) };
}

async function seedProduct(d1: D1DatabaseLike, id: number): Promise<void> {
  // savings_snapshots carries an FK to product_master — seed the parent.
  await d1
    .prepare(
      `INSERT INTO product_master (id, name, manufacturer, brand, category,
          unit_volume, container_type, regulatory_classification)
       VALUES (?, 'Karhu III', 'Hartwall', 'Karhu', 'beer', 0.33, 'metal', 'beer')`,
    )
    .bind(id)
    .run();
}

/** One fully computed daily snapshot, as the insight job emits it. */
function snapshot(
  overrides: Partial<SavingsSnapshotUpsertInput> = {},
): SavingsSnapshotUpsertInput {
  return {
    asOf: '2026-09-01',
    productId: 7,
    category: 'beer',
    bestMerchant: 'eu-import',
    bestMerchantCountry: 'DE',
    bestPriceCents: 1099,
    bestObservedAt: new Date('2026-09-01T06:00:00.000Z'),
    alkoReferenceCents: 2599,
    alkoObservedAt: new Date('2026-09-01T05:30:00.000Z'),
    landedTotalCents: 1590,
    landedReliability: 'ESTIMATED',
    confidence: 'MEDIUM',
    gapCents: 1009,
    gapBasisPoints: 3882,
    taxDatasetVersion: '2026-01-01',
    ...overrides,
  };
}

describe('D1SavingsSnapshotRepository.upsertSnapshot', () => {
  it('inserts a new snapshot and returns the assigned id', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, 7);

    const result = await repo.upsertSnapshot(snapshot());
    expect(result.id).toBeGreaterThan(0);

    const rows = await repo.findByCategoryRange('beer', '2026-09-01', '2026-09-01');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: result.id,
      asOf: '2026-09-01',
      productId: 7,
      category: 'beer',
      bestMerchant: 'eu-import',
      bestMerchantCountry: 'DE',
      bestPriceCents: 1099,
      alkoReferenceCents: 2599,
      landedTotalCents: 1590,
      landedReliability: 'ESTIMATED',
      confidence: 'MEDIUM',
      gapCents: 1009,
      gapBasisPoints: 3882,
      taxDatasetVersion: '2026-01-01',
    });
    expect(rows[0].bestObservedAt).toEqual(new Date('2026-09-01T06:00:00.000Z'));
    expect(rows[0].alkoObservedAt).toEqual(new Date('2026-09-01T05:30:00.000Z'));
  });

  it('re-running the same (asOf, productId) converges: same id, computed columns overwritten, no duplicate', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, 7);

    const first = await repo.upsertSnapshot(snapshot({ gapCents: 1009, gapBasisPoints: 3882 }));
    const second = await repo.upsertSnapshot(
      snapshot({
        bestPriceCents: 1049,
        bestMerchant: 'systembolaget',
        bestMerchantCountry: 'SE',
        landedTotalCents: 1540,
        gapCents: 1059,
        gapBasisPoints: 4075,
        confidence: 'HIGH',
        landedReliability: 'VERIFIED',
      }),
    );

    expect(second.id).toBe(first.id);
    const rows = await repo.findByCategoryRange('beer', '2026-09-01', '2026-09-01');
    expect(rows).toHaveLength(1); // no duplicate — the job re-run converged
    expect(rows[0].bestPriceCents).toBe(1049);
    expect(rows[0].bestMerchant).toBe('systembolaget');
    expect(rows[0].landedReliability).toBe('VERIFIED');
    expect(rows[0].confidence).toBe('HIGH');
    expect(rows[0].gapBasisPoints).toBe(4075);
  });

  it('treats different days or products as distinct keys', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, 7);
    await seedProduct(d1, 8);

    const day1 = await repo.upsertSnapshot(snapshot());
    const day2 = await repo.upsertSnapshot(snapshot({ asOf: '2026-09-02' }));
    const product8 = await repo.upsertSnapshot(snapshot({ productId: 8, asOf: '2026-09-05' }));
    expect(new Set([day1.id, day2.id, product8.id]).size).toBe(3);

    // Re-upserting the 09-01/product-7 row must still hit ITS row.
    const again = await repo.upsertSnapshot(snapshot());
    expect(again.id).toBe(day1.id);
    const day1Rows = await repo.findByCategoryRange('beer', '2026-09-01', '2026-09-01');
    expect(day1Rows).toHaveLength(1);
  });

  it('persists null Alko reference as null — never a sentinel zero', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, 7);

    await repo.upsertSnapshot(
      snapshot({ alkoReferenceCents: null, alkoObservedAt: null, gapCents: 0, gapBasisPoints: 0 }),
    );
    const rows = await repo.findByCategoryRange('beer', '2026-09-01', '2026-09-01');
    expect(rows[0].alkoReferenceCents).toBeNull();
    expect(rows[0].alkoObservedAt).toBeNull();
  });
});

describe('D1SavingsSnapshotRepository.findLatestDay', () => {
  it('returns only the rows of the most recent asOf day, product_id ascending', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, 8);
    await seedProduct(d1, 7);

    await repo.upsertSnapshot(snapshot({ asOf: '2026-08-30', productId: 7 }));
    await repo.upsertSnapshot(snapshot({ asOf: '2026-08-31', productId: 7 }));
    await repo.upsertSnapshot(snapshot({ asOf: '2026-08-31', productId: 8, gapBasisPoints: 1000 }));
    // Newest day, two products — inserted out of id order on purpose.
    await repo.upsertSnapshot(snapshot({ asOf: '2026-09-01', productId: 8 }));
    await repo.upsertSnapshot(snapshot({ asOf: '2026-09-01', productId: 7 }));

    const latest = await repo.findLatestDay();
    expect(latest.map((r) => r.productId)).toEqual([7, 8]);
    expect(latest.every((r) => r.asOf === '2026-09-01')).toBe(true);
  });

  it('returns empty before any snapshot exists', async () => {
    const { repo } = makeRepo();
    expect(await repo.findLatestDay()).toEqual([]);
  });
});

describe('D1SavingsSnapshotRepository.findByCategoryRange', () => {
  it('reads a closed [from, to] range for one category in asOf order', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, 7);

    await repo.upsertSnapshot(snapshot({ asOf: '2026-06-15', productId: 7 }));
    await repo.upsertSnapshot(snapshot({ asOf: '2026-06-01', productId: 7 }));
    await repo.upsertSnapshot(snapshot({ asOf: '2026-06-30', productId: 7 }));
    await repo.upsertSnapshot(snapshot({ asOf: '2026-07-01', productId: 7 })); // outside
    await repo.upsertSnapshot(snapshot({ asOf: '2026-05-31', productId: 7 })); // outside

    const rows = await repo.findByCategoryRange('beer', '2026-06-01', '2026-06-30');
    expect(rows.map((r) => r.asOf)).toEqual(['2026-06-01', '2026-06-15', '2026-06-30']);
  });

  it('filters by category — other categories stay out', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, 7);
    await d1
      .prepare(
        `INSERT INTO product_master (id, name, manufacturer, brand, category,
            unit_volume, container_type, regulatory_classification)
         VALUES (9, 'Viinaa', 'Anora', 'Koskenkorva', 'spirits', 0.5, 'glass', 'spirits')`,
      )
      .run();
    await repo.upsertSnapshot(snapshot({ productId: 7, category: 'beer' }));
    await repo.upsertSnapshot(snapshot({ productId: 9, category: 'spirits', gapBasisPoints: 900 }));

    const beers = await repo.findByCategoryRange('beer', '2026-09-01', '2026-09-01');
    expect(beers).toHaveLength(1);
    expect(beers[0].category).toBe('beer');
  });
});

describe('savings_snapshots CHECK constraints', () => {
  it.each(['INVALID', 'verified', ''])(
    'rejects landed_reliability outside the value set (%s)',
    async (bad) => {
      const { d1, repo } = makeRepo();
      await seedProduct(d1, 7);
      await repo.upsertSnapshot(snapshot());

      await expect(
        d1
          .prepare(
            `UPDATE savings_snapshots SET landed_reliability = ? WHERE as_of = '2026-09-01'`,
          )
          .bind(bad)
          .run(),
      ).rejects.toThrow(/CHECK/i);
    },
  );

  it('rejects confidence outside the HIGH/MEDIUM/LOW value set', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, 7);
    await repo.upsertSnapshot(snapshot());

    await expect(
      d1
        .prepare(`UPDATE savings_snapshots SET confidence = 'CERTAIN' WHERE as_of = '2026-09-01'`)
        .run(),
    ).rejects.toThrow(/CHECK/i);
  });

  it('rejects a duplicate (as_of, product_id) — the idempotency key is unique', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, 7);
    await repo.upsertSnapshot(snapshot());

    await expect(
      d1
        .prepare(
          `INSERT INTO savings_snapshots (as_of, product_id, category, best_merchant,
              best_merchant_country, best_price_cents, best_observed_at,
              landed_total_cents, landed_reliability, confidence, gap_cents,
              gap_basis_points, tax_dataset_version)
           VALUES ('2026-09-01', 7, 'beer', 'x', 'DE', 1, '2026-09-01T00:00:00.000Z',
                   1, 'VERIFIED', 'HIGH', 1, 1, 'x')`,
        )
        .run(),
    ).rejects.toThrow(/UNIQUE/i);
  });
});
