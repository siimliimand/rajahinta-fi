/**
 * Price-context route (task 3.2, change insight-surfaces, spec
 * price-context / design D5) — GET /api/v1/products/:id/price-context.
 *
 * One product's trailing-window price context over the product-wide
 * daily price-history buckets: findByProductRange with merchant null
 * reads ONLY the merchant-IS-NULL product-wide rows (binary semantics —
 * merchant rows would stack several series into one window). The window
 * is the trailing PRICE_CONTEXT_WINDOW_DAYS calendar days ending today
 * (UTC); that end day is the as-of date echoed in every payload. The
 * bucket figure per day is the bucket's closing price (priceCloseCents)
 * — the same materialized figure the price-alert evaluation reads as
 * the product's day-level price. The current best price comes from the
 * shared lowest-current-offer helper — the exact figure the product
 * detail response embeds.
 *
 * The window statistics themselves are the pure core-domain
 * computePriceContextWindow: fewer than PRICE_CONTEXT_MIN_BUCKETS
 * buckets → explicit unavailable INSUFFICIENT_HISTORY, no percentage.
 *
 * Guard chain (price-history parity): requireRateLimit('HISTORICAL')
 * registers at index.ts ahead of the guards; ageGate() per-route here.
 *
 * A product without current offers has no current price to contextualize
 * — the honest answer for that reference read is the standard 404, not
 * a context computed against a substituted price.
 *
 * @module PriceContextRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
// Direct source imports, route-file parity (search/allowances.routes) —
// wrangler aliases the @rajahinta/core-domain barrel to the bridge module,
// which re-exports only the pipeline's runtime closure.
import {
  computePriceContextWindow,
  PRICE_CONTEXT_WINDOW_DAYS,
} from '../../../../packages/core-domain/src/price-context/window-stats';
import type { PriceContextResult } from '../../../../packages/core-domain/src/price-context/price-context.types';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { parseIntParam } from './support';
import { ageGate } from '../middleware/age-gate';
import { lowestCurrentOfferPriceCents } from './current-best-price';
import { D1ProductSearchRepository } from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';
import { D1PriceHistorySummaryRepository } from '../../../../packages/data-platform/src/repositories/d1/price-history-summary.repository';

/** Today as a UTC calendar date — the window's end and the as-of date. */
function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The window's first day: PRICE_CONTEXT_WINDOW_DAYS calendar days
 * ending today, inclusive — today − 89 for the 90-day window.
 */
function windowStartIso(today: string): string {
  const end = new Date(`${today}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() - (PRICE_CONTEXT_WINDOW_DAYS - 1));
  return end.toISOString().slice(0, 10);
}

async function getPriceContext(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const asOf = todayIsoDate();

  const products = new D1ProductSearchRepository(c.env.DB);
  const product = await products.findById(id);
  if (product === null) {
    throw new ApiHttpError(404, `Product ${id} not found`);
  }

  const currentBestPriceCents = lowestCurrentOfferPriceCents(
    await products.findOffers(id),
  );
  if (currentBestPriceCents === null) {
    throw new ApiHttpError(
      404,
      `Product ${id} has no current offers to contextualize`,
    );
  }

  // Product-wide rows ONLY — bound null reads merchant-IS-NULL rows and
  // nothing else (repository binary semantics).
  const buckets = await new D1PriceHistorySummaryRepository(
    c.env.DB,
  ).findByProductRange(id, 'daily', windowStartIso(asOf), asOf, null);

  const context: PriceContextResult = computePriceContextWindow({
    bucketsCents: buckets.map((bucket) => bucket.priceCloseCents),
    currentBestCents: currentBestPriceCents,
    asOf,
  });

  // The context object carries windowDays, bucketCount, and asOf on
  // BOTH branches (computed and unavailable) — the every-value-bearing-
  // payload-is-explainable invariant.
  return c.json({
    productId: id,
    currentBestPriceCents,
    context,
  });
}

/** Register the price-context read behind its gate (limiter at index.ts). */
export function registerPriceContextRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.on('GET', '/api/v1/products/:id/price-context', ageGate());
  app.get('/api/v1/products/:id/price-context', getPriceContext);
  return app;
}
