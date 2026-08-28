/**
 * Merchant reliability service — application-api orchestration over the
 * factual score pipeline (task 3.4, change phase2-advanced-features).
 *
 * Assembles each score from three factual inputs:
 * - per-merchant offer aggregates (DataPlatformModule's
 *   MerchantReliabilityRepository — counts over CURRENT offers),
 * - the domain scoring rules (ReliabilityModule's
 *   MerchantReliabilityScoreService — shares, strictest status),
 * - the merchant's governance permission status (SourceGovernanceService).
 *
 * Governance fallback policy (mirrors the acquisition pipeline's
 * checkMerchantPermission): a merchant with no governance records, or whose
 * check cannot be resolved (the SOURCE_GOVERNANCE_REPOSITORY_PORT still
 * carries the shared null default until a concrete adapter is bound), is
 * reported as PENDING — permission is never overstated.
 *
 * Neutrality: scores produced here are informational only. They are never
 * fed into ranking, sorting, or sort defaults.
 *
 * @module MerchantReliabilityService
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  MerchantReliabilityScoreService,
  SourceGovernanceService,
  type MerchantReliabilityScore,
  type PermissionStatus,
} from '@rajahinta/core-domain';
import {
  MerchantReliabilityRepository,
  type MerchantReliabilityAggregate,
} from '@rajahinta/data-platform';
import type {
  MerchantReliabilityMap,
  MerchantReliabilityScoreDto,
} from './merchants.dto';

/** Factual default when no governance record exists or the check fails. */
const UNKNOWN_PERMISSION_STATUS: PermissionStatus = 'PENDING';

@Injectable()
export class MerchantReliabilityService {
  private readonly logger = new Logger(MerchantReliabilityService.name);

  constructor(
    private readonly reliabilityRepo: MerchantReliabilityRepository,
    private readonly scoreService: MerchantReliabilityScoreService,
    private readonly governance: SourceGovernanceService,
  ) {}

  /**
   * Score DTOs for every merchant holding at least one current offer,
   * ordered by merchant ascending (the repository's deterministic order).
   */
  async getReliabilityScores(): Promise<MerchantReliabilityScoreDto[]> {
    const aggregates = await this.reliabilityRepo.findCurrentOfferAggregates();
    return this.scoreAggregates(aggregates);
  }

  /**
   * Score map covering exactly the requested merchants that have
   * aggregates — a merchant with no current offers is simply absent.
   */
  async getReliabilityScoreMap(
    merchants: ReadonlySet<string>,
  ): Promise<MerchantReliabilityMap> {
    const aggregates = (
      await this.reliabilityRepo.findCurrentOfferAggregates()
    ).filter((aggregate) => merchants.has(aggregate.merchant));

    const scores = await this.scoreAggregates(aggregates);

    const map: Record<string, MerchantReliabilityScoreDto> = {};
    for (const score of scores) {
      map[score.merchant] = score;
    }
    return map;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Score and serialize each aggregate, resolving governance per merchant. */
  private async scoreAggregates(
    aggregates: readonly MerchantReliabilityAggregate[],
  ): Promise<MerchantReliabilityScoreDto[]> {
    const scores: MerchantReliabilityScoreDto[] = [];
    for (const aggregate of aggregates) {
      const governancePermissionStatus = await this.resolveGovernanceStatus(
        aggregate.merchant,
      );
      scores.push(
        this.toDto(
          this.scoreService.computeScore({
            merchant: aggregate.merchant,
            statusCounts: aggregate.statusCounts,
            offerCount: aggregate.offerCount,
            freshestObservedAt: aggregate.freshestObservedAt,
            governancePermissionStatus,
          }),
        ),
      );
    }
    return scores;
  }

  /**
   * Resolve the merchant's governance permission status via the service's
   * per-merchant aggregation (checkPermission — findById looks up a
   * governance record by numeric ID, not by merchant).
   */
  private async resolveGovernanceStatus(
    merchant: string,
  ): Promise<PermissionStatus> {
    try {
      const result = await this.governance.checkPermission(merchant);
      // No registered sources → nothing factual to report. PENDING is the
      // factual default in the PermissionStatus vocabulary and never
      // overstates permission.
      if (result.sources.length === 0) {
        return UNKNOWN_PERMISSION_STATUS;
      }
      return result.permissionStatus;
    } catch (err) {
      // Port unwired or repository outage — degrade to PENDING so an
      // infrastructure failure can never surface as GRANTED.
      this.logger.warn(
        `Governance check failed for merchant "${merchant}": ` +
          (err instanceof Error ? err.message : 'unknown error') +
          ' — defaulting to PENDING',
      );
      return UNKNOWN_PERMISSION_STATUS;
    }
  }

  /** Serialize the domain score — dates become ISO strings. */
  private toDto(score: MerchantReliabilityScore): MerchantReliabilityScoreDto {
    return {
      merchant: score.merchant,
      offerCount: score.offerCount,
      statusCounts: { ...score.statusCounts },
      statusShares: { ...score.statusShares },
      strictestStatus: score.strictestStatus,
      freshestObservedAt:
        score.freshestObservedAt === null
          ? null
          : score.freshestObservedAt.toISOString(),
      governancePermissionStatus: score.governancePermissionStatus,
      computedAt: score.computedAt.toISOString(),
    };
  }
}
