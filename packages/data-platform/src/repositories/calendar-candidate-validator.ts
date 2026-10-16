/**
 * Persistence-boundary validation for `calendar_event_candidates`
 * (task 1.2, change calendar-event-automation) — the one contract the
 * watcher cron (task 3.3) and the ops review queue (task 4.1) share
 * when they write candidate rows.
 *
 * Lives in its own module (not inside a repository file) so watcher →
 * validator and ops console → validator never form an import cycle
 * (the calendar-event-validator precedent). The status vocabulary
 * lives in d1/schema next to the CHECK it backs — one definition, no
 * drift (the CALENDAR_EVENT_STATUSES precedent).
 *
 * Contract (spec: calendar-event-automation, "Candidate collection
 * from source feeds"): every rejection is a contract-level Error whose
 * message names the valid values — never silent coercion. The rules
 * mirror the pure state machine's row contract
 * (core-domain's assertValidCalendarCandidate) at the data boundary:
 * the closed status vocabulary, non-empty identity fields (source, url,
 * title), a real-calendar publishedAt day, and drafts that are null or
 * real text — a blank draft would read as present to the accept form
 * and fail later, mid-event-mapping. The schema CHECK is the last-line
 * guarantee for raw SQL paths; this module is the boundary every
 * application-side write goes through.
 *
 * URL dedup itself is NOT re-decided here — it is structural (`url`
 * UNIQUE) and decided insert-or-skip by the pure layer
 * (decideCandidateInsert) before this validator runs; a duplicate
 * reaching this boundary fails at the storage constraint, not by
 * validator policy.
 *
 * @module calendar-candidate-validator
 */
import {
  CALENDAR_CANDIDATE_STATUSES,
  type CalendarCandidateStatus,
} from '../d1/schema';

/** Raw creation input — stringly typed where this contract narrows it. */
export interface CalendarEventCandidateInput {
  /** Watcher feed identifier (e.g. 'vero-fi-news'). Required — an unsourced proposal cannot exist. */
  readonly source: string;
  /** The announcement's URL — the dedup key (exact-string rule at the storage constraint). */
  readonly url: string;
  /** The announcement's headline as observed. */
  readonly title: string;
  /** Publication date of the source item, ISO YYYY-MM-DD. */
  readonly publishedAt: string;
  /** Expected to be one of {@link CALENDAR_CANDIDATE_STATUSES}; unknown values reject. */
  readonly status: string;
  /** Watcher's draft Finnish text, or null when none was extracted. */
  readonly draftFi: string | null;
  /** Watcher's draft English text, or null when none was extracted. */
  readonly draftEn: string | null;
}

/**
 * The validated insert shape — status narrowed onto the closed review
 * vocabulary, every identity field proven present.
 */
export interface ValidatedCalendarEventCandidate {
  readonly source: string;
  readonly url: string;
  readonly title: string;
  readonly publishedAt: string;
  readonly status: CalendarCandidateStatus;
  readonly draftFi: string | null;
  readonly draftEn: string | null;
}

const ISO_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** Narrow the free string onto the status union, naming the valid values on miss. */
function requireKnownStatus(value: string): CalendarCandidateStatus {
  if (
    typeof value !== 'string' ||
    !(CALENDAR_CANDIDATE_STATUSES as readonly string[]).includes(value)
  ) {
    throw new Error(
      `calendar_event_candidates.status ${JSON.stringify(value ?? null)} is not a known ` +
        `candidate status — valid statuses: ${CALENDAR_CANDIDATE_STATUSES.join(', ')}`,
    );
  }
  return value as CalendarCandidateStatus;
}

/** Identity fields are mandatory — a blank source/url/title would poison dedup and the audit trail. */
function requireNonEmptyText(column: string, value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `calendar_event_candidates.${column} is required — every candidate carries its source, url, and observed title`,
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
      `calendar_event_candidates.${column} ${JSON.stringify(value ?? null)} must be a real calendar date in YYYY-MM-DD shape`,
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
 * Drafts are null or real text — a whitespace-only draft would look
 * present to the accept form and fail later, mid-event-mapping (the
 * pure row contract's own rule).
 */
function requireNullOrText(column: string, value: string | null): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `calendar_event_candidates.${column} must be null or a non-empty string — ` +
        'a blank draft would read as present and fail mid-acceptance',
    );
  }
  return value;
}

/**
 * Validate a candidate creation input against the
 * `calendar_event_candidates` persistence contract, returning the
 * validated insert shape with the status narrowed onto the closed
 * vocabulary. Throws a contract-level Error on the first violation;
 * the message names the valid values (never silently coerces).
 */
export function validateCalendarEventCandidate(
  input: CalendarEventCandidateInput,
): ValidatedCalendarEventCandidate {
  return {
    source: requireNonEmptyText('source', input.source),
    url: requireNonEmptyText('url', input.url),
    title: requireNonEmptyText('title', input.title),
    publishedAt: requireIsoDate('published_at', input.publishedAt),
    status: requireKnownStatus(input.status),
    draftFi: requireNullOrText('draft_fi', input.draftFi),
    draftEn: requireNullOrText('draft_en', input.draftEn),
  };
}
