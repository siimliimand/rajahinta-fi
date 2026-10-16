/**
 * Public tax-change calendar API (task 3.2, change tax-change-calendar;
 * spec: "Public deterministic calendar API"):
 *
 *   GET /api/v1/calendar/events?year=2026[&language=fi|en]
 *   GET /api/v1/calendar/next[?language=fi|en]
 *
 * Strictly read-side over the task-3.1 DrizzleCalendarEventRepository
 * (constructed over `c.env.DB` exactly like the allowances-route
 * precedent). No write path exists here: events are created and updated
 * only through the audited ops console (task 5.1).
 *
 * Determinism: the repository orders the year listing and selects the
 * next event through the pure calendar module's one total order, and
 * every date judgement takes an explicit input — the route owns the
 * single clock read per request (`todayIsoDate()`, the allowances-route
 * default-date precedent) and passes it down, so repeated identical
 * requests within a day produce byte-identical responses.
 *
 * Next-event shape: the payload carries the full event row (status
 * included), the module's own `daysUntil` figure for CONFIRMED rows
 * (`null` for EXPECTED — a window must never render a countdown), the
 * `expectedWindow` verbatim for EXPECTED rows, and the disclaimer. The
 * daysUntil figure is NOT recomputed here: the selected row is fed back
 * through the pure module's `findNextCalendarEvent`, which validates the
 * row and applies its own day arithmetic — the route never re-implements
 * window or date math. When nothing is upcoming the endpoint answers an
 * explicit 404 envelope (the allowances uncovered-date precedent — never
 * a guessed or fabricated fallback event).
 *
 * Disclaimer policy (documented decision, R2 governs presentation): the
 * structural rhythm disclaimer rides EVERY 200 response of BOTH
 * endpoints, selected by the request's `language` from the versioned
 * FI/EN constant pair (`selectRhythmDisclaimer`, the what-if route's
 * language handling — `fi` default per design D1, never composed at
 * request time). Over-inclusion on CONFIRMED-only payloads is safe — R2
 * requires the disclaimer on EXPECTED-event presentation and does not
 * forbid it elsewhere — while conditionally omitting it would make the
 * response shape depend on row statuses and complicate every client.
 *
 * Middleware per route (allowances parity — a public read over alcohol
 * reference data): the age gate precedes the handler and the DEFAULT
 * read rate-limit profile applies. No feature flags.
 *
 * @module CalendarRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { requireRateLimit } from '../middleware/rate-limit';
import { ageGate } from '../middleware/age-gate';
import { validationError } from './support';
import {
  findNextCalendarEvent,
  selectRhythmDisclaimer,
  type CalendarEvent,
} from '../../../../packages/core-domain/src/calendar';
import { DrizzleCalendarEventRepository } from '../../../../packages/data-platform/src/repositories/calendar-event.repository';

// ---------------------------------------------------------------------------
// Query DTOs — zod over the query object, 400 ValidationError on failure
// ---------------------------------------------------------------------------

/** Contract-level messages name the valid values (never silent coercion). */
const YEAR_MESSAGE = 'year must be an integer calendar year (e.g. 2026)';
const LANGUAGE_MESSAGE = 'language must be one of: fi, en';

/**
 * The events listing query — `year` is REQUIRED (the spec's read key),
 * `language` selects the disclaimer variant (design D1: `fi` default,
 * `en` explicit). `z.coerce` parses the query string; an absent or empty
 * year is preprocessed to `undefined` so it fails REQUIRED (not silently
 * coerced to 0), and the integer check rejects fractions and junk alike
 * with the SAME message.
 */
const calendarEventsQuerySchema = z.object({
  year: z.preprocess(
    (raw) => (raw === '' || raw === undefined ? undefined : raw),
    z.coerce
      .number({
        invalid_type_error: YEAR_MESSAGE,
        required_error: YEAR_MESSAGE,
      })
      .int({ message: YEAR_MESSAGE }),
  ),
  language: z
    .enum(['fi', 'en'], { errorMap: () => ({ message: LANGUAGE_MESSAGE }) })
    .default('fi'),
});

/** The next-event query — only the disclaimer language. */
const calendarNextQuerySchema = z.object({
  language: z
    .enum(['fi', 'en'], { errorMap: () => ({ message: LANGUAGE_MESSAGE }) })
    .default('fi'),
});

/** Parse a query object against a schema, throwing the 400 envelope. */
function parseQuery<S extends z.ZodType>(
  query: Record<string, string>,
  schema: S,
): z.infer<S> {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw validationError(result.error);
  }
  return result.data;
}

/** Today as a UTC calendar date — the route's ONE clock read per request. */
function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Response shaping — the full sourced row, nothing added, nothing hidden
// ---------------------------------------------------------------------------

/**
 * The event row as the public payload carries it: every sourced field
 * (both locale texts, the official source URL, the status/precision
 * split) verbatim from the domain shape — citations are never
 * paraphrased into conclusions, and the status rides every row. The ops
 * console (task 5.1) reuses this mapper so both surfaces speak one row
 * shape.
 */
export function calendarEventBody(event: CalendarEvent): CalendarEvent {
  return {
    id: event.id,
    year: event.year,
    eventType: event.eventType,
    status: event.status,
    occurrenceDate: event.occurrenceDate,
    expectedWindow: event.expectedWindow,
    titleFi: event.titleFi,
    titleEn: event.titleEn,
    summaryFi: event.summaryFi,
    summaryEn: event.summaryEn,
    sourceUrl: event.sourceUrl,
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function getCalendarEvents(c: Context<AppEnv>): Promise<Response> {
  const query = parseQuery(c.req.query(), calendarEventsQuerySchema);

  const events = await new DrizzleCalendarEventRepository(
    c.env.DB,
  ).listByYear(query.year);

  return c.json({
    year: query.year,
    // Disclaimer policy (module doc): ALWAYS present on this endpoint.
    disclaimer: selectRhythmDisclaimer(query.language),
    events: events.map(calendarEventBody),
  });
}

async function getNextCalendarEvent(c: Context<AppEnv>): Promise<Response> {
  const query = parseQuery(c.req.query(), calendarNextQuerySchema);

  // The route owns the clock read and passes an explicit date down —
  // nothing below this line ever reads the clock (the pure module's rule).
  const fromDate = todayIsoDate();
  const repo = new DrizzleCalendarEventRepository(c.env.DB);
  const selected = await repo.findNext(fromDate);
  if (selected === null) {
    // Explicit not-found — an empty calendar degrades to an envelope the
    // widget can hide on, never a fabricated fallback event.
    throw new ApiHttpError(404, 'No upcoming calendar event');
  }

  // The module's OWN daysUntil figure — recounted through the pure
  // selector over the already-selected row (see module doc): CONFIRMED
  // rows carry the whole-day countdown, EXPECTED rows `null`. The same
  // selector picked the row as of the same date, so the recount cannot
  // come up empty; the guard keeps the impossible branch envelope-honest.
  const recounted = findNextCalendarEvent([selected], fromDate);
  if (recounted === null) {
    throw new ApiHttpError(404, 'No upcoming calendar event');
  }
  const { daysUntil } = recounted;

  return c.json({
    fromDate,
    event: calendarEventBody(selected),
    status: selected.status,
    daysUntil,
    expectedWindow: selected.expectedWindow,
    disclaimer: selectRhythmDisclaimer(query.language),
  });
}

// ---------------------------------------------------------------------------
// Registration (age gate + limiter pre-registered per-route here)
// ---------------------------------------------------------------------------

/** Register both calendar reads behind their gate and limiter. */
export function registerCalendarRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.on('GET', '/api/v1/calendar/events', ageGate());
  app.get(
    '/api/v1/calendar/events',
    requireRateLimit('DEFAULT'),
    getCalendarEvents,
  );
  app.on('GET', '/api/v1/calendar/next', ageGate());
  app.get('/api/v1/calendar/next', requireRateLimit('DEFAULT'), getNextCalendarEvent);
  return app;
}
