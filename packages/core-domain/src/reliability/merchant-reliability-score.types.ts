/**
 * Merchant reliability score types.
 *
 * Factual per-merchant aggregation over stored offer reliability statuses
 * and governance permission state. Informational only — the score is a
 * controlled-vocabulary summary, never a merchant endorsement, grade, or
 * ranking input.
 *
 * @module MerchantReliabilityScoreTypes
 */

import type { ReliabilityStatus } from './reliability.types';
import type { PermissionStatus } from '../governance/source-governance.types';

/**
 * Per-merchant offer-status aggregate to be scored.
 *
 * Produced by the data-platform repository (SQL GROUP BY over the
 * merchant's current offers) and mapped onto this shape by the API layer.
 */
export interface MerchantReliabilityScoreInput {
  /** Stable merchant identifier. */
  readonly merchant: string;
  /** Offer count per reliability status; absent statuses default to 0. */
  readonly statusCounts: Record<ReliabilityStatus, number>;
  /** Total number of current offers; MUST equal the sum of statusCounts. */
  readonly offerCount: number;
  /** Freshest observedAt across the merchant's offers; null when none. */
  readonly freshestObservedAt: Date | null;
  /** Governance permission status of the merchant's data sources. */
  readonly governancePermissionStatus: PermissionStatus;
}

/**
 * Factual per-merchant reliability score.
 *
 * Contains only counts, shares, statuses, and timestamps — no letter
 * grade, weighting, or subjective label. Informational only: never a
 * ranking input (a lockstep test asserts the ranking module rejects
 * score-carrying inputs).
 */
export interface MerchantReliabilityScore {
  /** Stable merchant identifier. */
  readonly merchant: string;
  /** Total number of current offers. */
  readonly offerCount: number;
  /** Offer count per reliability status; all four statuses present. */
  readonly statusCounts: Record<ReliabilityStatus, number>;
  /**
   * Share of offers per status as an exact ratio in [0, 1]
   * (count / offerCount, e.g. 0.75). All shares are 0 when offerCount
   * is 0.
   */
  readonly statusShares: Record<ReliabilityStatus, number>;
  /** Strictest (most conservative) status among the offers. */
  readonly strictestStatus: ReliabilityStatus;
  /** Freshest observedAt across the merchant's offers; null when none. */
  readonly freshestObservedAt: Date | null;
  /** Governance permission status of the merchant's data sources. */
  readonly governancePermissionStatus: PermissionStatus;
  /** When the score was computed. */
  readonly computedAt: Date;
}

/**
 * Thrown when a score input violates its contract: an unknown reliability
 * status key, a negative or non-integer count, or counts that do not sum
 * to offerCount.
 */
export class MerchantReliabilityInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MerchantReliabilityInputError';
  }
}
