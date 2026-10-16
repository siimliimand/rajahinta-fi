/**
 * Tax-change calendar types — the sourced read shape of the annual
 * price-change rhythm (spec: tax-change-calendar, task 2.1).
 *
 * The module is pure: these contracts are its OWN vocabulary, shaped to
 * map 1:1 from the `calendar_events` D1 table (the persistence boundary
 * in data-platform validates writes; this module only rejects values
 * outside the set as caller contract violations, the digest precedent).
 * The value sets are declared here, not imported: purity forbids a
 * data-platform import, and the two declarations mirror the same schema
 * value set (one definition lives next to the table CHECKs — no drift
 * is possible because the persistence boundary rejects anything else
 * before a row can exist).
 *
 * Precision split (design): a CONFIRMED row carries an exact
 * `occurrenceDate` and no window; an EXPECTED row carries an
 * `expectedWindow` at month-or-quarter precision and no exact date.
 * Rendering cannot invent precision the row does not carry.
 *
 * @module CalendarTypes
 */

// ---------------------------------------------------------------------------
// Canonical vocabulary — mirrors the calendar_events CHECK value sets.
// Declared here, not imported: purity forbids a data-platform import.
// ---------------------------------------------------------------------------

/**
 * Event types — the closed rhythm vocabulary. An unknown type is a
 * caller contract violation, never silently coerced (the alert-kind and
 * canonical-category validation style).
 */
export const CALENDAR_EVENT_TYPES = [
  'FI_EXCISE_CHANGE',
  'EE_EXCISE_CHANGE',
  'ALKO_PRICE_LIST',
  'TAX_TABLE_PUBLICATION',
  'RATE_DECISION',
] as const;

export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

/**
 * Event statuses — the closed precision vocabulary. CONFIRMED rows are
 * dated facts; EXPECTED rows are the annual rhythm and must never claim
 * day precision.
 */
export const CALENDAR_EVENT_STATUSES = ['CONFIRMED', 'EXPECTED'] as const;

export type CalendarEventStatus = (typeof CALENDAR_EVENT_STATUSES)[number];

// ---------------------------------------------------------------------------
// Read shape — mirrors a calendar_events row without ORM types
// ---------------------------------------------------------------------------

/**
 * One sourced calendar event as the pure module consumes it. Dates are
 * ISO `YYYY-MM-DD` TEXT and windows are `YYYY-MM` / `YYYY-Qn` TEXT —
 * the house date shape of the `calendar_events` columns, so the
 * repository adapter maps rows straight in with no coercion.
 *
 * Locale texts and the source URL are mandatory in both languages
 * (spec: source and locales mandatory) — the pure module re-checks them
 * as caller contract violations because a hole mid-timeline would break
 * every rendering downstream of a silently malformed row.
 */
export interface CalendarEvent {
  readonly id: number;
  /** Calendar year the event belongs to — the year-range read key. */
  readonly year: number;
  readonly eventType: CalendarEventType;
  readonly status: CalendarEventStatus;
  /**
   * CONFIRMED only: the exact occurrence date, ISO `YYYY-MM-DD`.
   * `null` for EXPECTED rows — a rhythm window must not claim day
   * precision.
   */
  readonly occurrenceDate: string | null;
  /**
   * EXPECTED only: the expected window at month-or-quarter precision,
   * `YYYY-MM` (e.g. `2026-09`) or `YYYY-Qn` (e.g. `2026-Q4`). `null`
   * for CONFIRMED rows.
   */
  readonly expectedWindow: string | null;
  readonly titleFi: string;
  readonly titleEn: string;
  readonly summaryFi: string;
  readonly summaryEn: string;
  /** Authoritative publication URL — no unsourced rows. */
  readonly sourceUrl: string;
}

/** Site language — selects from the versioned FI/EN constant pair. */
export type CalendarLanguage = 'fi' | 'en';

// ---------------------------------------------------------------------------
// Next-event result
// ---------------------------------------------------------------------------

/**
 * The nearest upcoming event plus its countdown figure.
 *
 * `daysUntil` is the whole-day difference from the requested date to the
 * event's occurrence date — CONFIRMED rows only. EXPECTED rows carry
 * `null`: a window must never render a countdown (spec: the widget
 * SHALL NOT invent a countdown for a window event), the caller renders
 * the window label instead.
 */
export interface NextCalendarEvent {
  readonly event: CalendarEvent;
  /** Whole days from the requested date to `occurrenceDate`; `null` for EXPECTED rows. */
  readonly daysUntil: number | null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Thrown when an input violates the module's contract — a value outside
 * the closed vocabularies, a status/precision mismatch (a CONFIRMED row
 * without an exact date or with a window; an EXPECTED row with an exact
 * date or without a window), a malformed date or window shape, or a
 * missing source URL / locale text. Mirrors
 * `InvalidDigestInputError`: a malformed row is a caller bug, so it
 * fails loudly instead of silently corrupting the deterministic
 * comparator or inventing precision the row does not carry.
 */
export class InvalidCalendarInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCalendarInputError';
  }
}
