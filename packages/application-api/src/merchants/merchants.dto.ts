/**
 * Merchant DTOs — request/response shapes for the merchant reliability API
 * (task 3.4, change phase2-advanced-features).
 *
 * Pure interfaces with no NestJS or swagger coupling so they can be shared
 * with API client packages or alternative frontends.
 *
 * Guardrails embedded in the shape:
 * - every Date of the core-domain score is serialized to an ISO 8601
 *   string — Date objects never cross the API boundary;
 * - status fields use only the controlled vocabularies (ReliabilityStatus,
 *   PermissionStatus) — counts, shares, statuses, and timestamps, never a
 *   letter grade, weighting, or endorsement;
 * - the score is informational only — it must never feed ranking,
 *   sorting, or sort defaults (informational-only rule, change
 *   phase2-advanced-features).
 *
 * @module MerchantsDto
 */

import type {
  PermissionStatus,
  ReliabilityStatus,
} from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

/**
 * Factual reliability score for one merchant — ISO-string mirror of the
 * core-domain {@link MerchantReliabilityScore}.
 */
export interface MerchantReliabilityScoreDto {
  /** Stable merchant identifier. */
  readonly merchant: string;
  /** Total number of the merchant's current offers (one per product). */
  readonly offerCount: number;
  /** Offer count per reliability status; all four statuses present. */
  readonly statusCounts: Readonly<Record<ReliabilityStatus, number>>;
  /** Share of offers per status, exact ratio in [0, 1]. */
  readonly statusShares: Readonly<Record<ReliabilityStatus, number>>;
  /** Strictest (most conservative) status among the offers. */
  readonly strictestStatus: ReliabilityStatus;
  /** Freshest observedAt across the offers, ISO 8601; null when none. */
  readonly freshestObservedAt: string | null;
  /** Governance permission status of the merchant's data sources. */
  readonly governancePermissionStatus: PermissionStatus;
  /** When the score was computed, ISO 8601. */
  readonly computedAt: string;
}

/**
 * Merchant identifier → score. Embedded in product-detail responses when
 * the ADVANCED_FEATURES flag is enabled; absent otherwise.
 */
export type MerchantReliabilityMap = Readonly<
  Record<string, MerchantReliabilityScoreDto>
>;

/** GET /api/v1/merchants/reliability — score per merchant with current offers. */
export interface MerchantReliabilityListResponse {
  readonly merchants: MerchantReliabilityScoreDto[];
}
