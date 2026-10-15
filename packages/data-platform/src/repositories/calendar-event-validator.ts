/**
 * Persistence-boundary validation for `calendar_events` (task 1.2,
 * change tax-change-calendar) — the one contract the seed (task 1.3),
 * the Drizzle repository (task 3.1), and the ops console (task 5.1)
 * all share.
 *
 * Lives in its own module (not inside a repository file) so seed →
 * validator, repository → validator, and ops console → validator never
 * form an import cycle (the effective-range-validator precedent). The
 * value sets live in d1/schema next to the CHECKs they back — one
 * definition, no drift (the PRODUCT_CATEGORIES precedent).
 *
 * Contract (spec: tax-change-calendar, "Calendar events as
 * closed-vocabulary sourced data"): every rejection is a contract-level
 * Error whose message names the valid values — never silent coercion
 * (the alert-kind and canonical-category validation style of the
 * price-alert repository). The schema CHECKs are the last-line
 * guarantee for raw SQL paths; this module is the boundary every
 * application-side write goes through.
 *
 * @module calendar-event-validator
 */
import {
  CALENDAR_EVENT_STATUSES,
  CALENDAR_EVENT_TYPES,
  type CalendarEventStatus,
  type CalendarEventType,
} from '../d1/schema';

/** Raw creation input — stringly typed where this contract narrows it. */
export interface CalendarEventInput {
  /** Calendar year the event belongs to. */
  readonly year: number;
  /** Expected to be one of {@link CALENDAR_EVENT_TYPES}; unknown values reject. */
  readonly eventType: string;
  /** Expected to be one of {@link CALENDAR_EVENT_STATUSES}; unknown values reject. */
  readonly status: string;
  /** CONFIRMED only: ISO YYYY-MM-DD. EXPECTED rows must carry null. */
  readonly occurrenceDate: string | null;
  /** EXPECTED only: 'YYYY-MM' or 'YYYY-Qn'. CONFIRMED rows must carry null. */
  readonly expectedWindow: string | null;
  readonly titleFi: string;
  readonly titleEn: string;
  readonly summaryFi: string;
  readonly summaryEn: string;
  readonly sourceUrl: string;
}

/** Fields shared by both validated shapes. */
interface ValidatedCalendarEventBase {
  readonly year: number;
  readonly eventType: CalendarEventType;
  readonly titleFi: string;
  readonly titleEn: string;
  readonly summaryFi: string;
  readonly summaryEn: string;
  readonly sourceUrl: string;
}

/**
 * CONFIRMED — an exact dated fact: occurrence_date set, expected_window
 * forbidden. A confirmed row must never carry rhythm-window wording.
 */
export interface ConfirmedCalendarEvent extends ValidatedCalendarEventBase {
  readonly status: 'CONFIRMED';
  readonly occurrenceDate: string;
  readonly expectedWindow: null;
}

/**
 * EXPECTED — the annual rhythm: expected_window at month-or-quarter
 * precision, occurrence_date forbidden. A rhythm row must never claim
 * day precision.
 */
export interface ExpectedCalendarEvent extends ValidatedCalendarEventBase {
  readonly status: 'EXPECTED';
  readonly occurrenceDate: null;
  readonly expectedWindow: string;
}

/** The status-narrowed insert shapes a validated input is guaranteed to satisfy. */
export type ValidatedCalendarEvent = ConfirmedCalendarEvent | ExpectedCalendarEvent;

const ISO_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const EXPECTED_WINDOW_SHAPE = /^\d{4}-(?:Q[1-4]|0[1-9]|1[0-2])$/;

/** Narrow the free string onto the event-type union, naming the valid values on miss. */
function requireKnownEventType(value: string): CalendarEventType {
  if (typeof value !== 'string' || !(CALENDAR_EVENT_TYPES as readonly string[]).includes(value)) {
    throw new Error(
      `calendar_events.event_type ${JSON.stringify(value ?? null)} is not a known calendar event type — valid types: ${CALENDAR_EVENT_TYPES.join(', ')}`,
    );
  }
  return value as CalendarEventType;
}

/** Narrow the free string onto the status union, naming the valid values on miss. */
function requireKnownStatus(value: string): CalendarEventStatus {
  if (typeof value !== 'string' || !(CALENDAR_EVENT_STATUSES as readonly string[]).includes(value)) {
    throw new Error(
      `calendar_events.status ${JSON.stringify(value ?? null)} is not a known calendar event status — valid statuses: ${CALENDAR_EVENT_STATUSES.join(', ')}`,
    );
  }
  return value as CalendarEventStatus;
}

/** Locale texts are mandatory in BOTH languages — a missing locale would render a hole mid-timeline. */
function requireNonEmptyText(column: string, value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `calendar_events.${column} is required — every calendar event carries FI and EN title and summary text`,
    );
  }
  return value;
}

/** Sourced rows only: no unsourced event can exist (the tax_rules.official_source discipline). */
function requireSourceUrl(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      'calendar_events.source_url is required — every calendar event cites its official source',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `calendar_events.source_url ${JSON.stringify(value)} is not an absolute URL — official sources are cited as http(s) URLs`,
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `calendar_events.source_url ${JSON.stringify(value)} must be an http(s) URL — protocol "${parsed.protocol}" is not a citable official source`,
    );
  }
  return value;
}

/** YYYY-MM-DD shape AND a real calendar date — '2026-13-45' sorts correctly but lies. */
function requireIsoDate(column: string, value: string): string {
  const real =
    typeof value === 'string' &&
    ISO_DATE_SHAPE.test(value) &&
    isRealCalendarDate(value);
  if (!real) {
    throw new Error(
      `calendar_events.${column} ${JSON.stringify(value ?? null)} must be a real calendar date in YYYY-MM-DD shape`,
    );
  }
  return value;
}

function isRealCalendarDate(value: string): boolean {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  return (
    asUtc.getUTCFullYear() === year &&
    asUtc.getUTCMonth() === month - 1 &&
    asUtc.getUTCDate() === day
  );
}

/**
 * Validate a calendar-event creation input against the
 * `calendar_events` persistence contract, returning the status-narrowed
 * insert shape. Throws a contract-level Error on the first violation;
 * the message names the valid values (never silently coerces).
 */
export function validateCalendarEvent(
  input: CalendarEventInput,
): ValidatedCalendarEvent {
  const eventType = requireKnownEventType(input.eventType);
  const status = requireKnownStatus(input.status);

  if (!Number.isInteger(input.year)) {
    throw new Error(
      `calendar_events.year ${JSON.stringify(input.year ?? null)} is not an integer calendar year (e.g. 2026)`,
    );
  }

  const base = {
    year: input.year,
    eventType,
    titleFi: requireNonEmptyText('title_fi', input.titleFi),
    titleEn: requireNonEmptyText('title_en', input.titleEn),
    summaryFi: requireNonEmptyText('summary_fi', input.summaryFi),
    summaryEn: requireNonEmptyText('summary_en', input.summaryEn),
    sourceUrl: requireSourceUrl(input.sourceUrl),
  };

  if (status === 'CONFIRMED') {
    if (input.occurrenceDate == null) {
      throw new Error(
        'calendar_events.status CONFIRMED requires occurrence_date — a confirmed event is an exact dated fact (YYYY-MM-DD); window-shaped rows are EXPECTED',
      );
    }
    if (input.expectedWindow != null) {
      throw new Error(
        'calendar_events.status CONFIRMED forbids expected_window — only EXPECTED rows carry a rhythm window (the confirmed precision is occurrence_date)',
      );
    }
    return {
      ...base,
      status,
      occurrenceDate: requireIsoDate('occurrence_date', input.occurrenceDate),
      expectedWindow: null,
    };
  }

  // status === 'EXPECTED'
  if (input.occurrenceDate != null) {
    throw new Error(
      'calendar_events.status EXPECTED forbids occurrence_date — an expected window event must not claim day precision; dated facts are CONFIRMED',
    );
  }
  if (
    typeof input.expectedWindow !== 'string' ||
    !EXPECTED_WINDOW_SHAPE.test(input.expectedWindow)
  ) {
    throw new Error(
      'calendar_events.status EXPECTED requires expected_window with month or quarter precision — valid shapes: YYYY-MM (e.g. 2026-09) or YYYY-Qn (e.g. 2027-Q4)',
    );
  }
  return {
    ...base,
    status,
    occurrenceDate: null,
    expectedWindow: input.expectedWindow,
  };
}
