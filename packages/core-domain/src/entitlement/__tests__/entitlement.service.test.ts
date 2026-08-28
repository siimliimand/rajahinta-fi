/**
 * Tests for Entitlement types, tier checking, and service.
 *
 * High-liability: tier-to-feature mapping and access control logic
 * must be correct to prevent unauthorized access to premium features.
 *
 * Covers the account-record tier resolution (technical-assessment
 * finding 14): tier comes from AccountContext (mirroring accounts.tier),
 * the env override is global and test-only, and per-user env overrides
 * no longer exist.
 *
 * @module EntitlementServiceTest
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isTierSufficient,
  isTierTransitionWellFormed,
  FEATURE_TIER_MAP,
  type AccountContext,
  type TierTransition,
} from '../entitlement.types';
import { EntitlementService } from '../entitlement.service';

// ---------------------------------------------------------------------------
// Env hygiene — the service reads process.env, so every test runs against a
// controlled snapshot and restores it afterwards.
// ---------------------------------------------------------------------------

const ENV_KEYS = ['ENTITLEMENT_DEFAULT_TIER', 'ENTITLEMENT_TIER_USER-123', 'NODE_ENV'] as const;
const savedEnv = new Map<string, string | undefined>();

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

beforeEach(() => {
  savedEnv.clear();
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    setEnv(key, undefined);
  }
});

afterEach(() => {
  for (const [key, value] of savedEnv) {
    setEnv(key, value);
  }
});

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

  describe('anonymous requests (account === null)', () => {
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

  describe('tier from the account record (AccountContext)', () => {
    it('resolves PREMIUM from the account tier', () => {
      const account: AccountContext = { userId: 'user-123', tier: 'PREMIUM' };
      const result = service.checkAccess(account, 'declaration:summary');
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe('PREMIUM');
    });

    it('resolves FREE from the account tier and denies premium features', () => {
      const account: AccountContext = { userId: 'user-123', tier: 'FREE' };
      const result = service.checkAccess(account, 'declaration:summary');
      expect(result.allowed).toBe(false);
      expect(result.tier).toBe('FREE');
      expect(result.reason).toContain('PREMIUM');
    });

    it('resolves PROFESSIONAL from the account tier', () => {
      const account: AccountContext = { userId: 'user-123', tier: 'PROFESSIONAL' };
      const result = service.checkAccess(account, 'api:access');
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe('PROFESSIONAL');
    });

    it('ignores per-user-shaped env variables entirely (spec: never keyed on user identifiers)', () => {
      // The legacy per-user override shape must have NO effect, even though
      // the variable name matches this account's userId.
      process.env['ENTITLEMENT_TIER_USER-123'] = 'PROFESSIONAL';
      const account: AccountContext = { userId: 'user-123', tier: 'FREE' };

      const result = service.checkAccess(account, 'api:access');
      expect(result.tier).toBe('FREE');
      expect(result.allowed).toBe(false);
    });

    it('account tier PREMIUM wins over any per-user env variable (spec scenario)', () => {
      process.env['ENTITLEMENT_TIER_USER-123'] = 'FREE';
      const account: AccountContext = { userId: 'user-123', tier: 'PREMIUM' };

      const result = service.checkAccess(account, 'api:access');
      expect(result.tier).toBe('PREMIUM');
    });
  });

  describe('global test override (ENTITLEMENT_DEFAULT_TIER)', () => {
    it('applies uniformly in non-production environments', () => {
      process.env.NODE_ENV = 'test';
      process.env.ENTITLEMENT_DEFAULT_TIER = 'PROFESSIONAL';

      const free: AccountContext = { userId: 'a', tier: 'FREE' };
      const premium: AccountContext = { userId: 'b', tier: 'PREMIUM' };

      expect(service.checkAccess(free, 'api:access').tier).toBe('PROFESSIONAL');
      expect(service.checkAccess(premium, 'api:access').tier).toBe('PROFESSIONAL');
    });

    it('is ignored in production — the account tier is authoritative', () => {
      process.env.NODE_ENV = 'production';
      process.env.ENTITLEMENT_DEFAULT_TIER = 'PROFESSIONAL';

      const account: AccountContext = { userId: 'user-123', tier: 'FREE' };
      const result = service.checkAccess(account, 'api:access');
      expect(result.tier).toBe('FREE');
      expect(result.allowed).toBe(false);
    });

    it('falls back to the account tier when the override value is invalid', () => {
      process.env.NODE_ENV = 'test';
      process.env.ENTITLEMENT_DEFAULT_TIER = 'not-a-tier';

      const account: AccountContext = { userId: 'user-123', tier: 'FREE' };
      const result = service.checkAccess(account, 'product:browse');
      expect(result.tier).toBe('FREE');
      expect(result.allowed).toBe(true);
    });
  });

  describe('legacy bare-userId callers (account context not yet fetched)', () => {
    it('keeps the Phase 1 PREMIUM default', () => {
      const result = service.checkAccess('user-123', 'declaration:summary');
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe('PREMIUM');
    });

    it('denies PROFESSIONAL features with reason', () => {
      const result = service.checkAccess('user-123', 'api:batch');
      expect(result.allowed).toBe(false);
      expect(result.tier).toBe('PREMIUM');
      expect(result.reason).toContain('PROFESSIONAL');
    });

    it('honors the global test override like account contexts do', () => {
      process.env.NODE_ENV = 'test';
      process.env.ENTITLEMENT_DEFAULT_TIER = 'FREE';

      const result = service.checkAccess('user-123', 'declaration:summary');
      expect(result.allowed).toBe(false);
      expect(result.tier).toBe('FREE');
    });
  });
});

// ---------------------------------------------------------------------------
// Tier-transition groundwork — shape only, no billing logic exists yet
// ---------------------------------------------------------------------------

describe('isTierTransitionWellFormed', () => {
  const base: TierTransition = {
    accountId: 'user-123',
    fromTier: 'FREE',
    toTier: 'PREMIUM',
    effectiveAt: '2026-09-01T00:00:00Z',
    source: 'billing',
  };

  it('accepts a well-formed upgrade', () => {
    expect(isTierTransitionWellFormed(base)).toBe(true);
  });

  it('accepts a well-formed downgrade', () => {
    expect(isTierTransitionWellFormed({ ...base, fromTier: 'PROFESSIONAL', toTier: 'PREMIUM' })).toBe(true);
  });

  it('rejects a no-op transition', () => {
    expect(isTierTransitionWellFormed({ ...base, toTier: 'FREE' })).toBe(false);
  });

  it('rejects unknown tier values', () => {
    expect(
      isTierTransitionWellFormed({ ...base, toTier: 'ENTERPRISE' as never }),
    ).toBe(false);
  });
});
