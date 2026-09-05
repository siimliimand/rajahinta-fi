/**
 * Basket optimizer route parity tests (task 3.6) — extended with the
 * flag-gated packing response section (task 3.3, change
 * product-roadmap-phases-1-4).
 *
 * Expectations ported from
 * packages/application-api/src/basket/__tests__/basket-optimizer.controller.test.ts
 * (validation messages, error mapping, idempotency headers) with the
 * composed-app guard checks from the task-3.2 route-coverage suite.
 *
 * @module BasketRoutesTest
 */

import type { DatabaseSync } from 'node:sqlite';
import { describe, it, expect } from 'vitest';
import {
  buildApp,
  expectEnvelope,
  lockedEnv,
  openMigratedD1,
  permissiveEnv,
  request,
  seedOffer,
  seedProduct,
  seedTaxRule,
} from './harness';

const AGE = { 'x-age-confirmed': 'confirmed' };
const JSON_HDRS = { 'content-type': 'application/json', ...AGE };

/** Valid single-item request (controller fixture parity). */
const VALID_REQUEST = {
  items: [{ productId: 1, quantity: 2 }],
  destination: 'FI',
};

describe('POST /api/v1/basket/optimize — validation (controller parity)', () => {
  it('rejects an empty items array with the joined message', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/basket/optimize', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ items: [], destination: 'FI' }),
    });
    await expectEnvelope(res, 400, {
      message: 'items must contain at least 1 item',
      error: 'ValidationError',
    });
  });

  it('rejects more than MAX_BASKET_ITEMS items', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const items = Array.from({ length: 11 }, (_, i) => ({ productId: i + 1, quantity: 1 }));
    const res = await request(app, permissiveEnv(d1), '/api/v1/basket/optimize', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ items, destination: 'FI' }),
    });
    await expectEnvelope(res, 400, {
      message: 'items must contain at most 10 items',
      error: 'ValidationError',
    });
  });

  it('rejects non-integer productId and out-of-range quantity with indexed messages', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/basket/optimize', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({
        items: [
          { productId: 1.5, quantity: 0 },
          { productId: 2, quantity: 100 },
        ],
        destination: 'FIN',
      }),
    });
    await expectEnvelope(res, 400, {
      message:
        'items[0].productId must be a positive integer; ' +
        'items[0].quantity must be a positive integer between 1 and 99; ' +
        'items[1].quantity must be a positive integer between 1 and 99; ' +
        'destination must be a 2-letter ISO 3166-1 alpha-2 country code',
      error: 'ValidationError',
    });
  });

  it('rejects an invalid transportArrangement', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/basket/optimize', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({
        items: VALID_REQUEST.items,
        destination: 'FI',
        transportArrangement: 'TELEPORT',
      }),
    });
    await expectEnvelope(res, 400, {
      message:
        'transportArrangement must be one of: SELLER_ARRANGED, INDEPENDENT_CARRIER, PERSONAL',
      error: 'ValidationError',
    });
  });
});

describe('POST /api/v1/basket/optimize — error mapping (controller parity)', () => {
  it('404s an unknown product (BasketValidationError PRODUCT_NOT_FOUND)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/basket/optimize', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify(VALID_REQUEST),
    });
    // The optimizer's per-product resolution throws PRODUCT_NOT_FOUND.
    await expectEnvelope(res, 404, {});
  });

  it('422s a classification-gate rejection with the product id', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, regulatoryClassification: 'unknown' });
    seedOffer(db, { productId: 1 });
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/basket/optimize', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify(VALID_REQUEST),
    });
    const body = await expectEnvelope(res, 422, {
      error: 'BasketClassificationGateRejection',
      productId: 1,
    });
    expect(typeof body.message).toBe('string');
  });
});

describe('POST /api/v1/basket/optimize — composed guards + idempotency', () => {
  it('carries the BASKET_OPTIMIZATION flag gate (route-coverage parity)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    const off = await request(app, lockedEnv(d1), '/api/v1/basket/optimize', {
      method: 'POST',
    });
    await expectEnvelope(off, 403, {
      message: 'Feature "BASKET_OPTIMIZATION" is not enabled',
    });
  });

  it('serves MISS then HIT for identical baskets, with stable content hash', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, depositSystemStatus: 0 });
    seedOffer(db, { productId: 1, priceCents: 350 });
    seedTaxRule(db, { taxType: 'excise', productCategory: 'beer', rate: 0.365 });
    seedTaxRule(db, {
      id: 2,
      taxType: 'container_duty',
      productCategory: 'all_beverages',
      rate: 0.51,
      verified: false,
    });
    const app = buildApp();
    const env = permissiveEnv(d1);
    const init: RequestInit = {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify(VALID_REQUEST),
    };

    const first = await request(app, env, '/api/v1/basket/optimize', init);
    expect(first.status).toBe(200);
    expect(first.headers.get('X-Cache')).toBe('MISS');
    const missHash = first.headers.get('X-Content-Hash');
    expect(missHash).toMatch(/^[0-9a-f]{64}$/);
    const missBody = (await first.json()) as Record<string, any>;
    expect(Array.isArray(missBody.shipments)).toBe(true);
    expect(missBody.totalCents).toBeGreaterThan(0);

    const second = await request(app, env, '/api/v1/basket/optimize', init);
    expect(second.headers.get('X-Cache')).toBe('HIT');
    expect(second.headers.get('X-Content-Hash')).toBe(missHash);
    expect(await second.json()).toEqual(missBody);

    // A different basket derives a different key → fresh computation.
    const third = await request(app, env, '/api/v1/basket/optimize', {
      ...init,
      body: JSON.stringify({
        items: [{ productId: 1, quantity: 3 }],
        destination: 'FI',
      }),
    });
    expect(third.headers.get('X-Cache')).toBe('MISS');
  });
});

// ---------------------------------------------------------------------------
// Packing section (task 3.3) — PACKING_OPTIMIZER gates the response section,
// never the endpoint. Shape expectations follow the 1.2 eurPerGram-embed
// precedent: flag off = exact legacy key list, flag on = legacy keys +
// `packing` appended last.
// ---------------------------------------------------------------------------

/** The optimize response keys before the packing section existed. */
const LEGACY_OPTIMIZE_KEYS = [
  'shipments',
  'totalCents',
  'itemizedTotals',
  'confidence',
  'confidenceBreakdown',
  'disclaimer',
  'alternatives',
  'metadata',
];

/** Insert a product_dimensions row (task 3.1 table). */
function seedDimension(
  db: DatabaseSync,
  dimension: {
    productId: number;
    weightG: number;
    heightMm: number;
    diameterMm: number;
    material: 'GLASS' | 'CAN' | 'PLASTIC' | 'OTHER';
  },
): void {
  db.prepare(
    `INSERT INTO product_dimensions (
       product_id, weight_g, height_mm, diameter_mm, material, source,
       reliability_status, observed_at
     ) VALUES (?, ?, ?, ?, ?, 'basket-routes-test', 'ESTIMATED', ?)`,
  ).run(
    dimension.productId,
    dimension.weightG,
    dimension.heightMm,
    dimension.diameterMm,
    dimension.material,
    new Date().toISOString(),
  );
}

/** Insert a carrier_box_types row (task 3.1 table; autoincrement id = insert order). */
function seedBoxType(
  db: DatabaseSync,
  box: {
    carrier: string;
    name: string;
    internalHeightMm: number;
    internalWidthMm: number;
    internalDepthMm: number;
    maxWeightG: number;
  },
): void {
  db.prepare(
    `INSERT INTO carrier_box_types (
       carrier, name, internal_height_mm, internal_width_mm, internal_depth_mm,
       max_weight_g, source, observed_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'carrier packaging page', ?)`,
  ).run(
    box.carrier,
    box.name,
    box.internalHeightMm,
    box.internalWidthMm,
    box.internalDepthMm,
    box.maxWeightG,
    new Date().toISOString(),
  );
}

/** Seed the working optimize fixture (MISS/HIT test parity) for the given product ids. */
function seedOptimizableProducts(db: DatabaseSync, ids: number[]): void {
  for (const id of ids) {
    seedProduct(db, { id, name: `Product ${id}`, depositSystemStatus: 0 });
    seedOffer(db, { productId: id, priceCents: 350 });
  }
  seedTaxRule(db, { taxType: 'excise', productCategory: 'beer', rate: 0.365 });
  seedTaxRule(db, {
    id: 2,
    taxType: 'container_duty',
    productCategory: 'all_beverages',
    rate: 0.51,
    verified: false,
  });
}

describe('packing section (flag PACKING_OPTIMIZER)', () => {
  it('flag off keeps the response byte-compatible — no packing key, dimensions present or not', async () => {
    const { db, d1 } = openMigratedD1();
    seedOptimizableProducts(db, [1]);
    seedDimension(db, {
      productId: 1,
      weightG: 400,
      heightMm: 250,
      diameterMm: 80,
      material: 'GLASS',
    });
    seedBoxType(db, {
      carrier: 'postnord',
      name: 'PostNord Box M',
      internalHeightMm: 350,
      internalWidthMm: 250,
      internalDepthMm: 180,
      maxWeightG: 20000,
    });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/basket/optimize', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify(VALID_REQUEST),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('"packing"');
    expect(Object.keys(JSON.parse(text) as Record<string, unknown>)).toEqual(
      LEGACY_OPTIMIZE_KEYS,
    );
  });

  it('flag on appends the packing section — smallest sufficient box, COMPUTED, exact fill rate', async () => {
    const { db, d1 } = openMigratedD1();
    seedOptimizableProducts(db, [1]);
    seedDimension(db, {
      productId: 1,
      weightG: 400,
      heightMm: 250,
      diameterMm: 80,
      material: 'GLASS',
    });
    // Box 1 is too short for a 250 mm unit; box 2 is the smallest sufficient.
    seedBoxType(db, {
      carrier: 'postnord',
      name: 'PostNord Box S',
      internalHeightMm: 200,
      internalWidthMm: 200,
      internalDepthMm: 200,
      maxWeightG: 20000,
    });
    seedBoxType(db, {
      carrier: 'postnord',
      name: 'PostNord Box M',
      internalHeightMm: 350,
      internalWidthMm: 250,
      internalDepthMm: 180,
      maxWeightG: 20000,
    });
    const app = buildApp();

    const res = await request(
      app,
      permissiveEnv(d1, { FF_PACKING_OPTIMIZER: 'true' }),
      '/api/v1/basket/optimize',
      { method: 'POST', headers: JSON_HDRS, body: JSON.stringify(VALID_REQUEST) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(Object.keys(body)).toEqual([...LEGACY_OPTIMIZE_KEYS, 'packing']);
    expect(body.packing.status).toBe('COMPUTED');
    expect(body.packing.excludedItems).toEqual([]);
    expect(body.packing.mixingWarning).toBeNull();
    expect(body.packing.boxes).toHaveLength(1);
    const box = body.packing.boxes[0];
    expect(box).toMatchObject({
      boxTypeId: 2,
      carrier: 'postnord',
      boxName: 'PostNord Box M',
      items: [{ productId: 1, units: 2 }],
      totalWeightG: 800,
    });
    expect(box.fillRate).toBeCloseTo(
      (2 * (Math.PI * 40 ** 2 * 250)) / (350 * 250 * 180),
      12,
    );
  });

  it('flag on + missing dimension rows degrades to ESTIMATED with the excluded list — optimize itself still succeeds', async () => {
    const { db, d1 } = openMigratedD1();
    seedOptimizableProducts(db, [1]);
    seedBoxType(db, {
      carrier: 'postnord',
      name: 'PostNord Box M',
      internalHeightMm: 350,
      internalWidthMm: 250,
      internalDepthMm: 180,
      maxWeightG: 20000,
    });
    const app = buildApp();

    const res = await request(
      app,
      permissiveEnv(d1, { FF_PACKING_OPTIMIZER: 'true' }),
      '/api/v1/basket/optimize',
      { method: 'POST', headers: JSON_HDRS, body: JSON.stringify(VALID_REQUEST) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    // The optimization result itself is unaffected by the missing dimensions.
    expect(Array.isArray(body.shipments)).toBe(true);
    expect(body.totalCents).toBeGreaterThan(0);
    expect(body.packing).toEqual({
      status: 'ESTIMATED',
      boxes: [],
      excludedItems: [{ productId: 1, quantity: 2, reason: 'MISSING_DIMENSIONS' }],
      mixingWarning: null,
    });
  });

  it('flag on + empty box catalogue degrades to NO_FITTING_BOX exclusions, never an error', async () => {
    const { db, d1 } = openMigratedD1();
    seedOptimizableProducts(db, [1]);
    seedDimension(db, {
      productId: 1,
      weightG: 400,
      heightMm: 250,
      diameterMm: 80,
      material: 'GLASS',
    });
    const app = buildApp();

    const res = await request(
      app,
      permissiveEnv(d1, { FF_PACKING_OPTIMIZER: 'true' }),
      '/api/v1/basket/optimize',
      { method: 'POST', headers: JSON_HDRS, body: JSON.stringify(VALID_REQUEST) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.packing).toEqual({
      status: 'ESTIMATED',
      boxes: [],
      excludedItems: [{ productId: 1, quantity: 2, reason: 'NO_FITTING_BOX' }],
      mixingWarning: null,
    });
  });

  it('flag on mixing warning cites the observed figures and only the fired threshold', async () => {
    const { db, d1 } = openMigratedD1();
    seedOptimizableProducts(db, [1, 2]);
    seedDimension(db, {
      productId: 1,
      weightG: 400,
      heightMm: 250,
      diameterMm: 80,
      material: 'GLASS',
    });
    seedDimension(db, {
      productId: 2,
      weightG: 250,
      heightMm: 120,
      diameterMm: 70,
      material: 'CAN',
    });
    // One big box holds all 16 units: 8 glass + 8 cans = 16 > 12 → UNIT_COUNT
    // fires; 8×400 + 8×250 = 5200 g ≤ 10 000 → COMBINED_WEIGHT does not.
    seedBoxType(db, {
      carrier: 'dhl',
      name: 'DHL Paket L',
      internalHeightMm: 600,
      internalWidthMm: 400,
      internalDepthMm: 350,
      maxWeightG: 20000,
    });
    const app = buildApp();

    const res = await request(
      app,
      permissiveEnv(d1, { FF_PACKING_OPTIMIZER: 'true' }),
      '/api/v1/basket/optimize',
      {
        method: 'POST',
        headers: JSON_HDRS,
        body: JSON.stringify({
          items: [
            { productId: 1, quantity: 8 },
            { productId: 2, quantity: 8 },
          ],
          destination: 'FI',
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.packing.status).toBe('COMPUTED');
    expect(body.packing.excludedItems).toEqual([]);
    expect(body.packing.mixingWarning).toEqual({
      glassUnits: 8,
      canUnits: 8,
      glassWeightG: 3200,
      canWeightG: 2000,
      combinedWeightG: 5200,
      triggeredBy: ['UNIT_COUNT'],
    });
    expect(body.packing.boxes).toHaveLength(1);
    const box = body.packing.boxes[0];
    expect(box).toMatchObject({
      boxTypeId: 1,
      carrier: 'dhl',
      boxName: 'DHL Paket L',
      items: [
        { productId: 1, units: 8 },
        { productId: 2, units: 8 },
      ],
      totalWeightG: 5200,
    });
    expect(box.fillRate).toBeCloseTo(
      (8 * (Math.PI * 40 ** 2 * 250) + 8 * (Math.PI * 35 ** 2 * 120)) /
        (600 * 400 * 350),
      12,
    );
  });

  it('flag on serves the packing section on cache HITs too — same body, stable hash', async () => {
    const { db, d1 } = openMigratedD1();
    seedOptimizableProducts(db, [1]);
    seedDimension(db, {
      productId: 1,
      weightG: 400,
      heightMm: 250,
      diameterMm: 80,
      material: 'GLASS',
    });
    seedBoxType(db, {
      carrier: 'postnord',
      name: 'PostNord Box M',
      internalHeightMm: 350,
      internalWidthMm: 250,
      internalDepthMm: 180,
      maxWeightG: 20000,
    });
    const app = buildApp();
    const env = permissiveEnv(d1, { FF_PACKING_OPTIMIZER: 'true' });
    const init: RequestInit = {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify(VALID_REQUEST),
    };

    const first = await request(app, env, '/api/v1/basket/optimize', init);
    expect(first.headers.get('X-Cache')).toBe('MISS');
    const missHash = first.headers.get('X-Content-Hash');
    const missBody = (await first.json()) as Record<string, any>;
    expect(missBody.packing).toBeDefined();

    const second = await request(app, env, '/api/v1/basket/optimize', init);
    expect(second.headers.get('X-Cache')).toBe('HIT');
    expect(second.headers.get('X-Content-Hash')).toBe(missHash);
    // The cached payload stays flag-agnostic; the section is attached per
    // request, so the HIT body equals the MISS body including packing.
    expect(await second.json()).toEqual(missBody);
  });
});
