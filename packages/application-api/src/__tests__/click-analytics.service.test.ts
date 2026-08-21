/**
 * Tests for ClickAnalyticsService — in-memory click tracking.
 *
 * Covers recordClick, getClickCounts, getClickStats, and reset.
 * Uses direct instantiation (no @nestjs/testing) matching the project pattern
 * established in sibling tests.
 *
 * @module ClickAnalyticsServiceTest
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ClickAnalyticsService } from '../analytics/click-analytics.service';
import type { ClickStats } from '../analytics/click-analytics.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Assert that a ClickStats record has every Phase-1 deferred field set to
 * the literal zero type — no ambiguity between "not tracked" and zero.
 */
function expectZeroedPhase1Fields(stats: ClickStats): void {
  expect(stats.purchaseCount).toBe(0);
  // Also verify the type-level constraint: values are literally 0, not just falsy
  expect(stats.purchaseCount as number).toBe(0);
  expect(stats.commissionTotalCents).toBe(0);
  expect(stats.affiliateCommissionCents).toBe(0);
  expect(stats.transactionCount).toBe(0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClickAnalyticsService', () => {
  let service: ClickAnalyticsService;

  beforeEach(() => {
    service = new ClickAnalyticsService();
  });

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------

  describe('empty state', () => {
    it('getClickCounts returns empty object when no clicks recorded', () => {
      expect(service.getClickCounts()).toEqual({});
    });

    it('getClickStats returns empty object when no clicks recorded', () => {
      expect(service.getClickStats()).toEqual({});
    });

    it('reset on empty service does not throw', () => {
      expect(() => service.reset()).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // recordClick — basic recording
  // ---------------------------------------------------------------------------

  describe('recordClick', () => {
    it('records a single click for a merchant–URL pair', () => {
      service.recordClick('alko', 'https://www.alko.fi/tuotteet/olut');

      const counts = service.getClickCounts();
      expect(counts).toEqual({
        alko: { 'https://www.alko.fi/tuotteet/olut': 1 },
      });
    });

    it('increments the count on repeated clicks for the same merchant+url', () => {
      service.recordClick('alko', 'https://www.alko.fi/tuotteet/olut');
      service.recordClick('alko', 'https://www.alko.fi/tuotteet/olut');
      service.recordClick('alko', 'https://www.alko.fi/tuotteet/olut');

      const counts = service.getClickCounts();
      expect(counts.alko['https://www.alko.fi/tuotteet/olut']).toBe(3);
    });

    it('maintains separate counts for different URLs under the same merchant', () => {
      service.recordClick('alko', '/olut');
      service.recordClick('alko', '/olut');
      service.recordClick('alko', '/viini');
      service.recordClick('alko', '/viini');

      const counts = service.getClickCounts();
      expect(counts.alko['/olut']).toBe(2);
      expect(counts.alko['/viini']).toBe(2);
    });

    it('maintains separate counts for the same URL across different merchants', () => {
      service.recordClick('alko', '/olut');
      service.recordClick('alko', '/olut');
      service.recordClick('citymarket', '/olut');

      const counts = service.getClickCounts();
      expect(counts.alko['/olut']).toBe(2);
      expect(counts.citymarket['/olut']).toBe(1);
    });

    it('accepts merchantId with special characters', () => {
      service.recordClick('ö-l-k-o_123', 'https://example.com');
      const counts = service.getClickCounts();
      expect(counts['ö-l-k-o_123']['https://example.com']).toBe(1);
    });

    it('accepts URLs with query parameters and fragments', () => {
      service.recordClick(
        'alko',
        'https://www.alko.fi/tuotteet?category=olut&page=2#reviews',
      );
      const counts = service.getClickCounts();
      expect(
        counts.alko[
          'https://www.alko.fi/tuotteet?category=olut&page=2#reviews'
        ],
      ).toBe(1);
    });

    it('treats empty merchantId as a valid key', () => {
      service.recordClick('', 'https://example.com');
      const counts = service.getClickCounts();
      expect(counts['']['https://example.com']).toBe(1);
    });

    it('treats empty url as a valid key', () => {
      service.recordClick('alko', '');
      const counts = service.getClickCounts();
      expect(counts.alko['']).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getClickCounts — snapshot semantics
  // ---------------------------------------------------------------------------

  describe('getClickCounts snapshot', () => {
    it('returns a snapshot that is not mutated by subsequent recordClick', () => {
      service.recordClick('alko', '/a');
      const snapshot1 = service.getClickCounts();

      service.recordClick('alko', '/a');
      const snapshot2 = service.getClickCounts();

      // snapshot1 should still reflect the state at time of capture
      expect(snapshot1.alko['/a']).toBe(1);
      expect(snapshot2.alko['/a']).toBe(2);
    });

    it('returns a new object each call (defensive copy)', () => {
      service.recordClick('alko', '/a');
      const a = service.getClickCounts();
      const b = service.getClickCounts();
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
    });

    it('includes all merchants and URLs after multiple recordings', () => {
      service.recordClick('a', '/1');
      service.recordClick('b', '/2');
      service.recordClick('a', '/3');

      const counts = service.getClickCounts();
      expect(Object.keys(counts).sort()).toEqual(['a', 'b']);
      expect(Object.keys(counts.a).sort()).toEqual(['/1', '/3']);
      expect(Object.keys(counts.b)).toEqual(['/2']);
    });
  });

  // ---------------------------------------------------------------------------
  // getClickStats — summary statistics
  // ---------------------------------------------------------------------------

  describe('getClickStats', () => {
    it('computes totalClicks for a single merchant', () => {
      service.recordClick('alko', '/a');
      service.recordClick('alko', '/a');
      service.recordClick('alko', '/b');

      const stats = service.getClickStats();
      expect(stats.alko.totalClicks).toBe(3);
    });

    it('computes uniqueUrls correctly', () => {
      service.recordClick('alko', '/a');
      service.recordClick('alko', '/a');
      service.recordClick('alko', '/b');

      const stats = service.getClickStats();
      expect(stats.alko.uniqueUrls).toBe(2);
    });

    it('includes perUrl breakdown with correct counts', () => {
      service.recordClick('alko', '/a');
      service.recordClick('alko', '/a');
      service.recordClick('alko', '/b');

      const stats = service.getClickStats();
      expect(stats.alko.perUrl).toEqual({ '/a': 2, '/b': 1 });
    });

    it('has all Phase-1 deferred fields explicitly zeroed', () => {
      service.recordClick('alko', '/a');
      const stats = service.getClickStats();
      const alkoStats = stats.alko;
      expectZeroedPhase1Fields(alkoStats);
    });

    it('returns stats for multiple merchants', () => {
      service.recordClick('alko', '/a');
      service.recordClick('citymarket', '/b');
      service.recordClick('citymarket', '/b');

      const stats = service.getClickStats();
      expect(Object.keys(stats).sort()).toEqual(['alko', 'citymarket']);
      expect(stats.alko.totalClicks).toBe(1);
      expect(stats.citymarket.totalClicks).toBe(2);
    });

    it('all Phase-1 deferred fields are present in every merchant record', () => {
      service.recordClick('alko', '/a');
      service.recordClick('citymarket', '/b');

      const stats = service.getClickStats();
      for (const merchantId of Object.keys(stats)) {
        expectZeroedPhase1Fields(stats[merchantId]);
      }
    });

    it('perUrl in stats is a snapshot (defensive copy)', () => {
      service.recordClick('alko', '/a');
      const stats1 = service.getClickStats();

      service.recordClick('alko', '/a');
      const stats2 = service.getClickStats();

      expect(stats1.alko.perUrl['/a']).toBe(1);
      expect(stats2.alko.perUrl['/a']).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // reset
  // ---------------------------------------------------------------------------

  describe('reset', () => {
    it('clears all click data', () => {
      service.recordClick('alko', '/a');
      service.recordClick('citymarket', '/b');
      service.reset();

      expect(service.getClickCounts()).toEqual({});
      expect(service.getClickStats()).toEqual({});
    });

    it('allows recording new clicks after reset', () => {
      service.recordClick('alko', '/a');
      service.reset();
      service.recordClick('alko', '/b');

      const counts = service.getClickCounts();
      expect(counts.alko['/a']).toBeUndefined();
      expect(counts.alko['/b']).toBe(1);
    });

    it('is idempotent — calling reset twice does not throw', () => {
      service.recordClick('alko', '/a');
      service.reset();
      expect(() => service.reset()).not.toThrow();
      expect(service.getClickCounts()).toEqual({});
    });
  });
});