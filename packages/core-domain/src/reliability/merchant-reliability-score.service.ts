/**
 * Merchant Reliability Score Service.
 *
 * Pure-function service that turns a per-merchant offer-status aggregate
 * plus governance permission status into a factual score object. The
 * score is informational only — it never feeds ranking or ordering.
 *
 * All methods are stateless; the class wrapper exists solely for NestJS
 * DI compatibility.
 *
 * @module MerchantReliabilityScoreService
 */

import { Injectable } from '@nestjs/common';
import { RELIABILITY_ORDER, type ReliabilityStatus } from './reliability.types';
import { ReliabilityService } from './reliability.service';
import {
  MerchantReliabilityInputError,
  type MerchantReliabilityScore,
  type MerchantReliabilityScoreInput,
} from './merchant-reliability-score.types';

@Injectable()
export class MerchantReliabilityScoreService {
  constructor(private readonly reliabilityService: ReliabilityService) {}

  /**
   * Compute a factual reliability score for one merchant.
   *
   * @param input  Per-merchant offer-status aggregate + governance status.
   * @returns      Counts, shares, strictest status, freshest observedAt,
   *               governance status, and the computation timestamp.
   * @throws {@link MerchantReliabilityInputError} when statusCounts holds
   *         an unknown status key, a negative or non-integer count, or the
   *         counts do not sum to offerCount.
   */
  computeScore(input: MerchantReliabilityScoreInput): MerchantReliabilityScore {
    const statusCounts = this.normalizeStatusCounts(input);

    const statusShares = {} as Record<ReliabilityStatus, number>;
    for (const status of RELIABILITY_ORDER) {
      statusShares[status] =
        input.offerCount === 0 ? 0 : statusCounts[status] / input.offerCount;
    }

    const presentStatuses = RELIABILITY_ORDER.filter(
      (status) => statusCounts[status] > 0,
    );

    return {
      merchant: input.merchant,
      offerCount: input.offerCount,
      statusCounts,
      statusShares,
      strictestStatus: this.reliabilityService.composeReliability(presentStatuses),
      freshestObservedAt: input.freshestObservedAt,
      governancePermissionStatus: input.governancePermissionStatus,
      computedAt: new Date(),
    };
  }

  /**
   * Validate raw counts and materialise a record with all four statuses
   * present (absent statuses default to 0) so the serialized shape is stable.
   */
  private normalizeStatusCounts(
    input: MerchantReliabilityScoreInput,
  ): Record<ReliabilityStatus, number> {
    const raw = input.statusCounts ?? ({} as Record<ReliabilityStatus, number>);
    let sum = 0;

    const normalized = {} as Record<ReliabilityStatus, number>;
    for (const status of RELIABILITY_ORDER) {
      const count = raw[status] ?? 0;
      if (!Number.isInteger(count) || count < 0) {
        throw new MerchantReliabilityInputError(
          `Count for status "${status}" must be a non-negative integer, got ${count}`,
        );
      }
      normalized[status] = count;
      sum += count;
    }

    for (const key of Object.keys(raw)) {
      if (!(RELIABILITY_ORDER as string[]).includes(key)) {
        throw new MerchantReliabilityInputError(
          `Unknown reliability status "${key}"; expected one of ${RELIABILITY_ORDER.join(', ')}`,
        );
      }
    }

    if (sum !== input.offerCount) {
      throw new MerchantReliabilityInputError(
        `statusCounts sum (${sum}) does not match offerCount (${input.offerCount})`,
      );
    }

    return normalized;
  }
}
