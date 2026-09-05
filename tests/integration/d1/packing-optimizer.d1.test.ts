/**
 * Packing-optimizer integration suite (task 3.5, change
 * product-roadmap-phases-1-4) — the packing section of
 * POST /api/v1/basket/optimize against the real stack: the FULL worker
 * app composition (createApp + guards + basket routes) over a real
 * migrated D1 (node:sqlite through the structural shim) with the REAL
 * curated carrier-box seed loaded (packages/data-platform/src/seed).
 *
 * Scope note — this file deliberately does NOT repeat the narrower
 * suites' bindings: box-selection/FFD internals, exclusion validation
 * order, and threshold arithmetic are pinned by the task-3.2 pure-module
 * unit tests, and the flag/section shape by the task-3.3 route tests
 * (fake-D1 harness). What only an integration run can prove, end to end
 * through the real optimize path (route → idempotency → repositories →
 * seeded D1):
 *
 * 1. missing-dimension degradation — a basket whose products lack
 *    product_dimensions rows optimizes fine (200) but packs as
 *    ESTIMATED, listing each unknown product MISSING_DIMENSIONS in
 *    basket order while known items still pack;
 * 2. warning thresholds at EXACT boundary values — 12 mixed units and
 *    10 000 g combined stay silent; one unit / one gram over warns with
 *    the exact observed figures and fired thresholds — driven through
 *    real inserted dimension rows against the real box catalogue, never
 *    by calling the pure module directly;
 * 3. flag-off omission — FF_PACKING_OPTIMIZER unset or explicitly
 *    'false' leaves the response with no `packing` key at all (exact
 *    legacy key list, not a falsy value), even with full packing data
 *    present;
 * 4. determinism — repeated optimize calls (same basket, same D1
 *    state) return byte-stable bodies including packing across
 *    MISS → HIT → HIT, and two independent identically-seeded D1
 *    states compute the identical packing section on fresh MISSes.
 *
 * Composition follows the 2.5 price-alerts d1 suite: the app/env/request
 * helpers come from the api-worker route harness (not duplicated), the
 * box catalogue from the committed seed module — the composition they
 * build IS the code under test.
 *
 * @module PackingOptimizerD1IntegrationTest
 */
import type { DatabaseSync } from 'node:sqlite';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  buildApp,
  openMigratedD1,
  permissiveEnv,
  request,
  seedOffer,
  seedProduct,
  seedTaxRule,
} from '../../../apps/api-worker/src/routes/__tests__/harness';
import { seedCarrierBoxTypes } from '../../../packages/data-platform/src/seed/carrier-box-types.seed';
import {
  MIXED_MATERIAL_MAX_COMBINED_WEIGHT_G,
  MIXED_MATERIAL_MAX_UNITS,
} from '../../../packages/core-domain/src/packing/thresholds';

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

/** JSON body + age confirmation — basket route request parity (3.3 tests). */
const JSON_HDRS = { 'content-type': 'application/json', 'x-age-confirmed': 'confirmed' };

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

/** The proven working optimize fixture (3.3 route-test parity): products
 * the optimizer resolves, plus the active excise/container-duty rules. */
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
     ) VALUES (?, ?, ?, ?, ?, 'packing-optimizer-d1-test', 'ESTIMATED', ?)`,
  ).run(
    dimension.productId,
    dimension.weightG,
    dimension.heightMm,
    dimension.diameterMm,
    dimension.material,
    new Date().toISOString(),
  );
}

/** Load the REAL curated box catalogue (PostNord + DHL S–XL) into D1. */
async function seedBoxCatalogue(
  d1: ReturnType<typeof openMigratedD1>['d1'],
): Promise<void> {
  await seedCarrierBoxTypes(d1);
}

/** Optimizable product + known glass dimensions + the real box seed. */
async function seedKnownGlassBasket(
  db: DatabaseSync,
  d1: ReturnType<typeof openMigratedD1>['d1'],
): Promise<void> {
  seedOptimizableProducts(db, [1]);
  seedDimension(db, {
    productId: 1,
    weightG: 400,
    heightMm: 250,
    diameterMm: 80,
    material: 'GLASS',
  });
  await seedBoxCatalogue(d1);
}

/** POST the given basket to the optimize route under a flag-on env. */
function optimizeRequest(
  app: ReturnType<typeof buildApp>,
  env: ReturnType<typeof permissiveEnv>,
  items: ReadonlyArray<{ readonly productId: number; readonly quantity: number }>,
): Promise<Response> {
  return request(app, env, '/api/v1/basket/optimize', {
    method: 'POST',
    headers: JSON_HDRS,
    body: JSON.stringify({ items, destination: 'FI' }),
  });
}

// ---------------------------------------------------------------------------
// 1. Missing-dimension degradation
// ---------------------------------------------------------------------------

describe('missing-dimension degradation through the optimize route', () => {
  let db: DatabaseSync;
  let d1: ReturnType<typeof openMigratedD1>['d1'];
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    const opened = openMigratedD1();
    db = opened.db;
    d1 = opened.d1;
    // Products 1 and 3 have dimensions (glass + can, mixing below every
    // threshold); products 2 and 4 are optimizer-known but dimensionless.
    seedOptimizableProducts(db, [1, 2, 3, 4]);
    seedDimension(db, {
      productId: 1,
      weightG: 100,
      heightMm: 100,
      diameterMm: 60,
      material: 'GLASS',
    });
    seedDimension(db, {
      productId: 3,
      weightG: 100,
      heightMm: 100,
      diameterMm: 60,
      material: 'CAN',
    });
    await seedBoxCatalogue(d1);
    app = buildApp();
  });

  afterEach(() => {
    db.close();
  });

  it('returns 200 with an ESTIMATED section: unknown products excluded MISSING_DIMENSIONS in basket order, known items still packed', async () => {
    const res = await optimizeRequest(
      app,
      permissiveEnv(d1, { FF_PACKING_OPTIMIZER: 'true' }),
      [
        { productId: 1, quantity: 2 },
        { productId: 2, quantity: 1 },
        { productId: 3, quantity: 3 },
        { productId: 4, quantity: 5 },
      ],
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;

    // The optimization itself is unaffected by the missing dimensions —
    // packing is advisory, never a failure.
    expect(Array.isArray(body.shipments)).toBe(true);
    expect(body.totalCents).toBeGreaterThan(0);

    // Section: the two dimensionless lines are named, in basket input
    // order, with their quantities as given.
    expect(body.packing.status).toBe('ESTIMATED');
    expect(body.packing.excludedItems).toEqual([
      { productId: 2, quantity: 1, reason: 'MISSING_DIMENSIONS' },
      { productId: 4, quantity: 5, reason: 'MISSING_DIMENSIONS' },
    ]);

    // The known items still pack — one smallest-sufficient box (PostNord
    // Box S holds 5 × 100 g units of 100 mm height / 60 mm diameter).
    expect(body.packing.boxes).toHaveLength(1);
    expect(body.packing.boxes[0]).toMatchObject({
      boxTypeId: 1,
      carrier: 'postnord',
      boxName: 'PostNord Box S',
      items: [
        { productId: 1, units: 2 },
        { productId: 3, units: 3 },
      ],
      totalWeightG: 500,
    });
    expect(body.packing.boxes[0].fillRate).toBeCloseTo(
      (5 * (Math.PI * 30 ** 2 * 100)) / (180 * 130 * 60),
      12,
    );

    // 5 mixed units / 500 g — mixing is present but below every threshold.
    expect(body.packing.mixingWarning).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Warning thresholds at exact boundary values — through the real
//    optimize path (real inserted dimensions, real box catalogue)
// ---------------------------------------------------------------------------

describe('mixing-warning thresholds at exact boundary values', () => {
  let db: DatabaseSync;
  let d1: ReturnType<typeof openMigratedD1>['d1'];
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    const opened = openMigratedD1();
    db = opened.db;
    d1 = opened.d1;
    app = buildApp();
  });

  afterEach(() => {
    db.close();
  });

  it('pins the threshold constants the boundary fixtures are built around', () => {
    // The boundary cases below use the documented figures (12 units /
    // 10 000 g) as literals; if the policy constants are retuned, this
    // pin breaks first and the fixtures must follow.
    expect(MIXED_MATERIAL_MAX_UNITS).toBe(12);
    expect(MIXED_MATERIAL_MAX_COMBINED_WEIGHT_G).toBe(10_000);
  });

  it('12 mixed units exactly (100 g each) → no warning — one PostNord Box S', async () => {
    seedOptimizableProducts(db, [1, 2]);
    seedDimension(db, {
      productId: 1,
      weightG: 100,
      heightMm: 100,
      diameterMm: 60,
      material: 'GLASS',
    });
    seedDimension(db, {
      productId: 2,
      weightG: 100,
      heightMm: 100,
      diameterMm: 60,
      material: 'CAN',
    });
    await seedBoxCatalogue(d1);

    const res = await optimizeRequest(
      app,
      permissiveEnv(d1, { FF_PACKING_OPTIMIZER: 'true' }),
      [
        { productId: 1, quantity: 6 },
        { productId: 2, quantity: 6 },
      ],
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;

    // Exactly AT the unit threshold (and 1200 g, far below the weight
    // threshold) is within the safe band: strict exceedance only.
    expect(body.packing.status).toBe('COMPUTED');
    expect(body.packing.excludedItems).toEqual([]);
    expect(body.packing.mixingWarning).toBeNull();
    expect(body.packing.boxes).toHaveLength(1);
    expect(body.packing.boxes[0]).toMatchObject({
      boxTypeId: 1,
      carrier: 'postnord',
      boxName: 'PostNord Box S',
      items: [
        { productId: 1, units: 6 },
        { productId: 2, units: 6 },
      ],
      totalWeightG: 1200,
    });
  });

  it('13 mixed units — one over the unit threshold → UNIT_COUNT warning with exact figures', async () => {
    seedOptimizableProducts(db, [1, 2]);
    seedDimension(db, {
      productId: 1,
      weightG: 100,
      heightMm: 100,
      diameterMm: 60,
      material: 'GLASS',
    });
    seedDimension(db, {
      productId: 2,
      weightG: 100,
      heightMm: 100,
      diameterMm: 60,
      material: 'CAN',
    });
    await seedBoxCatalogue(d1);

    const res = await optimizeRequest(
      app,
      permissiveEnv(d1, { FF_PACKING_OPTIMIZER: 'true' }),
      [
        { productId: 1, quantity: 7 },
        { productId: 2, quantity: 6 },
      ],
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;

    expect(body.packing.status).toBe('COMPUTED');
    expect(body.packing.excludedItems).toEqual([]);
    // Only the unit threshold fired; the weight figure is cited and is
    // still far below its own threshold.
    expect(body.packing.mixingWarning).toEqual({
      glassUnits: 7,
      canUnits: 6,
      glassWeightG: 700,
      canWeightG: 600,
      combinedWeightG: 1300,
      triggeredBy: ['UNIT_COUNT'],
    });
  });

  it('10 000 g combined exactly (4 mixed units) → no warning — weight split across two DHL Paket S boxes', async () => {
    seedOptimizableProducts(db, [1, 2]);
    // 2 × 3000 g glass + 2 × 2000 g cans = 10 000 g exactly at the weight
    // threshold, 4 units far below the unit threshold. 200 mm × 70 mm
    // units fit no PostNord S; the smallest sufficient catalogue box is
    // DHL Paket S (5000 g), so FFD opens exactly two of them.
    seedDimension(db, {
      productId: 1,
      weightG: 3000,
      heightMm: 200,
      diameterMm: 70,
      material: 'GLASS',
    });
    seedDimension(db, {
      productId: 2,
      weightG: 2000,
      heightMm: 200,
      diameterMm: 70,
      material: 'CAN',
    });
    await seedBoxCatalogue(d1);

    const res = await optimizeRequest(
      app,
      permissiveEnv(d1, { FF_PACKING_OPTIMIZER: 'true' }),
      [
        { productId: 1, quantity: 2 },
        { productId: 2, quantity: 2 },
      ],
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;

    expect(body.packing.status).toBe('COMPUTED');
    expect(body.packing.excludedItems).toEqual([]);
    expect(body.packing.mixingWarning).toBeNull();
    // FFD order ( productId asc at equal height/diameter ): g, g, c, c —
    // box 1 takes g + c (exactly 5000 g), box 2 the remaining g + c.
    expect(body.packing.boxes).toHaveLength(2);
    expect(body.packing.boxes[0]).toMatchObject({
      boxTypeId: 5,
      carrier: 'dhl',
      boxName: 'DHL Paket S',
      items: [
        { productId: 1, units: 1 },
        { productId: 2, units: 1 },
      ],
      totalWeightG: 5000,
    });
    expect(body.packing.boxes[1]).toMatchObject({
      boxTypeId: 5,
      carrier: 'dhl',
      boxName: 'DHL Paket S',
      items: [
        { productId: 1, units: 1 },
        { productId: 2, units: 1 },
      ],
      totalWeightG: 5000,
    });
  });

  it('10 001 g — one gram over the weight threshold → COMBINED_WEIGHT warning aggregated across boxes', async () => {
    seedOptimizableProducts(db, [1, 2]);
    // 1 × 3001 g glass + 2 × 3500 g cans = 10 001 g, 3 units far below
    // the unit threshold. Each unit needs its own DHL Paket S (5000 g
    // cap) — the warning must aggregate over all three boxes.
    seedDimension(db, {
      productId: 1,
      weightG: 3001,
      heightMm: 200,
      diameterMm: 70,
      material: 'GLASS',
    });
    seedDimension(db, {
      productId: 2,
      weightG: 3500,
      heightMm: 200,
      diameterMm: 70,
      material: 'CAN',
    });
    await seedBoxCatalogue(d1);

    const res = await optimizeRequest(
      app,
      permissiveEnv(d1, { FF_PACKING_OPTIMIZER: 'true' }),
      [
        { productId: 1, quantity: 1 },
        { productId: 2, quantity: 2 },
      ],
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;

    expect(body.packing.status).toBe('COMPUTED');
    expect(body.packing.excludedItems).toEqual([]);
    // Only the weight threshold fired — citing the exact observed grams.
    expect(body.packing.mixingWarning).toEqual({
      glassUnits: 1,
      canUnits: 2,
      glassWeightG: 3001,
      canWeightG: 7000,
      combinedWeightG: 10001,
      triggeredBy: ['COMBINED_WEIGHT'],
    });
    expect(body.packing.boxes).toHaveLength(3);
    expect(
      body.packing.boxes.map((box: { totalWeightG: number }) => box.totalWeightG),
    ).toEqual([3001, 3500, 3500]);
  });

  it('both thresholds breached → triggeredBy lists UNIT_COUNT before COMBINED_WEIGHT', async () => {
    seedOptimizableProducts(db, [1, 2]);
    // 13 × 800 g mixed units: 13 > 12 units and 10 400 > 10 000 g.
    seedDimension(db, {
      productId: 1,
      weightG: 800,
      heightMm: 100,
      diameterMm: 60,
      material: 'GLASS',
    });
    seedDimension(db, {
      productId: 2,
      weightG: 800,
      heightMm: 100,
      diameterMm: 60,
      material: 'CAN',
    });
    await seedBoxCatalogue(d1);

    const res = await optimizeRequest(
      app,
      permissiveEnv(d1, { FF_PACKING_OPTIMIZER: 'true' }),
      [
        { productId: 1, quantity: 7 },
        { productId: 2, quantity: 6 },
      ],
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;

    expect(body.packing.status).toBe('COMPUTED');
    expect(body.packing.excludedItems).toEqual([]);
    expect(body.packing.mixingWarning).toEqual({
      glassUnits: 7,
      canUnits: 6,
      glassWeightG: 5600,
      canWeightG: 4800,
      combinedWeightG: 10400,
      triggeredBy: ['UNIT_COUNT', 'COMBINED_WEIGHT'],
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Flag-off omission — no packing key at all, even with full packing data
// ---------------------------------------------------------------------------

describe('flag off: the optimize response omits the packing section entirely', () => {
  let db: DatabaseSync;
  let d1: ReturnType<typeof openMigratedD1>['d1'];
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    const opened = openMigratedD1();
    db = opened.db;
    d1 = opened.d1;
    // Richest possible packing state: known dimensions AND the real box
    // catalogue — none of it may leak into a flag-off response.
    await seedKnownGlassBasket(db, d1);
    app = buildApp();
  });

  afterEach(() => {
    db.close();
  });

  it('FF_PACKING_OPTIMIZER unset (default off) → exact legacy key list, no packing key', async () => {
    // permissiveEnv leaves FF_PACKING_OPTIMIZER unset — the flag service
    // defaults it off while BASKET_OPTIMIZATION stays on.
    const res = await optimizeRequest(app, permissiveEnv(d1), [
      { productId: 1, quantity: 2 },
    ]);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as Record<string, unknown>;
    // Key ABSENCE, not a falsy value: the exact flag-less key list.
    expect(Object.hasOwn(body, 'packing')).toBe(false);
    expect(Object.keys(body)).toEqual(LEGACY_OPTIMIZE_KEYS);
    expect(text).not.toContain('"packing"');
  });

  it("FF_PACKING_OPTIMIZER='false' → exact legacy key list, no packing key", async () => {
    const res = await optimizeRequest(
      app,
      permissiveEnv(d1, { FF_PACKING_OPTIMIZER: 'false' }),
      [{ productId: 1, quantity: 2 }],
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(Object.hasOwn(body, 'packing')).toBe(false);
    expect(Object.keys(body)).toEqual(LEGACY_OPTIMIZE_KEYS);
    expect(text).not.toContain('"packing"');
  });
});

// ---------------------------------------------------------------------------
// 4. Determinism across repeated optimize calls
// ---------------------------------------------------------------------------

describe('determinism across repeated optimize calls', () => {
  it('same basket, same D1 state: MISS → HIT → HIT bodies are identical, packing included, hash stable', async () => {
    const opened = openMigratedD1();
    try {
      await seedKnownGlassBasket(opened.db, opened.d1);
      const app = buildApp();
      // One env = one DO namespace set = one idempotency cache: the
      // repeats exercise the HIT path against the stored MISS result.
      const env = permissiveEnv(opened.d1, { FF_PACKING_OPTIMIZER: 'true' });
      const items = [{ productId: 1, quantity: 2 }];

      const first = await optimizeRequest(app, env, items);
      expect(first.status).toBe(200);
      expect(first.headers.get('X-Cache')).toBe('MISS');
      const missHash = first.headers.get('X-Content-Hash');
      const missBody = (await first.json()) as Record<string, any>;
      expect(missBody.packing).toBeDefined();

      for (const expectedCache of ['HIT', 'HIT']) {
        const repeat = await optimizeRequest(app, env, items);
        expect(repeat.status).toBe(200);
        expect(repeat.headers.get('X-Cache')).toBe(expectedCache);
        expect(repeat.headers.get('X-Content-Hash')).toBe(missHash);
        // Whole-body equality: the cached payload plus the re-attached
        // section is byte-for-byte the MISS body, packing included.
        expect(await repeat.json()).toEqual(missBody);
      }
    } finally {
      opened.db.close();
    }
  });

  it('two independent identically-seeded D1 states compute the identical packing section on fresh MISSes', async () => {
    const first = openMigratedD1();
    const second = openMigratedD1();
    try {
      await seedKnownGlassBasket(first.db, first.d1);
      await seedKnownGlassBasket(second.db, second.d1);
      const app = buildApp();
      const items = [{ productId: 1, quantity: 2 }];

      const res1 = await optimizeRequest(
        app,
        permissiveEnv(first.d1, { FF_PACKING_OPTIMIZER: 'true' }),
        items,
      );
      const res2 = await optimizeRequest(
        app,
        permissiveEnv(second.d1, { FF_PACKING_OPTIMIZER: 'true' }),
        items,
      );
      expect(res1.headers.get('X-Cache')).toBe('MISS');
      expect(res2.headers.get('X-Cache')).toBe('MISS');

      // The optimization metadata carries wall-clock provenance
      // (calculationTimestamp), so whole bodies may differ — but the
      // packing section is a pure function of the seeded state and must
      // be exactly equal.
      const body1 = (await res1.json()) as Record<string, any>;
      const body2 = (await res2.json()) as Record<string, any>;
      expect(body2.packing).toEqual(body1.packing);
    } finally {
      first.db.close();
      second.db.close();
    }
  });
});
