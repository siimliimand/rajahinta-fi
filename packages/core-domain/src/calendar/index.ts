/**
 * /calendar barrel — public exports for the tax-change calendar module.
 *
 * Consumers import from `@rajahinta/core-domain` (the barrel re-exports
 * this surface) — pure module, no persistence: the repository adapter
 * (task 3.1) implements the port declared here.
 *
 * @module CalendarIndex
 */

// Canonical vocabulary + read shape + contract error
export {
  CALENDAR_EVENT_TYPES,
  CALENDAR_EVENT_STATUSES,
  InvalidCalendarInputError,
} from './calendar.types';
export type {
  CalendarEventType,
  CalendarEventStatus,
  CalendarEvent,
  CalendarLanguage,
  NextCalendarEvent,
} from './calendar.types';

// Deterministic ordering — the one total order the listing and the
// next-event selection share
export {
  compareCalendarEvents,
  sortCalendarEvents,
  resolvePeriodStart,
  resolveWindowEnd,
  resolveExpectedWindow,
} from './ordering';
export type { ResolvedExpectedWindow } from './ordering';

// Next-event selection (pure, explicit fromDate — never the clock)
export { findNextCalendarEvent, assertValidCalendarEvent } from './calendar';

// Structural rhythm disclaimer — versioned FI/EN pair, selected by
// explicit language, never composed at request time
export {
  selectRhythmDisclaimer,
  CALENDAR_RHYTHM_DISCLAIMER_FI,
  CALENDAR_RHYTHM_DISCLAIMER_EN,
} from './calendar.disclaimer';

// Rhythm-skeleton generator — pure, repository-agnostic, never
// CONFIRMED (spec calendar-event-automation, task 2.1)
export {
  generateAlkoSkeleton,
  ALKO_RHYTHM_SOURCE_URL,
  CALENDAR_SKELETON_TEXT_FI,
  CALENDAR_SKELETON_TEXT_EN,
} from './calendar.skeleton';
export type {
  AlkoSkeletonEvent,
  CalendarSkeletonText,
  CalendarSkeletonCoverageEvent,
} from './calendar.skeleton';

// Candidate state machine — PENDING → ACCEPTED | REJECTED, URL dedup,
// accept→event mapping through the event validator (task 2.2)
export {
  CALENDAR_CANDIDATE_STATUSES,
  CANDIDATE_INSERT_DECISIONS,
  InvalidCandidateTransitionError,
  assertValidCalendarCandidate,
  decideCandidateInsert,
  acceptCandidate,
  rejectCandidate,
} from './calendar.candidate';
export type {
  CalendarCandidateStatus,
  CalendarEventCandidate,
  CalendarCandidateAcceptanceForm,
  CalendarEventReadyPayload,
  CandidateAcceptanceResult,
  CandidateInsertDecision,
} from './calendar.candidate';

// Repository port — the adapter lives in the composition root
export { CALENDAR_EVENT_REPOSITORY_PORT } from './ports/calendar-event-repository.port';
export type { ICalendarEventRepositoryPort } from './ports/calendar-event-repository.port';
