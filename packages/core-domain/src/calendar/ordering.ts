/**
 * Deterministic calendar order — period start, then CONFIRMED before
 * EXPECTED, then event type, then id (spec: tax-change-calendar,
 * "Public deterministic calendar API": repeated identical requests must
 * produce identical responses).
 *
 * PERIOD (documented definition): a CONFIRMED event's period start is
 * its `occurrenceDate`; an EXPECTED event's period start is the first
 * day of its window — `YYYY-MM` starts on the 1st of the month,
 * `YYYY-Qn` on the quarter's first month (Q1 → January, Q2 → April,
 * Q3 → July, Q4 → October). Both normalise to an ISO `YYYY-MM-DD` day
 * string, so the comparator compares lexicographically — no `Date`
 * parsing, no timezone, no locale collation. String comparison is
 * code-unit order, not `localeCompare` — locale collation varies across
 * environments and ICU versions and would break the determinism
 * contract (the savings-ordering and digest-ordering precedent).
 *
 * SAME-PERIOD PRECEDENCE (documented): when two events share a period
 * start, the CONFIRMED day-precision event sorts before an EXPECTED
 * window — the exact date is the stronger fact (spec: next-event
 * selection). Within one status, the event type ascending (code-unit)
 * breaks ties, and the numeric id is the final key, so two distinct
 * rows can never compare equal: the order is a total order, invariant
 * under input permutation.
 *
 * Pure — every function returns a value or a new array, mutates
 * nothing, reads no clock.
 *
 * @module CalendarOrdering
 */

import {
  InvalidCalendarInputError,
  type CalendarEvent,
} from './calendar.types';

// ---------------------------------------------------------------------------
// Window resolution — month / quarter arithmetic on explicit inputs only
// ---------------------------------------------------------------------------

/** First calendar month of each quarter — the quarter start month the period key sorts by. */
const QUARTER_START_MONTH: Record<'1' | '2' | '3' | '4', string> = {
  '1': '01',
  '2': '04',
  '3': '07',
  '4': '10',
};

/** Last calendar month of each quarter — the window end falls on this month's final day. */
const QUARTER_END_MONTH: Record<'1' | '2' | '3' | '4', string> = {
  '1': '03',
  '2': '06',
  '3': '09',
  '4': '12',
};

/** Zero-pad a number to two digits (`9` → `'09'`). */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Assert an exact calendar day: ISO `YYYY-MM-DD` with a real-calendar
 * date (round-tripped through `Date.UTC` on the parsed parts — rejects
 * e.g. `2026-02-30`; no clock is read). A silently mis-parsed date
 * would corrupt both the comparator and the day-difference figure.
 */
export function assertIsoDay(value: string, field: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new InvalidCalendarInputError(
      `${field} ${JSON.stringify(value)} is not an ISO YYYY-MM-DD date`,
    );
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const roundTrip = new Date(Date.UTC(year, monthIndex, day));
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== monthIndex ||
    roundTrip.getUTCDate() !== day
  ) {
    throw new InvalidCalendarInputError(
      `${field} ${JSON.stringify(value)} is not a real calendar day`,
    );
  }
}

/** Format `Date.UTC`-derived parts back into an ISO `YYYY-MM-DD` day string. */
function isoDay(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

/** Last day of the given 1-based month — `Date.UTC(year, month, 0)` day-of-month, pure arithmetic on explicit parts (no clock). */
function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/**
 * A parsed expected window: the raw `YYYY-MM` / `YYYY-Qn` string plus
 * the normalised period boundaries the ordering and the next-event
 * eligibility test work on.
 */
export interface ResolvedExpectedWindow {
  readonly year: number;
  /** Calendar month of the window start (1-based). */
  readonly startMonth: number;
  /** Calendar month of the window end (1-based). */
  readonly endMonth: number;
  /** First day of the window, ISO `YYYY-MM-DD` — the period sort key. */
  readonly startDay: string;
  /** Last day of the window, ISO `YYYY-MM-DD` — the upcoming test's boundary. */
  readonly endDay: string;
}

/**
 * Parse an expected window (`YYYY-MM` or `YYYY-Qn`) into its period
 * boundaries. Malformed shapes throw {@link InvalidCalendarInputError}
 * naming the valid shapes — a silently mis-parsed window would corrupt
 * both the comparator and the next-event eligibility test.
 *
 * `YYYY-MM` requires a zero-padded month 01–12; `YYYY-Qn` a quarter
 * Q1–Q4 (mirroring the persistence boundary's window shape). Leap
 * Februaries resolve exactly (`2028-02` ends on the 29th).
 */
export function resolveExpectedWindow(window: string): ResolvedExpectedWindow {
  const monthMatch = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(window);
  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]);
    return {
      year,
      startMonth: month,
      endMonth: month,
      startDay: `${monthMatch[1]}-${monthMatch[2]}-01`,
      endDay: isoDay(year, month - 1, lastDayOfMonth(year, month)),
    };
  }

  const quarterMatch = /^(\d{4})-Q([1-4])$/.exec(window);
  if (quarterMatch) {
    const year = Number(quarterMatch[1]);
    const quarter = quarterMatch[2] as '1' | '2' | '3' | '4';
    const startMonth = Number(QUARTER_START_MONTH[quarter]);
    const endMonth = Number(QUARTER_END_MONTH[quarter]);
    return {
      year,
      startMonth,
      endMonth,
      startDay: `${quarterMatch[1]}-${QUARTER_START_MONTH[quarter]}-01`,
      endDay: isoDay(year, endMonth - 1, lastDayOfMonth(year, endMonth)),
    };
  }

  throw new InvalidCalendarInputError(
    `calendar.expectedWindow ${JSON.stringify(window)} is not a valid expected window — ` +
      'valid shapes: YYYY-MM (e.g. 2026-09) or YYYY-Qn (e.g. 2026-Q4)',
  );
}

/**
 * The event's period start — the ordering key's first component:
 * `occurrenceDate` for CONFIRMED rows, the window's first day for
 * EXPECTED rows. Malformed dates or windows throw
 * {@link InvalidCalendarInputError}.
 */
export function resolvePeriodStart(event: CalendarEvent): string {
  if (event.status === 'CONFIRMED') {
    const { occurrenceDate } = event;
    if (typeof occurrenceDate !== 'string') {
      throw new InvalidCalendarInputError(
        `calendar.id ${event.id} occurrenceDate ${JSON.stringify(occurrenceDate)} is not an ISO YYYY-MM-DD date`,
      );
    }
    assertIsoDay(occurrenceDate, `calendar.id ${event.id} occurrenceDate`);
    return occurrenceDate;
  }
  return resolveExpectedWindow(event.expectedWindow as string).startDay;
}

/**
 * The event's window end — the last day of an EXPECTED row's window.
 * `null` for CONFIRMED rows (an exact date needs no window boundary).
 * Used by the next-event eligibility test: an in-progress window whose
 * start has passed stays upcoming until its window has ended.
 */
export function resolveWindowEnd(event: CalendarEvent): string | null {
  if (event.status !== 'EXPECTED') {
    return null;
  }
  return resolveExpectedWindow(event.expectedWindow as string).endDay;
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/**
 * Comparator for the calendar order: period start ascending, then
 * CONFIRMED before EXPECTED (same period), then event type ascending
 * (code-unit), then id ascending. Total order — no pair compares equal
 * unless every identity field matches, so the sort is invariant under
 * input permutation (the determinism the repeated-request scenario
 * pins).
 */
export function compareCalendarEvents(a: CalendarEvent, b: CalendarEvent): number {
  const periodA = resolvePeriodStart(a);
  const periodB = resolvePeriodStart(b);
  if (periodA !== periodB) {
    return periodA < periodB ? -1 : 1;
  }
  if (a.status !== b.status) {
    // CONFIRMED day precision beats an EXPECTED window in the same period.
    return a.status === 'CONFIRMED' ? -1 : 1;
  }
  if (a.eventType !== b.eventType) {
    return a.eventType < b.eventType ? -1 : 1;
  }
  return a.id - b.id;
}

/**
 * Sort calendar events into stated order, returning a new array — the
 * input (whatever order the repository read produced) is never mutated.
 * Two computations over equal inputs produce item-for-item identical
 * arrays regardless of input row order or runtime.
 */
export function sortCalendarEvents(events: readonly CalendarEvent[]): CalendarEvent[] {
  return [...events].sort(compareCalendarEvents);
}
