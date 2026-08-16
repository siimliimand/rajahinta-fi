/**
 * Tests for Entitlement types, tier checking, and service.
 *
 * High-liability: tier-to-feature mapping and access control logic
 * must be correct to prevent unauthorized access to premium features.
 *
 * @module EntitlementServiceTest
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { isTierSufficient, FEATURE_TIER_MAP } from '../entitlement.types';
import { EntitlementService } from '../entitlement.service';

// ---------------------------------------------------------------------------
// isTierSufficient
// ---------------------------------------------------------------------------

describe('isTierSufficient', () => {
  it('FREE is sufficient for FREE features', () => {
    expect(isTierSufficient('FREE', 'FREE')).toBe(true);
  });

  it('FREE is NOT sufficient for PREMIUM features', () => {
    expect(isTierSufficient('FREE', 'PREMIUM')).toBe(false);
  });

  it('FREE is NOT sufficient for PROFESSIONAL features', () => {
    expect(isTierSufficient('FREE', 'PROFESSIONAL')).toBe(false);
  });

  it('PREMIUM is sufficient for FREE features', () => {
    expect(isTierSufficient('PREMIUM', 'FREE')).toBe(true);
  });

  it('PREMIUM is sufficient for PREMIUM features', () => {
    expect(isTierSufficient('PREMIUM', 'PREMIUM')).toBe(true);
  });

  it('PREMIUM is NOT sufficient for PROFESSIONAL features', () => {
    expect(isTierSufficient('PREMIUM', 'PROFESSIONAL')).toBe(false);
  });

  it('PROFESSIONAL is sufficient for all tiers', () => {
    expect(isTierSufficient('PROFESSIONAL', 'FREE')).toBe(true);
    expect(isTierSufficient('PROFESSIONAL', 'PREMIUM')).toBe(true);
    expect(isTierSufficient('PROFESSIONAL', 'PROFESSIONAL')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FEATURE_TIER_MAP — every feature maps to a valid tier
// ---------------------------------------------------------------------------

describe('FEATURE_TIER_MAP', () => {
  it('all features map to a known tier', () => {
    const validTiers = new Set(['FREE', 'PREMIUM', 'PROFESSIONAL']);
    for (const [_feature, tier] of Object.entries(FEATURE_TIER_MAP)) {
      expect(validTiers.has(tier)).toBe(true);
    }
  });

  it('product:browse maps to FREE', () => {
    expect(FEATURE_TIER_MAP['product:browse']).toBe('FREE');
  });

  it('calculation:basic maps to FREE', () => {
    expect(FEATURE_TIER_MAP['calculation:basic']).toBe('FREE');
  });

  it('declaration:summary maps to PREMIUM', () => {
    expect(FEATURE_TIER_MAP['declaration:summary']).toBe('PREMIUM');
  });

  it('api:access maps to PROFESSIONAL', () => {
    expect(FEATURE_TIER_MAP['api:access']).toBe('PROFESSIONAL');
  });

  it('api:batch maps to PROFESSIONAL', () => {
    expect(FEATURE_TIER_MAP['api:batch']).toBe('PROFESSIONAL');
  });
});

// ---------------------------------------------------------------------------
// EntitlementService
// ---------------------------------------------------------------------------

describe('EntitlementService', () => {
  let service: EntitlementService;

  beforeEach(() => {
    service = new EntitlementService();
  });

  describe('anonymous users (userId === null)', () => {
    it('allows FREE-tier features', () => {
      const result = service.checkAccess(null, 'product:browse');
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe('FREE');
    });

    it('allows calculation:basic', () => {
      const result = service.checkAccess(null, 'calculation:basic');
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe('FREE');
    });

    it('denies PREMIUM features with a reason', () => {
      const result = service.checkAccess(null, 'declaration:summary');
      expect(result.allowed).toBe(false);
      expect(result.tier).toBe('FREE');
      expect(result.reason).toContain('PREMIUM');
    });

    it('denies PROFESSIONAL features', () => {
      const result = service.checkAccess(null, 'api:access');
      expect(result.allowed).toBe(false);
      expect(result.tier).toBe('FREE');
      expect(result.reason).toContain('PROFESSIONAL');
    });
  });

  describe('authenticated users', () => {
    it('defaults to PREMIUM tier', () => {
      // No env override — Phase 1 default
      const result = service.checkAccess('user-123', 'declaration:summary');
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe('PREMIUM');
    });

    it('allows FREE-tier features', () => {
      const result = service.checkAccess('user-123', 'product:browse');
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe('PREMIUM');
    });

    it('allows PREMIUM-tier features', () => {
      const result = service.checkAccess('user-123', 'calculation:detail');
      expect(result.allowed).toBe(true);
    });

    it('allows calculation:export', () => {
      const result = service.checkAccess('user-123', 'calculation:export');
      expect(result.allowed).toBe(true);
    });

    it('allows calculation:history', () => {
      const result = service.checkAccess('user-123', 'calculation:history');
      expect(result.allowed).toBe(true);
    });

    it('denies PROFESSIONAL features with reason', () => {
      const result = service.checkAccess('user-123', 'api:batch');
      expect(result.allowed).toBe(false);
      expect(result.tier).toBe('PREMIUM');
      expect(result.reason).toContain('PROFESSIONAL');
    });
  });
});