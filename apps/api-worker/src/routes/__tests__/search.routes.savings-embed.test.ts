/**
 * Catalog savings-embed contract tests (task 1.1, change
 * savings-first-catalog-and-prefill) over the FULL app composition
 * (createApp() — the exact composition index.ts wires) on the fake-D1
 * harness.
 *
 * Pinning: the display-only `savings` embed attaches to every listed
 * item with a latest-materialized-day snapshot row on EVERY path that
 * serves items (browse, ids, ranked-q) and for EVERY sort order; items
 * without a row for that day omit the embed entirely — no placeholder,
 * no zero; the response always carries `savingsAsOf` (null before the
 * first materialization); only the latest day feeds the embed (an
 * older-day row is invisible); and the embed is exactly the six contract
 * figures — no snapshot provenance leaks. Ordering is a different task's
 * subject (1.2) and is not asserted here beyond untouched absence.
 *
 * @module SearchRoutesSavingsEmbedTest
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import {
  buildApp,
  openMigratedD1,
  permissiveEnv,
  request,
  seedProduct,
} from './harness';
import { D1SavingsSnapshotRepository } from '../../../../../packages/data-platform/src/repositories/d1/savings-snapshot.repository';
import type { SavingsSnapshotUpsertInput } from '../../../../../packages/data-platform/src/abstracts';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

const AGE = { 'x-age-confirmed': 'confirmed' };

const AS_OF = '2026-09-08';
const DAY_BEFORE = '2026-09-07';

interface SavingsEmbedJson {
  landedTotalCents: number;
  alkoReferenceCents: number | null;
  gapCents: number;
  gapBasisPoints: number;
  reliability: string;
  confidence: string;
}

interface SearchItemJson {
  id: number;
  savings?: SavingsEmbedJson;
}

interface SearchJson {
  items: SearchItemJson[];
  savingsAsOf: string | null;
}

/** One fully computed daily snapshot, as the insight job emits it. */
function snapshotInput(
  productId: number,
  overrides: Partial<SavingsSnapshotUpsertInput> = {},
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
    gapBasisPoints: -3882,
    taxDatasetVersion: 'v3.0-2026',
    referenceLinkId: null,
    ...overrides,
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

/** Two covered products (1, 2) and one uncovered (3). */
function seedCatalog(db: DatabaseSync): void {
  seedProduct(db, { id: 1, name: 'A-Product', category: 'beer' });
  seedProduct(db, { id: 2, name: 'B-Product', category: 'beer' });
  seedProduct(db, { id: 3, name: 'C-Product', category: 'beer' });
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

function itemById(
  body: SearchJson,
): Map<number, SearchItemJson> {
  return new Map(body.items.map((item) => [item.id, item]));
}

describe('GET /api/v1/products — display-only savings embed (task 1.1, savings-first-catalog-and-prefill)', () => {
  it('covered items carry the embed and the response states savingsAsOf', async () => {
    const { db, d1 } = openMigratedD1();
    seedCatalog(db);
    await seedSnapshots(d1, [snapshotInput(1), snapshotInput(2)]);

    const body = await getProducts(d1);
    expect(body.savingsAsOf).toBe(AS_OF);
    const byId = itemById(body);
    expect(byId.get(1)!.savings).toEqual({
      landedTotalCents: 1590,
      alkoReferenceCents: 2599,
      gapCents: -1009,
      gapBasisPoints: -3882,
      reliability: 'ESTIMATED',
      confidence: 'MEDIUM',
    });
    expect(byId.get(2)!.savings).toEqual(byId.get(1)!.savings);
  });

  it('uncovered items omit the embed entirely — no placeholder, no zero', async () => {
    const { db, d1 } = openMigratedD1();
    seedCatalog(db);
    await seedSnapshots(d1, [snapshotInput(1)]);

    const body = await getProducts(d1);
    expect(body.savingsAsOf).toBe(AS_OF);
    const byId = itemById(body);
    expect('savings' in byId.get(3)!).toBe(false);
    expect(byId.get(3)!.savings).toBeUndefined();
    // The covered sibling still carries its embed on the same page.
    expect(byId.get(1)!.savings).toBeDefined();
  });

  it('attaches the embed for every explicit sort order', async () => {
    const { db, d1 } = openMigratedD1();
    seedCatalog(db);
    await seedSnapshots(d1, [snapshotInput(1), snapshotInput(2)]);

    for (const sort of ['ALPHABETICAL', 'LOWEST_PRICE', 'ALCOHOL_PERCENTAGE']) {
      const body = await getProducts(d1, `?sort=${sort}`);
      expect(body.savingsAsOf).toBe(AS_OF);
      const byId = itemById(body);
      expect(byId.get(1)!.savings).toBeDefined();
      expect(byId.get(2)!.savings).toBeDefined();
      expect('savings' in byId.get(3)!).toBe(false);
    }
  });

  it('only the latest materialized day feeds the embed — an older-day-only row is uncovered', async () => {
    const { db, d1 } = openMigratedD1();
    seedCatalog(db);
    await seedSnapshots(d1, [
      snapshotInput(1, { asOf: DAY_BEFORE }),
      snapshotInput(2),
    ]);

    const body = await getProducts(d1);
    expect(body.savingsAsOf).toBe(AS_OF);
    const byId = itemById(body);
    expect('savings' in byId.get(1)!).toBe(false);
    expect(byId.get(2)!.savings).toBeDefined();
  });

  it('before the first materialization savingsAsOf is null and no item carries an embed', async () => {
    const { db, d1 } = openMigratedD1();
    seedCatalog(db);

    const body = await getProducts(d1);
    expect(body.savingsAsOf).toBeNull();
    for (const item of body.items) {
      expect('savings' in item).toBe(false);
    }
  });

  it('the ids and ranked-q paths carry the same embed and savingsAsOf', async () => {
    const { db, d1 } = openMigratedD1();
    seedCatalog(db);
    await seedSnapshots(d1, [snapshotInput(2)]);

    const ids = await getProducts(d1, '?ids=1,2');
    expect(ids.savingsAsOf).toBe(AS_OF);
    const idsById = itemById(ids);
    expect('savings' in idsById.get(1)!).toBe(false);
    expect(idsById.get(2)!.savings).toBeDefined();

    const ranked = await getProducts(d1, '?q=Product');
    expect(ranked.savingsAsOf).toBe(AS_OF);
    const rankedById = itemById(ranked);
    expect('savings' in rankedById.get(1)!).toBe(false);
    expect(rankedById.get(2)!.savings).toBeDefined();
    expect('savings' in rankedById.get(3)!).toBe(false);
  });

  it('the embed is exactly the six contract figures — no snapshot provenance leaks', async () => {
    const { db, d1 } = openMigratedD1();
    seedCatalog(db);
    await seedSnapshots(d1, [snapshotInput(1)]);

    const body = await getProducts(d1);
    const savings = itemById(body).get(1)!.savings!;
    expect(Object.keys(savings).sort()).toEqual([
      'alkoReferenceCents',
      'confidence',
      'gapBasisPoints',
      'gapCents',
      'landedTotalCents',
      'reliability',
    ]);
  });
});
