/**
 * Trip feasibility API (task 5.3, change product-roadmap-phases-1-4) —
 * POST /api/v1/trip-feasibility over the task-5.2 pure tripcalc module
 * and the task-5.1 D1TravellerAllowancesRepository.
 *
 * Per request: resolve the PUBLISHED allowance dataset effective on the
 * travel date (half-open window, version resolved as a unit), map it
 * into the module's narrow already-resolved shape, run
 * `calculateTripBreakEven`, and return the module's result — whose
 * STRUCTURAL indicative-limits disclaimer field travels with every
 * rendering (disclaimer.ts architecture rule; task 5.4 renders from the
 * returned field, never from a UI string).
 *
 * ## Affiliate neutrality — two independent data paths (binding, design R8)
 *
 * The response envelope merges TWO paths that share nothing else:
 *
 *   1. CALCULATION PATH — allowances repository → pure module →
 *      idempotency cache. The ferry table is unreachable from here; the
 *      module's input types carry no affiliate field at source level.
 *   2. FERRY PATH — D1FerryOffersRepository.listPublished(), read fresh
 *      on EVERY request (hit or miss) and attached as the sibling
 *      `ferryOffers` block after cache retrieval.
 *
 * The idempotency cache stores ONLY the calculation result — never the
 * ferry block — so a cached calculation cannot freeze stale curated
 * links, and the calculation bytes are literally independent of how
 * many ferry rows exist (0, 1, many): the 5.5 byte-identical compliance
 * test is true by construction. X-Content-Hash covers the cached
 * calculation body (the deterministic half), not the per-request ferry
 * block.
 *
 * Public ferry references are redirector-ready, never raw urls: each
 * block item carries `redirectPath` (`/api/v1/outbound/ferry/:id`) into
 * the existing outbound redirect controller (R8: click tracking reuses
 * it — the stored url's only public reader). The raw url exists solely
 * in the table and the audited operator console.
 *
 * Middleware chain per request (in registration order):
 *
 *   requireFeatureFlag('TRIP_CALCULATOR') → requireRateLimit('CALCULATOR')
 *   → handler
 *
 * Flag BEFORE limiter (alerts/event-calc ordering rationale): a flag-off
 * deployment rejects with 403 before any limiter DO traffic. Anonymous
 * route (no session) like the calculator surface — the per-IP
 * CALCULATOR profile (10/min) applies.
 *
 * Documented decisions:
 * - Validation bounds mirror the module's contracts exactly, plus the
 *   API-surface caps the sibling routes establish: passengers 1..9 (the
 *   MVP vehicle set — car, van — physically bounds a shared trip at a
 *   van's nine seats), ticket/fuel costs 1..10 000 000 cents (POSITIVE
 *   per the task contract — a zero-cost trip is a caller bug; €100 000
 *   is the event-budget magnitude cap), per-litre prices 0..100 000
 *   cents (the module's field semantics are authoritative: non-negative
 *   integers — a zero price is a legitimate shape the module reports as
 *   NO_BREAK_EVEN, so the route invents no stricter bound), 1..6 price
 *   rows (the canonical category set), duplicate categories reject in
 *   zod (the module's DUPLICATE_CATEGORY becomes a 400 before compute).
 * - No published allowance dataset effective on the travel date: 409
 *   `NoPublishedAllowances`. The spec REQUIRES capping (break-even and
 *   suggested volumes SHALL be capped by the applicable limits), so an
 *   uncapped result is unrepresentable — unlike event-calc's
 *   NO_PUBLISHED_NORMS (a module value state), the tripcalc module
 *   takes allowances as an input and has no empty state; serving one
 *   would mean inventing caps. The state resolves when an operator
 *   publishes a version covering the date.
 * - Curated allowance data that violates the module's dataset contract
 *   (unknown/duplicate category, cap-less row) maps to 500
 *   `InconsistentAllowances` (InconsistentNormsError parity): the
 *   caller cannot fix curated data; the operator must.
 * - Version-aware idempotency (calculator/basket/event-calc parity):
 *   the resolved allowance version is resolved FIRST, keys the cache,
 *   and is re-checked on lookup, so an allowance bump yields fresh
 *   results under identical requests. Client `x-idempotency-key`
 *   values travel verbatim.
 *
 * @module TripFeasibilityRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { FeatureFlag, requireFeatureFlag } from '../middleware/feature-flags';
import { requireRateLimit } from '../middleware/rate-limit';
import { parseDto } from './support';
import { calculateTripBreakEven } from '../../../../packages/core-domain/src/tripcalc/tripcalc';
import {
  InvalidTripInputError,
  TRIP_CATEGORY_KEYS,
  TRIP_VEHICLE_TYPES,
} from '../../../../packages/core-domain/src/tripcalc/tripcalc.types';
import type {
  TripCalcResult,
  TripInputErrorReason,
} from '../../../../packages/core-domain/src/tripcalc/tripcalc.types';
import { D1TravellerAllowancesRepository } from '../../../../packages/data-platform/src/repositories/d1/traveller-allowances.repository';
import { D1FerryOffersRepository } from '../../../../packages/data-platform/src/repositories/d1/ferry-offers.repository';
import {
  idempotencyLookup,
  idempotencyStore,
  idempotencyContentHash,
} from '../adapters/idempotency-facade';

// ---------------------------------------------------------------------------
// Validation — caps documented in the module doc
// ---------------------------------------------------------------------------

const MAX_PASSENGERS = 9;
const MAX_TRIP_COST_CENTS = 10_000_000;
const MAX_PRICE_CENTS_PER_LITRE = 100_000;

const PASSENGERS_MESSAGE = `passengers must be an integer between 1 and ${MAX_PASSENGERS}`;
const TICKET_MESSAGE = `ticketCostCents must be a positive integer between 1 and ${MAX_TRIP_COST_CENTS}`;
const FUEL_MESSAGE = `fuelCostCents must be a positive integer between 1 and ${MAX_TRIP_COST_CENTS}`;

const tripFeasibilityRequestSchema = z.object({
  travelDate: z
    .string({
      required_error: 'travelDate must be an ISO YYYY-MM-DD calendar date',
      invalid_type_error: 'travelDate must be an ISO YYYY-MM-DD calendar date',
    })
    .regex(
      /^\d{4}-\d{2}-\d{2}$/,
      'travelDate must be an ISO YYYY-MM-DD calendar date',
    ),
  vehicleType: z.enum(TRIP_VEHICLE_TYPES, {
    errorMap: () => ({
      message: `vehicleType must be one of: ${TRIP_VEHICLE_TYPES.join(', ')}`,
    }),
  }),
  passengers: z
    .number({
      required_error: PASSENGERS_MESSAGE,
      invalid_type_error: PASSENGERS_MESSAGE,
    })
    .int(PASSENGERS_MESSAGE)
    .min(1, PASSENGERS_MESSAGE)
    .max(MAX_PASSENGERS, `passengers must be at most ${MAX_PASSENGERS}`),
  ticketCostCents: z
    .number({
      required_error: TICKET_MESSAGE,
      invalid_type_error: TICKET_MESSAGE,
    })
    .int(TICKET_MESSAGE)
    .min(1, TICKET_MESSAGE)
    .max(MAX_TRIP_COST_CENTS, `ticketCostCents must be at most ${MAX_TRIP_COST_CENTS}`),
  fuelCostCents: z
    .number({
      required_error: FUEL_MESSAGE,
      invalid_type_error: FUEL_MESSAGE,
    })
    .int(FUEL_MESSAGE)
    .min(1, FUEL_MESSAGE)
    .max(MAX_TRIP_COST_CENTS, `fuelCostCents must be at most ${MAX_TRIP_COST_CENTS}`),
  prices: z
    .array(
      z.object({
        category: z.enum(TRIP_CATEGORY_KEYS, {
          errorMap: () => ({
            message: `prices[].category must be one of: ${TRIP_CATEGORY_KEYS.join(', ')}`,
          }),
        }),
        domesticPriceCentsPerLitre: z
          .number({
            invalid_type_error:
              'prices[].domesticPriceCentsPerLitre must be an integer between 0 and 100000',
          })
          .int('prices[].domesticPriceCentsPerLitre must be an integer between 0 and 100000')
          .min(0, 'prices[].domesticPriceCentsPerLitre must be an integer between 0 and 100000')
          .max(MAX_PRICE_CENTS_PER_LITRE, 'prices[].domesticPriceCentsPerLitre must be an integer between 0 and 100000'),
        foreignPriceCentsPerLitre: z
          .number({
            invalid_type_error:
              'prices[].foreignPriceCentsPerLitre must be an integer between 0 and 100000',
          })
          .int('prices[].foreignPriceCentsPerLitre must be an integer between 0 and 100000')
          .min(0, 'prices[].foreignPriceCentsPerLitre must be an integer between 0 and 100000')
          .max(MAX_PRICE_CENTS_PER_LITRE, 'prices[].foreignPriceCentsPerLitre must be an integer between 0 and 100000'),
      }),
      { invalid_type_error: 'prices must be an array' },
    )
    .min(1, 'prices must carry at least one category')
    .max(TRIP_CATEGORY_KEYS.length, `prices must carry at most ${TRIP_CATEGORY_KEYS.length} categories`),
})
  .superRefine((dto, ctx) => {
    const seen = new Set<string>();
    for (const [index, price] of dto.prices.entries()) {
      if (seen.has(price.category)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['prices', index, 'category'],
          message: `prices carries "${price.category}" more than once`,
        });
      }
      seen.add(price.category);
    }
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

/** The 200 payload: the calculation result + the separate curated ferry block. */
type TripFeasibilityResponse = TripCalcResult & {
  readonly ferryOffers: readonly TripFerryOfferRef[];
};

// ---------------------------------------------------------------------------
// POST /api/v1/trip-feasibility
// ---------------------------------------------------------------------------

/**
 * Curated-dataset fault reasons — a PUBLISHED allowance version that
 * violates the module's dataset contract is an operator-visibility 500,
 * not a client 400 (InconsistentNormsError parity).
 */
const CURATED_DATA_FAULTS: ReadonlySet<TripInputErrorReason> = new Set([
  'INVALID_ALLOWANCE_VERSION',
  'EMPTY_ALLOWANCE_LIMITS',
  'UNKNOWN_ALLOWANCE_CATEGORY',
  'DUPLICATE_ALLOWANCE_CATEGORY',
  'INVALID_ALLOWANCE_CAPS',
]);

async function calculateTripFeasibility(c: Context<AppEnv>): Promise<Response> {
  const dto = await parseDto(c, tripFeasibilityRequestSchema);

  // Version-aware idempotency starts HERE: the allowance version
  // resolved for the travel date is the dataset dimension of the cache
  // key — resolved FIRST (calculator §15 known-issue fix parity).
  const resolved = await new D1TravellerAllowancesRepository(
    c.env.DB,
  ).findPublishedEffectiveOn(dto.travelDate);

  if (resolved === null) {
    // Capping is spec-mandatory, so no dataset ⇒ no computable result.
    // 409 (module doc): resolvable by publishing a covering version.
    throw new ApiHttpError(409, {
      statusCode: 409,
      message: `No published traveller allowance dataset is effective on ${dto.travelDate} — the trip calculator cannot produce an uncapped result`,
      error: 'NoPublishedAllowances',
    });
  }

  // Repository rows → the pure module's narrow row shape (structurally
  // compatible by design, task 5.2; the explicit mapping keeps the API
  // layer honest about which fields cross the boundary).
  const result = (() => {
    try {
      return calculateTripBreakEven({
        travelDate: dto.travelDate,
        vehicleType: dto.vehicleType,
        passengers: dto.passengers,
        ticketCostCents: dto.ticketCostCents,
        fuelCostCents: dto.fuelCostCents,
        prices: dto.prices,
        allowances: {
          dataset: { versionLabel: resolved.dataset.versionLabel },
          limits: resolved.limits.map((limit) => ({
            category: limit.category,
            volumeCapLitres: limit.volumeCapLitres,
            quantityCap: limit.quantityCap,
          })),
        },
      });
    } catch (err) {
      // Defense in depth: zod makes the request-shaped reasons
      // unreachable, but the module is callable with any shape — keep
      // the 400 contract (event-calc parity).
      if (err instanceof InvalidTripInputError) {
        if (CURATED_DATA_FAULTS.has(err.reason)) {
          throw new ApiHttpError(500, {
            statusCode: 500,
            message: err.message,
            error: 'InconsistentAllowances',
          });
        }
        throw new ApiHttpError(400, {
          statusCode: 400,
          message: err.message,
          error: 'ValidationError',
        });
      }
      throw err;
    }
  })();

  const allowanceVersion: string = result.allowanceDatasetVersion;
  const clientKey = c.req.header('x-idempotency-key');
  const cacheKey =
    clientKey ??
    [
      'trip-feasibility',
      dto.travelDate,
      dto.vehicleType,
      dto.passengers,
      dto.ticketCostCents,
      dto.fuelCostCents,
      JSON.stringify(
        dto.prices
          .slice()
          .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0)),
      ),
      allowanceVersion,
    ].join('|');

  // Lookup re-checks the version (defense in depth — a verbatim client
  // key reused across an allowance bump is a miss, calculator parity).
  const cached = await idempotencyLookup(c.env, cacheKey, [allowanceVersion]);
  if (cached !== null) {
    c.header('X-Cache', 'HIT');
    c.header('X-Content-Hash', await idempotencyContentHash(cached.result));
    return c.json(await withFerryBlock(c, cached.result as TripCalcResult));
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
 * calculation body enters and leaves untouched; the raw url never
 * crosses this boundary.
 */
async function withFerryBlock(
  c: Context<AppEnv>,
  result: TripCalcResult,
): Promise<TripFeasibilityResponse> {
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

/** Register the trip-feasibility handler behind its flag gate + limiter. */
export function registerTripFeasibilityRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.post(
    '/api/v1/trip-feasibility',
    requireFeatureFlag(FeatureFlag.TRIP_CALCULATOR),
    requireRateLimit('CALCULATOR'),
    calculateTripFeasibility,
  );
  return app;
}
