/**
 * FeatureFlagService tests — verifies the flag lifecycle used by gated
 * rollouts, including the `HISTORICAL_PRICE_INTELLIGENCE` flag
 * (spec slug: `enable_historical_price_intelligence`).
 *
 * Verifies:
 *   1. Every flag defaults to OFF (safe default), including new flags.
 *   2. Flags enable via `FF_<FLAG>=true|1` and ignore invalid values.
 *   3. Numeric values act as rollout percentages (bucketed by entity).
 *   4. FeatureFlagGuard blocks a gated route when the flag is off and
 *      allows it when on.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlagService } from '../feature-flags/feature-flag.service';
import { FeatureFlag } from '../feature-flags/feature-flag.types';
import {
  FeatureFlagGuard,
  FEATURE_FLAG_KEY,
} from '../feature-flags/feature-flags.guard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All `FF_*` env vars derived from the enum — cleared between tests. */
function ffEnvVars(): string[] {
  return [
    ...Object.values(FeatureFlag).map((f) => `FF_${f}`),
    ...Object.values(FeatureFlag).map((f) => `FF_ROLLOUT_${f}`),
  ];
}

/** Create a mock Reflector that returns a fixed flag. */
function mockReflector(flag: FeatureFlag | null): Reflector {
  return {
    getAllAndOverride: (key: string) => {
      if (key === FEATURE_FLAG_KEY) return flag;
      return undefined;
    },
    get: () => undefined,
  } as unknown as Reflector;
}

/** Minimal ExecutionContext with getHandler / getClass stubs. */
function mockContext(): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({}),
    }),
    getArgs: () => [],
    getType: () => 'http',
  } as ExecutionContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FeatureFlagService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const varName of ffEnvVars()) {
      delete process.env[varName];
    }
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('default state (all flags OFF)', () => {
    it('should have every declared flag disabled by default', () => {
      const service = new FeatureFlagService();

      for (const flag of Object.values(FeatureFlag)) {
        expect(service.isEnabled(flag)).toBe(false);
      }
    });

    it('should keep HISTORICAL_PRICE_INTELLIGENCE off by default', () => {
      const service = new FeatureFlagService();

      expect(
        service.isEnabled(FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE),
      ).toBe(false);
    });
  });

  describe('HISTORICAL_PRICE_INTELLIGENCE env overrides', () => {
    it('should enable via FF_HISTORICAL_PRICE_INTELLIGENCE=true', () => {
      process.env.FF_HISTORICAL_PRICE_INTELLIGENCE = 'true';
      const service = new FeatureFlagService();

      expect(
        service.isEnabled(FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE),
      ).toBe(true);
    });

    it('should enable via FF_HISTORICAL_PRICE_INTELLIGENCE=1', () => {
      process.env.FF_HISTORICAL_PRICE_INTELLIGENCE = '1';
      const service = new FeatureFlagService();

      expect(
        service.isEnabled(FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE),
      ).toBe(true);
    });

    it('should disable via explicit false', () => {
      process.env.FF_HISTORICAL_PRICE_INTELLIGENCE = 'false';
      const service = new FeatureFlagService();

      expect(
        service.isEnabled(FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE),
      ).toBe(false);
    });

    it('should treat non-boolean, non-numeric values as false', () => {
      process.env.FF_HISTORICAL_PRICE_INTELLIGENCE = 'yes';
      const service = new FeatureFlagService();

      expect(
        service.isEnabled(FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE),
      ).toBe(false);
    });

    it('should not leak into other flags', () => {
      process.env.FF_HISTORICAL_PRICE_INTELLIGENCE = 'true';
      const service = new FeatureFlagService();

      expect(service.isEnabled(FeatureFlag.NEW_MERCHANT_SOURCE)).toBe(false);
      expect(service.isEnabled(FeatureFlag.NEW_TAX_RULESET)).toBe(false);
      expect(service.isEnabled(FeatureFlag.UI_RANKING_V2)).toBe(false);
    });
  });

  describe('gradual rollout (isEnabledForEntity)', () => {
    it('should return false for any entity when the flag is off', () => {
      const service = new FeatureFlagService();

      expect(
        service.isEnabledForEntity(
          FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE,
          'user-1',
        ),
      ).toBe(false);
    });

    it('should return true for every entity at 100 % rollout', () => {
      process.env.FF_HISTORICAL_PRICE_INTELLIGENCE = '100';
      const service = new FeatureFlagService();

      for (let i = 0; i < 50; i++) {
        expect(
          service.isEnabledForEntity(
            FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE,
            `user-${i}`,
          ),
        ).toBe(true);
      }
    });

    it('should return false for every entity at 0 % rollout', () => {
      process.env.FF_HISTORICAL_PRICE_INTELLIGENCE = '0';
      const service = new FeatureFlagService();

      expect(
        service.isEnabledForEntity(
          FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE,
          'user-1',
        ),
      ).toBe(false);
    });

    it('should bucket entities deterministically under partial rollout', () => {
      process.env.FF_HISTORICAL_PRICE_INTELLIGENCE = 'true';
      process.env.FF_ROLLOUT_HISTORICAL_PRICE_INTELLIGENCE = '50';
      const service = new FeatureFlagService();

      const first = service.isEnabledForEntity(
        FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE,
        'user-42',
      );
      const second = service.isEnabledForEntity(
        FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE,
        'user-42',
      );

      expect(first).toBe(second);
    });
  });
});

describe('FeatureFlagGuard (regression)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.FF_HISTORICAL_PRICE_INTELLIGENCE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws ForbiddenException when HISTORICAL_PRICE_INTELLIGENCE is off (default)', () => {
    const reflector = mockReflector(FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE);
    const guard = new FeatureFlagGuard(reflector, new FeatureFlagService());

    expect(() => guard.canActivate(mockContext())).toThrow(ForbiddenException);
  });

  it('allows access when the flag is enabled via env', () => {
    process.env.FF_HISTORICAL_PRICE_INTELLIGENCE = 'true';
    const reflector = mockReflector(FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE);
    const guard = new FeatureFlagGuard(reflector, new FeatureFlagService());

    expect(guard.canActivate(mockContext())).toBe(true);
  });

  it('allows access when no flag metadata is set', () => {
    const reflector = mockReflector(null);
    const guard = new FeatureFlagGuard(reflector, new FeatureFlagService());

    expect(guard.canActivate(mockContext())).toBe(true);
  });
});
