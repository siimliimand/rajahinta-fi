/**
 * ReliabilityService tests.
 *
 * High-liability logic coverage:
 *   - composeReliability ordering (strictest wins)
 *   - assessDataRecency boundary and staleness detection
 *   - assessAvailability null/undefined vs present data
 *   - stalenessThresholdFor defaults and overrides
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { ReliabilityService } from '../reliability.service';
import { HOUR, DAY } from '../reliability.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fixed "now" for deterministic recency tests. */
function fixedNow(offsetMs = 0): Date {
  return new Date(1_000_000_000_000 + offsetMs);
}

describe('ReliabilityService', () => {
  let service: ReliabilityService;

  beforeAll(() => {
    service = new ReliabilityService();
  });

  // -------------------------------------------------------------------------
  // composeReliability
  // -------------------------------------------------------------------------

  describe('composeReliability', () => {
    it('returns UNAVAILABLE for empty input', () => {
      expect(service.composeReliability([])).toBe('UNAVAILABLE');
    });

    it('returns the single input when only one status is given', () => {
      expect(service.composeReliability(['VERIFIED'])).toBe('VERIFIED');
      expect(service.composeReliability(['STALE'])).toBe('STALE');
      expect(service.composeReliability(['UNAVAILABLE'])).toBe('UNAVAILABLE');
      expect(service.composeReliability(['ESTIMATED'])).toBe('ESTIMATED');
    });

    it('returns the strictest (most conservative) status: UNAVAILABLE beats all', () => {
      expect(service.composeReliability(['VERIFIED', 'ESTIMATED', 'UNAVAILABLE'])).toBe('UNAVAILABLE');
      expect(service.composeReliability(['UNAVAILABLE', 'VERIFIED'])).toBe('UNAVAILABLE');
      expect(service.composeReliability(['UNAVAILABLE'])).toBe('UNAVAILABLE');
    });

    it('returns STALE when inputs are VERIFIED, ESTIMATED, and STALE', () => {
      expect(service.composeReliability(['VERIFIED', 'ESTIMATED', 'STALE'])).toBe('STALE');
    });

    it('returns ESTIMATED when inputs are VERIFIED and ESTIMATED', () => {
      expect(service.composeReliability(['VERIFIED', 'ESTIMATED'])).toBe('ESTIMATED');
    });

    it('returns VERIFIED when all inputs are VERIFIED', () => {
      expect(service.composeReliability(['VERIFIED', 'VERIFIED', 'VERIFIED'])).toBe('VERIFIED');
    });

    it('handles duplicate statuses correctly', () => {
      expect(service.composeReliability(['STALE', 'STALE', 'STALE'])).toBe('STALE');
    });
  });

  // -------------------------------------------------------------------------
  // assessDataRecency
  // -------------------------------------------------------------------------

  describe('assessDataRecency', () => {
    it('returns VERIFIED when observedAt is within threshold', () => {
      const now = fixedNow();
      const observedAt = new Date(now.getTime() - 12 * HOUR.milliseconds);
      expect(service.assessDataRecency(observedAt, DAY, now)).toBe('VERIFIED');
    });

    it('returns STALE when observedAt exceeds threshold', () => {
      const now = fixedNow();
      const observedAt = new Date(now.getTime() - 25 * HOUR.milliseconds);
      expect(service.assessDataRecency(observedAt, DAY, now)).toBe('STALE');
    });

    it('returns VERIFIED at exact threshold boundary (elapsed === threshold)', () => {
      const now = fixedNow();
      const observedAt = new Date(now.getTime() - DAY.milliseconds);
      expect(service.assessDataRecency(observedAt, DAY, now)).toBe('VERIFIED');
    });

    it('returns VERIFIED for data observed in the future', () => {
      const now = fixedNow();
      const observedAt = new Date(now.getTime() + HOUR.milliseconds);
      expect(service.assessDataRecency(observedAt, DAY, now)).toBe('VERIFIED');
    });

    it('uses Date.now() when no now argument is provided', () => {
      // Freeze Date.now to a deterministic value
      const frozenNow = fixedNow();
      vi.useFakeTimers();
      vi.setSystemTime(frozenNow);

      try {
        const observedAt = new Date(frozenNow.getTime() - 6 * HOUR.milliseconds);
        expect(service.assessDataRecency(observedAt, DAY)).toBe('VERIFIED');

        const staleObservedAt = new Date(frozenNow.getTime() - 48 * HOUR.milliseconds);
        expect(service.assessDataRecency(staleObservedAt, DAY)).toBe('STALE');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // -------------------------------------------------------------------------
  // assessAvailability
  // -------------------------------------------------------------------------

  describe('assessAvailability', () => {
    it('returns UNAVAILABLE for null', () => {
      expect(service.assessAvailability(null)).toBe('UNAVAILABLE');
    });

    it('returns UNAVAILABLE for undefined', () => {
      expect(service.assessAvailability(undefined)).toBe('UNAVAILABLE');
    });

    it('returns ESTIMATED for a number', () => {
      expect(service.assessAvailability(42)).toBe('ESTIMATED');
    });

    it('returns ESTIMATED for an object', () => {
      expect(service.assessAvailability({ price: 100 })).toBe('ESTIMATED');
    });

    it('returns ESTIMATED for an array', () => {
      expect(service.assessAvailability([])).toBe('ESTIMATED');
    });

    it('returns ESTIMATED for an empty string', () => {
      expect(service.assessAvailability('')).toBe('ESTIMATED');
    });

    it('returns ESTIMATED for false boolean', () => {
      expect(service.assessAvailability(false)).toBe('ESTIMATED');
    });

    it('returns ESTIMATED for zero', () => {
      expect(service.assessAvailability(0)).toBe('ESTIMATED');
    });
  });

  // -------------------------------------------------------------------------
  // stalenessThresholdFor
  // -------------------------------------------------------------------------

  describe('stalenessThresholdFor', () => {
    it('returns 24h for price domain by default', () => {
      const threshold = service.stalenessThresholdFor('price');
      expect(threshold.milliseconds).toBe(24 * HOUR.milliseconds);
    });

    it('returns 7d for transport domain by default', () => {
      const threshold = service.stalenessThresholdFor('transport');
      expect(threshold.milliseconds).toBe(7 * DAY.milliseconds);
    });

    it('returns 30d for classification domain by default', () => {
      const threshold = service.stalenessThresholdFor('classification');
      expect(threshold.milliseconds).toBe(30 * DAY.milliseconds);
    });

    it('respects overrides for a specific domain', () => {
      const threshold = service.stalenessThresholdFor('price', {
        price: { milliseconds: 6 * HOUR.milliseconds },
      });
      expect(threshold.milliseconds).toBe(6 * HOUR.milliseconds);
    });

    it('falls back to default when override does not match domain', () => {
      const threshold = service.stalenessThresholdFor('price', {
        transport: { milliseconds: 1 * HOUR.milliseconds },
      });
      expect(threshold.milliseconds).toBe(24 * HOUR.milliseconds);
    });

    it('returns the default when overrides is undefined', () => {
      const threshold = service.stalenessThresholdFor('classification');
      expect(threshold.milliseconds).toBe(30 * DAY.milliseconds);
    });
  });
});