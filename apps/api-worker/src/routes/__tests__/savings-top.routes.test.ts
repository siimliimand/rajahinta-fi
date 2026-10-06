/**
 * Savings top-N route tests (task 1.1, change homepage-live-gap-hero)
 * over the FULL app composition (createApp() + registerSavingsRoutes —
 * the exact composition index.ts wires, age gate + SAVINGS limiter on
 * the route) on the fake-D1 harness.
 *
 * Pinning here (spec savings-discovery, "Public deterministic
 * cross-category top-N listing"):
 *   1. The deterministic import-favourable order — most negative gap
 *      first, name ascending on equal gaps, product id as the final
 *      tie — identical across repeated reads (byte-identical body).
 *   2. The eligibility defenses — a dearer-than-reference row, a row
 *      without a computed Alko reference, and a row whose product name
 *      no longer resolves from the registry are each excluded.
 *   3. No padding — fewer eligible rows than N returns exactly those;
 *      dearer rows never fill the list.
 *   4. The limit contract — default 5, malformed falls back to 5,
 *      clamped at 25.
 *   5. The honest zero states — empty list with coverage counts and a
 *      null as-of before the first pass, and with the day's as-of when
 *      only ineligible rows exist; never an error.
 *   6. The age gate (403 without confirmation) and per-row provenance.
 *   7. The recent-day fallback (change savings-top-day-fallback) — an
 *      eligible maximal day short-circuits; otherwise the newest day
 *      within the 3-day lookback holding an eligible row answers with
 *      ITS rows, as-of and coverage (exactly one day, never a mix);
 *      nothing eligible in the window answers honest-empty with the
 *      maximal as-of.
 *
 * @module SavingsTopRoutesTest
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
 * index.ts registers the handler behind its per-route age gate and
 * SAVINGS limiter; the test composition mirrors that exactly.
 */
function topApp(): ReturnType<typeof buildApp> {
  const app = buildApp();
  registerSavingsRoutes(app);
  return app;
}

const AGE_OK = { 'x-age-confirmed': 'confirmed-test-token' };

const AS_OF = '2026-09-08';

interface TopRowJson {
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

interface TopJson {
  asOf: string | null;
  coverage: { evaluated: number; importFavourable: number; listed: number };
  rows: TopRowJson[];
}

async function getTop(
  app: ReturnType<typeof buildApp>,
  env: Env,
  query = '',
): Promise<Response> {
  return request(app, env, `/api/v1/savings/top${query}`, { headers: AGE_OK });
}

/**
 * Seed one registry product plus its snapshot row (real repository).
 * `asOf` places the row on a snapshot day (defaults to AS_OF — the
 * multi-day fallback fixtures pass explicit days). `referenceCents:
 * null` seeds the reference-less row (with a null observation instant,
 * per the contract's "null with the reference").
 */
async function seedSnapshot(
  db: DatabaseSync,
  d1: D1DatabaseLike,
  seed: {
    productId: number;
    name: string;
    category: string;
    gapCents: number;
    gapBasisPoints: number;
    asOf?: string;
    referenceCents?: number | null;
    priceCents?: number;
    reliability?: SavingsReliabilityStatus;
    confidence?: SavingsConfidenceGrade;
  },
): Promise<void> {
  const asOf = seed.asOf ?? AS_OF;
  seedProduct(db, {
    id: seed.productId,
    name: seed.name,
    category: seed.category,
  });
  const input: SavingsSnapshotUpsertInput = {
    asOf,
    productId: seed.productId,
    category: seed.category,
    bestMerchant: 'saksoinet',
    bestMerchantCountry: 'EE',
    bestPriceCents: seed.priceCents ?? 500,
    bestObservedAt: new Date(`${asOf}T12:00:00.000Z`),
    alkoReferenceCents: seed.referenceCents === undefined ? 1000 : seed.referenceCents,
    alkoObservedAt:
      seed.referenceCents === null ? null : new Date(`${asOf}T09:00:00.000Z`),
    landedTotalCents: 1200,
    landedReliability: seed.reliability ?? 'ESTIMATED',
    confidence: seed.confidence ?? 'HIGH',
    gapCents: seed.gapCents,
    gapBasisPoints: seed.gapBasisPoints,
    taxDatasetVersion: 'v3.0-2026',
    referenceLinkId: null,
  };
  await new D1SavingsSnapshotRepository(d1).upsertSnapshot(input);
}

describe('GET /api/v1/savings/top — deterministic import-favourable order', () => {
  it('lists the most import-favourable gap first, with the name-then-id tiebreak, and repeats byte-identically', async () => {
    const { db, d1 } = openMigratedD1();
    // Inserted out of order on purpose: the equal-gap pair (Aurora/Cider,
    // −750 bps) breaks by name ascending, the equal-gap same-name pair
    // (ids 5 and 4) by product id ascending — neither by insertion order.
    await seedSnapshot(db, d1, { productId: 5, name: 'Twin Ale', category: 'beer', gapCents: -100, gapBasisPoints: -250 });
    await seedSnapshot(db, d1, { productId: 4, name: 'Twin Ale', category: 'beer', gapCents: -100, gapBasisPoints: -250 });
    await seedSnapshot(db, d1, { productId: 1, name: 'Aurora Lager', category: 'beer', gapCents: -300, gapBasisPoints: -750 });
    await seedSnapshot(db, d1, { productId: 3, name: 'Cider Zest', category: 'beer', gapCents: -300, gapBasisPoints: -750 });
    await seedSnapshot(db, d1, { productId: 2, name: 'Borealis Porter', category: 'beer', gapCents: -200, gapBasisPoints: -500 });
    const app = topApp();
    const env = permissiveEnv(d1);

    const first = await getTop(app, env);
    expect(first.status).toBe(200);
    const firstText = await first.text();
    const second = await getTop(app, env);
    // Byte-identical across reads: key order and row order are fixed by
    // construction, not by D1 row order.
    expect(await second.text()).toBe(firstText);

    const body = JSON.parse(firstText) as TopJson;
    expect(body.asOf).toBe(AS_OF);
    expect(body.rows.map((r) => r.productId)).toEqual([1, 3, 2, 4, 5]);
    expect(body.rows.map((r) => r.gapBasisPoints)).toEqual([
      -750, -750, -500, -250, -250,
    ]);
    // Coverage: registry count / eligible-before-slice / returned rows.
    expect(body.coverage).toEqual({ evaluated: 5, importFavourable: 5, listed: 5 });

    // Full row provenance on every figure-bearing field.
    const row = body.rows[0]!;
    expect(Object.keys(row).sort()).toEqual([
      'alkoObservedAt', 'alkoReferenceCents', 'category', 'confidence',
      'gapBasisPoints', 'gapCents', 'landedTotalCents', 'merchant',
      'merchantCountry', 'observedAt', 'priceCents', 'productId',
      'productName', 'reliability', 'taxDatasetVersion',
    ]);
    expect(row).toMatchObject({
      productId: 1,
      productName: 'Aurora Lager',
      category: 'beer',
      merchant: 'saksoinet',
      merchantCountry: 'EE',
      priceCents: 500,
      landedTotalCents: 1200,
      alkoReferenceCents: 1000,
      gapCents: -300,
      gapBasisPoints: -750,
      reliability: 'ESTIMATED',
      confidence: 'HIGH',
      taxDatasetVersion: 'v3.0-2026',
    });
    expect(row.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row.alkoObservedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('GET /api/v1/savings/top — eligibility matches the listing defenses', () => {
  it('excludes a dearer row, a null-reference row, and an unresolved-name row', async () => {
    const { db, d1 } = openMigratedD1();
    // The one eligible row; the dearer row is import-UNfavourable and the
    // no-reference row lacks a computed reference.
    await seedSnapshot(db, d1, { productId: 1, name: 'Cheaper Ale', category: 'beer', gapCents: -400, gapBasisPoints: -1000 });
    await seedSnapshot(db, d1, { productId: 2, name: 'Dearer Ale', category: 'beer', gapCents: 200, gapBasisPoints: 500 });
    await seedSnapshot(db, d1, { productId: 3, name: 'No Ref Ale', category: 'beer', gapCents: -400, gapBasisPoints: -1000, referenceCents: null });
    // The stale row: its registry row is gone while the snapshot row
    // survives. The snapshot FK makes that state unreachable on the write
    // path — corrupt data, exactly what the defense must omit — so the
    // fixture manufactures it with a scoped FK toggle.
    await seedSnapshot(db, d1, { productId: 4, name: 'Ghost Ale', category: 'beer', gapCents: -400, gapBasisPoints: -1000 });
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare('DELETE FROM product_master WHERE id = 4').run();
    db.exec('PRAGMA foreign_keys = ON');
    const app = topApp();

    const body = (await (await getTop(app, permissiveEnv(d1))).json()) as TopJson;

    expect(body.rows.map((r) => r.productName)).toEqual(['Cheaper Ale']);
    // evaluated counts registry products only (the ghost has none);
    // importFavourable counts eligible rows before the slice.
    expect(body.coverage).toEqual({ evaluated: 3, importFavourable: 1, listed: 1 });
  });
});

describe('GET /api/v1/savings/top — no padding beyond what qualifies', () => {
  it('returns exactly the eligible rows when fewer exist than the limit, never dearer filler', async () => {
    const { db, d1 } = openMigratedD1();
    await seedSnapshot(db, d1, { productId: 1, name: 'Ale A', category: 'beer', gapCents: -100, gapBasisPoints: -250 });
    await seedSnapshot(db, d1, { productId: 2, name: 'Ale B', category: 'beer', gapCents: -200, gapBasisPoints: -500 });
    await seedSnapshot(db, d1, { productId: 3, name: 'Ale C', category: 'beer', gapCents: -300, gapBasisPoints: -750 });
    // Dearer than the reference — the padding candidate that must stay out.
    await seedSnapshot(db, d1, { productId: 4, name: 'Dearer Ale', category: 'beer', gapCents: 200, gapBasisPoints: 500 });
    const app = topApp();

    const body = (await (
      await getTop(app, permissiveEnv(d1), '?limit=5')
    ).json()) as TopJson;

    expect(body.rows.map((r) => r.productName)).toEqual([
      'Ale C', 'Ale B', 'Ale A',
    ]);
    expect(body.rows).toHaveLength(3);
    expect(body.coverage).toEqual({ evaluated: 4, importFavourable: 3, listed: 3 });
  });
});

describe('GET /api/v1/savings/top — recent-day fallback (savings-top-day-fallback)', () => {
  // Three consecutive days — LATEST is the maximal snapshot day the
  // fallback walks from, THREE_BACK is the lookback window's last day,
  // FOUR_BACK lies already outside it.
  const LATEST = '2026-10-06';
  const YESTERDAY = '2026-10-05';
  const THREE_BACK = '2026-10-04';
  const FOUR_BACK = '2026-10-03';

  it('short-circuits on an eligible maximal day — no fallback, no older-day rows', async () => {
    const { db, d1 } = openMigratedD1();
    // The maximal day IS eligible — the older eligible days must be
    // ignored entirely.
    await seedSnapshot(db, d1, { productId: 1, name: 'Fresh Ale', category: 'beer', gapCents: -300, gapBasisPoints: -750, asOf: LATEST });
    await seedSnapshot(db, d1, { productId: 2, name: 'Fresh Porter', category: 'beer', gapCents: -200, gapBasisPoints: -500, asOf: LATEST });
    await seedSnapshot(db, d1, { productId: 3, name: 'Old Ale', category: 'beer', gapCents: -400, gapBasisPoints: -1000, asOf: YESTERDAY });
    await seedSnapshot(db, d1, { productId: 4, name: 'Older Ale', category: 'beer', gapCents: -500, gapBasisPoints: -1250, asOf: THREE_BACK });
    const app = topApp();

    const body = (await (await getTop(app, permissiveEnv(d1))).json()) as TopJson;

    expect(body.asOf).toBe(LATEST);
    expect(body.rows.map((r) => r.productName)).toEqual([
      'Fresh Ale', 'Fresh Porter',
    ]);
    expect(body.coverage).toEqual({ evaluated: 4, importFavourable: 2, listed: 2 });
  });

  it('falls back to yesterday when the maximal day has only ineligible rows', async () => {
    const { db, d1 } = openMigratedD1();
    // The maximal day is materialized but yields nothing eligible — one
    // row dearer than its reference, one without a computed reference.
    await seedSnapshot(db, d1, { productId: 1, name: 'Dearer Ale', category: 'beer', gapCents: 200, gapBasisPoints: 500, asOf: LATEST });
    await seedSnapshot(db, d1, { productId: 2, name: 'No Ref Ale', category: 'beer', gapCents: -400, gapBasisPoints: -1000, referenceCents: null, asOf: LATEST });
    // Yesterday IS eligible — and the older eligible day stays out:
    // the answer is exactly ONE day, never a mix.
    await seedSnapshot(db, d1, { productId: 3, name: 'Yesterday Ale', category: 'beer', gapCents: -400, gapBasisPoints: -1000, asOf: YESTERDAY });
    await seedSnapshot(db, d1, { productId: 4, name: 'Yesterday Porter', category: 'beer', gapCents: -200, gapBasisPoints: -500, asOf: YESTERDAY });
    await seedSnapshot(db, d1, { productId: 5, name: 'Stale Ale', category: 'beer', gapCents: -600, gapBasisPoints: -1500, asOf: THREE_BACK });
    const app = topApp();

    const body = (await (await getTop(app, permissiveEnv(d1))).json()) as TopJson;

    expect(body.asOf).toBe(YESTERDAY);
    expect(body.rows.map((r) => r.productName)).toEqual([
      'Yesterday Ale', 'Yesterday Porter',
    ]);
    // Coverage counts over the SELECTED day: 2 eligible rows there.
    expect(body.coverage).toEqual({ evaluated: 5, importFavourable: 2, listed: 2 });
  });

  it('reaches the window\'s last day (3 back) when only it is eligible', async () => {
    const { db, d1 } = openMigratedD1();
    await seedSnapshot(db, d1, { productId: 1, name: 'Dearer Ale', category: 'beer', gapCents: 200, gapBasisPoints: 500, asOf: LATEST });
    await seedSnapshot(db, d1, { productId: 2, name: 'Dearer Too', category: 'beer', gapCents: 300, gapBasisPoints: 750, asOf: YESTERDAY });
    // The window's last day is the only eligible one.
    await seedSnapshot(db, d1, { productId: 3, name: 'Three-Back Ale', category: 'beer', gapCents: -400, gapBasisPoints: -1000, asOf: THREE_BACK });
    await seedSnapshot(db, d1, { productId: 4, name: 'Three-Back Porter', category: 'beer', gapCents: -200, gapBasisPoints: -500, asOf: THREE_BACK });
    // Also eligible but OLDER than the 3-back day: proves the walk takes
    // the NEWEST eligible day within the window, not the oldest.
    await seedSnapshot(db, d1, { productId: 5, name: 'Four-Back Ale', category: 'beer', gapCents: -600, gapBasisPoints: -1500, asOf: FOUR_BACK });
    const app = topApp();

    const body = (await (await getTop(app, permissiveEnv(d1))).json()) as TopJson;

    expect(body.asOf).toBe(THREE_BACK);
    expect(body.rows.map((r) => r.productName)).toEqual([
      'Three-Back Ale', 'Three-Back Porter',
    ]);
    expect(body.coverage).toEqual({ evaluated: 5, importFavourable: 2, listed: 2 });
  });

  it('answers honest-empty with the maximal as-of when no day in the window is eligible', async () => {
    const { db, d1 } = openMigratedD1();
    await seedSnapshot(db, d1, { productId: 1, name: 'Dearer Ale', category: 'beer', gapCents: 200, gapBasisPoints: 500, asOf: LATEST });
    await seedSnapshot(db, d1, { productId: 2, name: 'Dearer Too', category: 'beer', gapCents: 300, gapBasisPoints: 750, asOf: YESTERDAY });
    await seedSnapshot(db, d1, { productId: 3, name: 'Dearer Three', category: 'beer', gapCents: 400, gapBasisPoints: 1000, asOf: THREE_BACK });
    // Eligible — but OUTSIDE the 3-day window: it must not rescue the
    // answer with stale days (spec: honest zero state).
    await seedSnapshot(db, d1, { productId: 4, name: 'Four-Back Ale', category: 'beer', gapCents: -600, gapBasisPoints: -1500, asOf: FOUR_BACK });
    const app = topApp();

    const res = await getTop(app, permissiveEnv(d1));
    expect(res.status).toBe(200);
    const body = (await res.json()) as TopJson;
    expect(body.asOf).toBe(LATEST);
    expect(body.rows).toEqual([]);
    expect(body.coverage).toEqual({ evaluated: 4, importFavourable: 0, listed: 0 });
  });
});

describe('GET /api/v1/savings/top — limit default, fallback, and clamp', () => {
  async function seedTwentySeven(db: DatabaseSync, d1: D1DatabaseLike): Promise<void> {
    for (let id = 1; id <= 27; id++) {
      await seedSnapshot(db, d1, {
        productId: id,
        name: `Bulk Ale ${id}`,
        category: 'beer',
        gapCents: -id,
        gapBasisPoints: -id * 10,
      });
    }
  }

  it('defaults to 5, falls back to 5 on a malformed limit, and clamps above 25', async () => {
    const { db, d1 } = openMigratedD1();
    await seedTwentySeven(db, d1);
    const app = topApp();
    const env = permissiveEnv(d1);

    // No limit param → the default 5, most import-favourable first.
    const defaulted = (await (await getTop(app, env)).json()) as TopJson;
    expect(defaulted.rows).toHaveLength(5);
    expect(defaulted.rows[0]!.productId).toBe(27);
    expect(defaulted.coverage).toEqual({ evaluated: 27, importFavourable: 27, listed: 5 });

    // Malformed → the same fallback, never a 400 on a read.
    const malformed = (await (
      await getTop(app, env, '?limit=potato')
    ).json()) as TopJson;
    expect(malformed.rows).toHaveLength(5);

    // Above the hard cap → clamped to 25.
    const overMax = (await (
      await getTop(app, env, '?limit=999')
    ).json()) as TopJson;
    expect(overMax.rows).toHaveLength(25);
    expect(overMax.coverage.listed).toBe(25);
    // The count above the clamp stays honest.
    expect(overMax.coverage.importFavourable).toBe(27);
  });
});

describe('GET /api/v1/savings/top — honest zero states', () => {
  it('answers with a null as-of and zeroed counts before the first pass', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Aurora Lager', category: 'beer' });
    const app = topApp();

    const res = await getTop(app, permissiveEnv(d1));
    expect(res.status).toBe(200);
    const body = (await res.json()) as TopJson;
    expect(body.asOf).toBeNull();
    expect(body.rows).toEqual([]);
    expect(body.coverage).toEqual({ evaluated: 1, importFavourable: 0, listed: 0 });
  });

  it('answers an empty list with the day as-of when only ineligible rows exist', async () => {
    const { db, d1 } = openMigratedD1();
    // The day is materialized, but nothing is import-favourable.
    await seedSnapshot(db, d1, { productId: 1, name: 'Dearer Ale', category: 'beer', gapCents: 200, gapBasisPoints: 500 });
    const app = topApp();

    const body = (await (await getTop(app, permissiveEnv(d1))).json()) as TopJson;
    expect(body.asOf).toBe(AS_OF);
    expect(body.rows).toEqual([]);
    expect(body.coverage).toEqual({ evaluated: 1, importFavourable: 0, listed: 0 });
  });
});

describe('GET /api/v1/savings/top — age gate', () => {
  it('denies an unconfirmed caller with 403 AGE_GATE_REQUIRED and admits a confirmed one', async () => {
    const { db, d1 } = openMigratedD1();
    await seedSnapshot(db, d1, { productId: 1, name: 'Aurora Lager', category: 'beer', gapCents: -300, gapBasisPoints: -750 });
    const app = topApp();
    const env = permissiveEnv(d1);

    await expectEnvelope(
      await request(app, env, '/api/v1/savings/top', {}),
      403,
      { error: 'Forbidden', code: 'AGE_GATE_REQUIRED' },
    );
    expect((await getTop(app, env)).status).toBe(200);
  });
});
