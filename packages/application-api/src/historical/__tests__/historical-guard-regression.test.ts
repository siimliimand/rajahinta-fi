/**
 * Regression test: HistoricalDataController guard application.
 *
 * Mirrors calculator-guard-regression.test.ts — verifies at the metadata +
 * guard-unit level that the price-history endpoint is protected:
 *
 *   1. Class-level @UseGuards(RateLimitGuard, FeatureFlagGuard, AgeGateGuard)
 *      metadata is inherited by the getPriceHistory handler.
 *   2. The route is rate-limited with the HISTORICAL profile.
 *   3. The route is gated by the HISTORICAL_PRICE_INTELLIGENCE feature flag
 *      (spec slug enable_historical_price_intelligence).
 *   4. FeatureFlagGuard rejects (403) while the flag is disabled — the
 *      default — and allows once FF_HISTORICAL_PRICE_INTELLIGENCE is set.
 *
 * @module HistoricalGuardRegressionTest
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HistoricalDataController } from '../historical.controller';
import {
  FeatureFlagGuard,
  FeatureFlagDec,
  FeatureFlag,
  FEATURE_FLAG_KEY,
} from '../../feature-flags';
import { FeatureFlagService } from '../../feature-flags/feature-flag.service';
import {
  RateLimitGuard,
  RateLimit,
  RATE_LIMIT_KEY,
} from '../../rate-limiting/rate-limit.guard';
import { RATE_LIMIT_PROFILES } from '../../rate-limiting/rate-limiting.service';
import { AgeGateGuard } from '../../age-gate/age-gate.guard';

/** NestJS internal metadata key for guards applied via @UseGuards. */
const GUARDS_METADATA = '__guards__';

/** Constructor reference for a NestJS guard — compared, never instantiated. */
type GuardConstructor = abstract new (...args: never[]) => unknown;

/**
 * Build an ExecutionContext pointing at a controller method.
 * @param handler The controller method — stored for metadata reflection only.
 */
function contextForMethod<F>(handler: F, controller: object): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({ headers: {}, cookies: {} }),
      getResponse: () => ({ header: () => undefined }),
    }),
    getArgs: () => [],
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

describe('HistoricalDataController — guard regression', () => {
  const reflector = new Reflector();

  describe('guard + gate metadata', () => {
    it('inherits class-level @UseGuards metadata for getPriceHistory', () => {
      const guards = reflector.getAllAndOverride<GuardConstructor[]>(
        GUARDS_METADATA,
        [
          HistoricalDataController.prototype.getPriceHistory,
          HistoricalDataController,
        ],
      );

      expect(guards).toBeDefined();
      expect(guards).toHaveLength(3);
      expect(guards).toContain(RateLimitGuard);
      expect(guards).toContain(FeatureFlagGuard);
      expect(guards).toContain(AgeGateGuard);
    });

    it('carries @RateLimit(HISTORICAL) metadata on the handler', () => {
      const profile = reflector.getAllAndOverride<string>(RATE_LIMIT_KEY, [
        HistoricalDataController.prototype.getPriceHistory,
        HistoricalDataController,
      ]);

      expect(profile).toBe('HISTORICAL');
    });

    it('HISTORICAL rate-limit profile exists', () => {
      expect(RATE_LIMIT_PROFILES.HISTORICAL).toBeDefined();
      expect(RATE_LIMIT_PROFILES.HISTORICAL.limit).toBeGreaterThan(0);
    });

    it('is gated by the HISTORICAL_PRICE_INTELLIGENCE feature flag', () => {
      const flag = reflector.getAllAndOverride<FeatureFlag>(FEATURE_FLAG_KEY, [
        HistoricalDataController.prototype.getPriceHistory,
        HistoricalDataController,
      ]);

      expect(flag).toBe(FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE);
    });

    it('the HISTORICAL_PRICE_INTELLIGENCE flag defaults to disabled', () => {
      expect(new FeatureFlagService().isEnabled(FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE)).toBe(false);
    });
  });

  describe('FeatureFlagGuard blocks the endpoint while the flag is off', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.FF_HISTORICAL_PRICE_INTELLIGENCE;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('throws ForbiddenException when the flag is disabled (default)', () => {
      const guard = new FeatureFlagGuard(reflector, new FeatureFlagService());
      const context = contextForMethod(
        HistoricalDataController.prototype.getPriceHistory,
        HistoricalDataController,
      );

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException naming the flag', () => {
      const guard = new FeatureFlagGuard(reflector, new FeatureFlagService());
      const context = contextForMethod(
        HistoricalDataController.prototype.getPriceHistory,
        HistoricalDataController,
      );

      try {
        guard.canActivate(context);
        expect.unreachable('Expected ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        expect((err as ForbiddenException).message).toMatch(
          /HISTORICAL_PRICE_INTELLIGENCE/,
        );
      }
    });

    it('allows access when FF_HISTORICAL_PRICE_INTELLIGENCE=true', () => {
      process.env.FF_HISTORICAL_PRICE_INTELLIGENCE = 'true';
      const guard = new FeatureFlagGuard(reflector, new FeatureFlagService());
      const context = contextForMethod(
        HistoricalDataController.prototype.getPriceHistory,
        HistoricalDataController,
      );

      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('FeatureFlagDec decorator sets retrievable metadata', () => {
    it('produces the metadata the guard reads (contract smoke check)', () => {
      class Probe {
        @FeatureFlagDec(FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE)
        @RateLimit('HISTORICAL')
        handler(): void {
          /* metadata only */
        }
      }

      expect(
        reflector.getAllAndOverride<FeatureFlag>(FEATURE_FLAG_KEY, [
          Probe.prototype.handler,
          Probe,
        ]),
      ).toBe(FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE);
      expect(
        reflector.getAllAndOverride<string>(RATE_LIMIT_KEY, [
          Probe.prototype.handler,
          Probe,
        ]),
      ).toBe('HISTORICAL');
    });
  });
});
