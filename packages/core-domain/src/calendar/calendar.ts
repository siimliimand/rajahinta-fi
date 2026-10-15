/**
 * Pure tax-change calendar service — next-event selection over the
 * provided, already-fetched event rows (spec: tax-change-calendar,
 * "Public deterministic calendar API", task 2.1).
 *
 * The module consumes the rows the caller (the repository adapter of
 * task 3.1, wired behind {@link ICalendarEventRepositoryPort}) already
 * read — it never queries, never writes, and never reads the system
 * clock: every date judgement takes an explicit `fromDate` input
 * (ISO `YYYY-MM-DD`), so repeated identical requests produce identical
 * answers on every runtime.
 *
 * NEXT-EVENT RULE (documented, deterministic):
 * 1. Eligibility — a CONFIRMED event is upcoming when its
 *    `occurrenceDate` is on or after `fromDate`; an EXPECTED event is
 *    upcoming while its window has not ended — an in-progress
 *    quarter/month window whose start has passed is still upcoming
 *    (the rhythm is current even though its first day is gone).
 * 2. Selection — eligible events are ranked with the SAME total order
 *    the year listing uses ({@link compareCalendarEvents}: period
 *    start, then CONFIRMED before EXPECTED in the same period, then
 *    event type, then id) and the first one wins. "Nearest by period,
 *    CONFIRMED beats EXPECTED in the same period, deterministic
 *    tie-break" is therefore one rule shared by both surfaces — the
 *    next event is always the first upcoming event of the listing, so
 *    the widget and the timeline can never disagree.
 * 3. Countdown — CONFIRMED rows carry `daysUntil` (whole days from
 *    `fromDate` to `occurrenceDate`, computed in UTC arithmetic on the
 *    parsed parts); EXPECTED rows carry `null` — a window event must
 *    never render a countdown, the caller renders the window label.
 * 4. No eligible event → `null` — the caller degrades gracefully, the
 *    module never invents a fallback event.
 *
 * VALIDATION (documented, fail-loud): every provided row is validated
 * BEFORE selection — a malformed row is a caller-contract violation
 * ({@link InvalidCalendarInputError}) even when it would not have been
 * selected, because a silently tolerated row would corrupt the
 * comparator or leak an unsourced/locale-less row into a rendering
 * surface. Validation never clamps, coerces, or drops values.
 *
 * @module CalendarService
 */

import {
  CALENDAR_EVENT_STATUSES,
  CALENDAR_EVENT_TYPES,
  InvalidCalendarInputError,
  type CalendarEvent,
  type NextCalendarEvent,
} from './calendar.types';
import {
  assertIsoDay,
  resolveWindowEnd,
  sortCalendarEvents,
} from './ordering';

// ---------------------------------------------------------------------------
// Validation — caller-contract violations, first violation wins
// ---------------------------------------------------------------------------

/** Locale texts and the source URL are mandatory — a missing locale would render a hole mid-timeline. */
function assertNonEmpty(field: string, value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidCalendarInputError(
      `calendar.${field} must be a non-empty string`,
    );
  }
}

/**
 * Validate one calendar event against the module's contract: closed
 * vocabularies, the status/precision split (CONFIRMED carries an exact
 * date and no window; EXPECTED a window and no exact date), real-
 * calendar date/window shapes, and mandatory locale texts + source
 * URL. Unknown types and statuses are rejected naming the valid values
 * — never silently coerced.
 */
export function assertValidCalendarEvent(event: CalendarEvent): void {
  if (!Number.isInteger(event.id)) {
    throw new InvalidCalendarInputError(
      `calendar.id must be an integer, got ${String(event.id)}`,
    );
  }
  if (!Number.isInteger(event.year)) {
    throw new InvalidCalendarInputError(
      `calendar.year must be an integer, got ${String(event.year)}`,
    );
  }
  if (!(CALENDAR_EVENT_TYPES as readonly string[]).includes(event.eventType)) {
    throw new InvalidCalendarInputError(
      `calendar.eventType ${JSON.stringify(String(event.eventType))} is not a known calendar ` +
        `event type — valid types: ${CALENDAR_EVENT_TYPES.join(', ')}`,
    );
  }
  if (!(CALENDAR_EVENT_STATUSES as readonly string[]).includes(event.status)) {
    throw new InvalidCalendarInputError(
      `calendar.status ${JSON.stringify(String(event.status))} is not a known calendar ` +
        `status — valid statuses: ${CALENDAR_EVENT_STATUSES.join(', ')}`,
    );
  }

  if (event.status === 'CONFIRMED') {
    if (event.expectedWindow !== null) {
      throw new InvalidCalendarInputError(
        `calendar.id ${event.id}: a CONFIRMED event must not carry an expected window — ` +
          'an exact date excludes rhythm-window wording',
      );
    }
    assertIsoDay(event.occurrenceDate as string, `calendar.id ${event.id} occurrenceDate`);
  } else {
    if (event.occurrenceDate !== null) {
      throw new InvalidCalendarInputError(
        `calendar.id ${event.id}: an EXPECTED event must not carry an exact occurrence date — ` +
          'a rhythm window must not claim day precision',
      );
    }
    // Shape enforced here (via the window resolver) rather than only
    // mid-sort, so the violation surfaces at the boundary with the row
    // context attached.
    resolveWindowEnd(event);
  }

  assertNonEmpty(`id ${event.id} titleFi`, event.titleFi);
  assertNonEmpty(`id ${event.id} titleEn`, event.titleEn);
  assertNonEmpty(`id ${event.id} summaryFi`, event.summaryFi);
  assertNonEmpty(`id ${event.id} summaryEn`, event.summaryEn);
  assertNonEmpty(`id ${event.id} sourceUrl`, event.sourceUrl);
}

/** Validate every provided row — all of them, eligible or not (a silently tolerated malformed row would corrupt the comparator). */
function assertAllValid(events: readonly CalendarEvent[]): void {
  for (const event of events) {
    assertValidCalendarEvent(event);
  }
}

// ---------------------------------------------------------------------------
// Next-event selection
// ---------------------------------------------------------------------------

/** Whole days from `fromDate` to `target`, computed in UTC arithmetic on the parsed ISO parts — no clock, no timezone. */
function diffWholeDays(target: string, fromDate: string): number {
  const parse = (iso: string): number => {
    const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((parse(target) - parse(fromDate)) / 86_400_000);
}

/**
 * Return the nearest upcoming event as of the explicit `fromDate`
 * (ISO `YYYY-MM-DD`), with its `daysUntil` figure for CONFIRMED rows
 * (`null` for EXPECTED windows — no countdown is invented for a window
 * event). Deterministic: same rows, same `fromDate`, same result on
 * every runtime.
 *
 * Pure — no I/O, no clock; the input array is never mutated. Returns
 * `null` when nothing is upcoming; the caller renders the degrade
 * state. See the module docs for the exact rule.
 */
export function findNextCalendarEvent(
  events: readonly CalendarEvent[],
  fromDate: string,
): NextCalendarEvent | null {
  assertIsoDay(fromDate, 'fromDate');
  assertAllValid(events);

  const upcoming = events.filter((event) => {
    if (event.status === 'CONFIRMED') {
      // Exact-date eligibility: on or after the requested day.
      return (event.occurrenceDate as string) >= fromDate;
    }
    // Window eligibility: current until the window has ended — an
    // in-progress window whose start has passed is still upcoming.
    return (resolveWindowEnd(event) as string) >= fromDate;
  });

  if (upcoming.length === 0) {
    return null;
  }

  // Same total order as the year listing — the next event is the first
  // upcoming event of the listing (widget and timeline never disagree).
  const [event] = sortCalendarEvents(upcoming);
  return {
    event,
    daysUntil: event.status === 'CONFIRMED' ? diffWholeDays(event.occurrenceDate as string, fromDate) : null,
  };
}
