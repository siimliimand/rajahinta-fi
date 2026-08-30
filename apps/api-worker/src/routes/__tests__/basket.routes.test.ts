/**
 * Basket optimizer route parity tests (task 3.6).
 *
 * Expectations ported from
 * packages/application-api/src/basket/__tests__/basket-optimizer.controller.test.ts
 * (validation messages, error mapping, idempotency headers) with the
 * composed-app guard checks from the task-3.2 route-coverage suite.
 *
 * @module BasketRoutesTest
 */

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
