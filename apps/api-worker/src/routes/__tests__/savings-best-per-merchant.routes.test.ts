/**
 * Savings best-per-merchant route tests (task 1.3, change
 * savings-first-catalog-and-prefill) over the FULL app composition
 * (buildApp() + registerSavingsRoutes — the exact composition index.ts
 * wires, age gate + SAVINGS limiter on the route) on the fake-D1
 * harness.
 *
 * Pinning here (spec savings-discovery, "Best deal per merchant
 * listing"):
 *   1. One row per cross-border merchant — that merchant's row with
 *      the largest |gapCents| (the sign never filters; the magnitude
 *      decides) — with merchant `alko` excluded: the domestic reference
 *      is the comparison side, not a deal provider.
 *   2. The deterministic tie-break — equal absolute gaps select the
 *      lower product id — and the merchant order (name ascending,
 *      code-unit), identical across repeated reads (byte-identical
 *      body).
 *   3. The listing's staleness defenses — a row without a computed
 *      Alko reference or whose product name no longer resolves from
 *      the registry is omitted; a merchant left without rows
 *      disappears (no empty entry is manufactured).
 *   4. The honest zero states — an empty list with a null as-of before
 *      the first materialization, and with the day's as-of when only
 *      alko rows exist; 200, never an error.
 *   5. The age gate (403 without confirmation) and per-row provenance.
 *
 * @module SavingsBestPerMerchantRoutesTest
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
import type { SavingsSnapshotUpsertInput } from '../../../../../packages/data-platform/src/abstracts';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

/**
 * index.ts registers the handler behind its per-route age gate and
 * SAVINGS limiter; the test composition mirrors that exactly.
 */
function bestPerMerchantApp(): ReturnType<typeof buildApp> {
  const app = buildApp();
  registerSavingsRoutes(app);
  return app;
}

const AGE_OK = { 'x-age-confirmed': 'confirmed-test-token' };

const AS_OF = '2026-09-08';

interface MerchantRowJson {
  productId: number;
  productName: string;
  category: string;
  merchant: string;
  merchantCountry: string;
  priceCents: number;
  observedAt: string;
  landedTotalCents: number;
  alkoReferenceCents: number;
  alkoObservedAt: string | null;
  gapCents: number;
  gapBasisPoints: number;
  reliability: string;
  confidence: string;
  taxDatasetVersion: string;
}

interface BestPerMerchantJson {
  asOf: string | null;
  merchants: MerchantRowJson[];
}

async function getBestPerMerchant(
  app: ReturnType<typeof buildApp>,
  env: Env,
): Promise<Response> {
  return request(app, env, '/api/v1/savings/best-per-merchant', {
    headers: AGE_OK,
  });
}

/**
 * Seed one registry product plus its snapshot row (real repository).
 * `referenceCents: null` seeds the reference-less row (with a null
 * observation instant, per the contract's "null with the reference").
 */
async function seedSnapshot(
  db: DatabaseSync,
  d1: D1DatabaseLike,
  seed: {
    productId: number;
    name: string;
    category?: string;
    merchant: string;
    merchantCountry?: string;
    gapCents: number;
    gapBasisPoints: number;
    referenceCents?: number | null;
    priceCents?: number;
  },
): Promise<void> {
  seedProduct(db, {
    id: seed.productId,
    name: seed.name,
    category: seed.category ?? 'beer',
  });
  const input: SavingsSnapshotUpsertInput = {
    asOf: AS_OF,
    productId: seed.productId,
    category: seed.category ?? 'beer',
    bestMerchant: seed.merchant,
    bestMerchantCountry: seed.merchantCountry ?? 'EE',
    bestPriceCents: seed.priceCents ?? 500,
    bestObservedAt: new Date(`${AS_OF}T12:00:00.000Z`),
    alkoReferenceCents: seed.referenceCents === undefined ? 1000 : seed.referenceCents,
    alkoObservedAt:
      seed.referenceCents === null ? null : new Date(`${AS_OF}T09:00:00.000Z`),
    landedTotalCents: 1200,
    landedReliability: 'ESTIMATED',
    confidence: 'HIGH',
    gapCents: seed.gapCents,
    gapBasisPoints: seed.gapBasisPoints,
    taxDatasetVersion: 'v3.0-2026',
    referenceLinkId: null,
  };
  await new D1SavingsSnapshotRepository(d1).upsertSnapshot(input);
}

describe('GET /api/v1/savings/best-per-merchant — one row per cross-border merchant', () => {
  it("lists each merchant's largest-|gap| row, whatever the gap's sign, and excludes alko", async () => {
    const { db, d1 } = openMigratedD1();
    // The spec scenario's merchant set plus the alko reference: two
    // rows per cross-border merchant with different |gaps|, seeded out
    // of order — the argmax must win on magnitude alone, and alko must
    // never appear (its rows materialize as the domestic reference
    // side).
    await seedSnapshot(db, d1, { productId: 1, name: 'Alks Lager', merchant: 'alks', gapCents: -300, gapBasisPoints: -750 });
    await seedSnapshot(db, d1, { productId: 2, name: 'Alks Special', merchant: 'alks', gapCents: 800, gapBasisPoints: 2000 });
    await seedSnapshot(db, d1, { productId: 4, name: 'Longero Vodka', merchant: 'longero', gapCents: -600, gapBasisPoints: -1500 });
    await seedSnapshot(db, d1, { productId: 3, name: 'Longero Rum', merchant: 'longero', gapCents: -150, gapBasisPoints: -375 });
    await seedSnapshot(db, d1, { productId: 5, name: 'Kippis Cider', merchant: 'kippis', gapCents: -200, gapBasisPoints: -500 });
    await seedSnapshot(db, d1, { productId: 6, name: 'MyDrink Gin', merchant: 'mydrink', gapCents: -900, gapBasisPoints: -2250 });
    await seedSnapshot(db, d1, { productId: 7, name: 'Alko Only', merchant: 'alko', merchantCountry: 'FI', gapCents: -5000, gapBasisPoints: -12500 });
    const app = bestPerMerchantApp();

    const res = await getBestPerMerchant(app, permissiveEnv(d1));
    expect(res.status).toBe(200);
    const body = (await res.json()) as BestPerMerchantJson;

    // Exactly one row per cross-border merchant; the domestic
    // reference is absent. Merchants sort by name ascending (code-unit).
    expect(body.merchants.map((m) => m.merchant)).toEqual([
      'alks', 'kippis', 'longero', 'mydrink',
    ]);
    // Per-merchant argmax |gapCents|: alks' dearer row (|800|) beats
    // its cheaper row (|300|) — the magnitude decides, not the sign.
    expect(body.merchants.map((m) => m.productId)).toEqual([2, 5, 4, 6]);
    expect(body.merchants.map((m) => m.gapCents)).toEqual([800, -200, -600, -900]);
    expect(body.asOf).toBe(AS_OF);

    // Full row provenance on every figure-bearing field (the listing's
    // SavingsRowJson shape).
    const row = body.merchants[0]!;
    expect(Object.keys(row).sort()).toEqual([
      'alkoObservedAt', 'alkoReferenceCents', 'category', 'confidence',
      'gapBasisPoints', 'gapCents', 'landedTotalCents', 'merchant',
      'merchantCountry', 'observedAt', 'priceCents', 'productId',
      'productName', 'reliability', 'taxDatasetVersion',
    ]);
    expect(row).toMatchObject({
      productId: 2,
      productName: 'Alks Special',
      category: 'beer',
      merchant: 'alks',
      merchantCountry: 'EE',
      priceCents: 500,
      landedTotalCents: 1200,
      alkoReferenceCents: 1000,
      gapCents: 800,
      gapBasisPoints: 2000,
      reliability: 'ESTIMATED',
      confidence: 'HIGH',
      taxDatasetVersion: 'v3.0-2026',
    });
    expect(row.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row.alkoObservedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('GET /api/v1/savings/best-per-merchant — deterministic tie-break and byte-identical reads', () => {
  it('breaks an equal absolute gap by the lower product id and repeats byte-identically', async () => {
    const { db, d1 } = openMigratedD1();
    // One merchant, two rows with the SAME absolute gap (opposite
    // signs), seeded out of id order — the lower product id must win,
    // never the insertion order or the sign.
    await seedSnapshot(db, d1, { productId: 5, name: 'Twin Ale Five', merchant: 'saksoinet', gapCents: 100, gapBasisPoints: 250 });
    await seedSnapshot(db, d1, { productId: 4, name: 'Twin Ale Four', merchant: 'saksoinet', gapCents: -100, gapBasisPoints: -250 });
    const app = bestPerMerchantApp();
    const env = permissiveEnv(d1);

    const first = await getBestPerMerchant(app, env);
    expect(first.status).toBe(200);
    const firstText = await first.text();
    const second = await getBestPerMerchant(app, env);
    // Byte-identical across reads: key order, row order, and the
    // tie-break are fixed by construction, not by D1 row order.
    expect(await second.text()).toBe(firstText);

    const body = JSON.parse(firstText) as BestPerMerchantJson;
    expect(body.merchants).toHaveLength(1);
    expect(body.merchants[0]!.productId).toBe(4);
  });
});

describe('GET /api/v1/savings/best-per-merchant — staleness defenses', () => {
  it('omits a null-reference row and an unresolved-name row; an emptied merchant disappears', async () => {
    const { db, d1 } = openMigratedD1();
    // Kept Ale wins kippis: the null-reference row would carry the
    // larger |gap| but fails the sufficient-data defense.
    await seedSnapshot(db, d1, { productId: 1, name: 'Kept Ale', merchant: 'kippis', gapCents: -100, gapBasisPoints: -250 });
    await seedSnapshot(db, d1, { productId: 2, name: 'No Ref Ale', merchant: 'kippis', gapCents: -900, gapBasisPoints: -2250, referenceCents: null });
    // The ghost row is longero's ONLY row — the whole merchant must
    // vanish rather than render with a guessed name. The snapshot FK
    // makes that state unreachable on the write path — corrupt data,
    // exactly what the defense must omit — so the fixture manufactures
    // it with a scoped FK toggle.
    await seedSnapshot(db, d1, { productId: 3, name: 'Ghost Rum', merchant: 'longero', gapCents: -800, gapBasisPoints: -2000 });
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare('DELETE FROM product_master WHERE id = 3').run();
    db.exec('PRAGMA foreign_keys = ON');
    const app = bestPerMerchantApp();

    const body = (await (
      await getBestPerMerchant(app, permissiveEnv(d1))
    ).json()) as BestPerMerchantJson;

    expect(body.merchants.map((m) => m.merchant)).toEqual(['kippis']);
    expect(body.merchants[0]!.productId).toBe(1);
  });
});

describe('GET /api/v1/savings/best-per-merchant — honest zero states', () => {
  it('answers 200 with an empty list and a null as-of before the first materialization', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Aurora Lager', category: 'beer' });
    const app = bestPerMerchantApp();

    const res = await getBestPerMerchant(app, permissiveEnv(d1));
    expect(res.status).toBe(200);
    const body = (await res.json()) as BestPerMerchantJson;
    expect(body.asOf).toBeNull();
    expect(body.merchants).toEqual([]);
  });

  it('answers an empty list with the day as-of when only alko rows materialized', async () => {
    const { db, d1 } = openMigratedD1();
    await seedSnapshot(db, d1, { productId: 1, name: 'Domestic Ref', merchant: 'alko', merchantCountry: 'FI', gapCents: -500, gapBasisPoints: -1250 });
    const app = bestPerMerchantApp();

    const body = (await (
      await getBestPerMerchant(app, permissiveEnv(d1))
    ).json()) as BestPerMerchantJson;
    expect(body.asOf).toBe(AS_OF);
    expect(body.merchants).toEqual([]);
  });
});

describe('GET /api/v1/savings/best-per-merchant — age gate', () => {
  it('denies an unconfirmed caller with 403 AGE_GATE_REQUIRED and admits a confirmed one', async () => {
    const { db, d1 } = openMigratedD1();
    await seedSnapshot(db, d1, { productId: 1, name: 'Aurora Lager', merchant: 'kippis', gapCents: -300, gapBasisPoints: -750 });
    const app = bestPerMerchantApp();
    const env = permissiveEnv(d1);

    await expectEnvelope(
      await request(app, env, '/api/v1/savings/best-per-merchant', {}),
      403,
      { error: 'Forbidden', code: 'AGE_GATE_REQUIRED' },
    );
    expect((await getBestPerMerchant(app, env)).status).toBe(200);
  });
});
