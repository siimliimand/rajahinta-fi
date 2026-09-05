/**
 * Event calculator API (task 4.3, change product-roadmap-phases-1-4) —
 * POST /api/v1/event-calc over the task-4.2 pure eventcalc module and
 * the task-4.1 D1ConsumptionNormsRepository.
 *
 * Per request: resolve the PUBLISHED norms effective on the event date
 * (half-open window, one row per drink type, each naming its
 * `versionLabel`), feed them into `calculateEventShoppingList`, and
 * return the module's result plus a STRUCTURAL norms-are-estimates
 * disclaimer field (disclaimer.ts architecture rule: the disclaimer is
 * part of the result object, server-side — not a UI-only string).
 *
 * Middleware chain per request (in registration order):
 *
 *   requireFeatureFlag('EVENT_CALCULATOR') → requireRateLimit('CALCULATOR')
 *   → handler
 *
 * The flag gate composes here, not in guards.ts: this is a NEW surface
 * with no Nest counterpart, and guards.ts is the Nest-parity enumeration.
 * Flag BEFORE limiter (alerts ordering rationale): a flag-off deployment
 * rejects with 403 before any limiter DO traffic. The route is anonymous
 * (no session) like the calculator surface — the per-IP CALCULATOR
 * profile (10/min) applies.
 *
 * Documented decisions:
 * - Caps: guests 1..500, durationHours 1..72. The module accepts 0, but
 *   the API surface targets real events — a zero/absent dimension is a
 *   caller bug and rejects 400 instead of returning an all-zero list.
 *   500 guests sits far above any private gathering the MVP targets
 *   (larger events are professional-catering scale) and bounds the plan
 *   enumeration; 72 whole hours covers a three-day festival weekend.
 *   Fractional hours are unrepresentable at the module's exactness
 *   contract (whole hours only) and reject as non-integer. Out-of-cap
 *   rejects 400 ValidationError per the sibling convention (alerts/
 *   basket manual validation), not 422.
 * - No published norms: 200 with the module's `NO_PUBLISHED_NORMS`
 *   result VALUE plus the disclaimer — an expected operational state
 *   (nothing published yet), not a missing resource; the module models
 *   it as a value (unitprice 'unavailable' precedent) and the API
 *   boundary preserves that. 404 stays reserved for unknown resources.
 * - Version-aware idempotency (calculator/basket parity): the resolved
 *   norms version IS the dataset version. It is resolved FIRST and is
 *   part of the derived `event-calc:` key AND the lookup version check,
 *   so repeated identical requests within one norms version return a
 *   byte-identical result (X-Cache HIT) while a norms bump produces a
 *   fresh result (new key). Client `x-idempotency-key` values travel
 *   verbatim, keyed to the version at lookup. The NO_PUBLISHED_NORMS
 *   path is deliberately not cached: its result depends on input alone,
 *   and a cached empty state could outlive a norms publication (no
 *   version to pin the key to).
 *
 * @module EventCalcRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { FeatureFlag, requireFeatureFlag } from '../middleware/feature-flags';
import { requireRateLimit } from '../middleware/rate-limit';
import { parseDto } from './support';
import { calculateEventShoppingList } from '../../../../packages/core-domain/src/eventcalc/eventcalc';
import {
  InconsistentNormsError,
  InvalidEventInputError,
  MixedNormVersionsError,
} from '../../../../packages/core-domain/src/eventcalc/eventcalc.types';
import type {
  EventCalcResult,
  EventNormRow,
} from '../../../../packages/core-domain/src/eventcalc/eventcalc.types';
import type { Disclaimer } from '../../../../packages/core-domain/src/calculator/calculator.types';
import { D1ConsumptionNormsRepository } from '../../../../packages/data-platform/src/repositories/d1/consumption-norms.repository';
import {
  idempotencyLookup,
  idempotencyStore,
  idempotencyContentHash,
} from '../adapters/idempotency-facade';

// ---------------------------------------------------------------------------
// Structural disclaimer — norms are estimates (DISCLAIMER_FI precedent:
// same { text, language, version } keys, attached ON the result object)
// ---------------------------------------------------------------------------

const NORMS_ESTIMATES_DISCLAIMER_FI: Disclaimer = {
  text: 'Ostoslista perustuu yleisiin kulutusnormeihin. Normiarvot ovat arvioita keskimääräisestä kulutuksesta — todellinen kulutus vaihtelee tilaisuuden ja vieraiden mukaan.',
  language: 'fi',
  version: '1.0',
};

// ---------------------------------------------------------------------------
// Validation — caps documented in the module doc
// ---------------------------------------------------------------------------

const MAX_GUESTS = 500;
const MAX_DURATION_HOURS = 72;

const EVENT_PROFILES = ['casual_gathering', 'dinner_party', 'celebration'] as const;

const GUESTS_MESSAGE = `guests must be an integer between 1 and ${MAX_GUESTS}`;
const DURATION_MESSAGE = `durationHours must be an integer between 1 and ${MAX_DURATION_HOURS}`;

const eventCalcRequestSchema = z.object({
  guests: z
    .number({
      required_error: GUESTS_MESSAGE,
      invalid_type_error: GUESTS_MESSAGE,
    })
    .int(GUESTS_MESSAGE)
    .min(1, GUESTS_MESSAGE)
    .max(MAX_GUESTS, `guests must be at most ${MAX_GUESTS}`),
  durationHours: z
    .number({
      required_error: DURATION_MESSAGE,
      invalid_type_error: DURATION_MESSAGE,
    })
    .int(DURATION_MESSAGE)
    .min(1, DURATION_MESSAGE)
    .max(MAX_DURATION_HOURS, `durationHours must be at most ${MAX_DURATION_HOURS}`),
  eventProfile: z.enum(EVENT_PROFILES, {
    errorMap: () => ({
      message: `eventProfile must be one of: ${EVENT_PROFILES.join(', ')}`,
    }),
  }),
  eventDate: z
    .string({
      required_error: 'eventDate must be an ISO YYYY-MM-DD calendar date',
      invalid_type_error: 'eventDate must be an ISO YYYY-MM-DD calendar date',
    })
    .regex(
      /^\d{4}-\d{2}-\d{2}$/,
      'eventDate must be an ISO YYYY-MM-DD calendar date',
    ),
});

// ---------------------------------------------------------------------------
// POST /api/v1/event-calc
// ---------------------------------------------------------------------------

/** The module result decorated with the structural disclaimer field. */
type EventCalcResponse = EventCalcResult & { readonly disclaimer: Disclaimer };

async function calculateEvent(c: Context<AppEnv>): Promise<Response> {
  const dto = await parseDto(c, eventCalcRequestSchema);

  // Version-aware idempotency starts HERE: the norms version resolved for
  // (profile, date) is the dataset dimension of the cache key — resolved
  // FIRST, like the calculator's tax-version resolution (§15 known-issue fix).
  const resolvedNorms = await new D1ConsumptionNormsRepository(
    c.env.DB,
  ).findPublishedEffectiveOn(dto.eventProfile, dto.eventDate);

  // Repository rows → the pure module's narrow row shape (structurally
  // compatible by design, task 4.2; the explicit mapping keeps the API
  // layer honest about which fields cross the boundary).
  const norms: EventNormRow[] = resolvedNorms.map((row) => ({
    drinkType: row.drinkType,
    normValuePerGuestPerHour: row.normValuePerGuestPerHour,
    versionLabel: row.versionLabel,
  }));

  let result: EventCalcResult;
  try {
    result = calculateEventShoppingList({
      eventDate: dto.eventDate,
      eventProfile: dto.eventProfile,
      guests: dto.guests,
      durationHours: dto.durationHours,
      norms,
    });
  } catch (err) {
    // Defense in depth: zod makes InvalidEventInputError unreachable, but
    // the module is callable with any shape — keep the 400 contract.
    if (err instanceof InvalidEventInputError) {
      throw new ApiHttpError(400, {
        statusCode: 400,
        message: err.message,
        error: 'ValidationError',
      });
    }
    // InconsistentNormsError / MixedNormVersionsError are curated-DATA
    // faults (the repository's per-date resolution guarantees a coherent
    // version) — the caller cannot fix them; 500 for operator visibility.
    if (err instanceof InconsistentNormsError || err instanceof MixedNormVersionsError) {
      throw new ApiHttpError(500, {
        statusCode: 500,
        message: err.message,
        error: 'InconsistentNorms',
      });
    }
    throw err;
  }

  if (result.status === 'NO_PUBLISHED_NORMS') {
    // Explicit empty state (module doc): 200 + result value, not cached —
    // see the module doc's idempotency decision.
    const empty: EventCalcResponse = { ...result, disclaimer: NORMS_ESTIMATES_DISCLAIMER_FI };
    return c.json(empty);
  }

  const normsVersion: string = result.normsVersion;
  const clientKey = c.req.header('x-idempotency-key');
  const cacheKey =
    clientKey ??
    [
      'event-calc',
      dto.eventProfile,
      dto.eventDate,
      dto.guests,
      dto.durationHours,
      normsVersion,
    ].join('|');

  // Lookup re-checks the version (defense in depth — a verbatim client
  // key reused across a norms bump is a miss, calculator parity).
  const cached = await idempotencyLookup(c.env, cacheKey, [normsVersion]);
  if (cached !== null) {
    c.header('X-Cache', 'HIT');
    c.header('X-Content-Hash', await idempotencyContentHash(cached.result));
    return c.json(cached.result);
  }

  const body: EventCalcResponse = { ...result, disclaimer: NORMS_ESTIMATES_DISCLAIMER_FI };
  await idempotencyStore(c.env, cacheKey, body, { datasetVersions: [normsVersion] });

  c.header('X-Cache', 'MISS');
  c.header('X-Content-Hash', await idempotencyContentHash(body));
  return c.json(body);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the event-calculator handler behind its flag gate + limiter. */
export function registerEventCalcRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.post(
    '/api/v1/event-calc',
    requireFeatureFlag(FeatureFlag.EVENT_CALCULATOR),
    requireRateLimit('CALCULATOR'),
    calculateEvent,
  );
  return app;
}
