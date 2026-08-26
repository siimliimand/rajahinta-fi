/**
 * Merchant Terms Port — abstraction for reading merchant-level terms
 * such as minimum order thresholds.
 *
 * Core Domain owns this port so the optimizer depends on an abstraction,
 * not on a specific repository implementation.  The concrete adapter lives
 * in the composition root (typically Data Platform or Application Api) and
 * wires the actual persistence layer behind this contract at bootstrap time.
 *
 * ## Neutrality
 *
 * Terms are limited to objective merchant policies (minimum order value)
 * that affect purchase feasibility.  No commercial, promotional, or billing
 * data flows through this port.
 *
 * @module MerchantTermsPort
 */

import type { ReliabilityStatus } from '../../reliability/reliability.types';

/** Injection token for the merchant terms port. */
export const MERCHANT_TERMS_PORT = 'MERCHANT_TERMS_PORT';

/**
 * Merchant-level terms relevant to basket optimization.
 *
 * A null `minimumOrderValueCents` means no known threshold for this
 * merchant (the store remains eligible for any subtotal, with confidence
 * implications per Decision 3).
 */
export interface MerchantTerms {
  /** Stable merchant identifier. */
  readonly merchantId: string;

  /**
   * Minimum order value in euro-cents, or null when no threshold is known.
   * Assignments below this value are infeasible when the status is VERIFIED.
   */
  readonly minimumOrderValueCents: number | null;

  /** Currency of the threshold (always EUR in Phase 1). */
  readonly currency: string;

  /** Reliability status of the threshold data. */
  readonly reliabilityStatus: ReliabilityStatus;

  /** When the terms were last observed / refreshed. */
  readonly observedAt: Date;
}

/**
 * Repository contract for merchant terms lookup.
 *
 * Consumers inject this interface via {@link MERCHANT_TERMS_PORT}.
 * An adapter in the composition root maps the concrete data-platform
 * repository to this port.
 */
export interface IMerchantTermsPort {
  /**
   * Retrieve terms for a given merchant.
   *
   * Returns null when no terms record exists for the merchant (no known
   * minimum order threshold — the store remains eligible).
   */
  getTerms(merchantId: string): Promise<MerchantTerms | null>;
}