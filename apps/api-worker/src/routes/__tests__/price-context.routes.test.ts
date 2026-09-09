/**
 * Price-context route tests (task 3.2, change insight-surfaces) over the
 * FULL app composition (createApp() + registerPriceContextRoutes — the
 * exact composition index.ts wires, HISTORICAL limiter at index.ts +
 * age gate on the route) on the fake-D1 harness.
 *
 * Pinning here: the full computed payload over a populated 90-day window
 * (current best price, median/min/max, delta cents + basis points,
 * windowDays/bucketCount/asOf), the merchant-IS-NULL product-wide
 * semantics (a merchant-tagged bucket never joins the window) and the
 * window boundary (a 100-day-old bucket never joins), the explicit
 * INSUFFICIENT_HISTORY state over a thin window (nulls, no percentage,
 * window shape still present), the best-price consistency with the
 * product detail response (both via the shared lowest-current-offer
 * helper), the age gate, and the 404s (unknown product; known product
 * with no current offers).
 *
 * @module PriceContextRoutesTest
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
import { registerPriceContextRoutes } from '../price-context.routes';
import { D1PriceHistorySummaryRepository } from '../../../../../packages/data-platform/src/repositories/d1/price-history-summary.repository';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

/**
 * index.ts registers the handler behind the HISTORICAL limiter prefix
 * and the per-route age gate; the test composition mirrors that exactly.
 */
function priceContextApp(): ReturnType<typeof buildApp> {
  const app = buildApp();
  registerPriceContextRoutes(app);
  return app;
}

function priceContextEnv(d1: D1DatabaseLike, overrides: Partial<Env> = {}): Env {
  return permissiveEnv(d1, overrides);
}

const AGE_OK = { 'x-age-confirmed': 'confirmed-test-token' };

/** The route resolves as-of = today (UTC) — tests derive the same day. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayIso(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

interface ContextJson {
  productId: number;
  currentBestPriceCents: number | null;
  context: {
    status: 'computed' | 'unavailable';
    medianCents: number | null;
    minCents: number | null;
    maxCents: number | null;
    deltaVsMedianCents: number | null;
    deltaVsMedianBasisPoints: number | null;
    reason?: string;
    windowDays: number;
    bucketCount: number;
    asOf: string;
  };
}

/** Seed one daily product-wide (merchant-null) bucket for the window. */
async function seedBucket(
  d1: D1DatabaseLike,
  productId: number,
  periodStart: string,
  priceCloseCents: number,
  merchant: string | null = null,
): Promise<void> {
  await new D1PriceHistorySummaryRepository(d1).upsertBucket({
    granularity: 'daily',
    periodStart,
    productId,
    merchant,
    priceOpenCents: priceCloseCents,
    priceCloseCents,
    priceMinCents: priceCloseCents,
    priceMaxCents: priceCloseCents,
    priceAvgCents: priceCloseCents,
    landedCostOpenCents: 0,
    landedCostCloseCents: 0,
    landedCostMinCents: 0,
    landedCostMaxCents: 0,
    landedCostAvgCents: 0,
    observationCount: 1,
    strictestReliability: 'VERIFIED',
  });
}

describe('GET /api/v1/products/:id/price-context — computed window', () => {
  it('returns the full payload over a populated window, product-wide rows only', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedOffer(db, { id: 11, productId: 1, priceCents: 350 }); // alko
    seedOffer(db, { id: 12, productId: 1, priceCents: 299, merchant: 'saksoinet' }); // best
    seedOffer(db, { id: 13, productId: 1, priceCents: 420, merchant: 'eu-import' });
    for (let offset = 0; offset <= 6; offset++) {
      await seedBucket(d1, 1, dayIso(offset), 2000);
    }
    for (let offset = 7; offset <= 14; offset++) {
      await seedBucket(d1, 1, dayIso(offset), 1000);
    }
    // A merchant-tagged bucket must NOT join the product-wide window…
    await seedBucket(d1, 1, dayIso(5), 5000, 'alko');
    // …and neither may a bucket older than the 90-day window.
    await seedBucket(d1, 1, dayIso(100), 5000);
    const app = priceContextApp();

    const res = await request(app, priceContextEnv(d1), '/api/v1/products/1/price-context', {
      headers: AGE_OK,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ContextJson;

    expect(body.productId).toBe(1);
    expect(body.currentBestPriceCents).toBe(299);
    expect(body.context.status).toBe('computed');
    // 15 buckets: eight 1000s, seven 2000s → median 1000, min 1000, max 2000.
    expect(body.context.medianCents).toBe(1000);
    expect(body.context.minCents).toBe(1000);
    expect(body.context.maxCents).toBe(2000);
    expect(body.context.deltaVsMedianCents).toBe(299 - 1000);
    expect(body.context.deltaVsMedianBasisPoints).toBe(-7010);
    expect(body.context.windowDays).toBe(90);
    expect(body.context.bucketCount).toBe(15);
    expect(body.context.asOf).toBe(todayIso());
  });

  it('selects the same current best price the product detail response embeds', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedOffer(db, { id: 11, productId: 1, priceCents: 350 }); // alko
    seedOffer(db, { id: 12, productId: 1, priceCents: 299, merchant: 'saksoinet' });
    seedOffer(db, { id: 13, productId: 1, priceCents: 420, merchant: 'eu-import' });
    for (let offset = 0; offset < 14; offset++) {
      await seedBucket(d1, 1, dayIso(offset), 1000);
    }
    const app = priceContextApp();
    const env = priceContextEnv(d1);

    const detail = (await (
      await request(app, env, '/api/v1/products/1', { headers: AGE_OK })
    ).json()) as { currentBestPriceCents: number | null };
    const context = (await (
      await request(app, env, '/api/v1/products/1/price-context', { headers: AGE_OK })
    ).json()) as ContextJson;

    // One shared lowest-current-offer helper — the two surfaces can
    // never disagree about the product's best price.
    expect(detail.currentBestPriceCents).toBe(299);
    expect(context.currentBestPriceCents).toBe(detail.currentBestPriceCents);
  });
});

describe('GET /api/v1/products/:id/price-context — insufficient history', () => {
  it('returns the explicit unavailable state with no percentage over a thin window', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedOffer(db, { id: 11, productId: 1, priceCents: 350 });
    // 13 buckets — one below PRICE_CONTEXT_MIN_BUCKETS (14).
    for (let offset = 0; offset < 13; offset++) {
      await seedBucket(d1, 1, dayIso(offset), 1000);
    }
    const app = priceContextApp();

    const res = await request(app, priceContextEnv(d1), '/api/v1/products/1/price-context', {
      headers: AGE_OK,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ContextJson;

    expect(body.currentBestPriceCents).toBe(350);
    expect(body.context.status).toBe('unavailable');
    expect(body.context.reason).toBe('INSUFFICIENT_HISTORY');
    expect(body.context.medianCents).toBeNull();
    expect(body.context.minCents).toBeNull();
    expect(body.context.maxCents).toBeNull();
    expect(body.context.deltaVsMedianCents).toBeNull();
    expect(body.context.deltaVsMedianBasisPoints).toBeNull();
    // The window shape travels even on the unavailable branch.
    expect(body.context.windowDays).toBe(90);
    expect(body.context.bucketCount).toBe(13);
    expect(body.context.asOf).toBe(todayIso());
  });
});

describe('GET /api/v1/products/:id/price-context — errors and age gate', () => {
  it('404s an unknown product', async () => {
    const { d1 } = openMigratedD1();
    const app = priceContextApp();
    await expectEnvelope(
      await request(app, priceContextEnv(d1), '/api/v1/products/999/price-context', {
        headers: AGE_OK,
      }),
      404,
      { message: 'Product 999 not found' },
    );
  });

  it('404s a known product with no current offers (nothing to contextualize)', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    const app = priceContextApp();
    await expectEnvelope(
      await request(app, priceContextEnv(d1), '/api/v1/products/1/price-context', {
        headers: AGE_OK,
      }),
      404,
      { message: 'Product 1 has no current offers to contextualize' },
    );
  });

  it('rejects a non-numeric product id with the ParseIntPipe body', async () => {
    const { d1 } = openMigratedD1();
    const app = priceContextApp();
    await expectEnvelope(
      await request(app, priceContextEnv(d1), '/api/v1/products/abc/price-context', {
        headers: AGE_OK,
      }),
      400,
      { error: 'Bad Request' },
    );
  });

  it('denies an unconfirmed caller with 403 AGE_GATE_REQUIRED', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedOffer(db, { id: 11, productId: 1, priceCents: 350 });
    const app = priceContextApp();
    await expectEnvelope(
      await request(app, priceContextEnv(d1), '/api/v1/products/1/price-context', {}),
      403,
      { error: 'Forbidden', code: 'AGE_GATE_REQUIRED' },
    );
  });
});
