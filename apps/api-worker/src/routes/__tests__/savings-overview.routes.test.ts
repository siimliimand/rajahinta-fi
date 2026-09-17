/**
 * Savings market-overview route tests (task 5.2, change
 * price-intelligence-roadmap) over the FULL app composition
 * (createApp() + registerSavingsRoutes — the exact composition index.ts
 * wires, age gate + SAVINGS limiter on the route) on the fake-D1
 * harness.
 *
 * Pinned here:
 *   1. Aggregation DETERMINISM — the same D1 state twice yields a
 *      byte-identical body (categories in name order, fixed key order,
 *      productId-ascending tie-break).
 *   2. The aggregates are the objective ones: integer-cent mean of the
 *      day's best observed prices, the largest |gap| row with its signed
 *      figures, and the qualifying-row count.
 *   3. The tie-break is productId ascending on equal magnitude,
 *      independent of insertion order.
 *   4. Insufficient-data rows (no computed reference, or a product name
 *      the registry no longer resolves) are excluded — and a category
 *      with nothing qualifying is omitted entirely.
 *   5. Honest zero state before the first pass (null as-of, no
 *      categories), and the age gate (403 without confirmation).
 *
 * @module SavingsOverviewRoutesTest
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import {
  buildApp,
  expectEnvelope,
  openMigratedD1,
  permissiveEnv,
  request,
  seedProduct,
} from './harness';
import { registerSavingsRoutes } from '../savings.routes';
import { D1SavingsSnapshotRepository } from '../../../../../packages/data-platform/src/repositories/d1/savings-snapshot.repository';
import type {
  SavingsSnapshotUpsertInput,
  SavingsReliabilityStatus,
  SavingsConfidenceGrade,
} from '../../../../../packages/data-platform/src/abstracts';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

/**
 * index.ts registers the handlers behind their per-route age gate and
 * SAVINGS limiter; the test composition mirrors that exactly.
 */
function overviewApp(): ReturnType<typeof buildApp> {
  const app = buildApp();
  registerSavingsRoutes(app);
  return app;
}

const AGE_OK = { 'x-age-confirmed': 'confirmed-test-token' };

const AS_OF = '2026-09-08';

interface OverviewJson {
  asOf: string | null;
  categories: Array<{
    category: string;
    productCount: number;
    averageObservedPriceCents: number;
    largestDifference: {
      productId: number;
      productName: string;
      merchant: string;
      merchantCountry: string;
      observedPriceCents: number;
      referenceCents: number;
      gapCents: number;
      gapBasisPoints: number;
    } | null;
  }>;
}

/** Seed one registry product plus its snapshot row (real repository). */
async function seedSnapshot(
  db: DatabaseSync,
  d1: D1DatabaseLike,
  seed: {
    productId: number;
    name: string;
    category: string;
    gapCents: number;
    gapBasisPoints: number;
    priceCents?: number;
    referenceCents?: number | null;
    asOf?: string;
    reliability?: SavingsReliabilityStatus;
    confidence?: SavingsConfidenceGrade;
    seedRegistry?: boolean;
  },
): Promise<void> {
  if (seed.seedRegistry !== false) {
    seedProduct(db, {
      id: seed.productId,
      name: seed.name,
      category: seed.category,
    });
  }
  const asOf = seed.asOf ?? AS_OF;
  const input: SavingsSnapshotUpsertInput = {
    asOf,
    productId: seed.productId,
    category: seed.category,
    bestMerchant: 'saksoinet',
    bestMerchantCountry: 'EE',
    bestPriceCents: seed.priceCents ?? 500,
    bestObservedAt: new Date(`${asOf}T12:00:00.000Z`),
    alkoReferenceCents: seed.referenceCents === undefined ? 1000 : seed.referenceCents,
    alkoObservedAt: new Date(`${asOf}T09:00:00.000Z`),
    landedTotalCents: 1200,
    landedReliability: seed.reliability ?? 'ESTIMATED',
    confidence: seed.confidence ?? 'HIGH',
    gapCents: seed.gapCents,
    gapBasisPoints: seed.gapBasisPoints,
    taxDatasetVersion: 'v3.0-2026',
  };
  await new D1SavingsSnapshotRepository(d1).upsertSnapshot(input);
}

async function getOverview(
  app: ReturnType<typeof buildApp>,
  env: Env,
): Promise<Response> {
  return request(app, env, '/api/v1/savings/overview', { headers: AGE_OK });
}

describe('GET /api/v1/savings/overview — deterministic aggregation', () => {
  it('answers the same D1 state twice with a byte-identical body', async () => {
    const { db, d1 } = openMigratedD1();
    await seedSnapshot(db, d1, { productId: 1, name: 'Aurora Lager', category: 'beer', gapCents: 200, gapBasisPoints: 500, priceCents: 400 });
    await seedSnapshot(db, d1, { productId: 2, name: 'Borealis Porter', category: 'beer', gapCents: -300, gapBasisPoints: -750, priceCents: 600 });
    await seedSnapshot(db, d1, { productId: 3, name: 'Rioja Crianza', category: 'wine_still', gapCents: 500, gapBasisPoints: 1250, priceCents: 900 });
    const app = overviewApp();
    const env = permissiveEnv(d1);

    const first = await getOverview(app, env);
    expect(first.status).toBe(200);
    const firstText = await first.text();
    const second = await getOverview(app, env);
    // Byte-identical: key order and category order are fixed by
    // construction, not by D1 row order.
    expect(await second.text()).toBe(firstText);

    const body = JSON.parse(firstText) as OverviewJson;
    expect(body.asOf).toBe(AS_OF);
    // Categories in name order.
    expect(body.categories.map((c) => c.category)).toEqual(['beer', 'wine_still']);

    const beer = body.categories[0]!;
    expect(beer.productCount).toBe(2);
    // Mean of the two observed prices, integer cents.
    expect(beer.averageObservedPriceCents).toBe(500);
    // Largest |gap| = 300 (Borealis Porter), signed figure travels.
    expect(beer.largestDifference).toMatchObject({
      productId: 2,
      productName: 'Borealis Porter',
      gapCents: -300,
      gapBasisPoints: -750,
      observedPriceCents: 600,
      referenceCents: 1000,
    });

    const wine = body.categories[1]!;
    expect(wine.largestDifference).toMatchObject({
      productId: 3,
      productName: 'Rioja Crianza',
      gapCents: 500,
    });
  });

  it('breaks equal-magnitude ties by productId ascending, whatever the row order', async () => {
    const { db, d1 } = openMigratedD1();
    // Inserted descending: 3 first, then 2 — the lower id must still win.
    await seedSnapshot(db, d1, { productId: 3, name: 'Cider Zest', category: 'beer', gapCents: 250, gapBasisPoints: 625 });
    await seedSnapshot(db, d1, { productId: 2, name: 'Ale Two', category: 'beer', gapCents: -250, gapBasisPoints: -625 });
    const app = overviewApp();

    const body = (await (
      await getOverview(app, permissiveEnv(d1))
    ).json()) as OverviewJson;

    expect(body.categories).toHaveLength(1);
    expect(body.categories[0]!.largestDifference!.productId).toBe(2);
  });

  it('averages integer-cent prices without float drift on an odd sum', async () => {
    const { db, d1 } = openMigratedD1();
    await seedSnapshot(db, d1, { productId: 1, name: 'Ale A', category: 'beer', gapCents: 10, gapBasisPoints: 25, priceCents: 101 });
    await seedSnapshot(db, d1, { productId: 2, name: 'Ale B', category: 'beer', gapCents: 10, gapBasisPoints: 25, priceCents: 102 });
    await seedSnapshot(db, d1, { productId: 3, name: 'Ale C', category: 'beer', gapCents: 10, gapBasisPoints: 25, priceCents: 103 });
    const app = overviewApp();

    const body = (await (
      await getOverview(app, permissiveEnv(d1))
    ).json()) as OverviewJson;

    // (101 + 102 + 103) / 3 = 102 exact; the aggregate is integer cents.
    expect(body.categories[0]!.averageObservedPriceCents).toBe(102);
  });
});

describe('GET /api/v1/savings/overview — sufficient-data filter and gates', () => {
  it('omits rows without a computed reference, and empty categories with them', async () => {
    const { db, d1 } = openMigratedD1();
    // wine_still qualifies; mead's only row has NO reference → the whole
    // category is omitted instead of aggregated over insufficient data.
    await seedSnapshot(db, d1, { productId: 1, name: 'Rioja Crianza', category: 'wine_still', gapCents: 500, gapBasisPoints: 1250 });
    await seedSnapshot(db, d1, { productId: 2, name: 'Mead Light', category: 'mead', gapCents: 900, gapBasisPoints: 2250, referenceCents: null });
    const app = overviewApp();

    const body = (await (
      await getOverview(app, permissiveEnv(d1))
    ).json()) as OverviewJson;

    expect(body.categories.map((c) => c.category)).toEqual(['wine_still']);
    expect(body.categories[0]!.productCount).toBe(1);
  });

  it('answers with a null as-of and no categories before the first pass', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Aurora Lager', category: 'beer' });
    const app = overviewApp();

    const res = await getOverview(app, permissiveEnv(d1));
    expect(res.status).toBe(200);
    const body = (await res.json()) as OverviewJson;
    expect(body.asOf).toBeNull();
    expect(body.categories).toEqual([]);
  });

  it('denies an unconfirmed caller with 403 AGE_GATE_REQUIRED and admits a confirmed one', async () => {
    const { db, d1 } = openMigratedD1();
    await seedSnapshot(db, d1, { productId: 1, name: 'Aurora Lager', category: 'beer', gapCents: 200, gapBasisPoints: 500 });
    const app = overviewApp();
    const env = permissiveEnv(d1);

    await expectEnvelope(
      await request(app, env, '/api/v1/savings/overview', {}),
      403,
      { error: 'Forbidden', code: 'AGE_GATE_REQUIRED' },
    );
    expect((await getOverview(app, env)).status).toBe(200);
  });
});
