/**
 * ClickAnalyticsService — in-memory click tracking for Phase 1.
 *
 * Records click counts per merchant per link URL.  No database, no
 * purchase/commission tracking.  Designed for simple count-based
 * analytics that can be migrated to a persistent store in Phase 2.
 *
 * ## Phase 1 constraints
 *
 * - `ClickStats.purchaseCount` is **always zero** (purchase tracking deferred).
 * - `ClickStats.commissionTotalCents` is **always zero** (commission tracking deferred).
 * - `ClickStats.affiliateCommissionCents` is **always zero** (affiliate tracking deferred).
 * - `ClickStats.transactionCount` is **always zero** (transaction tracking deferred).
 *
 * These fields exist as literal `0` types so callers get compile-time
 * confirmation that the data is not available — no ambiguity between
 * "not tracked" and "tracked but zero".
 *
 * @module ClickAnalyticsService
 */

import { Injectable } from '@nestjs/common';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/**
 * Summary statistics for one merchant's click data.
 *
 * Purchase, commission, affiliate, and transaction fields are typed as
 * `0` literal — they are structurally zero and will remain so until
 * Phase 2 enables the tracking pipeline.
 */
export interface ClickStats {
  /** Total number of recorded clicks across all URLs for this merchant. */
  readonly totalClicks: number;
  /** Number of unique link URLs that have been clicked. */
  readonly uniqueUrls: number;
  /** Per-URL breakdown of click counts. */
  readonly perUrl: Record<string, number>;
  /**
   * Purchase count — **explicitly zero in Phase 1**.
   * Purchase tracking is not implemented until Phase 2.
   */
  readonly purchaseCount: 0;
  /**
   * Commission total in cents — **explicitly zero in Phase 1**.
   * Commission tracking is not implemented until Phase 2.
   */
  readonly commissionTotalCents: 0;
  /**
   * Affiliate commission amount in cents — **explicitly zero in Phase 1**.
   * Affiliate tracking is not implemented until Phase 2.
   */
  readonly affiliateCommissionCents: 0;
  /**
   * Number of completed transactions — **explicitly zero in Phase 1**.
   * Transaction tracking is not implemented until Phase 2.
   */
  readonly transactionCount: 0;
}

@Injectable()
export class ClickAnalyticsService {
  /**
   * Map<merchantId, Map<linkUrl, count>>
   */
  private readonly clicks = new Map<string, Map<string, number>>();

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Record a click for a given merchant and link URL.
   * Increments the count if the pair already exists.
   */
  recordClick(merchantId: string, url: string): void {
    let merchantClicks = this.clicks.get(merchantId);
    if (!merchantClicks) {
      merchantClicks = new Map<string, number>();
      this.clicks.set(merchantId, merchantClicks);
    }

    const current = merchantClicks.get(url) ?? 0;
    merchantClicks.set(url, current + 1);
  }

  /**
   * Return a snapshot of all click data as plain objects.
   */
  getClickCounts(): Record<string, Record<string, number>> {
    const result: Record<string, Record<string, number>> = {};

    for (const [merchantId, merchantClicks] of this.clicks) {
      const counts: Record<string, number> = {};
      for (const [url, count] of merchantClicks) {
        counts[url] = count;
      }
      result[merchantId] = counts;
    }

    return result;
  }

  /**
   * Return per-merchant summary statistics.
   *
   * Every record includes **explicitly zeroed** purchase, commission,
   * affiliate, and transaction fields — a type-level assertion that
   * these dimensions are not tracked in Phase 1.
   */
  getClickStats(): Record<string, ClickStats> {
    const result: Record<string, ClickStats> = {};

    for (const [merchantId, merchantClicks] of this.clicks) {
      const perUrl: Record<string, number> = {};
      let totalClicks = 0;

      for (const [url, count] of merchantClicks) {
        perUrl[url] = count;
        totalClicks += count;
      }

      result[merchantId] = {
        totalClicks,
        uniqueUrls: merchantClicks.size,
        perUrl,
        purchaseCount: 0,
        commissionTotalCents: 0,
        affiliateCommissionCents: 0,
        transactionCount: 0,
      };
    }

    return result;
  }

  /**
   * Reset all click data.  Intended for testing or administrative use.
   */
  reset(): void {
    this.clicks.clear();
  }
}