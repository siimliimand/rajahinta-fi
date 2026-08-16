/**
 * Confidence Framework Service.
 *
 * Cross-cutting service consumed by nearly every module to produce a
 * user-facing confidence signal from raw reliability statuses.
 *
 * This is a thin layer over {@link ReliabilityService} — it maps
 * technical reliability statuses into human-interpretable confidence
 * levels and provides aggregate computation.
 *
 * @module ConfidenceFrameworkService
 */

import { Injectable } from '@nestjs/common';
import type { ReliabilityStatus } from './reliability.types';
import { ReliabilityService } from './reliability.service';
import type {
  ConfidenceLevel,
  ConfidenceDetail,
  ConfidenceReport,
  LandingCostInputStatuses,
} from './confidence-framework.types';

/**
 * Default detail messages for each reliability status.
 * Used by {@link confidenceFromStatus} and {@link computeResultConfidence}
 * to populate the breakdown explanation.
 */
const STATUS_DETAIL: Record<ReliabilityStatus, string> = {
  VERIFIED: 'Data point is verified against an authoritative source.',
  ESTIMATED: 'Data point is estimated from incomplete or indirect data.',
  STALE: 'Data point has exceeded its freshness threshold.',
  UNAVAILABLE: 'No data is available for this data point.',
};

@Injectable()
export class ConfidenceFrameworkService {
  constructor(private readonly reliabilityService: ReliabilityService) {}

  // ---------------------------------------------------------------------------
  // Aggregate confidence
  // ---------------------------------------------------------------------------

  /**
   * Compute the aggregate confidence level from a set of reliability statuses.
   *
   * Rules:
   * - **HIGH**   — all statuses are VERIFIED.
   * - **MEDIUM** — one or more statuses are ESTIMATED, and none are
   *                STALE or UNAVAILABLE.
   * - **LOW**    — one or more statuses are STALE or UNAVAILABLE.
   *
   * @param inputStatuses  Reliability statuses for each constituent data point.
   * @returns              The aggregate confidence level.
   */
  computeResultConfidence(inputStatuses: ReliabilityStatus[]): ConfidenceLevel {
    if (inputStatuses.length === 0) {
      return 'LOW';
    }

    let hasEstimated = false;
    let hasStaleOrUnavailable = false;

    for (const status of inputStatuses) {
      if (status === 'ESTIMATED') {
        hasEstimated = true;
      } else if (status === 'STALE' || status === 'UNAVAILABLE') {
        hasStaleOrUnavailable = true;
      }
    }

    if (hasStaleOrUnavailable) {
      return 'LOW';
    }

    if (hasEstimated) {
      return 'MEDIUM';
    }

    // All VERIFIED
    return 'HIGH';
  }

  // ---------------------------------------------------------------------------
  // Domain-specific: landed cost
  // ---------------------------------------------------------------------------

  /**
   * Compute aggregate confidence for the landed-cost calculator.
   *
   * Domain-specific variant of {@link computeResultConfidence} that operates
   * on the five named inputs the calculator materialises:
   * `productPrice`, `transport`, `excise`, `containerDuty`, `classification`.
   *
   * Rules:
   * - **HIGH**   — all five inputs are VERIFIED.
   * - **MEDIUM** — one or more inputs are ESTIMATED; none are STALE or
   *                UNAVAILABLE.
   * - **LOW**    — any input is STALE or UNAVAILABLE.
   *
   * @param inputs  Reliability status for each landed-cost input.
   * @returns       The aggregate confidence level.
   */
  computeLandingCostConfidence(inputs: LandingCostInputStatuses): ConfidenceLevel {
    return this.computeResultConfidence([
      inputs.productPrice,
      inputs.transport,
      inputs.excise,
      inputs.containerDuty,
      inputs.classification,
    ]);
  }

  // ---------------------------------------------------------------------------
  // Evidence report from a status map
  // ---------------------------------------------------------------------------

  /**
   * Generate a confidence report from a labelled map of reliability statuses.
   *
   * Each entry in the map becomes a {@link ConfidenceDetail} in the
   * breakdown, labelled by its key.  The overall confidence is computed
   * from all values.
   *
   * Pure function — no I/O, no side effects.
   *
   * @param inputs  Record mapping data-point labels to reliability statuses.
   * @returns       A {@link ConfidenceReport} with aggregate and breakdown.
   */
  computeEvidenceFromStatuses(inputs: Record<string, ReliabilityStatus>): ConfidenceReport {
    const labels = Object.keys(inputs);
    const values = Object.values(inputs);

    const breakdown: ConfidenceDetail[] = labels.map((label) => ({
      status: inputs[label],
      detail: `[${label}] ${STATUS_DETAIL[inputs[label]]}`,
    }));

    return {
      overall: this.computeResultConfidence(values),
      breakdown,
    };
  }

  // ---------------------------------------------------------------------------
  // Delegate to ReliabilityService
  // ---------------------------------------------------------------------------

  /**
   * Compose multiple reliability statuses into a single result.
   *
   * Delegates to {@link ReliabilityService.composeReliability}.
   *
   * @param statuses  Non-empty array of statuses to compose.
   * @returns         The strictest (most conservative) status.
   */
  composeStatuses(statuses: ReliabilityStatus[]): ReliabilityStatus {
    return this.reliabilityService.composeReliability(statuses);
  }

  // ---------------------------------------------------------------------------
  // Single-status mapping
  // ---------------------------------------------------------------------------

  /**
   * Map a single reliability status to its corresponding confidence level.
   *
   * - `VERIFIED`     → `HIGH`
   * - `ESTIMATED`    → `MEDIUM`
   * - `STALE`        → `LOW`
   * - `UNAVAILABLE`  → `LOW`
   *
   * @param status  The reliability status to map.
   * @returns       The corresponding confidence level.
   */
  confidenceFromStatus(status: ReliabilityStatus): ConfidenceLevel {
    switch (status) {
      case 'VERIFIED':
        return 'HIGH';
      case 'ESTIMATED':
        return 'MEDIUM';
      case 'STALE':
      case 'UNAVAILABLE':
        return 'LOW';
    }
  }

  // ---------------------------------------------------------------------------
  // Full report
  // ---------------------------------------------------------------------------

  /**
   * Produce a full confidence report — aggregate level plus per-status
   * breakdown with explanations.
   *
   * @param statuses  Reliability statuses for each constituent data point,
   *                  paired with a label identifying the data point.
   * @returns         A {@link ConfidenceReport} with aggregate and breakdown.
   */
  buildReport(statuses: Array<{ status: ReliabilityStatus; label: string }>): ConfidenceReport {
    const rawStatuses = statuses.map((s) => s.status);
    const overall = this.computeResultConfidence(rawStatuses);

    const breakdown: ConfidenceDetail[] = statuses.map(({ status, label }) => ({
      status,
      detail: `[${label}] ${STATUS_DETAIL[status]}`,
    }));

    return { overall, breakdown };
  }
}