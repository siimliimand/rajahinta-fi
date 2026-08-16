/**
 * Reliability Service.
 *
 * Pure-function service that assesses and composes data-point reliability
 * statuses.  Used by the acquisition pipeline (to tag incoming data),
 * the calculation engine (to determine overall confidence), and the
 * ranking/sorting system (to factor freshness into result ordering).
 *
 * All methods are stateless to facilitate testing and tree-shaking;
 * the class wrapper exists solely for NestJS DI compatibility.
 *
 * @module ReliabilityService
 */

import { Injectable } from '@nestjs/common';
import {
  type ReliabilityStatus,
  type ReliabilityDomain,
  type Duration,
  RELIABILITY_ORDER,
  DEFAULT_STALENESS_THRESHOLDS,
} from './reliability.types';

@Injectable()
export class ReliabilityService {
  // ---------------------------------------------------------------------------
  // Assessment
  // ---------------------------------------------------------------------------

  /**
   * Assess whether a data point has gone stale.
   *
   * Compares `observedAt` against the current time (`now`).  If the
   * elapsed time exceeds `stalenessThreshold` the status is `STALE`,
   * otherwise it is `VERIFIED`.
   *
   * @param observedAt          When the data point was last observed.
   * @param stalenessThreshold  Maximum acceptable age for the domain.
   * @returns                   `VERIFIED` if fresh, `STALE` if expired.
   */
  assessDataRecency(
    observedAt: Date,
    stalenessThreshold: Duration,
    now: Date = new Date(),
  ): ReliabilityStatus {
    const elapsed = now.getTime() - observedAt.getTime();
    return elapsed <= stalenessThreshold.milliseconds ? 'VERIFIED' : 'STALE';
  }

  /**
   * Assess whether data is actually present.
   *
   * @param data  The data point (or null/undefined).
   * @returns     `UNAVAILABLE` when data is null or undefined,
   *              otherwise `ESTIMATED` (caller may promote to VERIFIED
   *              after source-specific validation).
   */
  assessAvailability(data: unknown | null): ReliabilityStatus {
    return data === null || data === undefined ? 'UNAVAILABLE' : 'ESTIMATED';
  }

  // ---------------------------------------------------------------------------
  // Composition
  // ---------------------------------------------------------------------------

  /**
   * Compose multiple reliability statuses into a single result.
   *
   * Returns the **strictest** (most conservative) status among the inputs.
   * Ordering (least → most strict): VERIFIED → ESTIMATED → STALE → UNAVAILABLE.
   *
   * Use case: a calculation that reads price (VERIFIED) + transport (STALE)
   * should report STALE — the weakest link determines overall reliability.
   *
   * @param statuses  Non-empty array of statuses to compose.
   * @returns         The strictest status in the input set.
   */
  composeReliability(statuses: ReliabilityStatus[]): ReliabilityStatus {
    if (statuses.length === 0) {
      return 'UNAVAILABLE';
    }

    // RELIABILITY_ORDER is from best to worst; the highest index is strictest.
    let strictestIndex = -1;

    for (const status of statuses) {
      const idx = RELIABILITY_ORDER.indexOf(status);
      if (idx > strictestIndex) {
        strictestIndex = idx;
      }
    }

    return RELIABILITY_ORDER[strictestIndex];
  }

  // ---------------------------------------------------------------------------
  // Threshold configuration
  // ---------------------------------------------------------------------------

  /**
   * Resolve the staleness threshold for a given domain.
   *
   * Overrides can be passed to allow runtime or environment-based
   * configuration.  Falls back to module-level defaults.
   *
   * @param domain    Domain identifier.
   * @param overrides Optional domain-specific overrides.
   * @returns         The effective staleness threshold.
   */
  stalenessThresholdFor(
    domain: ReliabilityDomain,
    overrides?: Partial<Record<ReliabilityDomain, Duration>>,
  ): Duration {
    if (overrides?.[domain]) {
      return overrides[domain]!;
    }
    return DEFAULT_STALENESS_THRESHOLDS[domain];
  }
}