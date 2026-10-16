/**
 * Port interface for tax-change calendar event lookup.
 *
 * Core Domain owns this port so the calendar API depends on an
 * abstraction, not on a specific repository implementation.  The concrete
 * adapter lives in the composition root (DataPlatform or ApplicationApi)
 * and wires the Drizzle `calendar_events` repository into this contract
 * at bootstrap time (the {@link ITaxRuleRepositoryPort} precedent).
 *
 * All date inputs are explicit ISO `YYYY-MM-DD` strings — the house
 * TEXT date shape of the `calendar_events` columns — and nothing here
 * ever reads the system clock: the caller (the API route) passes its
 * current date, so repeated identical requests produce identical
 * responses.
 *
 * @module CalendarEventRepositoryPort
 */

import type { CalendarEvent } from '../calendar.types';

// ---------------------------------------------------------------------------
// Injection token
// ---------------------------------------------------------------------------

/** Injection token for the calendar event repository. */
export const CALENDAR_EVENT_REPOSITORY_PORT =
  'CALENDAR_EVENT_REPOSITORY_PORT';

// ---------------------------------------------------------------------------
// Repository contract
// ---------------------------------------------------------------------------

/**
 * Repository contract that the calendar API needs.
 *
 * Consumers inject this interface.  An adapter in the composition root
 * maps the concrete `calendar_events` persistence to this port and
 * orders / selects rows with the pure calendar module so the repository
 * and the domain can never disagree about "the next event".
 */
export interface ICalendarEventRepositoryPort {
  /**
   * Return every event of the requested calendar year in the
   * deterministic stated order: period start (occurrence date for
   * CONFIRMED rows, window start for EXPECTED rows), then CONFIRMED
   * before EXPECTED in the same period, then event type, then id.
   *
   * An empty result (a year with no sourced events yet) is a valid
   * response, not an error.
   */
  listByYear(year: number): Promise<CalendarEvent[]>;

  /**
   * Return the single next upcoming event as of the given date
   * (inclusive), or `null` when nothing is upcoming.
   *
   * Nearest period wins; within the same period start a CONFIRMED
   * day-precision event beats an EXPECTED window; remaining ties break
   * by event type then id (the listing order). An EXPECTED window
   * stays upcoming until its window has ended, so an in-progress
   * quarter/month window is returned even after its first day.
   */
  findNext(fromDate: string): Promise<CalendarEvent | null>;
}
