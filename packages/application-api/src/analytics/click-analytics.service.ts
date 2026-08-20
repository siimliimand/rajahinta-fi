/**
 * ClickAnalyticsService — in-memory click tracking for Phase 1.
 *
 * Records click counts per merchant per link URL.  No database, no
 * purchase/commission tracking.  Designed for simple count-based
 * analytics that can be migrated to a persistent store in Phase 2.
 *
 * @module ClickAnalyticsService
 */

import { Injectable } from '@nestjs/common';

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
   * Reset all click data.  Intended for testing or administrative use.
   */
  reset(): void {
    this.clicks.clear();
  }
}