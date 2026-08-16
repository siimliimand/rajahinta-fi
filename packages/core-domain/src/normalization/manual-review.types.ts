/**
 * Manual review types — queue entries for low-confidence product matches.
 *
 * When the matching engine cannot assign HIGH or EXACT confidence, the result
 * is enqueued for manual review rather than auto-matched. A human operator
 * can later accept the proposed match, reject it, or flag the input as a new
 * product.
 *
 * @module ManualReviewTypes
 */

import type { MatchConfidence, ProductMatchCandidate } from './product-matcher.types';
import type { RawProductInput } from './normalization.types';

/** Status of a review queue entry. */
export type ReviewStatus = 'pending' | 'resolved';

/** Resolution action taken by a reviewer. */
export type ReviewResolution = 'accept' | 'reject' | 'new_product';

/**
 * A pending manual-review entry.
 *
 * Stores the raw input that triggered the low-confidence match, the candidates
 * the engine considered, and the engine's own confidence for diagnostic use.
 */
export interface PendingReview {
  /** Unique identifier for this review entry. */
  readonly id: string;
  /** The original raw product input that was being matched. */
  readonly rawProduct: RawProductInput;
  /** Candidate products the engine considered, ranked by score descending. */
  readonly matchCandidates: readonly ProductMatchCandidate[];
  /** The engine's own confidence in its best match. */
  readonly engineConfidence: MatchConfidence;
  /** Current status of the review entry. */
  readonly status: ReviewStatus;
  /** Timestamp (ISO 8601) when the entry was created. */
  readonly createdAt: string;
  /** Resolution action, set when status is 'resolved'. */
  readonly resolution?: ReviewResolution;
  /** Timestamp (ISO 8601) when the entry was resolved. */
  readonly resolvedAt?: string;
}