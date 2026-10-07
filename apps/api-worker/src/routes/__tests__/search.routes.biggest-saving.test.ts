/**
 * BIGGEST_SAVING default-order contract tests (task 1.2, change
 * savings-first-catalog-and-prefill) over the FULL app composition
 * (createApp()) on the fake-D1 harness.
 *
 * Pinning: the absent sort resolves to the savings-first order — covered
 * rows (a latest-materialized-day snapshot row exists) by gap basis
 * points ascending with the FI-collated name and the product id as
 * deterministic ties, uncovered rows strictly after every covered row and
 * alphabetical among themselves; explicit sort=BIGGEST_SAVING is the same
 * order; the explicit ALPHABETICAL contract is unchanged (tiers dissolved
 * into plain name order); an unknown sort stays a 400 contract error; the
 * same data renders byte-identical order on repeat; and the page slice
 * cuts the ONE full-set order (savers never repeat, uncovered never
 * surface early on a later page).
 *
 * @module SearchRoutesBiggestSavingTest
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import {
  buildApp,
  openMigratedD1,
  permissiveEnv,
  request,
  seedProduct,
  expectEnvelope,
} from './harness';
import { D1SavingsSnapshotRepository } from '../../../../../packages/data-platform/src/repositories/d1/savings-snapshot.repository';
import type { SavingsSnapshotUpsertInput } from '../../../../../packages/data-platform/src/abstracts';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

const AGE = { 'x-age-confirmed': 'confirmed' };

const AS_OF = '2026-09-08';

interface SearchJson {
  items: Array<{ id: number; savings?: unknown }>;
  total: number;
  totalPages: number;
  savingsAsOf: string | null;
}

/** One fully computed daily snapshot — only the gap matters to ordering. */
function snapshotInput(
  productId: number,
  gapBasisPoints: number,
): SavingsSnapshotUpsertInput {
  return {
    asOf: AS_OF,
    productId,
    category: 'beer',
    bestMerchant: 'eu-import',
    bestMerchantCountry: 'DE',
    bestPriceCents: 1099,
    bestObservedAt: new Date(`${AS_OF}T06:00:00.000Z`),
    alkoReferenceCents: 2599,
    alkoObservedAt: new Date(`${AS_OF}T05:30:00.000Z`),
    landedTotalCents: 1590,
    landedReliability: 'ESTIMATED',
    confidence: 'MEDIUM',
    gapCents: -1009,
    gapBasisPoints,
    taxDatasetVersion: 'v3.0-2026',
    referenceLinkId: null,
  };
}

async function seedSnapshots(
  d1: D1DatabaseLike,
  inputs: readonly SavingsSnapshotUpsertInput[],
): Promise<void> {
  const repo = new D1SavingsSnapshotRepository(d1);
  for (const input of inputs) {
    await repo.upsertSnapshot(input);
  }
}

/**
 * The tie-break fixture — ids deliberately scrambled against names so a
 * name-ordered assertion can never pass by id luck:
 *
 * | id | name  | gap bps | covered |
 * |----|-------|---------|---------|
 * | 1  | Delta | -2000   | yes     |
 * | 20 | alpha | -1000   | yes     |
 * | 3  | Beta  | -1000   | yes     |  equal gap → FI name: alpha < Beta
 * | 9  | Twin  | -500    | yes     |
 * | 4  | Twin  | -500    | yes     |  equal name+gap → id: 4 < 9
 * | 30 | Zeta  | —       | no      |
 * | 7  | Ana   | —       | no      |  uncovered alphabetical: Ana < Zeta
 */
function seedTieBreakCatalog(db: DatabaseSync): void {
  seedProduct(db, { id: 1, name: 'Delta', category: 'beer' });
  seedProduct(db, { id: 20, name: 'alpha', category: 'beer' });
  seedProduct(db, { id: 3, name: 'Beta', category: 'beer' });
  seedProduct(db, { id: 9, name: 'Twin', category: 'beer' });
  seedProduct(db, { id: 4, name: 'Twin', category: 'beer' });
  seedProduct(db, { id: 30, name: 'Zeta', category: 'beer' });
  seedProduct(db, { id: 7, name: 'Ana', category: 'beer' });
}

function seedTieBreakSnapshots(d1: D1DatabaseLike): Promise<void> {
  return seedSnapshots(d1, [
    snapshotInput(1, -2000),
    snapshotInput(20, -1000),
    snapshotInput(3, -1000),
    snapshotInput(9, -500),
    snapshotInput(4, -500),
  ]);
}

async function getProducts(
  d1: D1DatabaseLike,
  query = '',
): Promise<SearchJson> {
  const res = await request(buildApp(), permissiveEnv(d1), `/api/v1/products${query}`, {
    headers: AGE,
  });
  expect(res.status).toBe(200);
  return (await res.json()) as SearchJson;
}

function idsOf(body: SearchJson): number[] {
  return body.items.map((item) => item.id);
}

describe('GET /api/v1/products — BIGGEST_SAVING default order (task 1.2, savings-first-catalog-and-prefill)', () => {
  it('absent sort orders by gap ascending with FI-name then id tie-breaks, uncovered last alphabetical', async () => {
    const { db, d1 } = openMigratedD1();
    seedTieBreakCatalog(db);
    await seedTieBreakSnapshots(d1);

    const body = await getProducts(d1);
    // Delta (-2000) leads; the -1000 pair breaks by FI name (alpha, Beta
    // — not id 3, 20); the equal-name -500 pair breaks by id (4, 9);
    // the uncovered pair follows every covered row, alphabetical.
    expect(idsOf(body)).toEqual([1, 20, 3, 4, 9, 7, 30]);
    expect(body.savingsAsOf).toBe(AS_OF);
  });

  it('a positive gap (dearer than Alko) is still covered and sorts after the savers', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Kevyt', category: 'beer' });
    seedProduct(db, { id: 2, name: 'Kallis', category: 'beer' });
    seedProduct(db, { id: 3, name: 'Ei-vuoroa', category: 'beer' });
    await seedSnapshots(d1, [
      snapshotInput(1, -1500),
      snapshotInput(2, 250),
    ]);

    const body = await getProducts(d1);
    // Ascending gap: the negative gap first, the dearer-than-Alko row
    // second (covered, stated factually), the uncovered row last.
    expect(idsOf(body)).toEqual([1, 2, 3]);
    expect(body.items[1]!.savings).toBeDefined();
    expect(body.items[2]!.savings).toBeUndefined();
  });

  it('uncovered rows come strictly after covered rows — alphabetical among themselves, not globally', async () => {
    const { db, d1 } = openMigratedD1();
    // The covered row's name sorts LAST globally — pure alphabetical
    // would put it third; the tier boundary must precede name order.
    seedProduct(db, { id: 1, name: 'Vee', category: 'beer' });
    seedProduct(db, { id: 2, name: 'Aaa', category: 'beer' });
    seedProduct(db, { id: 3, name: 'Boo', category: 'beer' });
    await seedSnapshots(d1, [snapshotInput(1, -1)]);

    const body = await getProducts(d1);
    expect(idsOf(body)).toEqual([1, 2, 3]);
  });

  it('explicit BIGGEST_SAVING is the same order as the absent default', async () => {
    const { db, d1 } = openMigratedD1();
    seedTieBreakCatalog(db);
    await seedTieBreakSnapshots(d1);

    const absent = await getProducts(d1);
    const explicit = await getProducts(d1, '?sort=BIGGEST_SAVING');
    expect(idsOf(explicit)).toEqual(idsOf(absent));
  });

  it('explicit ALPHABETICAL is unchanged — plain FI name order, tiers dissolved', async () => {
    const { db, d1 } = openMigratedD1();
    seedTieBreakCatalog(db);
    await seedTieBreakSnapshots(d1);

    const body = await getProducts(d1, '?sort=ALPHABETICAL');
    // Every product by FI-collated name — covered and uncovered
    // interleaved (alpha, Ana, Beta, Delta, Twin, Twin, Zeta); no gap
    // and no tier may influence the explicit contract.
    expect(idsOf(body)).toEqual([20, 7, 3, 1, 4, 9, 30]);
  });

  it('an unknown sort value is still a 400 contract error naming the full valid set', async () => {
    const { d1 } = openMigratedD1();
    const res = await request(
      buildApp(),
      permissiveEnv(d1),
      '/api/v1/products?sort=PROMOTED',
      { headers: AGE },
    );
    await expectEnvelope(res, 400, {
      message:
        "Unknown sort 'PROMOTED'. Valid sort orders: ALPHABETICAL, LOWEST_PRICE, ALCOHOL_PERCENTAGE, BIGGEST_SAVING.",
    });
  });

  it('the same data renders byte-identical order on repeat', async () => {
    const { db, d1 } = openMigratedD1();
    seedTieBreakCatalog(db);
    await seedTieBreakSnapshots(d1);

    const first = await getProducts(d1);
    const second = await getProducts(d1);
    expect(JSON.stringify(second.items)).toBe(JSON.stringify(first.items));
  });

  it('the page slice cuts the one full-set order — later pages continue it without repeats', async () => {
    const { db, d1 } = openMigratedD1();
    seedTieBreakCatalog(db);
    await seedTieBreakSnapshots(d1);

    const page1 = await getProducts(d1, '?limit=3&page=1');
    const page2 = await getProducts(d1, '?limit=3&page=2');
    const page3 = await getProducts(d1, '?limit=3&page=3');

    // Exact total regardless of the slice (the full key list's length).
    for (const page of [page1, page2, page3]) {
      expect(page.total).toBe(7);
      expect(page.totalPages).toBe(3);
    }
    expect(idsOf(page1)).toEqual([1, 20, 3]);
    expect(idsOf(page2)).toEqual([4, 9, 7]);
    expect(idsOf(page3)).toEqual([30]);
  });
});
