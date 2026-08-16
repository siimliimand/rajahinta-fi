/**
 * DataQualityService tests.
 *
 * High-liability logic coverage:
 *   - checkOfferFreshness: boundary and staleness detection per domain
 *   - runQualityCheck: counting, silent-VERIFIED flagging, empty input
 *   - verifyNoSilentVerified: mismatch detection and valid cases
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { DataQualityService } from '../services/data-quality.service';
import { ReliabilityService } from '@rajahinta/core-domain';
import { HOUR, DAY } from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fixed "now" for deterministic tests. */
function fixedNow(offsetMs = 0): Date {
  return new Date(1_000_000_000_000 + offsetMs);
}

/** Build a lightweight offer-like object. */
function makeOffer(overrides: Partial<{
  merchant: string;
  productId: number;
  observedAt: Date;
  reliabilityStatus: string;
}> = {}) {
  return {
    merchant: 'test-merchant',
    productId: 1,
    observedAt: new Date(),
    reliabilityStatus: 'VERIFIED',
    ...overrides,
  };
}

describe('DataQualityService', () => {
  let service: DataQualityService;
  let reliability: ReliabilityService;

  beforeAll(() => {
    reliability = new ReliabilityService();
    service = new DataQualityService(reliability);
  });

  // -------------------------------------------------------------------------
  // checkOfferFreshness
  // -------------------------------------------------------------------------

  describe('checkOfferFreshness', () => {
    it('returns VERIFIED for price offer observed within 24h threshold', () => {
      const now = fixedNow();
      const offer = makeOffer({ observedAt: new Date(now.getTime() - 12 * HOUR.milliseconds) });

      // Freeze timers for deterministic now
      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        expect(service.checkOfferFreshness(offer, 'price')).toBe('VERIFIED');
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns STALE for price offer older than 24h', () => {
      const now = fixedNow();
      const offer = makeOffer({ observedAt: new Date(now.getTime() - 25 * HOUR.milliseconds) });

      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        expect(service.checkOfferFreshness(offer, 'price')).toBe('STALE');
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns VERIFIED at exact threshold boundary for price', () => {
      const now = fixedNow();
      const offer = makeOffer({ observedAt: new Date(now.getTime() - DAY.milliseconds) });

      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        expect(service.checkOfferFreshness(offer, 'price')).toBe('VERIFIED');
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns STALE for transport offer older than 7d', () => {
      const now = fixedNow();
      const offer = makeOffer({ observedAt: new Date(now.getTime() - 8 * DAY.milliseconds) });

      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        expect(service.checkOfferFreshness(offer, 'transport')).toBe('STALE');
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns VERIFIED for transport offer within 7d', () => {
      const now = fixedNow();
      const offer = makeOffer({ observedAt: new Date(now.getTime() - 3 * DAY.milliseconds) });

      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        expect(service.checkOfferFreshness(offer, 'transport')).toBe('VERIFIED');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // -------------------------------------------------------------------------
  // verifyNoSilentVerified
  // -------------------------------------------------------------------------

  describe('verifyNoSilentVerified', () => {
    it('returns false when stored is VERIFIED but actual is STALE', () => {
      expect(service.verifyNoSilentVerified('VERIFIED', 'STALE')).toBe(false);
    });

    it('returns false when stored is VERIFIED but actual is UNAVAILABLE', () => {
      expect(service.verifyNoSilentVerified('VERIFIED', 'UNAVAILABLE')).toBe(false);
    });

    it('returns true when stored is VERIFIED and actual is also VERIFIED', () => {
      expect(service.verifyNoSilentVerified('VERIFIED', 'VERIFIED')).toBe(true);
    });

    it('returns true when stored is ESTIMATED and actual is STALE', () => {
      expect(service.verifyNoSilentVerified('ESTIMATED', 'STALE')).toBe(true);
    });

    it('returns true when stored is STALE and actual is STALE', () => {
      expect(service.verifyNoSilentVerified('STALE', 'STALE')).toBe(true);
    });

    it('returns true when stored is ESTIMATED and actual is VERIFIED', () => {
      expect(service.verifyNoSilentVerified('ESTIMATED', 'VERIFIED')).toBe(true);
    });

    it('returns true when stored is UNAVAILABLE and actual is UNAVAILABLE', () => {
      expect(service.verifyNoSilentVerified('UNAVAILABLE', 'UNAVAILABLE')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // runQualityCheck
  // -------------------------------------------------------------------------

  describe('runQualityCheck', () => {
    it('returns zero counts for empty offers array', () => {
      const report = service.runQualityCheck([]);

      expect(report.totalOffers).toBe(0);
      expect(report.verifiedCount).toBe(0);
      expect(report.staleCount).toBe(0);
      expect(report.unavailableCount).toBe(0);
      expect(report.estimatedCount).toBe(0);
      expect(report.flaggedIssues).toEqual([]);
    });

    it('counts a fresh VERIFIED offer correctly', () => {
      const now = fixedNow();
      const offer = makeOffer({
        observedAt: new Date(now.getTime() - 6 * HOUR.milliseconds),
        reliabilityStatus: 'VERIFIED',
      });

      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        const report = service.runQualityCheck([offer]);
        expect(report.totalOffers).toBe(1);
        expect(report.verifiedCount).toBe(1);
        expect(report.staleCount).toBe(0);
        expect(report.flaggedIssues).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('counts a stale offer and does NOT flag it as silent-VERIFIED when stored as ESTIMATED', () => {
      const now = fixedNow();
      const offer = makeOffer({
        observedAt: new Date(now.getTime() - 48 * HOUR.milliseconds),
        reliabilityStatus: 'ESTIMATED',
      });

      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        const report = service.runQualityCheck([offer]);
        expect(report.totalOffers).toBe(1);
        expect(report.staleCount).toBe(1);
        expect(report.verifiedCount).toBe(0);
        // Not flagged — stored as ESTIMATED, not falsely claiming VERIFIED
        expect(report.flaggedIssues).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('flags a stale offer that is silently stored as VERIFIED', () => {
      const now = fixedNow();
      const offer = makeOffer({
        merchant: 'alko',
        productId: 42,
        observedAt: new Date(now.getTime() - 48 * HOUR.milliseconds),
        reliabilityStatus: 'VERIFIED',
      });

      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        const report = service.runQualityCheck([offer]);
        expect(report.totalOffers).toBe(1);
        expect(report.staleCount).toBe(1);
        expect(report.flaggedIssues).toHaveLength(1);
        expect(report.flaggedIssues[0]).toContain('alko');
        expect(report.flaggedIssues[0]).toContain('productId=42');
        expect(report.flaggedIssues[0]).toContain('VERIFIED');
        expect(report.flaggedIssues[0]).toContain('STALE');
      } finally {
        vi.useRealTimers();
      }
    });

    it('handles a mixed batch correctly', () => {
      const now = fixedNow();

      // Fresh → VERIFIED
      const fresh = makeOffer({
        merchant: 'merchant-a',
        productId: 1,
        observedAt: new Date(now.getTime() - 1 * HOUR.milliseconds),
        reliabilityStatus: 'VERIFIED',
      });

      // Stale, stored as ESTIMATED → no flag
      const staleEstimated = makeOffer({
        merchant: 'merchant-b',
        productId: 2,
        observedAt: new Date(now.getTime() - 48 * HOUR.milliseconds),
        reliabilityStatus: 'ESTIMATED',
      });

      // Stale, stored as VERIFIED → flagged
      const staleVerified = makeOffer({
        merchant: 'merchant-c',
        productId: 3,
        observedAt: new Date(now.getTime() - 96 * HOUR.milliseconds),
        reliabilityStatus: 'VERIFIED',
      });

      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        const report = service.runQualityCheck([fresh, staleEstimated, staleVerified]);

        expect(report.totalOffers).toBe(3);
        expect(report.verifiedCount).toBe(1);
        expect(report.staleCount).toBe(2);
        expect(report.estimatedCount).toBe(0);
        expect(report.unavailableCount).toBe(0);
        expect(report.flaggedIssues).toHaveLength(1);
        expect(report.flaggedIssues[0]).toContain('merchant-c');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});