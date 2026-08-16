/**
 * Data-quality service.
 *
 * Automated checks that run after each pipeline ingestion to flag
 * freshness and consistency issues:
 *   - Offers older than their domain-specific staleness threshold
 *   - STALE / UNAVAILABLE data silently classified as VERIFIED
 *
 * Delegates recency and availability assessment to core-domain's
 * {@link ReliabilityService}.  The report is actionable — each flagged
 * issue includes a human-readable description of what is wrong.
 *
 * @module DataQualityService
 */

import { Injectable, Logger } from '@nestjs/common';
import { ReliabilityService } from '@rajahinta/core-domain';
import type { ReliabilityStatus, ReliabilityDomain } from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal offer-like object that the quality check can inspect.
 *
 * The pipeline orchestrator does not have full `RetailOfferRecord` instances
 * at upsert time — it constructs these lightweight objects from the mapped
 * data.  Callers outside the pipeline (e.g. a scheduled auditor) may pass
 * full `RetailOfferRecord` values since the shape is structurally compatible.
 */
export interface QualityCheckOffer {
  readonly merchant: string;
  readonly productId: number;
  readonly observedAt: Date;
  readonly reliabilityStatus: string;
}

/**
 * Per-offer freshness result exposed for diagnostics.
 */
export interface OfferFreshnessResult {
  readonly identifier: string;
  readonly storedStatus: string;
  readonly actualStatus: ReliabilityStatus;
  readonly isStale: boolean;
}

/**
 * Actionable report summarising data-quality across a set of offers.
 */
export interface DataQualityReport {
  totalOffers: number;
  staleCount: number;
  unavailableCount: number;
  estimatedCount: number;
  verifiedCount: number;
  /** Human-readable descriptions of every issue found. */
  flaggedIssues: string[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class DataQualityService {
  private readonly logger = new Logger(DataQualityService.name);

  constructor(private readonly reliability: ReliabilityService) {}

  /**
   * Assess whether an offer's observation timestamp is fresh enough for
   * the given domain.
   *
   * @param offer   Object with an `observedAt` timestamp (structural subtype
   *                of both RetailOfferRecord and TransportOfferRecord).
   * @param domain  Domain identifier — determines the staleness threshold.
   * @returns       `VERIFIED` when the data is within threshold,
   *                `STALE` when the threshold has been exceeded.
   */
  checkOfferFreshness(
    offer: { observedAt: Date },
    domain: ReliabilityDomain,
  ): ReliabilityStatus {
    const threshold = this.reliability.stalenessThresholdFor(domain);
    return this.reliability.assessDataRecency(offer.observedAt, threshold);
  }

  /**
   * Run a full quality check over a batch of offers.
   *
   * For each offer the method:
   *   1. Determines the actual recency status via `checkOfferFreshness`.
   *   2. Counts VERIFIED / STALE / UNAVAILABLE / ESTIMATED.
   *   3. Flags offers whose stored `reliabilityStatus` claims VERIFIED
   *      but whose actual status is STALE or UNAVAILABLE.
   *
   * @param offers  Offers to audit (lightweight objects from the pipeline
   *                or full RetailOfferRecord values — both are structurally
   *                compatible with {@link QualityCheckOffer}).
   * @returns       An actionable quality report.
   */
  runQualityCheck(offers: QualityCheckOffer[]): DataQualityReport {
    const report: DataQualityReport = {
      totalOffers: offers.length,
      staleCount: 0,
      unavailableCount: 0,
      estimatedCount: 0,
      verifiedCount: 0,
      flaggedIssues: [],
    };

    for (const offer of offers) {
      const actualStatus = this.checkOfferFreshness(offer, 'price');
      const storedStatus = offer.reliabilityStatus as ReliabilityStatus;

      // Count by actual status
      if (actualStatus === 'VERIFIED') report.verifiedCount++;
      else if (actualStatus === 'STALE') report.staleCount++;
      else if (actualStatus === 'UNAVAILABLE') report.unavailableCount++;
      else if (actualStatus === 'ESTIMATED') report.estimatedCount++;

      // Check for silent VERIFIED — stored claims VERIFIED but actual isn't
      if (!this.verifyNoSilentVerified(storedStatus, actualStatus)) {
        const identifier = `merchant="${offer.merchant}" productId=${offer.productId}`;
        report.flaggedIssues.push(
          `Offer ${identifier} has stored reliabilityStatus "${storedStatus}" ` +
            `but is actually "${actualStatus}" (observedAt=${offer.observedAt.toISOString()})`,
        );
      }
    }

    this.logger.log(
      `Quality check: ${report.totalOffers} offers, ` +
        `${report.verifiedCount} verified, ${report.staleCount} stale, ` +
        `${report.estimatedCount} estimated, ${report.unavailableCount} unavailable, ` +
        `${report.flaggedIssues.length} issues flagged`,
    );

    return report;
  }

  /**
   * Verify that STALE / UNAVAILABLE data is never silently presented as
   * VERIFIED.
   *
   * @param reliabilityStatus  What the data was recorded as (e.g. the stored
   *                           `reliabilityStatus` column value).
   * @param actualStatus       What the actual status should be based on
   *                           recency and availability checks.
   * @returns                  `true` when the stored classification is valid
   *                           (no silent VERIFIED), `false` when data claimed
   *                           as VERIFIED should actually be STALE or
   *                           UNAVAILABLE.
   */
  verifyNoSilentVerified(
    reliabilityStatus: ReliabilityStatus,
    actualStatus: ReliabilityStatus,
  ): boolean {
    // Only the VERIFIED → non-VERIFIED mismatch is a problem.
    // If stored as anything else, or if actual is also VERIFIED, it's fine.
    if (reliabilityStatus === 'VERIFIED' && actualStatus !== 'VERIFIED') {
      return false;
    }
    return true;
  }
}