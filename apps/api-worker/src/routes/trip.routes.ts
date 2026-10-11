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
 *   2. FERRY PATH — the curated ferry display blocks, read fresh
 *      on EVERY request and attached AFTER cache retrieval, exactly
 *      like the trip-feasibility envelope (same redirector-ready shape
 *      — 8.3 renders the existing ferry block unchanged): the
 *      `ferryOffers` block from D1FerryOffersRepository.listPublished()
 *      and — beside it (change ferry-onboard-prices) — the `ferryPrices`
 *      observed onboard-shop block from D1FerryPriceRepository. Both
 *      are display-only curated facts; neither is a fill input.
 *
 * The idempotency cache stores ONLY the fill result — never the ferry
 * blocks — so the fill basket is byte-identical whether zero, one, or
 * many ferry rows exist (the compliance pattern, true by construction).
 * X-Content-Hash covers the cached fill body, not the per-request ferry
 * blocks. The raw ferry url never crosses this boundary.
 *
 * The `ferryPrices` rows carry the full curated provenance — operator,
 * route, display label, EUR minor-unit price, observation date (the UTC
 * calendar date), per-row citation. Display semantics: the table is
 * append-only history, so the block serves the LATEST observation per
 * (operator, route, label), in the deterministic (operator, route,
 * label) order, capped at MAX_FERRY_PRICE_ROWS rows. An empty table is
 * the designed empty state: the API returns `ferryPrices: []` honestly
 * and the frontend renders nothing — no staleness gate, no fallback
 * figure at the API.
 *
 * Middleware chain per request:
 *
 *   requireRateLimit('CALCULATOR') → handler
 *
 * The route is ANONYMOUS (change client-experience-improvement, D2 —
 * minimal personal data: the fill needs no identity), so the former
 * sessionAuth and `requireFeature('calculation:basic')` guards are
 * dropped. The CALCULATOR rate limit (the trip calculator's own,
 * 10/min), the version-aware idempotency cache, and the ferry-offer
 * neutrality contract are unchanged.
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
 * - The observed-price block is a pure read of the curated table
 *   (governance-gated at ingestion — every stored row is publishable):
 *   latest revision per (operator, route, label) from the append-only
 *   history, deterministic order, MAX_FERRY_PRICE_ROWS cap as a payload
 *   budget (truncation drops display rows only). The guard chain — age
 *   gate, CALCULATOR limiter, version-aware idempotency, anonymity — is
 *   untouched; the block attaches after the content hash, exactly like
 *   `ferryOffers`, and no calculator/optimizer module enters the import
 *   graph through it.
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
 * The display-only `empiricalMargin` (task 2.2, change
 * hedge-dedup-confidence-meter) attaches AFTER the ferry merge — the
 * third independent read-time path. A traveller fill has no transport
 * carrier (the traveller IS the carrier) and no single product
 * category, so only the ladder's global rung is reachable (see
 * ./empirical-margin).
 *
 * @module TripRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { requireRateLimit } from '../middleware/rate-limit';
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
import {
  D1FerryPriceRepository,
  type FerryPriceObservationRecord,
} from '../../../../packages/data-platform/src/repositories/d1/ferry-price.repository';
import { D1ProductSearchRepository } from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import { D1ProductDataPort } from '../adapters/d1-domain-ports';
import { D1TravellerAllowancePort } from '../adapters/d1-traveller-allowance-port';
import {
  idempotencyLookup,
  idempotencyStore,
  idempotencyContentHash,
} from '../adapters/idempotency-facade';
import {
  readEmpiricalMarginLadder,
  withEmpiricalMargin,
  type WithEmpiricalMargin,
} from './empirical-margin';

/**
 * The trip-fill margin query (task 2.2): a traveller fill has no single
 * product category and no transport carrier (the traveller IS the
 * carrier) — the ladder path simply cannot enter the rungs that need
 * either, so only the global rung is reachable (margin-calibration
 * geometry; the query stays honest, never guessed).
 */
const TRIP_MARGIN_QUERY = { category: null, carrier: null } as const;

/** The served fill body: fill result + ferry block + the optional margin. */
type TripFillServedResponse = WithEmpiricalMargin<TripFillResponse>;

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

/**
 * The 200 payload: the fill result + the separate curated ferry blocks
 * (`ferryOffers`, and `ferryPrices` beside it — change
 * ferry-onboard-prices). Pure key addition: no existing field renamed,
 * moved, or reshaped.
 */
type TripFillResponse = AllowanceFillResult & {
  readonly ferryOffers: readonly TripFerryOfferRef[];
  readonly ferryPrices: readonly TripFerryPriceRow[];
};

// ---------------------------------------------------------------------------
// Observed-price block — curated onboard-shop facts, display-only
// (change ferry-onboard-prices; spec "Observed onboard prices block")
// ---------------------------------------------------------------------------

/**
 * Payload budget for the display block: at most MAX_FERRY_PRICE_ROWS
 * rows are served, truncated in the block's deterministic
 * (operator, route, label) order. The curated dataset is bounded by
 * operator transcription, so the cap guards unbounded growth rather
 * than an expected state — and it can drop display rows only, never a
 * calculation figure (the block is display-only).
 */
const MAX_FERRY_PRICE_ROWS = 50;

/** One observed onboard price: the curated row's full provenance. */
interface TripFerryPriceRow {
  readonly operator: string;
  readonly route: string;
  readonly label: string;
  /** EUR minor-unit price, verbatim from the observation. */
  readonly priceCents: number;
  /**
   * The observation date — the stored instant's UTC calendar date
   * (YYYY-MM-DD; the upsert normalizes observed_at to a full ISO UTC
   * instant, so the slice is exact).
   */
  readonly observedAt: string;
  /** Per-row source citation, verbatim from the observation. */
  readonly citation: string;
}

/**
 * Deterministic (operator, route, label) order — byte-wise
 * comparison, locale-independent (the trip-feasibility cache-key sort
 * precedent).
 */
function byObservationKey(
  a: FerryPriceObservationRecord,
  b: FerryPriceObservationRecord,
): number {
  return (
    (a.operator < b.operator ? -1 : a.operator > b.operator ? 1 : 0) ||
    (a.route < b.route ? -1 : a.route > b.route ? 1 : 0) ||
    (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)
  );
}

/**
 * FERRY-PRICE READ — the observed-price half of the ferry path (module
 * doc): stored rows in, display rows out. The fill path cannot reach
 * this function (data-platform import only — no calculator/optimizer
 * module crosses here); the block meets the response only in the
 * envelope below.
 *
 * Latest-revision display: history is append-only (a re-observation on
 * a later date lands a NEW row), so the block dedupes to the LATEST
 * observation per (operator, route, label) — max observed_at; the
 * unique constraint makes the instant unambiguous within a key.
 */
async function readFerryPriceRows(
  db: D1DatabaseLike,
): Promise<readonly TripFerryPriceRow[]> {
  const observations = await new D1FerryPriceRepository(db).findPublished();

  const latestByKey = new Map<string, FerryPriceObservationRecord>();
  for (const row of observations) {
    const key = `${row.operator}\n${row.route}\n${row.label}`;
    const kept = latestByKey.get(key);
    if (kept === undefined || kept.observedAt.getTime() < row.observedAt.getTime()) {
      latestByKey.set(key, row);
    }
  }

  return [...latestByKey.values()]
    .sort(byObservationKey)
    .slice(0, MAX_FERRY_PRICE_ROWS)
    .map((row) => ({
      operator: row.operator,
      route: row.route,
      label: row.label,
      priceCents: row.priceCents,
      observedAt: row.observedAt.toISOString().slice(0, 10),
      citation: row.citation,
    }));
}

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
    return c.json(
      await serveWithMargin(c, cached.result as AllowanceFillResult),
    );
  }

  await idempotencyStore(c.env, cacheKey, result, {
    datasetVersions: [allowanceVersion],
  });

  c.header('X-Cache', 'MISS');
  c.header('X-Content-Hash', await idempotencyContentHash(result));
  return c.json(await serveWithMargin(c, result));
}

/**
 * The served body: the ferry merge, then the display-only
 * `empiricalMargin` resolved fresh from the margins snapshot (task 2.2)
 * — both AFTER the content hash, so the cached payload keeps identifying
 * the fill (the ferry-neutrality contract extends to the margin: the
 * fill body inside the cache never carries either per-request block).
 */
async function serveWithMargin(
  c: Context<AppEnv>,
  result: AllowanceFillResult,
): Promise<TripFillServedResponse> {
  const [withFerry, ladder] = await Promise.all([
    withFerryBlock(c, result),
    readEmpiricalMarginLadder(c.env.DB),
  ]);
  return withEmpiricalMargin(withFerry, ladder, TRIP_MARGIN_QUERY);
}

/**
 * FERRY PATH — the independent data path (module doc): both curated
 * blocks read fresh on every request and merged ONLY here, in the
 * response envelope. The fill body enters and leaves untouched; no raw
 * url crosses this boundary and neither block is a fill input.
 */
async function withFerryBlock(
  c: Context<AppEnv>,
  result: AllowanceFillResult,
): Promise<TripFillResponse> {
  const [offers, ferryPrices] = await Promise.all([
    new D1FerryOffersRepository(c.env.DB).listPublished(),
    readFerryPriceRows(c.env.DB),
  ]);
  return {
    ...result,
    ferryOffers: offers.map((offer) => ({
      id: offer.id,
      operator: offer.operator,
      routeLabel: offer.routeLabel,
      redirectPath: `/api/v1/outbound/ferry/${offer.id}`,
    })),
    ferryPrices,
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the trip-fill handler behind its CALCULATOR rate limiter —
 * anonymous by design (D2); idempotency and the ferry block are
 * unchanged.
 */
export function registerTripRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.post(
    '/api/v1/trip/fill',
    requireRateLimit('CALCULATOR'),
    fillTripAllowance,
  );
  return app;
}
