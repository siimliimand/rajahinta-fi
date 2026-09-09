/**
 * Compliance test: price-context payload contract (task 6.1, change
 * insight-surfaces, spec price-context).
 *
 * Every response of GET /api/v1/products/:id/price-context must explain
 * itself: the payload carries the window length (`windowDays`), the
 * number of daily buckets actually found (`bucketCount`), and the as-of
 * date the window ended on (`asOf`) — on BOTH branches. The value branch
 * (status "computed") additionally carries median/min/max and the
 * integer cents/bps delta versus the median, in lockstep with the pure
 * `computePriceContextWindow` policy. The unavailable branch carries
 * `INSUFFICIENT_HISTORY` and NO percentage — every value field is null,
 * never a guessed number over thin or out-of-window data.
 *
 * Fixture discipline: buckets seeded directly into
 * price_history_summaries (route-test parity with the historical route
 * suite) with fixed instants; a merchant-tagged bucket planted beside
 * the product-wide ones proves the repository's merchant-IS-NULL binary
 * read keeps them out of the window.
 *
 * @module PriceContextPayloadContractComplianceTest
 */

import { describe, it, expect } from 'vitest';

import {
  buildApp,
  openMigratedD1,
  permissiveEnv,
  request,
  seedOffer,
  seedProduct,
} from '../../apps/api-worker/src/routes/__tests__/harness';
import { registerPriceContextRoutes } from '../../apps/api-worker/src/routes/price-context.routes';
import {
  PRICE_CONTEXT_MIN_BUCKETS,
  PRICE_CONTEXT_WINDOW_DAYS,
  computePriceContextWindow,
} from '../../packages/core-domain/src/price-context/window-stats';
import type { DatabaseSync } from 'node:sqlite';

const AGE = { 'x-age-confirmed': 'confirmed' };

/** Today as a UTC calendar date — the route's own convention. */
function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `today` shifted by `deltaDays` (negative = past), as YYYY-MM-DD. */
function dayShift(today: string, deltaDays: number): string {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

/**
 * Seed one daily summary bucket with a deterministic id — route-test
 * parity with the historical route suite's raw insert.
 */
function seedBucket(
  db: DatabaseSync,
  bucket: {
    id: number;
    productId: number;
    periodStart: string;
    closeCents: number;
    merchant?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO price_history_summaries (
       id, granularity, period_start, product_id, merchant,
       price_open_cents, price_close_cents, price_min_cents, price_max_cents,
       price_avg_cents, landed_cost_open_cents, landed_cost_close_cents,
       landed_cost_min_cents, landed_cost_max_cents, landed_cost_avg_cents,
       observation_count, strictest_reliability
     ) VALUES (?, 'daily', ?, ?, ?, ?, ?, ?, ?, ?, 850, 860, 840, 870, 855, 3, 'ESTIMATED')`,
  ).run(
    bucket.id,
    bucket.periodStart,
    bucket.productId,
    bucket.merchant ?? null,
    bucket.closeCents,
    bucket.closeCents,
    bucket.closeCents,
    bucket.closeCents,
    bucket.closeCents,
  );
}

interface ContextJson {
  status: string;
  medianCents: number | null;
  minCents: number | null;
  maxCents: number | null;
  deltaVsMedianCents: number | null;
  deltaVsMedianBasisPoints: number | null;
  reason?: string;
  windowDays: number;
  bucketCount: number;
  asOf: string;
}

interface PriceContextResponse {
  productId: number;
  currentBestPriceCents: number;
  context: ContextJson;
}

async function getPriceContext(
  d1: ReturnType<typeof openMigratedD1>['d1'],
  productId: number,
): Promise<Response> {
  return request(
    registerPriceContextRoutes(buildApp()),
    permissiveEnv(d1),
    `/api/v1/products/${productId}/price-context`,
    { headers: AGE },
  );
}

// ===========================================================================
// 1. Value branch — computed payload carries window + count + as-of
// ===========================================================================

describe('price-context value branch: payload explains its own window', () => {
  it('the computed context is in lockstep with the pure policy and carries windowDays, bucketCount, and asOf', async () => {
    const today = todayIsoDate();
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Context Product' });
    // Two current offers — the lowest wins (the shared lowest-current-
    // offer rule), 300, not 350.
    seedOffer(db, { id: 11, productId: 1, merchant: 'alko', priceCents: 350, observedAt: '2026-09-01T10:00:00.000Z' });
    seedOffer(db, { id: 12, productId: 1, merchant: 'eu-import', country: 'DE', priceCents: 300, observedAt: '2026-09-01T10:00:00.000Z' });

    // Fifteen in-window buckets (>= the minimum gate), deterministic
    // closes, ending yesterday. Seed period_start ASC so the route's
    // ordered read matches the seeded sequence.
    const closes = [320, 310, 330, 300, 340, 315, 325, 335, 305, 345, 312, 322, 332, 342, 318];
    closes.forEach((closeCents, index) => {
      seedBucket(db, {
        id: index + 1,
        productId: 1,
        periodStart: dayShift(today, -(closes.length - index)),
        closeCents,
      });
    });
    // A merchant-tagged bucket INSIDE the window must never leak into
    // the product-wide read (merchant-IS-NULL binary semantics).
    seedBucket(db, {
      id: 900,
      productId: 1,
      periodStart: dayShift(today, -1),
      closeCents: 99_999,
      merchant: 'alko',
    });

    const res = await getPriceContext(d1, 1);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PriceContextResponse;

    // The current best price is the lowest current offer.
    expect(body.currentBestPriceCents).toBe(300);

    // Lockstep: the context object IS the pure policy's output over the
    // same inputs (route ↔ policy, the mirror suite's discipline) —
    // merchant rows excluded, bucketCount exactly the seeded fifteen.
    const expected = computePriceContextWindow({
      bucketsCents: closes,
      currentBestCents: 300,
      asOf: today,
    });
    expect(body.context).toEqual(expected);

    // The contract fields, explicitly — every value-bearing payload
    // carries the window length, the bucket count, and the as-of date.
    expect(body.context.status).toBe('computed');
    expect(body.context.windowDays).toBe(PRICE_CONTEXT_WINDOW_DAYS);
    expect(body.context.bucketCount).toBe(closes.length);
    expect(body.context.asOf).toBe(today);
    expect(Number.isInteger(body.context.medianCents)).toBe(true);
    expect(Number.isInteger(body.context.deltaVsMedianCents)).toBe(true);
    expect(Number.isInteger(body.context.deltaVsMedianBasisPoints)).toBe(true);
  });
});

// ===========================================================================
// 2. Unavailable branch — INSUFFICIENT_HISTORY, no percentage fields
// ===========================================================================

describe('price-context unavailable branch: honest no-value payload', () => {
  it('a thin window (below the bucket gate) carries INSUFFICIENT_HISTORY and nulls, with the contract fields still present', async () => {
    const today = todayIsoDate();
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 2, name: 'Thin History Product' });
    seedOffer(db, { id: 21, productId: 2, merchant: 'alko', priceCents: 350, observedAt: '2026-09-01T10:00:00.000Z' });
    // Only three buckets — below PRICE_CONTEXT_MIN_BUCKETS.
    for (let index = 0; index < 3; index++) {
      seedBucket(db, {
        id: index + 1,
        productId: 2,
        periodStart: dayShift(today, -(index + 1)),
        closeCents: 300 + index,
      });
    }

    const res = await getPriceContext(d1, 2);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PriceContextResponse;

    expect(body.context.status).toBe('unavailable');
    expect(body.context.reason).toBe('INSUFFICIENT_HISTORY');
    // No percentage — every value field is null, never a guessed number.
    expect(body.context.medianCents).toBeNull();
    expect(body.context.minCents).toBeNull();
    expect(body.context.maxCents).toBeNull();
    expect(body.context.deltaVsMedianCents).toBeNull();
    expect(body.context.deltaVsMedianBasisPoints).toBeNull();
    // The unavailable payload still explains its window and as-of.
    expect(body.context.windowDays).toBe(PRICE_CONTEXT_WINDOW_DAYS);
    expect(body.context.bucketCount).toBe(3);
    expect(body.context.asOf).toBe(today);
  });

  it('buckets only OUTSIDE the trailing window yield bucketCount 0 and INSUFFICIENT_HISTORY', async () => {
    const today = todayIsoDate();
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 3, name: 'Old History Product' });
    seedOffer(db, { id: 31, productId: 3, merchant: 'alko', priceCents: 350, observedAt: '2026-09-01T10:00:00.000Z' });
    // Plenty of buckets — but all older than the 90-day window.
    for (let index = 0; index < PRICE_CONTEXT_MIN_BUCKETS + 5; index++) {
      seedBucket(db, {
        id: index + 1,
        productId: 3,
        periodStart: dayShift(today, -(PRICE_CONTEXT_WINDOW_DAYS + 20 + index)),
        closeCents: 300,
      });
    }

    const res = await getPriceContext(d1, 3);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PriceContextResponse;

    expect(body.context.status).toBe('unavailable');
    expect(body.context.reason).toBe('INSUFFICIENT_HISTORY');
    expect(body.context.bucketCount).toBe(0);
    expect(body.context.deltaVsMedianBasisPoints).toBeNull();
    expect(body.context.windowDays).toBe(PRICE_CONTEXT_WINDOW_DAYS);
    expect(body.context.asOf).toBe(today);
  });
});

// ===========================================================================
// 3. Honest absences — no current price, no product
// ===========================================================================

describe('price-context absences', () => {
  it('a product without current offers is a 404, never a context over a substituted price', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 4, name: 'Offerless Product' });

    const res = await getPriceContext(d1, 4);
    expect(res.status).toBe(404);
  });

  it('an unknown product is a 404', async () => {
    const { d1 } = openMigratedD1();
    const res = await getPriceContext(d1, 999);
    expect(res.status).toBe(404);
  });

  it('the route is age-gated', async () => {
    const { d1 } = openMigratedD1();
    const res = await request(
      registerPriceContextRoutes(buildApp()),
      permissiveEnv(d1),
      '/api/v1/products/1/price-context',
    );
    expect(res.status).toBe(403);
  });
});
