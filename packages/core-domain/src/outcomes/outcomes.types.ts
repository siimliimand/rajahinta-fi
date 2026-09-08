/**
 * Calculation-outcome types — user-reported actual totals compared
 * against the stored estimate.
 *
 * An outcome is a user's report of what a landed-cost calculation
 * actually cost them. Everything downstream of it is labeled
 * user-reported: the module exports the exact label constants the API
 * and UI must render, so no consumer invents its own wording.
 *
 * @module OutcomeTypes
 */

import type { Duration } from '../reliability/reliability.types';
import { DAY } from '../reliability/reliability.types';

// ---------------------------------------------------------------------------
// User-reported labeling
// ---------------------------------------------------------------------------

/**
 * Finnish label that must accompany every user-facing rendering of the
 * accuracy statistic (spec calculation-outcomes: the response and every
 * UI rendering SHALL label the statistic as based on user-reported
 * outcomes). Exported so the wording has exactly one source of truth.
 */
export const USER_REPORTED_OUTCOMES_LABEL_FI =
  'Perustuu käyttäjien ilmoittamiin lopputuloksiin';

/** English counterpart of {@link USER_REPORTED_OUTCOMES_LABEL_FI}. */
export const USER_REPORTED_OUTCOMES_LABEL_EN = 'Based on user-reported outcomes';

// ---------------------------------------------------------------------------
// Submission window
// ---------------------------------------------------------------------------

/**
 * How long after a record's calculation timestamp an outcome may still
 * be reported for it (spec: 60 days). Injected-time boundary: an
 * outcome is submittable while `now − recordCalculationTimestamp ≤
 * OUTCOME_SUBMISSION_WINDOW` — the 60th day inclusive, rejection from
 * the first millisecond after it.
 */
export const OUTCOME_SUBMISSION_WINDOW: Duration = {
  milliseconds: 60 * DAY.milliseconds,
};

// ---------------------------------------------------------------------------
// Owns-record / duplicate contract — port, implemented by the adapter layer
// ---------------------------------------------------------------------------

/**
 * Di token for the read-side contract the pure submission validator
 * consumes. Implementations live in the persistence layer; this module
 * deliberately contains no I/O.
 *
 * Before calling {@link validateOutcomeSubmission} the adapter resolves
 * two facts through this port:
 *
 * - `getRecordOwnerAccountId` — who owns the calculation record (or
 *   `null` when no such record exists);
 * - `findOutcomeId` — the id of an already-stored outcome for the
 *   (record, account) pair, or `null` when none exists.
 */
export const OUTCOME_RECORD_QUERY_PORT = 'OUTCOME_RECORD_QUERY_PORT';

export interface IOutcomeRecordQueryPort {
  /** Owning account of a calculation record, or null when unknown. */
  getRecordOwnerAccountId(calculationRecordId: string): Promise<string | null>;
  /** Existing outcome for the (record, account) pair, or null. */
  findOutcomeId(
    calculationRecordId: string,
    accountId: string,
  ): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Submission validation
// ---------------------------------------------------------------------------

/** Raw outcome submission, enriched with the port-resolved facts. */
export interface OutcomeSubmissionInput {
  /** Calculation record the outcome is reported against. */
  readonly calculationRecordId: unknown;
  /** Reporting account. */
  readonly accountId: unknown;
  /** Reported actual total, in euro cents (positive whole cents). */
  readonly reportedTotalCents: unknown;
  /** The record's calculation timestamp (window is measured from it). */
  readonly recordCalculationTimestamp: Date;
  /** Injected clock — when the submission is attempted. */
  readonly now: Date;
  /** `getRecordOwnerAccountId` result: record owner, or null if absent. */
  readonly recordOwnerAccountId: string | null;
  /** `findOutcomeId` result: existing outcome for (record, account), or null. */
  readonly existingOutcomeId: string | null;
}

/** Canonical, validated form to persist. */
export interface ValidatedOutcomeSubmission {
  readonly calculationRecordId: string;
  readonly accountId: string;
  readonly reportedTotalCents: number;
  readonly recordCalculationTimestamp: Date;
}

/** Why a submission was rejected. Checks run in this documented order. */
export type OutcomeInputErrorReason =
  | 'MISSING_RECORD_ID'
  | 'MISSING_ACCOUNT_ID'
  | 'RECORD_NOT_FOUND'
  | 'NOT_RECORD_OWNER'
  | 'OUTCOME_ALREADY_EXISTS'
  | 'REPORTED_TOTAL_NOT_POSITIVE'
  | 'WINDOW_EXPIRED'
  | 'INVALID_MARGIN_INPUT';

/**
 * Rejected outcome-domain input. A duplicate rejection
 * (`OUTCOME_ALREADY_EXISTS`) maps to HTTP 409 in the API layer and must
 * leave the stored outcome untouched; a window or ownership rejection
 * stores nothing. Values are never clamped or silently corrected.
 */
export class InvalidOutcomeInputError extends Error {
  readonly reason: OutcomeInputErrorReason;

  constructor(reason: OutcomeInputErrorReason, detail: string) {
    super(`invalid outcome input (${reason}): ${detail}`);
    this.name = 'InvalidOutcomeInputError';
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Margin comparison
// ---------------------------------------------------------------------------

/**
 * Reported totals within this fraction of the estimate count as
 * "within margin" — spec-fixed at 5%. The comparison is inclusive:
 * a deviation of exactly 5% of the estimate is within margin. Pinned
 * by test.
 */
export const WITHIN_MARGIN_FRACTION = 0.05;

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** Stored outcome facts the aggregation reads (estimate snapshot included). */
export interface StoredOutcomeTotals {
  /** The user-reported actual total, euro cents. */
  readonly reportedTotalCents: number;
  /** Estimate digest stored alongside the outcome, euro cents. */
  readonly estimatedTotalCents: number;
}

/**
 * Public accuracy statistic computed read-time from stored outcomes.
 *
 * `withinMarginShare` is `null` **exactly when `count` is 0**: with no
 * user-reported outcomes there is no honest percentage, and fabricating
 * one (0% or 100%) would misrepresent trust in the estimates. The UI
 * must render the null state as "no user-reported outcomes exist yet"
 * — never as a number — alongside the {@link USER_REPORTED_OUTCOMES_LABEL_FI}
 * / `_EN` label and the sample size.
 */
export interface OutcomeAccuracyStatistic {
  /** Number of stored outcomes (sample size — must be displayed). */
  readonly count: number;
  /** Share within margin in [0, 1], or null in the empty state. */
  readonly withinMarginShare: number | null;
  /** As-of instant the statistic was computed for (passed through). */
  readonly asOf: Date;
}
