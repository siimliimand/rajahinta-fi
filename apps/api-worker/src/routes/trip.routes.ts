/**
 * Trip fill API (task 8.2, change trust-and-reach-roadmap) —
 * POST /api/v1/trip/fill over the task-8.1 AllowanceFillService, the
 * task-5.1 D1TravellerAllowancesRepository (via the D1 port adapter),
 * and the product/offer D1 repositories.
 *
 * Per request: compose the fill service over its D1 port adapters
 * (basket.routes.ts per-request composition parity), run the
 * value-maximal fill against the PUBLISHED allowance dataset effective
 * on the travel date (resolved as a unit through
 * ITravellerAllowancePort), and return the engine's result — whose
 * STRUCTURAL disclaimer field and `allowanceDatasetVersion` provenance
 * travel with every rendering (disclaimer.ts architecture rule; the
 * result names the dataset version it was bounded by).
 *
 * ## Ferry neutrality — two independent data paths (spec: ferry offers
 * stay display-only)
 *
 * The response envelope merges TWO paths that share nothing else:
 *
 *   1. FILL PATH — allowances port + product data port → fill engine →
 *      idempotency cache. The ferry table is unreachable from here; the
 *      fill engine's input types carry no affiliate field at source
 *      level.
 *   2. FERRY PATH — D1FerryOffersRepository.listPublished(), read fresh
 *      on EVERY request and attached as the sibling `ferryOffers` block
 *      AFTER cache retrieval, exactly like the trip-feasibility
 *      envelope (same redirector-ready shape — 8.3 renders the existing
 *      ferry block unchanged).
 *
 * The idempotency cache stores ONLY the fill result — never the ferry
 * block — so the fill basket is byte-identical whether zero, one, or
 * many ferry rows exist (the compliance pattern, true by construction).
 * X-Content-Hash covers the cached fill body, not the per-request ferry
 * block. The raw ferry url never crosses this boundary.
 *
 * Middleware chain per request (in registration order — Nest guard
 * order: RateLimitGuard first in every guard list, then class/method
 * guards):
 *
 *   requireRateLimit('CALCULATOR') → sessionAuth() →
 *   requireFeature('calculation:basic') → handler
 *
 * The allowance-fill spec requires an AUTHENTICATED user ("An
 * authenticated user SHALL be able to request a basket fill"), so
 * unlike the anonymous trip-feasibility surface the route sits behind
 * sessionAuth — an anonymous caller gets the guard's standard 401. The
 * entitlement check is the platform's calculation-surface seam
 * (`requireFeature`, declaration/reports parity): every tier is FREE
 * today, so the check admits every signed-in caller while keeping the
 * paywall seam wired. Rate limit: the CALCULATOR profile, the trip
 * calculator's own (10/min).
 *
 * Documented decisions:
 * - Validation bounds mirror the module's contracts exactly:
 *   `MAX_FILL_ITEMS` candidate lines, `maxQuantity` 1..MAX_FILL_QUANTITY
 *   (the module rejects the same shapes with AllowanceFillError — zod
 *   makes them 400s before compute), positive integer productIds, ISO
 *   travel date. The module's date validation stays reachable as
 *   defense in depth (trip-feasibility parity).
 * - The DTO carries no sessionId: the fill engine's optional audit
 *   grouping echoes whatever the caller sent, and the route has no
 *   calculation-record persistence to key it on — omitting the field
 *   keeps the cached result user-independent (data minimization).
 * - Version-aware idempotency (calculator/basket/trip-feasibility
 *   parity): the fill result's `allowanceDatasetVersion` — the dataset
 *   version the caps were resolved from — is part of the cache key and
 *   re-checked on lookup, so an allowance bump yields fresh results
 *   under identical requests. Client `x-idempotency-key` values travel
 *   verbatim.
 * - Honest engine states: BOUND_EXHAUSTED and NO_BOUNDABLE_LINE are
 *   200 result bodies (the explicit empty fill, not an error);
 *   no published dataset covering the date is 409
 *   `NoPublishedAllowances` (trip-feasibility parity — resolvable by
 *   publishing a covering version); curated data violating the dataset
 *   contract is an operator-visibility 500 `InconsistentAllowances`
 *   (InconsistentNormsError parity); unknown product / product without
 *   offers are 404 (basket parity); a classification-gate rejection is
 *   422 (basket parity); the engine's search-budget exhaustion is a
 *   500 (an engine bound, not a caller fault).
 *
 * @module TripRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { requireRateLimit } from '../middleware/rate-limit';
import { sessionAuth } from '../middleware/session-auth';
import { requireFeature } from '../middleware/entitlement';
import { parseDto } from './support';
import { AllowanceFillService } from '../../../../packages/core-domain/src/optimizer/services/allowance-fill.service';
import {
  AllowanceFillError,
  MAX_FILL_ITEMS,
  MAX_FILL_QUANTITY,
} from '../../../../packages/core-domain/src/optimizer/allowance-fill.types';
import type { AllowanceFillResult } from '../../../../packages/core-domain/src/optimizer/allowance-fill.types';
import { BasketClassificationGateError } from '../../../../packages/core-domain/src/optimizer/optimizer.types';
import { ClassificationGateService } from '../../../../packages/core-domain/src/normalization/classification-gate.service';
import { D1TravellerAllowancesRepository } from '../../../../packages/data-platform/src/repositories/d1/traveller-allowances.repository';
import { D1FerryOffersRepository } from '../../../../packages/data-platform/src/repositories/d1/ferry-offers.repository';
import { D1ProductSearchRepository } from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';
import { D1ProductDataPort } from '../adapters/d1-domain-ports';
import { D1TravellerAllowancePort } from '../adapters/d1-traveller-allowance-port';
import {
  idempotencyLookup,
  idempotencyStore,
  idempotencyContentHash,
} from '../adapters/idempotency-facade';

// ---------------------------------------------------------------------------
// Validation — caps mirror the fill module's contracts exactly
// ---------------------------------------------------------------------------

const PRODUCT_ID_MESSAGE = 'items[].productId must be a positive integer';
const QUANTITY_MESSAGE = `items[].maxQuantity must be a whole number between 1 and ${MAX_FILL_QUANTITY}`;

const tripFillRequestSchema = z.object({
  travelDate: z
    .string({
      required_error: 'travelDate must be an ISO YYYY-MM-DD calendar date',
      invalid_type_error: 'travelDate must be an ISO YYYY-MM-DD calendar date',
    })
    .regex(
      /^\d{4}-\d{2}-\d{2}$/,
      'travelDate must be an ISO YYYY-MM-DD calendar date',
    ),
  items: z
    .array(
      z.object({
        productId: z
          .number({
            required_error: PRODUCT_ID_MESSAGE,
            invalid_type_error: PRODUCT_ID_MESSAGE,
          })
          .int(PRODUCT_ID_MESSAGE)
          .min(1, PRODUCT_ID_MESSAGE),
        maxQuantity: z
          .number({
            required_error: QUANTITY_MESSAGE,
            invalid_type_error: QUANTITY_MESSAGE,
          })
          .int(QUANTITY_MESSAGE)
          .min(1, QUANTITY_MESSAGE)
          .max(MAX_FILL_QUANTITY, QUANTITY_MESSAGE),
      }),
      { invalid_type_error: 'items must be an array' },
    )
    .min(1, 'items must carry at least one candidate line')
    .max(MAX_FILL_ITEMS, `items must carry at most ${MAX_FILL_ITEMS} candidate lines`),
});

// ---------------------------------------------------------------------------
// Ferry block — redirector-ready references, never raw urls
// ---------------------------------------------------------------------------

/** One public ferry reference: the redirect path is the only link the API exposes. */
interface TripFerryOfferRef {
  readonly id: number;
  readonly operator: string;
  readonly routeLabel: string;
  readonly redirectPath: string;
}

/** The 200 payload: the fill result + the separate curated ferry block. */
type TripFillResponse = AllowanceFillResult & {
  readonly ferryOffers: readonly TripFerryOfferRef[];
};

// ---------------------------------------------------------------------------
// POST /api/v1/trip/fill
// ---------------------------------------------------------------------------

/**
 * Fill-request-shaped reasons — unreachable through zod, but the engine
 * is callable with any shape: keep the 400 contract (trip-feasibility
 * defense-in-depth parity).
 */
const REQUEST_SHAPE_FAULTS: ReadonlySet<AllowanceFillError['reason']> = new Set([
  'INVALID_TRAVEL_DATE',
  'TOO_MANY_ITEMS',
  'INVALID_QUANTITY',
]);

async function fillTripAllowance(c: Context<AppEnv>): Promise<Response> {
  const dto = await parseDto(c, tripFillRequestSchema);

  // Per-request composition over the D1 ports (basket.routes.ts parity):
  // the fill engine reads products/offers through IProductDataPort and
  // the allowance version through ITravellerAllowancePort — the ferry
  // table is unreachable from this object graph.
  const fillService = new AllowanceFillService(
    new ClassificationGateService(),
    new D1ProductDataPort(new D1ProductSearchRepository(c.env.DB)),
    new D1TravellerAllowancePort(new D1TravellerAllowancesRepository(c.env.DB)),
  );

  const result = await (async (): Promise<AllowanceFillResult> => {
    try {
      return await fillService.fill({
        travelDate: dto.travelDate,
        items: dto.items,
      });
    } catch (err) {
      if (err instanceof AllowanceFillError) {
        // No covering version: capping is spec-mandatory, so a fill has
        // no computable result — 409, resolvable by publishing a
        // version covering the date (trip-feasibility parity).
        if (err.reason === 'NO_ALLOWANCE_DATASET') {
          throw new ApiHttpError(409, {
            statusCode: 409,
            message: err.message,
            error: 'NoPublishedAllowances',
          });
        }
        // Curated/ingested data faults — the caller cannot fix these;
        // the operator must (InconsistentNormsError parity).
        if (
          err.reason === 'INVALID_ALLOWANCE_DATASET' ||
          err.reason === 'INVALID_PRODUCT_DATA'
        ) {
          throw new ApiHttpError(500, {
            statusCode: 500,
            message: err.message,
            error:
              err.reason === 'INVALID_ALLOWANCE_DATASET'
                ? 'InconsistentAllowances'
                : 'InconsistentProductData',
          });
        }
        if (err.reason === 'SEARCH_BUDGET_EXCEEDED') {
          throw new ApiHttpError(500, {
            statusCode: 500,
            message: err.message,
            error: 'SearchBudgetExceeded',
          });
        }
        if (REQUEST_SHAPE_FAULTS.has(err.reason)) {
          throw new ApiHttpError(400, {
            statusCode: 400,
            message: err.message,
            error: 'ValidationError',
          });
        }
        // PRODUCT_NOT_FOUND / NO_OFFERS — 404 (basket parity: the
        // caller picked a line that cannot be resolved).
        throw new ApiHttpError(404, err.message);
      }
      if (err instanceof BasketClassificationGateError) {
        throw new ApiHttpError(422, {
          statusCode: 422,
          message: err.message,
          error: 'BasketClassificationGateRejection',
          productId: err.productId,
        });
      }
      throw err;
    }
  })();

  // Version-aware idempotency: the resolved dataset version keys the
  // cache and is re-checked on lookup, so an allowance bump yields a
  // fresh fill under identical requests.
  const allowanceVersion: string = result.allowanceDatasetVersion;
  const clientKey = c.req.header('x-idempotency-key');
  const cacheKey =
    clientKey ??
    [
      'trip-fill',
      dto.travelDate,
      JSON.stringify(dto.items),
      allowanceVersion,
    ].join('|');

  const cached = await idempotencyLookup(c.env, cacheKey, [allowanceVersion]);
  if (cached !== null) {
    c.header('X-Cache', 'HIT');
    c.header('X-Content-Hash', await idempotencyContentHash(cached.result));
    return c.json(await withFerryBlock(c, cached.result as AllowanceFillResult));
  }

  await idempotencyStore(c.env, cacheKey, result, {
    datasetVersions: [allowanceVersion],
  });

  c.header('X-Cache', 'MISS');
  c.header('X-Content-Hash', await idempotencyContentHash(result));
  return c.json(await withFerryBlock(c, result));
}

/**
 * FERRY PATH — the independent data path (module doc): read fresh on
 * every request and merged ONLY here, in the response envelope. The
 * fill body enters and leaves untouched; the raw url never crosses this
 * boundary.
 */
async function withFerryBlock(
  c: Context<AppEnv>,
  result: AllowanceFillResult,
): Promise<TripFillResponse> {
  const offers = await new D1FerryOffersRepository(c.env.DB).listPublished();
  return {
    ...result,
    ferryOffers: offers.map((offer) => ({
      id: offer.id,
      operator: offer.operator,
      routeLabel: offer.routeLabel,
      redirectPath: `/api/v1/outbound/ferry/${offer.id}`,
    })),
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the trip-fill handler behind its guard chain (rate limit →
 * session auth → entitlement — Nest guard order; the entitlement check
 * is the calculation surface's paywall seam).
 */
export function registerTripRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.post(
    '/api/v1/trip/fill',
    requireRateLimit('CALCULATOR'),
    sessionAuth(),
    requireFeature('calculation:basic'),
    fillTripAllowance,
  );
  return app;
}
