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
  ConfidenceUISnapshot,
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

  // ---------------------------------------------------------------------------
  // Named input detail
  // ---------------------------------------------------------------------------

  /**
   * Human-readable detail line for a named input and its reliability status.
   *
   * Produces context-aware messages that go beyond the generic
   * {@link STATUS_DETAIL} by incorporating the input name and status-specific
   * nuance (e.g. staleness thresholds).
   *
   * Pure function — no I/O, no side effects.
   *
   * @example
   * ```ts
   * formatConfidenceDetail("Price", "VERIFIED")
   * // => "Price data is verified and current"
   *
   * formatConfidenceDetail("Transport", "STALE")
   * // => "Transport estimate is stale (last refreshed over 7 days ago)"
   *
   * formatConfidenceDetail("Tax rates", "ESTIMATED")
   * // => "Tax rules include estimated rates (deposit status unknown)"
   * ```
   *
   * @param name    Human-readable input name (e.g. "Price", "Transport").
   * @param status  Reliability status of the input.
   * @returns       Human-readable detail string.
   */
  formatConfidenceDetail(name: string, status: ReliabilityStatus): string {
    switch (status) {
      case 'VERIFIED':
        return `${name} data is verified and current`;
      case 'ESTIMATED': {
        if (name === 'Price') {
          return `${name} data is estimated from category averages or similar products`;
        }
        if (name === 'Transport') {
          return `${name} rates are estimated from weight and destination rules`;
        }
        if (name === 'Tax rates' || name === 'Excise duty') {
          return 'Tax rules include estimated rates (deposit status unknown)';
        }
        return `${name} rules include estimated rates (deposit status unknown)`;
      }
      case 'STALE': {
        if (name === 'Price') {
          return `${name} data is stale (last refreshed over 24 hours ago)`;
        }
        if (name === 'Transport') {
          return `${name} estimate is stale (last refreshed over 7 days ago)`;
        }
        if (name === 'Classification') {
          return `${name} rules are stale (last reviewed over 30 days ago)`;
        }
        return `${name} data is stale (exceeded freshness threshold)`;
      }
      case 'UNAVAILABLE':
        return `${name} data is not available for this product`;
    }
  }

  // ---------------------------------------------------------------------------
  // Full landed-cost detail report
  // ---------------------------------------------------------------------------

  /**
   * Generate a complete named-detail {@link ConfidenceReport} for the
   * landed-cost calculator inputs.
   *
   * Unlike {@link computeLandingCostConfidence} (which only returns the
   * aggregate level), this method populates the full breakdown with
   * per-input names and context-aware detail strings via
   * {@link formatConfidenceDetail}.
   *
   * Pure function — no I/O, no side effects.
   *
   * @param inputs  Reliability status for each landed-cost input.
   * @returns       A {@link ConfidenceReport} with aggregate level and
   *                per-input breakdown including `inputName`.
   */
  computeLandingCostDetail(inputs: LandingCostInputStatuses): ConfidenceReport {
    const entries: Array<{ status: ReliabilityStatus; name: string }> = [
      { status: inputs.productPrice, name: 'Price' },
      { status: inputs.transport, name: 'Transport' },
      { status: inputs.excise, name: 'Excise duty' },
      { status: inputs.containerDuty, name: 'Container duty' },
      { status: inputs.classification, name: 'Classification' },
    ];

    const breakdown: ConfidenceDetail[] = entries.map(({ status, name }) => ({
      inputName: name,
      status,
      detail: this.formatConfidenceDetail(name, status),
    }));

    return {
      overall: this.computeResultConfidence(entries.map((e) => e.status)),
      breakdown,
    };
  }

  // ---------------------------------------------------------------------------
  // UI-friendly confidence snapshot
  // ---------------------------------------------------------------------------

  /**
   * Produce a UI-queryable confidence snapshot from the landed-cost inputs.
   *
   * The returned shape is designed for direct rendering — no further
   * transformation needed on the client side.
   *
   * - `overall` — the aggregate confidence level as an uppercase string.
   * - `explanation` — a human-readable paragraph summarising why the
   *   confidence is what it is.
   * - `inputs` — per-input statuses with names, status strings, and
   *   human-readable detail.
   *
   * Pure function — no I/O, no side effects.
   *
   * @param inputs  Reliability status for each landed-cost input.
   * @returns       A UI-ready confidence snapshot.
   */
  getConfidenceForUI(inputs: LandingCostInputStatuses): ConfidenceUISnapshot {
    const report = this.computeLandingCostDetail(inputs);
    const lowCount = report.breakdown.filter(
      (d) => d.status === 'STALE' || d.status === 'UNAVAILABLE',
    ).length;
    const estimatedCount = report.breakdown.filter(
      (d) => d.status === 'ESTIMATED',
    ).length;
    const verifiedCount = report.breakdown.filter(
      (d) => d.status === 'VERIFIED',
    ).length;

    let explanation: string;

    switch (report.overall) {
      case 'HIGH':
        explanation = `All data points are verified against authoritative sources. The landed-cost calculation reflects current, reliable data.`;
        break;
      case 'MEDIUM':
        explanation = `${estimatedCount} of 5 inputs are estimated from incomplete data: `;
        explanation += report.breakdown
          .filter((d) => d.status === 'ESTIMATED')
          .map((d) => (d as ConfidenceDetail & { inputName: string }).inputName ?? 'an input')
          .join(', ');
        explanation += `. The result is reliable but may have minor inaccuracies.`;
        break;
      case 'LOW':
        explanation = `${lowCount} of 5 inputs are stale or unavailable`;
        if (estimatedCount > 0) {
          explanation += ` and ${estimatedCount} are estimated`;
        }
        explanation += `. The result should be treated with caution`;
        if (verifiedCount > 0) {
          explanation += ` — ${verifiedCount} of 5 inputs are still current`;
        }
        explanation += `.`;
        break;
    }

    return {
      overall: report.overall,
      explanation,
      inputs: report.breakdown.map((d) => ({
        name: (d as ConfidenceDetail & { inputName: string }).inputName ?? d.status,
        status: d.status,
        detail: d.detail,
      })),
    };
  }
}