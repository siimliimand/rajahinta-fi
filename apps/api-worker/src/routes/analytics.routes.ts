/**
 * Analytics route ports (task 3.7) — Hono re-host of AnalyticsController
 * and OutboundRedirectController (packages/application-api/src/analytics/).
 *
 * Click recording goes through the ClickCounterDO client (the exact,
 * persisted DO counters that replaced the Redis service — task 3.4):
 * POST /api/v1/analytics/click awaits the increment and reports the
 * updated count; the outbound redirect fires it without awaiting — click
 * accounting must never add latency (or an outage) to the redirect.
 * Phase 1 policy: payloads that suggest affiliate, commission, or
 * purchase intent are rejected outright.
 *
 * @module AnalyticsRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { parseIntParam } from './support';
import { requireRateLimit } from '../middleware/rate-limit';
import { getClickCounts, recordClick } from '../do/client';
import { D1ProductSearchRepository } from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';

/** Fields that are disallowed in Phase 1 click payloads (controller parity). */
const FORBIDDEN_FIELDS = new Set([
  'commission',
  'affiliate',
  'purchase',
  'transactionId',
  'orderId',
]);

// ---------------------------------------------------------------------------
// POST /api/v1/analytics/click
// ---------------------------------------------------------------------------

async function click(c: Context<AppEnv>): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await c.req.json();
    body =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
  } catch {
    body = {};
  }

  // Reject forbidden fields before any other validation.
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_FIELDS.has(key)) {
      throw new ApiHttpError(400, {
        statusCode: 400,
        message: `Field "${key}" is not allowed in click analytics payload`,
        error: 'ForbiddenField',
      });
    }
  }

  if (typeof body.merchantId !== 'string' || body.merchantId.length === 0) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: '"merchantId" is required and must be a non-empty string',
      error: 'ValidationError',
    });
  }

  if (typeof body.url !== 'string' || body.url.length === 0) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: '"url" is required and must be a non-empty string',
      error: 'ValidationError',
    });
  }

  // recordClick is exact and persisted (DO storage); the endpoint can
  // safely await it before reporting the updated count.
  await recordClick(c.env, body.merchantId, body.url);
  const counts = await getClickCounts(c.env);
  const merchantClicks = counts[body.merchantId];
  const count = merchantClicks?.[body.url] ?? 0;

  return c.json({ success: true, count });
}

// ---------------------------------------------------------------------------
// GET /api/v1/outbound/:offerId
// ---------------------------------------------------------------------------

async function outbound(c: Context<AppEnv>): Promise<Response> {
  const offerId = parseIntParam(c, 'offerId');
  const offer = await new D1ProductSearchRepository(c.env.DB).findRetailOfferById(offerId);

  if (offer === null || !offer.sourceUrl) {
    throw new ApiHttpError(404, `Offer ${offerId} not found or has no source URL`);
  }

  // Fire-and-forget — the client never throws; lost analytics must not
  // break a redirect.
  void recordClick(c.env, offer.merchant, offer.sourceUrl);

  return c.redirect(offer.sourceUrl, 302);
}

/** Register the analytics handlers (no Nest guards on these routes). */
export function registerAnalyticsRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  // AnalyticsController — no rate limit in Nest.
  app.post('/api/v1/analytics/click', click);
  // OutboundRedirectController — RateLimitGuard, DEFAULT profile.
  app.on('GET', '/api/v1/outbound/:offerId', requireRateLimit('DEFAULT'));
  app.get('/api/v1/outbound/:offerId', outbound);
  return app;
}
