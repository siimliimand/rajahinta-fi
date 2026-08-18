/**
 * Rate review types — scheduled check results and pending-review entries.
 *
 * These types are local to data-acquisition because the rate-review lifecycle
 * (check → create review task → manual confirmation) has different semantics
 * from the product-matching manual-review queue in core-domain.  The generic
 * IManualReviewRepository pattern is reused, but the entry shape is specific
 * to tax-rate updates.
 *
 * Rates are NEVER auto-published — discovery of new data creates a review
 * entry that requires manual/legal confirmation before the dataset goes live.
 *
 * @module RateReviewTypes
 */

// ---------------------------------------------------------------------------
// Check result
// ---------------------------------------------------------------------------

/**
 * Outcome of a single rate-check cycle.
 *
 * When {@code newRatesDetected} is true and a review entry was created,
 * {@code reviewId} holds the id of the pending-review entry so it can be
 * surfaced in monitoring or dashboards.
 *
 * When the rate-change source knows which dataset versions are being
 * replaced, the {@code detectedVersions} field carries those version
 * identifiers so downstream consumers (e.g. {@code IdempotencyService})
 * can invalidate stale cache entries.
 */
export interface RateReviewResult {
  /** ISO-8601 timestamp of the check. */
  readonly checkedAt: string;
  /** True when the check found newly published rates not yet reviewed. */
  readonly newRatesDetected: boolean;
  /**
   * Present when newRatesDetected is true and the review entry was created
   * successfully.  Links to the pending-review entry for operator follow-up.
   */
  readonly reviewId?: string;
  /**
   * Dataset versions that are being replaced by the newly detected rates.
   * When set, cache entries referencing these versions should be invalidated.
   * Absent or empty when the source does not know which versions changed.
   */
  readonly detectedVersions?: readonly string[];
}

// ---------------------------------------------------------------------------
// Pending-review entry for a rate update
// ---------------------------------------------------------------------------

/** Status of a rate-review entry. */
export type RateReviewStatus = 'pending' | 'resolved';

/** Resolution action taken by a reviewer. */
export type RateReviewResolution = 'approve' | 'reject' | 'escalate';

/**
 * A pending manual-review entry for a discovered tax-rate update.
 *
 * Stores what the scheduler detected so the reviewer can compare against
 * the official publication before approving the new rates.
 */
export interface RateReviewEntry {
  /** Unique identifier for this review entry. */
  readonly id: string;
  /** ISO-8601 timestamp when the review entry was created. */
  readonly createdAt: string;
  /**
   * Human-readable description of what was detected.
   * Example: "New excise duty rates published by Vero.fi, effective 2025-01-01"
   */
  readonly description: string;
  /**
   * Identifier or description of the source that was checked
   * (e.g. 'vero.fi', 'EUR-Lex').
   */
  readonly source: string;
  /** Current status of the review entry. */
  readonly status: RateReviewStatus;
  /** Resolution action, set when status is 'resolved'. */
  readonly resolution?: RateReviewResolution;
  /** ISO-8601 timestamp when the entry was resolved. */
  readonly resolvedAt?: string;
  /** Free-text notes left by the reviewer. */
  readonly reviewerNotes?: string;
}