/**
 * Unit-price ranking route tests (trust-and-reach-roadmap task 7.1).
 *
 * Spec unit-price-metrics, MODIFIED "Category ranking by ethanol unit
 * price": deterministic €/g-ascending order with the product id as the
 * stable secondary key, VERIFIED/ESTIMATED rows only, unavailable
 * products omitted (never placed arbitrarily), status carried per row.
 * Expected values are hand-computed from the pinned metric vectors
 * (0.33 l × 0.047 × 789 = 12.23739 g ethanol).
 *
 * @module UnitPriceRoutesTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildApp,
  expectEnvelope,
  openMigratedD1,
  permissiveEnv,
  request,
  seedOffer,
  seedProduct,
} from './harness';

const AGE = { 'x-age-confirmed': 'confirmed' };
const PATH = '/api/v1/unitprice/ranking';

interface RankingRow {
  productId: number;
  name: string;
  brand: string;
  offerId: number;
  centsPerGram: number;
  ethanolGrams: number;
  reliabilityStatus: string;
}

interface RankingBody {
  category: string;
  items: RankingRow[];
}

async function getRanking(d1: ReturnType<typeof openMigratedD1>['d1'], query: string) {
  const app = buildApp();
  return request(app, permissiveEnv(d1), `${PATH}${query}`, { headers: AGE });
}

describe('GET /api/v1/unitprice/ranking — validation', () => {
  it('rejects a missing category with 400 and the valid keys', async () => {
    const { d1 } = openMigratedD1();
    const res = await getRanking(d1, '');
    const body = (await expectEnvelope(res, 400, {
      message: expect.stringContaining("Query parameter 'category' is required"),
    })) as { message: string };
    expect(body.message).toContain('beer, wine_still, wine_sparkling');
  });

  it('treats a blank category as missing', async () => {
    const { d1 } = openMigratedD1();
    const res = await getRanking(d1, '?category=%20%20');
    await expectEnvelope(res, 400, {
      message: expect.stringContaining('is required'),
    });
  });

  it('rejects an unknown category with 400 naming it', async () => {
    const { d1 } = openMigratedD1();
    const res = await getRanking(d1, '?category=juice');
    await expectEnvelope(res, 400, {
      message: expect.stringContaining("Unknown category 'juice'"),
    });
  });

  it('is guarded by the age gate (product-surface parity)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), `${PATH}?category=beer`);
    await expectEnvelope(res, 403, { code: 'AGE_GATE_REQUIRED' });
  });
});

describe('GET /api/v1/unitprice/ranking — ordering', () => {
  // beer products: 0.33 l / 4.7 % → 12.23739 g ethanol per unit.
  async function seedRankedBeers(db: ReturnType<typeof openMigratedD1>['db']) {
    seedProduct(db, { id: 1, name: 'Karhu III', category: 'beer' }); // 350 ¢
    seedProduct(db, { id: 2, name: 'Bock Svec', category: 'beer' }); // 300 ¢
    seedProduct(db, {
      id: 3,
      name: 'Vahvin Lager',
      category: 'beer',
      unitVolume: 0.5,
      alcoholByVolume: 0.055,
    }); // 420 ¢ over 21.6975 g
    seedOffer(db, { id: 11, productId: 1, priceCents: 350 });
    seedOffer(db, { id: 21, productId: 2, priceCents: 300 });
    seedOffer(db, { id: 31, productId: 3, priceCents: 420 });
  }

  it('orders by €/g ascending across the category and filters other categories out', async () => {
    const { db, d1 } = openMigratedD1();
    await seedRankedBeers(db);
    // Cheapest €/g overall but the wrong category — must not appear.
    seedProduct(db, { id: 9, name: 'Koskenkorva Viina', category: 'spirits' });
    seedOffer(db, { id: 91, productId: 9, priceCents: 500 });

    const res = await getRanking(d1, '?category=beer');
    expect(res.status).toBe(200);
    const body = (await res.json()) as RankingBody;
    expect(body.category).toBe('beer');
    // 420/21.6975 ≈ 19.3571 < 300/12.23739 ≈ 24.5150 < 350/12.23739 ≈ 28.6009.
    expect(body.items.map((r) => r.productId)).toEqual([3, 2, 1]);
    expect(body.items.every((r) => r.reliabilityStatus === 'VERIFIED')).toBe(true);
  });

  it('is deterministic: identical queries return identical order and rows', async () => {
    const { db, d1 } = openMigratedD1();
    await seedRankedBeers(db);

    const first = await getRanking(d1, '?category=beer');
    const second = await getRanking(d1, '?category=beer');
    const firstBody = (await first.json()) as RankingBody;
    const secondBody = (await second.json()) as RankingBody;
    expect(secondBody).toEqual(firstBody);
    expect(secondBody.items.map((r) => r.productId)).toEqual([3, 2, 1]);
  });

  it('resolves an exact €/g tie by product id, not the alphabetical listing order', async () => {
    const { db, d1 } = openMigratedD1();
    // Identical physical inputs and price → bit-identical €/g. The
    // repository lists alphabetically ('Alpha Ale', id 2, first); the
    // tiebreaker must still emit id 1 first.
    seedProduct(db, { id: 1, name: 'Zeta Lager', category: 'beer' });
    seedProduct(db, { id: 2, name: 'Alpha Ale', category: 'beer' });
    seedOffer(db, { id: 11, productId: 1, priceCents: 300 });
    seedOffer(db, { id: 21, productId: 2, priceCents: 300 });

    const res = await getRanking(d1, '?category=beer');
    const body = (await res.json()) as RankingBody;
    expect(body.items.map((r) => r.productId)).toEqual([1, 2]);
    expect(body.items[0]!.centsPerGram).toBe(body.items[1]!.centsPerGram);
  });

  it('carries the ranked value with offer provenance per row', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III', brand: 'Hartwall', category: 'beer' });
    seedOffer(db, { id: 11, productId: 1, priceCents: 300 });

    const res = await getRanking(d1, '?category=beer');
    const body = (await res.json()) as RankingBody;
    expect(body.items).toHaveLength(1);
    const row = body.items[0]!;
    expect(row.productId).toBe(1);
    expect(row.name).toBe('Karhu III');
    expect(row.brand).toBe('Hartwall');
    expect(row.offerId).toBe(11);
    // 0.33 l × 0.047 × 789 = 12.23739 g; 300 ¢ / 12.23739 ≈ 24.5150 ¢/g.
    expect(row.ethanolGrams).toBeCloseTo(12.23739, 5);
    expect(row.centsPerGram).toBeCloseTo(24.5150313915, 4);
    expect(Object.keys(row)).toEqual([
      'productId',
      'name',
      'brand',
      'offerId',
      'centsPerGram',
      'ethanolGrams',
      'reliabilityStatus',
    ]);
  });
});

describe('GET /api/v1/unitprice/ranking — omission', () => {
  it('omits products with no computable unit price, keeping rankable ones', async () => {
    const { db, d1 } = openMigratedD1();
    // No ABV → MISSING_ALCOHOL_FRACTION.
    seedProduct(db, { id: 1, name: 'Mystery Brew', category: 'beer', alcoholByVolume: null });
    seedOffer(db, { id: 11, productId: 1, priceCents: 300 });
    // No offers at all → no price to derive from.
    seedProduct(db, { id: 2, name: 'Unlisted Brew', category: 'beer' });
    // STALE price only → not rankable (rows must be VERIFIED/ESTIMATED).
    seedProduct(db, { id: 3, name: 'Stale Brew', category: 'beer' });
    seedOffer(db, { id: 31, productId: 3, priceCents: 200, reliabilityStatus: 'STALE' });
    // UNAVAILABLE price only → not rankable.
    seedProduct(db, { id: 4, name: 'Unsourced Brew', category: 'beer' });
    seedOffer(db, {
      id: 41,
      productId: 4,
      priceCents: 200,
      reliabilityStatus: 'UNAVAILABLE',
    });
    // Rankable — stays.
    seedProduct(db, { id: 5, name: 'Fresh Brew', category: 'beer' });
    seedOffer(db, { id: 51, productId: 5, priceCents: 300 });

    const res = await getRanking(d1, '?category=beer');
    expect(res.status).toBe(200);
    const body = (await res.json()) as RankingBody;
    expect(body.items.map((r) => r.productId)).toEqual([5]);
  });

  it('represents a product by its best rankable offer, never an excluded cheaper one', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Dual Offer Brew', category: 'beer' });
    // Cheaper but STALE — must not win (nor be merged into the row).
    seedOffer(db, { id: 11, productId: 1, priceCents: 250, reliabilityStatus: 'STALE' });
    seedOffer(db, { id: 12, productId: 1, priceCents: 300 });

    const res = await getRanking(d1, '?category=beer');
    const body = (await res.json()) as RankingBody;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.offerId).toBe(12);
    expect(body.items[0]!.centsPerGram).toBeCloseTo(24.5150313915, 4);
    expect(body.items[0]!.reliabilityStatus).toBe('VERIFIED');
  });
});

describe('GET /api/v1/unitprice/ranking — status carriage', () => {
  it('labels VERIFIED-price rows VERIFIED and ESTIMATED-price rows ESTIMATED', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Verified Brew', category: 'beer' });
    seedOffer(db, { id: 11, productId: 1, priceCents: 300 });
    seedProduct(db, { id: 2, name: 'Estimated Brew', category: 'beer' });
    seedOffer(db, {
      id: 21,
      productId: 2,
      priceCents: 350,
      reliabilityStatus: 'ESTIMATED',
    });

    const res = await getRanking(d1, '?category=beer');
    expect(res.status).toBe(200);
    const body = (await res.json()) as RankingBody;
    // 300 ¢ → 24.5150 (cheaper, first); 350 ¢ → 28.6009 (second).
    expect(body.items.map((r) => r.productId)).toEqual([1, 2]);
    expect(body.items[0]!.reliabilityStatus).toBe('VERIFIED');
    expect(body.items[1]!.reliabilityStatus).toBe('ESTIMATED');
    expect(body.items[1]!.centsPerGram).toBeCloseTo(28.6008699568, 4);
  });

  it('returns an empty listing for a valid category with no rankable products', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III', category: 'beer' });
    seedOffer(db, { id: 11, productId: 1, priceCents: 300 });

    const res = await getRanking(d1, '?category=wine_sparkling');
    expect(res.status).toBe(200);
    const body = (await res.json()) as RankingBody;
    expect(body.category).toBe('wine_sparkling');
    expect(body.items).toEqual([]);
  });
});
