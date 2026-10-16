/**
 * Pure calendar-event candidate state machine — the source-watcher's
 * review pipeline, up to (but never across) the persistence boundary
 * (spec: calendar-event-automation, "Candidate collection from source
 * feeds" + "Operator review queue", task 2.2).
 *
 * A candidate is a watcher-observed announcement (source feed item):
 * an ops-review row that is NEVER public. The machine owns three
 * concerns, all pure — no clock, no persistence, no fetch:
 *
 * 1. STATUS MACHINE — PENDING → ACCEPTED | REJECTED, and nothing else.
 *    ACCEPTED and REJECTED are terminal: a decided candidate can never
 *    be re-decided, so a review action can never silently overwrite a
 *    previous decision (the audit trail stays truthful). Illegal
 *    transitions throw {@link InvalidCandidateTransitionError}.
 *
 * 2. URL DEDUP — the watcher's insert decision: an announcement whose
 *    URL is already known must never become a candidate again (spec:
 *    "an already-known URL SHALL never become a candidate again"). The
 *    pure layer exposes {@link decideCandidateInsert}: given the known
 *    URLs and a new item, it returns insert-or-skip. The comparison is
 *    the exact string — the same rule the `url UNIQUE` column enforces
 *    structurally, so the pure layer and the storage boundary can never
 *    disagree about what counts as a duplicate.
 *
 * 3. ACCEPT→EVENT MAPPING — an ACCEPTED candidate does NOT become an
 *    event by itself: the operator supplies the calendar framing (type,
 *    status, date-or-window) in the console form. The mapping fills the
 *    event's identity from the candidate (url as sourceUrl, draft text
 *    unless overridden), derives the year from the chosen period, and
 *    validates the whole combination through the committed
 *    {@link assertValidCalendarEvent} — an illegal combination fails
 *    the contract exactly the way a calendar event does, in the same
 *    words. The returned payload is event-ready and id-less: ids are
 *    assigned by the repository (the skeleton-generator precedent).
 *
 * Candidate types are declared here, not imported from data-platform:
 * purity forbids the import (the calendar.types vocabulary precedent),
 * and the declarations mirror the `calendarEventCandidates` columns the
 * schema task (1.2) owns — one definition lives next to the table CHECKs.
 *
 * @module CalendarCandidate
 */

import {
  InvalidCalendarInputError,
  type CalendarEvent,
  type CalendarEventStatus,
  type CalendarEventType,
} from './calendar.types';
import { assertIsoDay } from './ordering';
import { assertValidCalendarEvent } from './calendar';

// ---------------------------------------------------------------------------
// Canonical vocabulary — mirrors the calendarEventCandidates CHECK set.
// ---------------------------------------------------------------------------

/** Candidate statuses — the closed review vocabulary. */
export const CALENDAR_CANDIDATE_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
] as const;

export type CalendarCandidateStatus = (typeof CALENDAR_CANDIDATE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Read shape — mirrors a calendarEventCandidates row without ORM types
// ---------------------------------------------------------------------------

/**
 * One watcher-detected announcement awaiting (or past) operator review.
 * `url` is the unique key dedup is keyed on; `draftFi`/`draftEn` are
 * the watcher's optional draft texts — pre-fill for the accept form,
 * never an event text on their own. `publishedAt` is the item's
 * publication date, ISO `YYYY-MM-DD` — the house TEXT date shape.
 */
export interface CalendarEventCandidate {
  readonly source: string;
  readonly url: string;
  readonly title: string;
  readonly publishedAt: string;
  readonly status: CalendarCandidateStatus;
  /** Watcher's draft Finnish text, or `null` when none was extracted. */
  readonly draftFi: string | null;
  /** Watcher's draft English text, or `null` when none was extracted. */
  readonly draftEn: string | null;
}

// ---------------------------------------------------------------------------
// Validation — caller-contract violations, first violation wins
// ---------------------------------------------------------------------------

/** Non-empty string or contract violation — a blank identity field would poison dedup and the audit trail. */
function assertNonEmpty(field: string, value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidCalendarInputError(
      `calendar.candidate.${field} must be a non-empty string`,
    );
  }
}

/**
 * Validate one candidate against the module's contract: closed status
 * vocabulary, non-empty identity fields (source, url, title), a real-
 * calendar `publishedAt` day, and drafts that are `null` or real text —
 * a whitespace-only draft would look present to the accept form and
 * fail later, mid-event-mapping.
 */
export function assertValidCalendarCandidate(candidate: CalendarEventCandidate): void {
  if (!(CALENDAR_CANDIDATE_STATUSES as readonly string[]).includes(candidate.status)) {
    throw new InvalidCalendarInputError(
      `calendar.candidate.status ${JSON.stringify(String(candidate.status))} is not a known ` +
        `candidate status — valid statuses: ${CALENDAR_CANDIDATE_STATUSES.join(', ')}`,
    );
  }
  assertNonEmpty('source', candidate.source);
  assertNonEmpty('url', candidate.url);
  assertNonEmpty('title', candidate.title);
  assertIsoDay(candidate.publishedAt, 'calendar.candidate.publishedAt');
  for (const field of ['draftFi', 'draftEn'] as const) {
    const draft = candidate[field];
    if (draft !== null && (typeof draft !== 'string' || draft.trim().length === 0)) {
      throw new InvalidCalendarInputError(
        `calendar.candidate.${field} must be null or a non-empty string — ` +
          'a blank draft would read as present and fail mid-acceptance',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Transition error
// ---------------------------------------------------------------------------

/**
 * Thrown when a review action violates the status machine — deciding an
 * already-decided candidate above all. Distinct from
 * {@link InvalidCalendarInputError} (a malformed row) so the ops route
 * can tell "bad payload" from "stale queue view, someone decided this
 * already" without string matching.
 */
export class InvalidCandidateTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCandidateTransitionError';
  }
}

/** The only legal decision an operator can make on a PENDING candidate. */
function assertPending(candidate: CalendarEventCandidate, action: 'accepted' | 'rejected'): void {
  if (candidate.status !== 'PENDING') {
    throw new InvalidCandidateTransitionError(
      `candidate ${candidate.url} is ${candidate.status}, not PENDING — a candidate can only be ` +
        `${action} while PENDING; ACCEPTED and REJECTED are terminal`,
    );
  }
}

// ---------------------------------------------------------------------------
// URL dedup — the watcher's insert decision
// ---------------------------------------------------------------------------

/** The watcher's per-item decision: become a PENDING candidate, or skip. */
export const CANDIDATE_INSERT_DECISIONS = ['INSERT', 'SKIP_KNOWN_URL'] as const;

export type CandidateInsertDecision = (typeof CANDIDATE_INSERT_DECISIONS)[number];

/**
 * Decide whether a new announcement may become a candidate: `INSERT`
 * when its URL is unknown, `SKIP_KNOWN_URL` when it is already known —
 * a re-seen announcement never re-enters the queue (spec: known URL
 * never re-suggested).
 *
 * The comparison is the exact string, the same rule the `url UNIQUE`
 * column enforces — no normalization, no case folding, no trailing-
 * slash tolerance. Anything softer here and the pure layer would admit
 * a row the storage boundary then rejects, or silently merge two
 * distinct announcements.
 *
 * Pure — the known set is never mutated; an array is copied into a
 * `Set` internally so repeated calls over large queues stay linear.
 * Throws {@link InvalidCalendarInputError} for a blank URL (a malformed
 * item is a caller bug, not a skip — the watcher counts those as
 * normalization failures).
 *
 * @param item — the announcement; only its `url` is read.
 * @param knownUrls — every URL already stored as a candidate (any status —
 *   REJECTED rows keep deduplicating; that is why rejection retains them).
 */
export function decideCandidateInsert(
  item: Pick<CalendarEventCandidate, 'url'>,
  knownUrls: readonly string[] | ReadonlySet<string>,
): CandidateInsertDecision {
  assertNonEmpty('url', item.url);
  const known = knownUrls instanceof Set ? knownUrls : new Set(knownUrls);
  return known.has(item.url) ? 'SKIP_KNOWN_URL' : 'INSERT';
}

// ---------------------------------------------------------------------------
// Accept → event mapping
// ---------------------------------------------------------------------------

/**
 * The operator's console form: the calendar framing the candidate can
 * never supply itself. Exactly one of `occurrenceDate` (CONFIRMED) or
 * `expectedWindow` (EXPECTED) — the same precision split the event
 * contract enforces, failing in the same words. The optional texts
 * override the candidate's drafts field-by-field; a field with neither
 * override nor draft is a contract violation, never fabricated.
 */
export interface CalendarCandidateAcceptanceForm {
  readonly eventType: CalendarEventType;
  readonly status: CalendarEventStatus;
  /** CONFIRMED only: the exact date, ISO `YYYY-MM-DD`; `null` otherwise. */
  readonly occurrenceDate: string | null;
  /** EXPECTED only: the window `YYYY-MM` / `YYYY-Qn`; `null` otherwise. */
  readonly expectedWindow: string | null;
  readonly titleFi?: string;
  readonly titleEn?: string;
  readonly summaryFi?: string;
  readonly summaryEn?: string;
}

/** An event-ready payload — everything but the repository-assigned id. */
export type CalendarEventReadyPayload = Omit<CalendarEvent, 'id'>;

/** The result of accepting: the decided candidate AND its event-ready payload. */
export interface CandidateAcceptanceResult {
  /** The candidate as stored after acceptance — status ACCEPTED, fields unchanged. */
  readonly candidate: CalendarEventCandidate;
  /** Contract-validated event payload; the repository assigns the id. */
  readonly event: CalendarEventReadyPayload;
}

/**
 * Resolve one locale text: the operator override when given, else the
 * watcher draft, else a contract violation naming the field — a missing
 * locale would render a hole mid-timeline (the event contract's own
 * rule), so the mapping surfaces it before any write.
 */
function resolveText(
  field: 'titleFi' | 'titleEn' | 'summaryFi' | 'summaryEn',
  draftField: 'draftFi' | 'draftEn',
  candidate: CalendarEventCandidate,
  override: string | undefined,
): string {
  const resolved = override ?? candidate[draftField];
  if (resolved === undefined || resolved === null || typeof resolved !== 'string') {
    throw new InvalidCalendarInputError(
      `candidate ${candidate.url} cannot be accepted: ${field} has no operator override ` +
        `and no ${draftField} on the candidate — one of the two is required`,
    );
  }
  return resolved;
}

/**
 * Accept a PENDING candidate: flip it to ACCEPTED and produce the
 * event-ready payload the persistence boundary will insert.
 *
 * The event's identity comes from the candidate — `url` becomes
 * `sourceUrl` (no unsourced rows), drafts fill the locale texts unless
 * the operator overrode them — and the calendar framing comes wholly
 * from the form. The `year` is derived from the chosen period (the
 * seed's year-matches-period self-check discipline), never supplied
 * separately, so a year/period mismatch cannot be expressed.
 *
 * The whole combination is then validated through
 * {@link assertValidCalendarEvent} — the exact contract every calendar
 * event satisfies — so an illegal combination (CONFIRMED with a window,
 * an EXPECTED row with an exact date, an unknown type, a malformed
 * window, missing text) fails here, in the contract's own words, with
 * nothing written. The contract check runs against a full event shape
 * with a sentinel id (0): the only field the payload does not carry,
 * because ids are assigned by the repository.
 *
 * Pure — the input candidate is never mutated; the decided row is a new
 * object. Throws {@link InvalidCandidateTransitionError} unless the
 * candidate is PENDING (terminal states), and
 * {@link InvalidCalendarInputError} for a malformed candidate or an
 * event combination the contract rejects.
 */
export function acceptCandidate(
  candidate: CalendarEventCandidate,
  form: CalendarCandidateAcceptanceForm,
): CandidateAcceptanceResult {
  assertValidCalendarCandidate(candidate);
  assertPending(candidate, 'accepted');

  // Derive the year from the chosen period — one source of truth.
  const hasDate = form.occurrenceDate !== null && form.occurrenceDate !== undefined;
  const hasWindow = form.expectedWindow !== null && form.expectedWindow !== undefined;
  if (hasDate === hasWindow) {
    throw new InvalidCalendarInputError(
      `candidate ${candidate.url} acceptance must carry exactly one of occurrenceDate ` +
        '(CONFIRMED) or expectedWindow (EXPECTED), got ' +
        `${JSON.stringify(form.occurrenceDate)} and ${JSON.stringify(form.expectedWindow)}`,
    );
  }
  const periodValue = form.occurrenceDate ?? form.expectedWindow;
  const year = Number(String(periodValue).slice(0, 4));
  if (!Number.isInteger(year) || String(year).length !== 4) {
    throw new InvalidCalendarInputError(
      `candidate ${candidate.url} acceptance period value ${JSON.stringify(periodValue)} ` +
        'must start with a four-digit year',
    );
  }

  const event: CalendarEventReadyPayload = {
    year,
    eventType: form.eventType,
    status: form.status,
    occurrenceDate: form.occurrenceDate ?? null,
    expectedWindow: form.expectedWindow ?? null,
    titleFi: resolveText('titleFi', 'draftFi', candidate, form.titleFi),
    titleEn: resolveText('titleEn', 'draftEn', candidate, form.titleEn),
    summaryFi: resolveText('summaryFi', 'draftFi', candidate, form.summaryFi),
    summaryEn: resolveText('summaryEn', 'draftEn', candidate, form.summaryEn),
    sourceUrl: candidate.url,
  };

  // The full contract, in the event validator's own words. The sentinel
  // id (0) satisfies the id-integer check only; it is not part of the
  // returned payload — the repository assigns the real one.
  assertValidCalendarEvent({ id: 0, ...event });

  return {
    candidate: { ...candidate, status: 'ACCEPTED' },
    event,
  };
}

/**
 * Reject a PENDING candidate: flip it to REJECTED, unchanged otherwise.
 * The row is retained — rejection is what keeps the URL known, so the
 * same announcement never re-enters the queue ({@link decideCandidateInsert}
 * reads REJECTED rows' URLs exactly like the others).
 *
 * Pure — the input is never mutated. Throws
 * {@link InvalidCandidateTransitionError} unless the candidate is
 * PENDING (terminal states).
 */
export function rejectCandidate(candidate: CalendarEventCandidate): CalendarEventCandidate {
  assertValidCalendarCandidate(candidate);
  assertPending(candidate, 'rejected');
  return { ...candidate, status: 'REJECTED' };
}
