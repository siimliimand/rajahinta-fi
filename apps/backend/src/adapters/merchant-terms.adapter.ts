/**
 * Merchant Terms Adapter — domain-port implementation for IMerchantTermsPort.
 *
 * Delegates to the data-platform DrizzleMerchantTermsRepository and maps the
 * persisted MerchantTermsRecord to the domain MerchantTerms type.
 *
 * ## Key transformations
 *
 * | Database column         | Domain field            | Notes                        |
 * |-------------------------|-------------------------|------------------------------|
 * | `reliability_status`    | `reliabilityStatus`     | String narrowed to union     |
 * | `source_url`            | — (dropped)             | Not in domain type           |
 * | `id`                    | — (dropped)             | Internal PK, not in domain   |
 *
 * @module MerchantTermsAdapter
 */

import { Injectable } from '@nestjs/common';
import { MerchantTermsRepository } from '@rajahinta/data-platform';
import type {
  IMerchantTermsPort,
  MerchantTerms,
  ReliabilityStatus,
} from '@rajahinta/core-domain';

@Injectable()
export class MerchantTermsAdapter implements IMerchantTermsPort {
  constructor(private readonly repo: MerchantTermsRepository) {}

  /**
   * Retrieve terms for a merchant.
   * Returns null when no terms record exists.
   */
  async getTerms(merchantId: string): Promise<MerchantTerms | null> {
    const record = await this.repo.findByMerchant(merchantId);
    if (record === null) return null;

    return {
      merchantId: record.merchantId,
      minimumOrderValueCents: record.minimumOrderValueCents ?? null,
      currency: record.currency,
      reliabilityStatus: toReliabilityStatus(record.reliabilityStatus),
      observedAt: record.observedAt,
    };
  }
}

/**
 * Narrow a persisted reliability string to the domain union.
 *
 * The database column is varchar(16); rows written before the vocabulary
 * unification may hold legacy values. Unknown values degrade to ESTIMATED —
 * reliability is never overstated.
 */
function toReliabilityStatus(value: string): ReliabilityStatus {
  return value === 'VERIFIED' || value === 'STALE' || value === 'UNAVAILABLE'
    ? value
    : 'ESTIMATED';
}
