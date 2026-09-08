/**
 * Trip fill route tests (task 8.2, change trust-and-reach-roadmap) —
 * POST /api/v1/trip/fill over the REAL AllowanceFillService composed
 * with the real D1 port adapters (fake-D1 harness + committed
 * migrations), trip-feasibility.routes.test.ts parity:
 *
 * - session/entitlement guards: anonymous callers get the standard 401;
 *   the requireFeature paywall seam rejects when the tier gate is
 *   raised (every tier is FREE today, so the pin raises the map entry
 *   and restores it).
 * - CALCULATOR rate-limit profile (the trip calculator's own).
 * - the ferry block's display-only isolation: the fill bytes are
 *   identical with zero, one, and many published ferry rows (spec:
 *   ferry offers stay display-only) and raw urls never leak.
 * - honest engine states: BOUND_EXHAUSTED / NO_BOUNDABLE_LINE are 200
 *   result bodies, never errors; dataset-version provenance carriage
 *   and version-aware idempotency under an allowance bump.
 *
 * @module TripRoutesTest
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import {
  buildApp,
  expectEnvelope,
  openMigratedD1,
  permissiveEnv,
  issueSessionToken,
  request,
  seedAccount,
  seedOffer,
  seedProduct,
} from './harness';
import { registerTripRoutes } from '../trip.routes';
import { D1TravellerAllowancesRepository } from '../../../../../packages/data-platform/src/repositories/d1/traveller-allowances.repository';
import { D1FerryOffersRepository } from '../../../../../packages/data-platform/src/repositories/d1/ferry-offers.repository';
import { FEATURE_TIER_MAP } from '../../../../../packages/core-domain/src/entitlement/entitlement.types';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

/**
 * index.ts registers the fill handler behind its guard chain (rate
 * limit → session auth → entitlement); the test composition mirrors
 * that exactly.
 */
function fillApp(): ReturnType<typeof buildApp> {
  const app = buildApp();
  registerTripRoutes(app);
  return app;
}

function fillEnv(d1: D1DatabaseLike, overrides: Partial<Env> = {}): Env {
  return permissiveEnv(d1, overrides);
}

const CITATION =
  'Commission Directive 2007/74/EC, Annex (https://eur-lex.europa.example/32007L0074)';

const FILL = {
  travelDate: '2026-06-01',
  items: [
    { productId: 1, maxQuantity: 10 },
    { productId: 2, maxQuantity: 10 },
  ],
};

interface FillLineJson {
  productId: number;
  category: string;
  merchant: string;
  unitPriceCents: number;
  maxQuantity: number;
  filledQuantity: number;
  valueContributionCents: number;
  consumedVolumeLitres: number;
  status: string;
  headroomAfter: Record<string, unknown> | null;
}

interface FillJson {
  status: string;
  travelDate: string;
  allowanceDatasetVersion?: string;
  filledValueCents?: number;
  filledUnits?: number;
  lines?: FillLineJson[];
  categoryHeadroom?: Record<string, unknown>[];
  disclaimer?: { text: string; language: string; version: string };
  metadata?: { input?: unknown; calculationTimestamp?: string };
  ferryOffers?: {
    id: number;
    operator: string;
    routeLabel: string;
    redirectPath: string;
  }[];
}

async function seedFreeSession(d1: D1DatabaseLike, db: DatabaseSync): Promise<string> {
  seedAccount(db, {
    id: 1,
    userId: 'user-fill',
    email: 'fill@example.invalid',
    tier: 'FREE',
  });
  return issueSessionToken(d1, 1);
}

function fillInit(body: unknown, token?: string): RequestInit {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token !== undefined ? { cookie: `rajahinta_session=${token}` } : {}),
    },
    body: JSON.stringify(body),
  };
}

async function postFill(
  app: ReturnType<typeof buildApp>,
  env: Env,
  body: unknown = FILL,
  token?: string,
): Promise<Response> {
  return request(app, env, '/api/v1/trip/fill', fillInit(body, token));
}

/** The standard fill fixtures: two boundable half-litre lines with offers. */
async function seedFillProducts(db: DatabaseSync): Promise<void> {
  seedProduct(db, {
    id: 1,
    name: 'Karhu III 0,5 l',
    category: 'beer',
    regulatoryClassification: 'beer',
    unitVolume: 0.5,
  });
  seedOffer(db, { id: 11, productId: 1, merchant: 'alko', priceCents: 250 });
  seedOffer(db, { id: 12, productId: 1, merchant: 's-market', priceCents: 300 });
  seedProduct(db, {
    id: 2,
    name: 'Koskenkorva 0,5 l',
    category: 'spirits',
    regulatoryClassification: 'spirits',
    unitVolume: 0.5,
  });
  seedOffer(db, { id: 21, productId: 2, merchant: 'alko', priceCents: 1000 });
}

/**
 * Append one allowance version and publish it — the only PUBLISHED
 * path. Defaults bound beer (1 l / 3 units) and spirits (2 l / 4 units)
 * effective from 2026-01-01.
 */
async function seedPublishedFillAllowances(
  d1: D1DatabaseLike,
  overrides: {
    versionLabel?: string;
    effectiveFrom?: string;
    limits?: {
      category: string;
      volumeCapLitres: number | null;
      quantityCap: number | null;
    }[];
  } = {},
): Promise<number> {
  const effectiveFrom = overrides.effectiveFrom ?? '2026-01-01';
  const repo = new D1TravellerAllowancesRepository(d1);
  const version = await repo.createPendingVersion(
    {
      versionLabel: overrides.versionLabel ?? 'allowances-fill-2026.1',
      sourceCitation: CITATION,
      effectiveFrom,
      effectiveTo: null,
    },
    (overrides.limits ?? [
      { category: 'beer', volumeCapLitres: 1, quantityCap: 3 },
      { category: 'spirits', volumeCapLitres: 2, quantityCap: 4 },
    ]).map((limit) => ({
      ...limit,
      sourceCitation: CITATION,
      effectiveFrom,
      effectiveTo: null,
    })),
  );
  const published = await repo.publish(version.dataset.id, 'ops-test');
  expect(published).not.toBeNull();
  return version.dataset.id;
}

/** Seed one published ferry offer directly and return its id. */
async function seedPublishedFerry(
  d1: D1DatabaseLike,
  overrides: Partial<{ operator: string; routeLabel: string; url: string }> = {},
): Promise<number> {
  const repo = new D1FerryOffersRepository(d1);
  const created = await repo.create({
    operator: overrides.operator ?? 'Viking Line',
    routeLabel: overrides.routeLabel ?? 'Helsinki–Tallinn',
    url: overrides.url ?? 'https://www.vikingline.example/minifarty',
  });
  const published = await repo.publish(created.id);
  expect(published).not.toBeNull();
  return created.id;
}

// ---------------------------------------------------------------------------
// Guards — session auth and the entitlement seam
// ---------------------------------------------------------------------------

describe('POST /api/v1/trip/fill — guards', () => {
  it('rejects an unauthenticated caller with the standard 401 auth envelope', async () => {
    const { d1 } = openMigratedD1();
    const app = fillApp();
    await expectEnvelope(await postFill(app, fillEnv(d1)), 401, {
      error: 'SessionRequired',
    });
  });

  it('rejects an unknown session token with 401', async () => {
    const { d1 } = openMigratedD1();
    const app = fillApp();
    await expectEnvelope(
      await postFill(app, fillEnv(d1), FILL, 'not-a-real-token'),
      401,
      { error: 'InvalidSession' },
    );
  });

  it('enforces the entitlement seam: a raised tier gate rejects a FREE session with 403', async () => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedFillAllowances(d1);
    await seedFillProducts(db);
    const token = await seedFreeSession(d1, db);
    const app = fillApp();
    const env = fillEnv(d1);

    // Every feature is FREE today — raise this feature's gate to pin the
    // 403 payload, then restore so no other test sees the paywall.
    const original = FEATURE_TIER_MAP['calculation:basic'];
    FEATURE_TIER_MAP['calculation:basic'] = 'PROFESSIONAL';
    try {
      await expectEnvelope(await postFill(app, env, FILL, token), 403, {
        error: 'InsufficientEntitlement',
        requiredTier: 'calculation:basic',
        currentTier: 'FREE',
      });
    } finally {
      FEATURE_TIER_MAP['calculation:basic'] = original;
    }

    // Restored gate: the same FREE session is admitted.
    const res = await postFill(app, env, FILL, token);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Validation — the fill module's contracts at the boundary
// ---------------------------------------------------------------------------

describe('POST /api/v1/trip/fill — validation', () => {
  it.each(['2026/06/01', 'not-a-date'])('rejects travelDate=%s with 400', async (travelDate) => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedFillAllowances(d1);
    const token = await seedFreeSession(d1, db);
    const app = fillApp();
    await expectEnvelope(
      await postFill(app, fillEnv(d1), { ...FILL, travelDate }, token),
      400,
      { error: 'ValidationError' },
    );
  });

  it.each([0, -1, 2.5, 100])('rejects maxQuantity=%s with 400', async (maxQuantity) => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedFillAllowances(d1);
    const token = await seedFreeSession(d1, db);
    const app = fillApp();
    await expectEnvelope(
      await postFill(app, fillEnv(d1), {
        travelDate: '2026-06-01',
        items: [{ productId: 1, maxQuantity }],
      }, token),
      400,
      { error: 'ValidationError' },
    );
  });

  it.each([0, -3, 1.5])('rejects productId=%s with 400', async (productId) => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedFillAllowances(d1);
    const token = await seedFreeSession(d1, db);
    const app = fillApp();
    await expectEnvelope(
      await postFill(app, fillEnv(d1), {
        travelDate: '2026-06-01',
        items: [{ productId, maxQuantity: 1 }],
      }, token),
      400,
      { error: 'ValidationError' },
    );
  });

  it('rejects an empty item list and an over-cap item list with 400', async () => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedFillAllowances(d1);
    const token = await seedFreeSession(d1, db);
    const app = fillApp();
    const env = fillEnv(d1);

    await expectEnvelope(
      await postFill(app, env, { travelDate: '2026-06-01', items: [] }, token),
      400,
      { error: 'ValidationError' },
    );
    await expectEnvelope(
      await postFill(app, env, {
        travelDate: '2026-06-01',
        items: Array.from({ length: 11 }, (_, i) => ({ productId: 1, maxQuantity: i + 1 })),
      }, token),
      400,
      { error: 'ValidationError' },
    );
  });
});

// ---------------------------------------------------------------------------
// Computed fill — itemization, headroom, disclaimer, provenance
// ---------------------------------------------------------------------------

describe('POST /api/v1/trip/fill — computed fill', () => {
  it('returns the value-maximal fill with per-line contribution, headroom, disclaimer and dataset-version provenance', async () => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedFillAllowances(d1);
    await seedFillProducts(db);
    const token = await seedFreeSession(d1, db);
    const app = fillApp();
    const res = await postFill(app, fillEnv(d1), FILL, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FillJson;

    expect(body.status).toBe('FILLED');
    expect(body.travelDate).toBe('2026-06-01');
    expect(body.allowanceDatasetVersion).toBe('allowances-fill-2026.1');

    // beer: cap 1 l / 3 units → two 0.5 l units at the cheapest offer.
    // spirits: cap 2 l / 4 units → four 0.5 l units.
    expect(body.filledUnits).toBe(6);
    expect(body.filledValueCents).toBe(4500);

    expect(body.lines).toHaveLength(2);
    const beer = body.lines![0]!;
    expect(beer).toMatchObject({
      productId: 1,
      category: 'beer',
      merchant: 'alko',
      unitPriceCents: 250,
      maxQuantity: 10,
      filledQuantity: 2,
      valueContributionCents: 500,
      consumedVolumeLitres: 1,
      status: 'FILLED',
    });
    expect(beer.headroomAfter).toMatchObject({
      category: 'beer',
      capLitres: 1,
      capUnits: 3,
      remainingLitres: 0,
      remainingUnits: 1,
    });

    const spirits = body.lines![1]!;
    expect(spirits).toMatchObject({
      productId: 2,
      category: 'spirits',
      unitPriceCents: 1000,
      filledQuantity: 4,
      valueContributionCents: 4000,
      status: 'FILLED',
    });
    expect(spirits.headroomAfter).toMatchObject({
      category: 'spirits',
      remainingLitres: 0,
      remainingUnits: 0,
    });

    // Final headroom, category ascending.
    expect(body.categoryHeadroom).toEqual([
      {
        category: 'beer',
        capLitres: 1,
        capUnits: 3,
        usedLitres: 1,
        usedUnits: 2,
        remainingLitres: 0,
        remainingUnits: 1,
      },
      {
        category: 'spirits',
        capLitres: 2,
        capUnits: 4,
        usedLitres: 2,
        usedUnits: 4,
        remainingLitres: 0,
        remainingUnits: 0,
      },
    ]);

    // Structural field, not a UI string: the engine's DISCLAIMER_FI.
    expect(body.disclaimer).toEqual({
      text: expect.stringContaining('Arvioitu kokonaiskustannus'),
      language: 'fi',
      version: '1.0',
    });

    // Input echo + provenance metadata.
    expect(body.metadata!.input).toEqual({
      travelDate: '2026-06-01',
      items: FILL.items,
    });
    expect(typeof body.metadata!.calculationTimestamp).toBe('string');

    // The separate block exists even with zero ferry rows — empty, present.
    expect(body.ferryOffers).toEqual([]);
  });

  it('responds 409 NoPublishedAllowances when no published dataset covers the travel date', async () => {
    const { db, d1 } = openMigratedD1();
    await seedFillProducts(db);
    const token = await seedFreeSession(d1, db);
    const app = fillApp();
    await expectEnvelope(await postFill(app, fillEnv(d1), FILL, token), 409, {
      error: 'NoPublishedAllowances',
    });
  });

  it('honours the effective window: PENDING_CONFIRMATION is invisible and a version covers only from its effectiveFrom', async () => {
    const { db, d1 } = openMigratedD1();
    const repo = new D1TravellerAllowancesRepository(d1);
    // Pending version for June — never visible (no PUBLISHED path ran).
    await repo.createPendingVersion(
      {
        versionLabel: 'allowances-fill-pending',
        sourceCitation: CITATION,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
      [{
        category: 'beer',
        volumeCapLitres: 1,
        quantityCap: 3,
        sourceCitation: CITATION,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      }],
    );
    // Published but only from July — June is uncovered.
    await seedPublishedFillAllowances(d1, {
      versionLabel: 'allowances-fill-july',
      effectiveFrom: '2026-07-01',
    });
    await seedFillProducts(db);
    const token = await seedFreeSession(d1, db);
    const app = fillApp();
    const env = fillEnv(d1);

    await expectEnvelope(await postFill(app, env, FILL, token), 409, {
      error: 'NoPublishedAllowances',
    });

    const inside = await postFill(app, env, { ...FILL, travelDate: '2026-07-15' }, token);
    expect(inside.status).toBe(200);
    expect(((await inside.json()) as FillJson).allowanceDatasetVersion).toBe(
      'allowances-fill-july',
    );
  });

  it('returns BOUND_EXHAUSTED as an honest 200 when even one unit fits no cap', async () => {
    const { db, d1 } = openMigratedD1();
    // A 0.1 l beer cap cannot hold a single 0.5 l unit.
    await seedPublishedFillAllowances(d1, {
      limits: [{ category: 'beer', volumeCapLitres: 0.1, quantityCap: 3 }],
    });
    seedProduct(db, {
      id: 1,
      category: 'beer',
      regulatoryClassification: 'beer',
      unitVolume: 0.5,
    });
    seedOffer(db, { id: 11, productId: 1, merchant: 'alko', priceCents: 250 });
    const token = await seedFreeSession(d1, db);
    const app = fillApp();
    const res = await postFill(app, fillEnv(d1), {
      travelDate: '2026-06-01',
      items: [{ productId: 1, maxQuantity: 10 }],
    }, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FillJson;
    expect(body.status).toBe('BOUND_EXHAUSTED');
    expect(body.filledUnits).toBe(0);
    expect(body.filledValueCents).toBe(0);
    expect(body.lines![0]!.status).toBe('CAP_EXHAUSTED');
    expect(body.lines![0]!.filledQuantity).toBe(0);
    expect(body.allowanceDatasetVersion).toBe('allowances-fill-2026.1');
  });

  it('returns NO_BOUNDABLE_LINE as an honest 200 when the version has no row for the line category', async () => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedFillAllowances(d1, {
      limits: [{ category: 'beer', volumeCapLitres: 1, quantityCap: 3 }],
    });
    seedProduct(db, {
      id: 2,
      category: 'spirits',
      regulatoryClassification: 'spirits',
      unitVolume: 0.5,
    });
    seedOffer(db, { id: 21, productId: 2, merchant: 'alko', priceCents: 1000 });
    const token = await seedFreeSession(d1, db);
    const app = fillApp();
    const res = await postFill(app, fillEnv(d1), {
      travelDate: '2026-06-01',
      items: [{ productId: 2, maxQuantity: 5 }],
    }, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FillJson;
    expect(body.status).toBe('NO_BOUNDABLE_LINE');
    expect(body.filledUnits).toBe(0);
    expect(body.lines![0]!.status).toBe('NO_ALLOWANCE_ROW');
    expect(body.lines![0]!.headroomAfter).toBeNull();
    expect(body.categoryHeadroom).toEqual([]);
  });

  it('404s an unknown product and a product without offers (basket parity)', async () => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedFillAllowances(d1);
    seedProduct(db, { id: 3, category: 'beer' }); // no offers seeded
    const token = await seedFreeSession(d1, db);
    const app = fillApp();
    const env = fillEnv(d1);

    const unknown = await postFill(app, env, {
      travelDate: '2026-06-01',
      items: [{ productId: 9999, maxQuantity: 1 }],
    }, token);
    await expectEnvelope(unknown, 404, {
      message: expect.stringContaining('product 9999 not found'),
    });

    const unoffered = await postFill(app, env, {
      travelDate: '2026-06-01',
      items: [{ productId: 3, maxQuantity: 1 }],
    }, token);
    await expectEnvelope(unoffered, 404, {
      message: expect.stringContaining('no retail offers found for product 3'),
    });
  });

  it('422s a product the classification gate rejects (basket parity)', async () => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedFillAllowances(d1);
    seedProduct(db, {
      id: 4,
      category: 'beer',
      regulatoryClassification: 'unknown', // the placeholder — never passes
    });
    seedOffer(db, { id: 41, productId: 4, merchant: 'alko', priceCents: 250 });
    const token = await seedFreeSession(d1, db);
    const app = fillApp();
    await expectEnvelope(
      await postFill(app, fillEnv(d1), {
        travelDate: '2026-06-01',
        items: [{ productId: 4, maxQuantity: 1 }],
      }, token),
      422,
      { error: 'BasketClassificationGateRejection', productId: 4 },
    );
  });
});

// ---------------------------------------------------------------------------
// Ferry neutrality — the ferry block is a separate display-only path
// ---------------------------------------------------------------------------

describe('POST /api/v1/trip/fill — ferry block isolation', () => {
  it('keeps the fill BYTE-IDENTICAL with zero, one, and many ferry rows; never leaks the raw url', async () => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedFillAllowances(d1);
    await seedFillProducts(db);
    const token = await seedFreeSession(d1, db);
    const app = fillApp();
    const env = fillEnv(d1);

    const fillProjection = (body: FillJson): Omit<FillJson, 'ferryOffers'> => {
      const { ferryOffers: _ferry, ...fill } = body;
      return fill;
    };

    // Zero rows.
    const empty = await postFill(app, env, FILL, token);
    expect(empty.status).toBe(200);
    expect(empty.headers.get('X-Cache')).toBe('MISS');
    const emptyBody = (await empty.json()) as FillJson;
    expect(emptyBody.ferryOffers).toEqual([]);
    const emptyFill = JSON.stringify(fillProjection(emptyBody));

    // One row — fill bytes unchanged, block appears, raw url absent.
    await seedPublishedFerry(d1);
    const one = await postFill(app, env, FILL, token);
    expect(one.headers.get('X-Cache')).toBe('HIT');
    const oneBody = (await one.json()) as FillJson;
    expect(JSON.stringify(fillProjection(oneBody))).toBe(emptyFill);
    expect(oneBody.ferryOffers).toHaveLength(1);
    expect(oneBody.ferryOffers![0]).toEqual({
      id: expect.any(Number),
      operator: 'Viking Line',
      routeLabel: 'Helsinki–Tallinn',
      redirectPath: `/api/v1/outbound/ferry/${oneBody.ferryOffers![0]!.id}`,
    });
    expect(JSON.stringify(oneBody)).not.toContain('vikingline.example');

    // Many rows — same fill bytes, block grows in curation order.
    await seedPublishedFerry(d1, {
      operator: 'Eckerö Line',
      routeLabel: 'Helsinki–Tallinn',
      url: 'https://www.eckero.example/mini',
    });
    await seedPublishedFerry(d1, {
      operator: 'Viking Line',
      routeLabel: 'Turku–Stockholm',
      url: 'https://www.vikingline.example/amorella',
    });
    const many = await postFill(app, env, FILL, token);
    expect(many.headers.get('X-Cache')).toBe('HIT');
    const manyBody = (await many.json()) as FillJson;
    expect(JSON.stringify(fillProjection(manyBody))).toBe(emptyFill);
    expect(manyBody.ferryOffers!.map((o) => o.operator)).toEqual([
      'Eckerö Line',
      'Viking Line',
      'Viking Line',
    ]);
    expect(JSON.stringify(manyBody)).not.toContain('eckero.example');
  });
});

// ---------------------------------------------------------------------------
// Version-aware idempotency + provenance carriage
// ---------------------------------------------------------------------------

describe('POST /api/v1/trip/fill — version-aware idempotency', () => {
  it('serves a byte-identical repeat (X-Cache HIT) and a fresh fill after an allowance bump', async () => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedFillAllowances(d1);
    await seedFillProducts(db);
    const token = await seedFreeSession(d1, db);
    const app = fillApp();
    const env = fillEnv(d1);

    const first = await postFill(app, env, FILL, token);
    expect(first.headers.get('X-Cache')).toBe('MISS');
    const firstBody = (await first.json()) as FillJson;
    expect(firstBody.allowanceDatasetVersion).toBe('allowances-fill-2026.1');
    const firstHash = first.headers.get('X-Content-Hash');
    expect(firstHash).not.toBeNull();

    const repeat = await postFill(app, env, FILL, token);
    expect(repeat.headers.get('X-Cache')).toBe('HIT');
    expect(repeat.headers.get('X-Content-Hash')).toBe(firstHash);
    expect(await repeat.json()).toEqual(firstBody);

    // A NEWER version published effective on the same date changes the
    // resolved dataset version → fresh fill, not a stale HIT.
    await seedPublishedFillAllowances(d1, {
      versionLabel: 'allowances-fill-2026.2',
      effectiveFrom: '2026-02-01',
      limits: [
        { category: 'beer', volumeCapLitres: 2, quantityCap: 3 },
        { category: 'spirits', volumeCapLitres: 2, quantityCap: 4 },
      ],
    });

    const afterBump = await postFill(app, env, FILL, token);
    expect(afterBump.headers.get('X-Cache')).toBe('MISS');
    const bumpBody = (await afterBump.json()) as FillJson;
    expect(bumpBody.allowanceDatasetVersion).toBe('allowances-fill-2026.2');
    // beer cap 2 l / 3 units → three 0.5 l units now fit.
    expect(bumpBody.lines![0]!.filledQuantity).toBe(3);
    expect(bumpBody.lines![0]!.valueContributionCents).toBe(750);
    expect(bumpBody.filledValueCents).toBe(4750);
  });
});

// ---------------------------------------------------------------------------
// Rate limiting — the per-IP CALCULATOR profile (10/min), trip calculator parity
// ---------------------------------------------------------------------------

describe('POST /api/v1/trip/fill — rate-limit profile', () => {
  it('admits ten requests per minute per IP (CALCULATOR) and rejects the eleventh with 429', async () => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedFillAllowances(d1);
    await seedFillProducts(db);
    const token = await seedFreeSession(d1, db);
    const app = fillApp();
    const env = fillEnv(d1); // one shared env = one shared DO limiter bucket

    for (let i = 0; i < 10; i++) {
      // Distinct payloads so idempotency never short-circuits the limiter's
      // admission path (the limiter runs FIRST either way — that is the pin).
      const res = await postFill(app, env, {
        travelDate: '2026-06-01',
        items: [{ productId: 1, maxQuantity: i + 1 }],
      }, token);
      expect(res.status).toBe(200);
    }

    const eleventh = await postFill(app, env, {
      travelDate: '2026-06-01',
      items: [{ productId: 1, maxQuantity: 11 }],
    }, token);
    await expectEnvelope(eleventh, 429, { error: 'TooManyRequests' });
    expect(eleventh.headers.get('Retry-After')).not.toBeNull();
  });
});
