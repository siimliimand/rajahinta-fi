/**
 * Compliance test: the shared listing universe excludes non-alcoholic
 * rows (nonalcoholic-catalog-hygiene task 3.4, specs product-catalog +
 * savings-discovery MODIFIED requirements).
 *
 * One alcohol-category (beer) catalog with the full offending row-shape
 * set, fired against EVERY listing surface end-to-end through the real
 * route harness — the cross-cutting witness that a held row
 * (`review_hold_reason = NONALCOHOLIC_HOLD_REASON`) and zero/unparseable-
 * ABV rows appear on NO user-facing surface:
 *
 *   - catalog browse (GET /api/v1/products, plain and category-filtered)
 *   - detail degrade (GET /api/v1/products/:id → 404, same predicate)
 *   - ids compare (GET /api/v1/products?ids=)
 *   - ranked search (GET /api/v1/products?q= — FTS matches all five
 *     names; only the universe answers)
 *   - €/g value ranking (GET /api/v1/unitprice/ranking?category=beer)
 *   - savings qualification → snapshots → market overview: the REAL cron
 *     pass runs over a catalog where the zero-ABV row carries the largest
 *     would-be gap (the observed "Red Bull headlines the category"
 *     defect), and the overview must select an in-universe product
 *     instead.
 *
 * The converse is pinned on every surface too (design D3): a parsed
 * ABV > 0 row keeps today's behavior ENTIRELY — product 5's alcohol
 * fields carry ESTIMATED provenance at ingestion (ESTIMATED-reliability
 * offers; the predicate reads the parsed value, never a status) and it
 * remains fully listed everywhere. The D3 calculator-layer twin vector
 * lives in tests/golden/per-category.test.ts.
 *
 * Non-vacuity is structural: the three out-of-universe rows are proven
 * present in product_master WITH offers (the Red Bull shape: cheapest
 * prices, largest would-be gaps) before any surface is asserted — the
 * suites cannot pass because the fixtures silently failed to seed.
 *
 * Harness: the api-worker route-test harness and the REAL
 * handleSavingsSnapshots cron handler by relative path, per the
 * savings-snapshot-isolation precedent; tests/compliance/vitest.config.ts
 * resolves the graph. Runs on node ≥ 24 (FTS5).
 *
 * @module NonalcoholicListingUniverseComplianceTest
 */

import { describe, it, expect } from 'vitest';

import { NONALCOHOLIC_HOLD_REASON } from '@rajahinta/core-domain';

import {
  buildApp,
  openMigratedD1,
  permissiveEnv,
  request,
  seedOffer,
  seedProduct,
  seedTaxRule,
} from '../../apps/api-worker/src/routes/__tests__/harness';
import { handleSavingsSnapshots } from '../../apps/api-worker/src/cron/savings-snapshots';
import { createLogger } from '../../apps/api-worker/src/logger';

const AGE = { 'x-age-confirmed': 'confirmed' };

const LOG = createLogger('error');

// ---------------------------------------------------------------------------
// Shared catalog — the offending shapes live in one beer-category catalog
// ---------------------------------------------------------------------------

/**
 * Five beer products (unit volume 0.5 L), each with a foreign offer and
 * an Alko reference offer so the savings cron's direct path would qualify
 * every one of them absent the predicate:
 *
 *   id 1  control        — parsed ABV 0.047, VERIFIED offers
 *   id 2  held           — parseable ABV 0.047 BUT review hold stamped
 *   id 3  zero-ABV       — alcohol_by_volume = 0 (the Red Bull shape;
 *                          priced to win every surface and to carry the
 *                          largest would-be savings gap)
 *   id 4  unknown-ABV    — alcohol_by_volume NULL (unparseable)
 *   id 5  estimated-ABV  — parsed ABV 0.045 > 0, ESTIMATED-reliability
 *                          offers (design D3 converse: fully visible)
 *
 * Prices (foreign / alko cents): the calculator races ALL offers, so the
 * out-of-universe rows carry the cheapest offers and — via their Alko
 * references — the LARGEST would-be savings gaps (they would lead
 * LOWEST_PRICE browse, the €/g ranking, and the largest-difference
 * selection if the universe leaked). Among the in-universe controls the
 * ESTIMATED-provenance row carries the larger legitimate gap, so the
 * overview's largestDifference has an unambiguous expected winner that
 * also demonstrates D3: a parsed-ABV row with ESTIMATED alcohol fields
 * may genuinely headline its category.
 */
function seedCatalog(db: ReturnType<typeof openMigratedD1>['db']): void {
  seedTaxRule(db, { taxType: 'excise', productCategory: 'beer', rate: 0.365 });
  seedTaxRule(db, {
    id: 2,
    taxType: 'container_duty',
    productCategory: 'all_beverages',
    rate: 0.51,
  });

  const products: {
    id: number;
    name: string;
    alcoholByVolume?: number | null;
    hold?: boolean;
    estimated?: boolean;
    foreignCents: number;
    alkoCents: number;
  }[] = [
    { id: 1, name: 'Panimo Altta', foreignCents: 200, alkoCents: 300 },
    { id: 2, name: 'PanimoPidetty', hold: true, foreignCents: 100, alkoCents: 100 },
    {
      id: 3,
      name: 'PanimoNolla',
      alcoholByVolume: 0,
      foreignCents: 90,
      alkoCents: 90,
    },
    {
      id: 4,
      name: 'PanimoTuntematon',
      alcoholByVolume: null,
      foreignCents: 95,
      alkoCents: 95,
    },
    {
      id: 5,
      name: 'PanimoArvio',
      alcoholByVolume: 0.045,
      estimated: true,
      foreignCents: 150,
      alkoCents: 300,
    },
  ];

  for (const p of products) {
    seedProduct(db, {
      id: p.id,
      name: p.name,
      category: 'beer',
      unitVolume: 0.5,
      ...(p.alcoholByVolume === undefined
        ? {}
        : { alcoholByVolume: p.alcoholByVolume }),
    });
    if (p.hold) {
      db.prepare(
        `UPDATE product_master SET review_hold_reason = ? WHERE id = ?`,
      ).run(NONALCOHOLIC_HOLD_REASON, p.id);
    }
    seedOffer(db, {
      id: p.id * 10 + 1,
      productId: p.id,
      merchant: 'beverage-de',
      country: 'DE',
      priceCents: p.foreignCents,
      observedAt: '2026-10-01T10:00:00.000Z',
      ...(p.estimated ? { reliabilityStatus: 'ESTIMATED' } : {}),
    });
    seedOffer(db, {
      id: p.id * 10 + 2,
      productId: p.id,
      merchant: 'alko',
      country: 'FI',
      priceCents: p.alkoCents,
      observedAt: '2026-10-01T09:00:00.000Z',
      ...(p.estimated ? { reliabilityStatus: 'ESTIMATED' } : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// Non-vacuity — the offending rows exist with offers, out of the universe
// ---------------------------------------------------------------------------

describe('fixture non-vacuity: the offending rows are stored, offered, and held', () => {
  const { db } = openMigratedD1();
  seedCatalog(db);

  it('all five rows exist in product_master with the intended ABV/hold state', () => {
    const rows = db
      .prepare(
        `SELECT id, alcohol_by_volume AS abv, review_hold_reason AS hold
           FROM product_master WHERE category = 'beer' ORDER BY id`,
      )
      .all() as unknown as { id: number; abv: number | null; hold: string | null }[];

    expect(rows).toEqual([
      { id: 1, abv: 0.047, hold: null },
      { id: 2, abv: 0.047, hold: NONALCOHOLIC_HOLD_REASON },
      { id: 3, abv: 0, hold: null },
      { id: 4, abv: null, hold: null },
      { id: 5, abv: 0.045, hold: null },
    ]);
  });

  it('every row — held rows included — keeps its offer history (hold for review, never delete)', () => {
    const offers = db
      .prepare(
        `SELECT product_id AS productId, COUNT(*) AS n FROM retail_offers
          WHERE product_id IN (1, 2, 3, 4, 5) GROUP BY product_id ORDER BY product_id`,
      )
      .all() as unknown as { productId: number; n: number }[];
    // Two offers per product — a held row's provenance survives intact.
    expect(offers).toEqual([
      { productId: 1, n: 2 },
      { productId: 2, n: 2 },
      { productId: 3, n: 2 },
      { productId: 4, n: 2 },
      { productId: 5, n: 2 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Product surfaces — browse, detail, ids, ranked search, €/g ranking
// ---------------------------------------------------------------------------

describe('the catalog listing universe answers every product surface', () => {
  const { db, d1 } = openMigratedD1();
  seedCatalog(db);
  const app = buildApp();
  const env = permissiveEnv(d1);

  const idsOf = (body: { items: { id: number }[] }): number[] =>
    body.items.map((i) => i.id).sort((a, b) => a - b);

  it('browse: only the control and the estimated-ABV row are listed', async () => {
    const res = await request(app, env, '/api/v1/products', { headers: AGE });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: number }[]; total: number };
    expect(idsOf(body)).toEqual([1, 5]);
    expect(body.total).toBe(2);
  });

  it('browse, category-filtered: beer shrinks to the universe; other_fermented is honestly empty', async () => {
    const beer = await request(app, env, '/api/v1/products?category=beer', {
      headers: AGE,
    });
    expect(beer.status).toBe(200);
    const beerBody = (await beer.json()) as { items: { id: number }[]; total: number };
    expect(idsOf(beerBody)).toEqual([1, 5]);
    expect(beerBody.total).toBe(2);

    // The honest-shrinkage converse: a category whose every row is
    // out-of-universe lists nothing rather than leaking one row.
    seedProduct(db, { id: 6, name: 'PanimoSiideri', category: 'other_fermented' });
    db.prepare(
      `UPDATE product_master SET alcohol_by_volume = 0 WHERE id = 6`,
    ).run();
    seedOffer(db, {
      id: 61,
      productId: 6,
      merchant: 'beverage-de',
      priceCents: 100,
      observedAt: '2026-10-01T10:00:00.000Z',
    });

    const cider = await request(app, env, '/api/v1/products?category=other_fermented', {
      headers: AGE,
    });
    expect(cider.status).toBe(200);
    const ciderBody = (await cider.json()) as { items: { id: number }[]; total: number };
    expect(ciderBody.items).toEqual([]);
    expect(ciderBody.total).toBe(0);
  });

  it('detail degrades consistently: held, zero-ABV, and unknown-ABV rows are all 404', async () => {
    for (const id of [2, 3, 4]) {
      const res = await request(app, env, `/api/v1/products/${id}`, { headers: AGE });
      expect(res.status, `product ${id} must degrade to not-found`).toBe(404);
    }
    // The converse: both in-universe rows still resolve.
    for (const id of [1, 5]) {
      const res = await request(app, env, `/api/v1/products/${id}`, { headers: AGE });
      expect(res.status, `product ${id} must stay visible`).toBe(200);
    }
  });

  it('ids compare: the batch read resolves only in-universe ids', async () => {
    const res = await request(app, env, '/api/v1/products?ids=1,2,3,4,5', {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: number }[] };
    expect(idsOf(body)).toEqual([1, 5]);
  });

  it('ranked search: FTS matches all five names, the universe answers', async () => {
    const res = await request(app, env, '/api/v1/products?q=Panimo', { headers: AGE });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: number }[] };
    // Non-vacuity of the MATCH: all five product names carry the token,
    // so an empty result would mean the FTS leg broke, not the predicate.
    expect(idsOf(body)).toEqual([1, 5]);
  });

  it('€/g value ranking: the cheapest rows are the out-of-universe ones, and the ranking never lists them', async () => {
    const res = await request(app, env, '/api/v1/unitprice/ranking?category=beer', {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { productId: number }[] };
    // Controls only, cheapest €/g ethanol first: 150 ¢ / 22.5 g beats
    // 200 ¢ / 23.5 g. The held row (100 ¢) and the zero/unknown-ABV rows
    // (which have no ethanol at all) appear nowhere.
    expect(body.items.map((i) => i.productId)).toEqual([5, 1]);
  });
});

// ---------------------------------------------------------------------------
// Savings surface — real cron qualification → snapshots → market overview
// ---------------------------------------------------------------------------

describe('the savings surface observes the same universe (real cron pass → overview)', () => {
  const { db, d1 } = openMigratedD1();
  seedCatalog(db);
  const app = buildApp();

  it('the cron qualifies only in-universe products — the zero-ABV row with the largest gap never snapshots', async () => {
    const result = await handleSavingsSnapshots(permissiveEnv(d1), LOG);

    // qualifyingProducts === 2 is the enumeration pin: products 2/3/4
    // carry Alko references, so absent the shared predicate all five
    // would qualify. rowsWritten/skipped/failed pin the clean pass.
    expect(result.qualifyingProducts).toBe(2);
    expect(result.rowsWritten).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);

    // The materialized rows at the storage layer: controls only.
    const stored = db
      .prepare(`SELECT product_id FROM savings_snapshots ORDER BY product_id`)
      .all() as unknown as { product_id: number }[];
    expect(stored.map((r) => r.product_id)).toEqual([1, 5]);
  });

  it('market overview: the zero-ABV row cannot headline the category — an in-universe row does', async () => {
    const res = await request(app, permissiveEnv(d1), '/api/v1/savings/overview', {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      asOf: string;
      categories: {
        category: string;
        productCount: number;
        averageObservedPriceCents: number;
        largestDifference: { productId: number };
      }[];
    };

    // Exactly one category aggregates, over exactly the two controls.
    expect(body.categories).toHaveLength(1);
    const beer = body.categories[0]!;
    expect(beer.category).toBe('beer');
    expect(beer.productCount).toBe(2);
    // Mean of the controls' day-best observed prices (200, 150 — the
    // calculator races all offers, and each control's foreign offer wins).
    expect(beer.averageObservedPriceCents).toBe(175);
    // Largest in-universe gap: product 5 (|300 − 151| = 149 beats
    // product 1's |300 − 201| = 99). Products 2/3/4 carry the LARGER
    // would-be gaps (199/209/205 — cheapest offers, biggest references)
    // and are absent. An ESTIMATED-alcohol-provenance row may legitimately
    // headline: its ABV is parsed and greater than zero (design D3).
    expect(beer.largestDifference.productId).toBe(5);
  });

  it('savings listing: only the control rows render', async () => {
    const res = await request(app, permissiveEnv(d1), '/api/v1/savings?category=beer', {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { productId: number }[] };
    expect(body.rows.map((r) => r.productId).sort((a, b) => a - b)).toEqual([1, 5]);
  });
});
