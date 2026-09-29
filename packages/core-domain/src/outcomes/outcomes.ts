/**
 * Pure calculation-outcome domain logic — submission validation,
 * margin comparison, and the public accuracy aggregation.
 *
 * No I/O: the persistence facts the validator needs (record ownership,
 * existing duplicate) are resolved by the caller through
 * {@link IOutcomeRecordQueryPort} and passed in as plain values, and
 * time enters as an injected `now` so window boundaries are
 * deterministic and testable.
 *
 * @module Outcomes
 */

import type {
  OutcomeAccuracyBreakdown,
  OutcomeAccuracyBreakdownCell,
  OutcomeAccuracySplitDimension,
  OutcomeAccuracySplitRow,
  OutcomeAccuracyStatistic,
  OutcomeInputErrorReason,
  OutcomeSubmissionInput,
  StoredOutcomeTotals,
  ValidatedOutcomeSubmission,
} from './outcomes.types';
import {
  InvalidOutcomeInputError,
  OUTCOME_SUBMISSION_WINDOW,
  WITHIN_MARGIN_FRACTION,
} from './outcomes.types';

// ---------------------------------------------------------------------------
// Submission window
// ---------------------------------------------------------------------------

/**
 * Whether `now` still falls inside the 60-day reporting window that
 * opens at the record's calculation timestamp. Inclusive at both ends
 * of the boundary: elapsed time of exactly the window is still valid;
 * the first millisecond after it is not (spec: rejection "more than 60
 * days after the calculation timestamp").
 *
 * Pure — the clock is a parameter, never read from the environment.
 */
export function isWithinSubmissionWindow(
  recordCalculationTimestamp: Date,
  now: Date,
): boolean {
  const elapsedMs = now.getTime() - recordCalculationTimestamp.getTime();
  return elapsedMs <= OUTCOME_SUBMISSION_WINDOW.milliseconds;
}

// ---------------------------------------------------------------------------
// Submission validation
// ---------------------------------------------------------------------------

/**
 * Validate an outcome submission against the one-per-record contract.
 *
 * Checks run in this documented order (first failure reported):
 *
 * 1. `calculationRecordId` / `accountId` — non-empty strings.
 * 2. `RECORD_NOT_FOUND` — the port resolved no owner for the record.
 * 3. `NOT_RECORD_OWNER` — the record exists but belongs to another
 *    account: an account may report only its own calculations.
 * 4. `OUTCOME_ALREADY_EXISTS` — at most one outcome per
 *    (calculationRecordId, accountId); the API layer maps this to 409
 *    and the stored outcome stays untouched.
 * 5. `REPORTED_TOTAL_NOT_POSITIVE` — the reported total must be whole
 *    euro cents > 0; cents are integers by definition, so a fractional
 *    value is rejected, never rounded.
 * 6. `WINDOW_EXPIRED` — see {@link isWithinSubmissionWindow}.
 *
 * On success the canonical fields to persist are returned. On failure
 * a typed {@link InvalidOutcomeInputError} is thrown and nothing is
 * stored.
 */
export function validateOutcomeSubmission(
  input: OutcomeSubmissionInput,
): ValidatedOutcomeSubmission {
  const calculationRecordId = requireNonEmptyString(
    input.calculationRecordId,
    'MISSING_RECORD_ID',
    'calculation record id is required',
  );
  const accountId = requireNonEmptyString(
    input.accountId,
    'MISSING_ACCOUNT_ID',
    'account id is required',
  );

  if (input.recordOwnerAccountId === null) {
    throw new InvalidOutcomeInputError(
      'RECORD_NOT_FOUND',
      `no calculation record ${calculationRecordId}`,
    );
  }
  if (input.recordOwnerAccountId !== accountId) {
    throw new InvalidOutcomeInputError(
      'NOT_RECORD_OWNER',
      `record ${calculationRecordId} is owned by another account`,
    );
  }
  if (input.existingOutcomeId !== null) {
    throw new InvalidOutcomeInputError(
      'OUTCOME_ALREADY_EXISTS',
      `outcome ${input.existingOutcomeId} already exists for (${calculationRecordId}, ${accountId})`,
    );
  }

  const { reportedTotalCents } = input;
  if (
    typeof reportedTotalCents !== 'number' ||
    !Number.isInteger(reportedTotalCents) ||
    reportedTotalCents <= 0
  ) {
    throw new InvalidOutcomeInputError(
      'REPORTED_TOTAL_NOT_POSITIVE',
      `reported total must be positive whole euro cents, got ${String(reportedTotalCents)}`,
    );
  }

  if (!isWithinSubmissionWindow(input.recordCalculationTimestamp, input.now)) {
    throw new InvalidOutcomeInputError(
      'WINDOW_EXPIRED',
      `submission at ${input.now.toISOString()} is more than ${OUTCOME_SUBMISSION_WINDOW.milliseconds} ms after the record timestamp`,
    );
  }

  return {
    calculationRecordId,
    accountId,
    reportedTotalCents,
    recordCalculationTimestamp: input.recordCalculationTimestamp,
  };
}

/** Trim to a non-empty string or throw the given validation reason. */
function requireNonEmptyString(
  value: unknown,
  reason: OutcomeInputErrorReason,
  detail: string,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidOutcomeInputError(reason, detail);
  }
  return value.trim();
}

// ---------------------------------------------------------------------------
// Margin comparison
// ---------------------------------------------------------------------------

/**
 * Whether a user-reported total falls within the configured margin of
 * the estimate: `|reported − estimated| ≤ 5% of estimatedTotalCents`
 * (spec-fixed {@link WITHIN_MARGIN_FRACTION}, inclusive boundary — a
 * deviation of exactly 5% counts as within margin).
 *
 * A zero estimate is degenerate but handled honestly: nothing can be
 * within 5% of zero except an exact zero report. Negative or non-finite
 * totals throw `INVALID_MARGIN_INPUT` rather than producing a silent
 * verdict.
 */
export function isWithinMargin(
  reportedTotalCents: number,
  estimatedTotalCents: number,
): boolean {
  if (
    !Number.isFinite(reportedTotalCents) ||
    !Number.isFinite(estimatedTotalCents) ||
    reportedTotalCents < 0 ||
    estimatedTotalCents < 0
  ) {
    throw new InvalidOutcomeInputError(
      'INVALID_MARGIN_INPUT',
      `margin comparison needs finite non-negative totals, got reported=${String(reportedTotalCents)}, estimated=${String(estimatedTotalCents)}`,
    );
  }
  const deviation = Math.abs(reportedTotalCents - estimatedTotalCents);
  return deviation <= estimatedTotalCents * WITHIN_MARGIN_FRACTION;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Compute the public accuracy statistic read-time from stored
 * outcomes: the sample size, the share of outcomes whose reported
 * total fell within the margin, and the as-of instant.
 *
 * Empty state is explicit: `count` is 0 and `withinMarginShare` is
 * `null` — no percentage is fabricated when no user-reported outcomes
 * exist (see {@link OutcomeAccuracyStatistic}). `asOf` is passed
 * through unchanged; choosing it (typically the aggregation instant)
 * is the caller's policy.
 */
export function aggregateOutcomeAccuracy(
  outcomes: readonly StoredOutcomeTotals[],
  asOf: Date,
): OutcomeAccuracyStatistic {
  const count = outcomes.length;
  if (count === 0) {
    return { count: 0, withinMarginShare: null, asOf };
  }

  let withinMarginCount = 0;
  for (const outcome of outcomes) {
    if (isWithinMargin(outcome.reportedTotalCents, outcome.estimatedTotalCents)) {
      withinMarginCount += 1;
    }
  }

  return { count, withinMarginShare: withinMarginCount / count, asOf };
}

/**
 * Compute the per-dimension accuracy breakdown read-time from outcome
 * rows enriched with their split dimensions: one cell per dimension
 * value, each carrying its own count and within-margin share under
 * the same honesty rules as {@link aggregateOutcomeAccuracy} — a
 * cell's `withinMarginShare` is null exactly when the cell's count is
 * 0 (never a fabricated percentage; see
 * {@link OutcomeAccuracyBreakdownCell}).
 *
 * Attribution is join-honest: a row whose dimension value is null
 * (its calculation record or transport offer no longer resolves) is
 * not attributed to any cell, so cell counts need not sum to the
 * global count. Without `knownKeys` a cell exists only for values
 * observed in the rows; `knownKeys` adds zero-count empty cells for
 * requested values that no row carries (the caller owns which value
 * vocabulary is enumerated, e.g. the canonical category set).
 *
 * Cells are sorted by key ascending so output is deterministic. Pure —
 * the clock stays an injected `asOf` parameter; display-only.
 */
export function aggregateOutcomeAccuracyBreakdown(
  rows: readonly OutcomeAccuracySplitRow[],
  dimension: OutcomeAccuracySplitDimension,
  asOf: Date,
  knownKeys?: readonly string[],
): OutcomeAccuracyBreakdown {
  const totals = new Map<string, { count: number; withinMarginCount: number }>();
  const ensureCell = (key: string): { count: number; withinMarginCount: number } => {
    let cell = totals.get(key);
    if (!cell) {
      cell = { count: 0, withinMarginCount: 0 };
      totals.set(key, cell);
    }
    return cell;
  };

  for (const row of rows) {
    const key = row[dimension];
    // An unresolvable join is nobody's cell — attributing the outcome
    // to a placeholder value would fabricate data for that value.
    if (key === null) continue;
    const cell = ensureCell(key);
    cell.count += 1;
    if (isWithinMargin(row.reportedTotalCents, row.estimatedTotalCents)) {
      cell.withinMarginCount += 1;
    }
  }

  // knownKeys only ever ADDS empty cells; observed keys always surface
  // even when the caller's vocabulary is stale.
  if (knownKeys) {
    for (const key of knownKeys) {
      ensureCell(key);
    }
  }

  const cells: OutcomeAccuracyBreakdownCell[] = [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, { count, withinMarginCount }]) => ({
      key,
      count,
      withinMarginShare: count === 0 ? null : withinMarginCount / count,
    }));

  return { dimension, cells, asOf };
}
