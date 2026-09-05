/**
 * Search + declaration route parity tests (task 3.5).
 *
 * Expectations ported from:
 * - packages/application-api/src/search/__tests__/search.controller.test.ts
 *   (list/search/ids/pagination/sort + detail shapes),
 * - packages/application-api/src/declaration/__tests__/declaration.controller.test.ts
 *   (guidance gating; unreachable handler paths verified on a bare app —
 *   the composed route carries the pinned always-403 entitlement from
 *   task 3.2).
 *
 * @module SearchDeclarationRoutesTest
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  buildApp,
  createApp,
  expectEnvelope,
  issueSessionToken,
  lockedEnv,
  openMigratedD1,
  permissiveEnv,
  request,
  seedAccount,
  seedCalculationRecord,
  seedOffer,
  seedProduct,
} from './harness';
import { registerDeclarationRoutes, stripGuidance } from '../declaration.routes';
import { respondToError } from '../../errors';
import type { AppEnv } from '../../env';
import { errorBoundary } from '../../middleware/error-boundary';
import { openMigratedD1 as freshD1 } from '../../analytics/__tests__/fake-d1';

const AGE = { 'x-age-confirmed': 'confirmed' };

describe('GET /api/v1/products (search)', () => {
  it('is guarded by the PRICE_DATA launch gate and the age gate', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    const closed = await request(app, lockedEnv(d1), '/api/v1/products');
    await expectEnvelope(closed, 403, {
      message: expect.stringMatching(/Price data is not yet publicly available/),
    });

    const noAge = await request(app, permissiveEnv(d1), '/api/v1/products');
    await expectEnvelope(noAge, 403, {
      message: expect.stringMatching(/age confirmation required/i),
    });
  });

  it('lists products alphabetically with pagination metadata', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III' });
    seedProduct(db, { id: 2, name: 'Bock Svec' });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products', { headers: AGE });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: number; name: string; lowestPriceCents: number | null }>;
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };

    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.totalPages).toBe(1);
    expect(body.items.map((i) => i.name)).toEqual([...body.items.map((i) => i.name)].sort());
    // The item projection carries the Phase 1 nulls verbatim.
    expect(body.items[0]!.lowestPriceCents).toBeNull();
  });

  it('ranks free-text queries (golden query parity: karhu)', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III' });
    seedProduct(db, { id: 2, name: 'Koff III' });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products?q=karhu', {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: number }>; total: number };
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.items[0]!.id).toBe(1);
  });

  it('fetches by ids with name ordering and ignores q (ids precedence)', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III' });
    seedProduct(db, { id: 2, name: 'Bock Svec' });
    const app = buildApp();

    const res = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/products?ids=1,2&q=bock',
      { headers: AGE },
    );
    const body = (await res.json()) as { items: Array<{ id: number; name: string }>; total: number };
    expect(body.total).toBe(2);
    expect(body.items.map((i) => i.id)).toEqual([2, 1]); // alphabetical, not rank order
  });

  it('paginates deterministically and caps the page size at 100', async () => {
    const { db, d1 } = openMigratedD1();
    for (let i = 1; i <= 5; i++) {
      seedProduct(db, { id: i, name: `Product ${String(i).padStart(2, '0')}` });
    }
    const app = buildApp();

    const page = await request(app, permissiveEnv(d1), '/api/v1/products?page=2&limit=2', {
      headers: AGE,
    });
    const pageBody = (await page.json()) as {
      items: Array<{ id: number }>;
      total: number;
      totalPages: number;
    };
    expect(pageBody.total).toBe(5);
    expect(pageBody.totalPages).toBe(3);
    expect(pageBody.items).toHaveLength(2);

    const capped = await request(app, permissiveEnv(d1), '/api/v1/products?limit=500', {
      headers: AGE,
    });
    const cappedBody = (await capped.json()) as { limit: number };
    expect(cappedBody.limit).toBe(100);
  });

  it('rejects non-alphabetical sort orders with the Phase 1 message', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/products?sort=LOWEST_LANDED_COST',
      { headers: AGE },
    );
    await expectEnvelope(res, 400, {
      message:
        "Sort order 'LOWEST_LANDED_COST' is not supported in Phase 1. Only ALPHABETICAL is available.",
    });
  });
});

describe('GET /api/v1/products/:id (detail)', () => {
  it('returns the product with its offers, ISO timestamps, and default deposit status', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, depositSystemStatus: null });
    seedOffer(db, { id: 11, productId: 1, priceCents: 350 });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products/1', { headers: AGE });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.product.id).toBe(1);
    expect(body.product.depositSystemStatus).toBe(false); // ?? false parity
    expect(body.product.alcoholByVolume).toBeCloseTo(0.047, 6);
    expect(body.offers).toHaveLength(1);
    expect(body.offers[0]!.id).toBe(11);
    expect(body.offers[0]!.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Flag is on in permissiveEnv — the informational embed rides along
    // (per-merchant factual aggregate; PENDING governance fail-closed).
    expect(body.merchantReliability).toMatchObject({
      alko: { offerCount: 1, governancePermissionStatus: 'PENDING' },
    });
  });

  it('embeds merchant reliability only while ADVANCED_FEATURES is on', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedOffer(db, { id: 11, productId: 1 });
    const app = buildApp();

    const on = await request(app, permissiveEnv(d1), '/api/v1/products/1', { headers: AGE });
    const onBody = (await on.json()) as Record<string, any>;
    expect(onBody.merchantReliability).toBeDefined();
    expect(onBody.merchantReliability.alko.merchant).toBe('alko');
    // Governance has no D1 store — the status degrades to PENDING (never overstated).
    expect(onBody.merchantReliability.alko.governancePermissionStatus).toBe('PENDING');

    const off = await request(
      app,
      permissiveEnv(d1, { FF_ADVANCED_FEATURES: undefined }),
      '/api/v1/products/1',
      { headers: AGE },
    );
    const offBody = (await off.json()) as Record<string, any>;
    expect(offBody.merchantReliability).toBeUndefined();
  });

  it('404s an unknown product', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/products/999', { headers: AGE });
    await expectEnvelope(res, 404, { message: 'Product 999 not found' });
  });
});

describe('eurPerGram embed (flag UNIT_PRICE_EUR_PER_GRAM)', () => {
  // The flag-less shapes — the embed key appends to (flag on) or stays
  // absent from (flag off) these exact key lists, in this order.
  const LEGACY_ITEM_KEYS = [
    'id',
    'name',
    'brand',
    'category',
    'alcoholByVolume',
    'unitVolume',
    'containerType',
    'lowestPriceCents',
    'merchantCount',
  ];
  const LEGACY_OFFER_KEYS = [
    'id',
    'merchant',
    'country',
    'priceCents',
    'currency',
    'availability',
    'sourceUrl',
    'observedAt',
    'reliabilityStatus',
  ];

  it('search items carry the metric while the flag is on — explicitly unavailable (no price in the search path)', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 }); // volume + ABV present
    const app = buildApp();

    const res = await request(
      app,
      permissiveEnv(d1, { FF_UNIT_PRICE_EUR_PER_GRAM: 'true' }),
      '/api/v1/products',
      { headers: AGE },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    // One embed shape everywhere: the Phase 1 search path loads no offers,
    // so there is no price to derive from — the metric degrades to an
    // explicit unavailable, never a substituted value.
    expect(body.items[0]!.eurPerGram).toEqual({
      status: 'unavailable',
      centsPerGram: null,
      ethanolGrams: null,
      reason: 'INVALID_PRICE',
    });
    expect(Object.keys(body.items[0]!)).toEqual([...LEGACY_ITEM_KEYS, 'eurPerGram']);
  });

  it('search metric names a missing alcohol fraction before the absent price (module precedence)', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, alcoholByVolume: null });
    const app = buildApp();

    const res = await request(
      app,
      permissiveEnv(d1, { FF_UNIT_PRICE_EUR_PER_GRAM: 'true' }),
      '/api/v1/products',
      { headers: AGE },
    );
    const body = (await res.json()) as {
      items: Array<{ eurPerGram: Record<string, unknown> }>;
    };
    expect(body.items[0]!.eurPerGram).toEqual({
      status: 'unavailable',
      centsPerGram: null,
      ethanolGrams: null,
      reason: 'MISSING_ALCOHOL_FRACTION',
    });
  });

  it('flag off leaves the search item byte-compatible (no eurPerGram key)', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    const app = buildApp();

    const res = await request(
      app,
      permissiveEnv(d1, { FF_UNIT_PRICE_EUR_PER_GRAM: undefined }),
      '/api/v1/products',
      { headers: AGE },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('eurPerGram');
    const body = JSON.parse(text) as { items: Array<Record<string, unknown>> };
    expect(Object.keys(body.items[0]!)).toEqual(LEGACY_ITEM_KEYS);
  });

  it('offer metric is computed from the exact inputs while VERIFIED (density 789 g/l)', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 }); // 0.33 l, ABV 0.047
    seedOffer(db, { id: 11, productId: 1, priceCents: 350 }); // VERIFIED
    const app = buildApp();

    const res = await request(
      app,
      permissiveEnv(d1, { FF_UNIT_PRICE_EUR_PER_GRAM: 'true' }),
      '/api/v1/products/1',
      { headers: AGE },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      offers: Array<{
        eurPerGram: {
          status: string;
          ethanolGrams: number;
          centsPerGram: number;
          priceReliability: string;
        };
      }>;
    };
    // 0.33 l × 0.047 × 789 g/l ≈ 12.23739 g ethanol; 350 ¢ / that ≈ 28.6 ¢/g.
    expect(body.offers[0]!.eurPerGram.status).toBe('computed');
    expect(body.offers[0]!.eurPerGram.ethanolGrams).toBeCloseTo(12.23739, 5);
    expect(body.offers[0]!.eurPerGram.centsPerGram).toBeCloseTo(28.60087, 4);
    expect(body.offers[0]!.eurPerGram.priceReliability).toBe('VERIFIED');
    expect(Object.keys(body.offers[0]!)).toEqual([...LEGACY_OFFER_KEYS, 'eurPerGram']);
  });

  it('a non-VERIFIED offer price yields an ESTIMATED metric (value still returned)', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedOffer(db, {
      id: 11,
      productId: 1,
      priceCents: 350,
      reliabilityStatus: 'ESTIMATED',
    });
    const app = buildApp();

    const res = await request(
      app,
      permissiveEnv(d1, { FF_UNIT_PRICE_EUR_PER_GRAM: 'true' }),
      '/api/v1/products/1',
      { headers: AGE },
    );
    const body = (await res.json()) as {
      offers: Array<{
        eurPerGram: { status: string; priceReliability: string; centsPerGram: number };
      }>;
    };
    expect(body.offers[0]!.eurPerGram.status).toBe('ESTIMATED');
    expect(body.offers[0]!.eurPerGram.priceReliability).toBe('ESTIMATED');
    expect(body.offers[0]!.eurPerGram.centsPerGram).toBeCloseTo(28.60087, 4);
  });

  it('missing alcohol percentage → explicit unavailable, no value substituted', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, alcoholByVolume: null });
    seedOffer(db, { id: 11, productId: 1, priceCents: 350 });
    const app = buildApp();

    const res = await request(
      app,
      permissiveEnv(d1, { FF_UNIT_PRICE_EUR_PER_GRAM: 'true' }),
      '/api/v1/products/1',
      { headers: AGE },
    );
    const body = (await res.json()) as {
      offers: Array<{ eurPerGram: Record<string, unknown> }>;
    };
    expect(body.offers[0]!.eurPerGram).toEqual({
      status: 'unavailable',
      centsPerGram: null,
      ethanolGrams: null,
      reason: 'MISSING_ALCOHOL_FRACTION',
    });
  });

  it('flag off leaves the detail payload byte-compatible and the embed never reorders offers', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedOffer(db, { id: 11, productId: 1, priceCents: 350 });
    seedOffer(db, { id: 12, productId: 1, priceCents: 420, merchant: 'systembolaget' });
    const app = buildApp();

    const on = await request(
      app,
      permissiveEnv(d1, { FF_UNIT_PRICE_EUR_PER_GRAM: 'true' }),
      '/api/v1/products/1',
      { headers: AGE },
    );
    const onBody = (await on.json()) as { offers: Array<Record<string, unknown>> };

    const off = await request(
      app,
      permissiveEnv(d1, { FF_UNIT_PRICE_EUR_PER_GRAM: undefined }),
      '/api/v1/products/1',
      { headers: AGE },
    );
    const offText = await off.text();
    expect(offText).not.toContain('eurPerGram');
    const offBody = JSON.parse(offText) as { offers: Array<Record<string, unknown>> };

    // Identical order and identical values — the only difference is the
    // appended embed key.
    expect(onBody.offers.map((o) => o.id)).toEqual(offBody.offers.map((o) => o.id));
    expect(offBody.offers.map((o) => Object.keys(o))).toEqual([
      LEGACY_OFFER_KEYS,
      LEGACY_OFFER_KEYS,
    ]);
    const stripped = structuredClone(onBody.offers);
    for (const offer of stripped) delete offer.eurPerGram;
    expect(stripped).toEqual(offBody.offers);
  });
});

describe('GET /api/v1/declaration/:recordId (pinned Nest behavior)', () => {
  it('403s with InsufficientEntitlement even for a valid PREMIUM session', async () => {
    const { db, d1 } = openMigratedD1();
    seedAccount(db, { id: 11, userId: 'user-11', email: 'p@example.invalid', tier: 'PREMIUM' });
    seedProduct(db, { id: 1 });
    seedCalculationRecord(db, { id: 5, productMasterId: 1 });
    const token = await issueSessionToken(d1, 11);
    const app = buildApp();

    for (const headers of [
      AGE,
      { ...AGE, cookie: `rajahinta_session=${token}` },
    ]) {
      const res = await request(app, permissiveEnv(d1), '/api/v1/declaration/5', { headers });
      await expectEnvelope(res, 403, {
        error: 'InsufficientEntitlement',
        requiredTier: 'declaration:summary',
        currentTier: 'FREE',
      });
    }
  });

  it('age gate denies before the entitlement check (class-level guard order)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/declaration/5');
    await expectEnvelope(res, 403, {
      message: expect.stringMatching(/age confirmation required/i),
    });
  });

  describe('handler parity on a bare app (behind the pinned 403 in composition)', () => {
    function bareApp(): ReturnType<typeof createApp> {
      const app = new Hono<AppEnv>();
      // The createApp error composition, without guards — the handler's
      // thrown ApiHttpError must render the unified envelope.
      app.onError((err, c) => respondToError(c, err));
      app.use(errorBoundary());
      registerDeclarationRoutes(app);
      return app as ReturnType<typeof createApp>;
    }

    it('404s a missing calculation record (CalculationRecordNotFoundError mapping)', async () => {
      const { d1 } = freshD1();
      const app = bareApp();
      const res = await request(app, permissiveEnv(d1), '/api/v1/declaration/999');
      await expectEnvelope(res, 404, {
        message: 'Calculation record 999 not found',
        error: 'Not Found',
      });
    });

    it('strips the guidance field while ADVANCED_FEATURES is off (design D5)', () => {
      const summary = {
        estimatedExcise: { totalCents: 23 },
        myTaxLink: 'https://www.vero.fi/mytax',
        guidance: { derivation: [], checklist: [] },
      };

      const stripped = stripGuidance(summary);
      expect('guidance' in stripped).toBe(false);
      expect(stripped.myTaxLink).toBe(summary.myTaxLink);
      // The flag-on pass-through returns the summary unchanged.
      expect(stripGuidance.length).toBe(1);
    });

    it('500s factually on a persisted record whose classification is unpersisted', async () => {
      // The record adapter degrades the un-persisted classification to the
      // factual marker; the declaration assembly needs a legal label and
      // fails — the same closed failure the phase-1 null port produced.
      const { db, d1 } = freshD1();
      seedProduct(db, { id: 1 });
      seedCalculationRecord(db, { id: 5, productMasterId: 1 });
      const app = bareApp();

      const res = await request(app, permissiveEnv(d1), '/api/v1/declaration/5');
      const body = await expectEnvelope(res, 500, { error: 'Internal Server Error' });
      expect(typeof body.message).toBe('string');
    });
  });
});
