/**
 * Regression test: ReportsController guard stack (task 6.2, change
 * phase2-advanced-features).
 *
 * Mirrors historical-guard-regression.test.ts — verifies at the metadata +
 * guard-unit level that the report export endpoint is protected by its
 * documented stack, with REAL guard dependencies (FeatureFlagService,
 * EntitlementService, AgeGateService, InMemoryRateLimiter) and no vi.fn():
 *
 *   1. Class-level @UseGuards(RateLimitGuard, FeatureFlagGuard, AgeGateGuard)
 *      + method-level @UseGuards(EntitlementGuard) metadata.
 *   2. The route is rate-limited with the DECLARATION profile (20 req/min).
 *   3. The route is gated by the ADVANCED_FEATURES feature flag — 403 while
 *      off (the default), allowed once FF_ADVANCED_FEATURES is set.
 *   4. EntitlementGuard @RequireFeature('calculation:export') — PREMIUM
 *      allowed; FREE tier and anonymous requests get a 403 with the
 *      InsufficientEntitlement body. FREE is forced through the real
 *      EntitlementService env override (ENTITLEMENT_TIER_<USER>), matching
 *      how a FREE account row resolves.
 *   5. AgeGateGuard rejects without a confirmation token.
 *   6. Exhausting the DECLARATION profile through the REAL in-memory
 *      limiter yields HTTP 429 with a Retry-After header.
 *
 * @module ReportsGuardRegressionTest
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ForbiddenException,
  HttpException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EntitlementService } from '@rajahinta/core-domain';
import { ReportsController } from '../reports.controller';
import {
  FeatureFlagGuard,
  FeatureFlag,
  FEATURE_FLAG_KEY,
} from '../../feature-flags';
import { FeatureFlagService } from '../../feature-flags/feature-flag.service';
import {
  EntitlementGuard,
  REQUIRE_FEATURE_KEY,
} from '../../entitlement';
import { AgeGateGuard } from '../../age-gate/age-gate.guard';
import { AgeGateService } from '../../age-gate/age-gate.service';
import { SimpleConfirmationProvider } from '../../age-gate/simple-confirmation.provider';
import {
  RateLimitGuard,
  RATE_LIMIT_KEY,
} from '../../rate-limiting/rate-limit.guard';
import {
  RateLimitingService,
  InMemoryRateLimiter,
  RATE_LIMIT_PROFILES,
} from '../../rate-limiting/rate-limiting.service';

/** NestJS internal metadata key for guards applied via @UseGuards. */
const GUARDS_METADATA = '__guards__';

/** Handler under test — the single route of ReportsController. */
const HANDLER = ReportsController.prototype.getReport;

/**
 * Build an ExecutionContext pointing at the report handler.
 * @param request  Request shape the guards read (headers, ip, user).
 * @param response Response double capturing header() calls.
 */
function context(
  request: Record<string, unknown> = {},
  response?: { header: (name: string, value: string) => void },
): ExecutionContext {
  return {
    getHandler: () => HANDLER,
    getClass: () => ReportsController,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response ?? { header: () => undefined },
    }),
    getArgs: () => [],
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

describe('ReportsController — guard regression', () => {
  const reflector = new Reflector();

  describe('guard + gate metadata', () => {
    it('carries class-level RateLimitGuard, FeatureFlagGuard, AgeGateGuard', () => {
      // getAllAndOverride would return the method-level list (override
      // semantics), so read the class metadata directly.
      const guards = Reflect.getMetadata(GUARDS_METADATA, ReportsController) as unknown[];

      expect(guards).toBeDefined();
      expect(guards).toHaveLength(3);
      expect(guards).toContain(RateLimitGuard);
      expect(guards).toContain(FeatureFlagGuard);
      expect(guards).toContain(AgeGateGuard);
    });

    it('carries method-level EntitlementGuard on getReport', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, HANDLER) as unknown[];
      expect(guards).toBeDefined();
      expect(guards).toContain(EntitlementGuard);
    });

    it('carries @RateLimit(DECLARATION) metadata on the handler', () => {
      const profile = reflector.getAllAndOverride<string>(RATE_LIMIT_KEY, [
        HANDLER,
        ReportsController,
      ]);
      expect(profile).toBe('DECLARATION');
    });

    it('the DECLARATION profile is 20 requests per minute', () => {
      expect(RATE_LIMIT_PROFILES.DECLARATION).toEqual({
        limit: 20,
        windowMs: 60_000,
      });
    });

    it('is gated by the ADVANCED_FEATURES feature flag', () => {
      const flag = reflector.getAllAndOverride<FeatureFlag>(FEATURE_FLAG_KEY, [
        HANDLER,
        ReportsController,
      ]);
      expect(flag).toBe(FeatureFlag.ADVANCED_FEATURES);
    });

    it('requires the calculation:export entitlement feature', () => {
      const feature = reflector.getAllAndOverride<string>(
        REQUIRE_FEATURE_KEY,
        [HANDLER, ReportsController],
      );
      expect(feature).toBe('calculation:export');
    });
  });

  describe('FeatureFlagGuard — flag-off 403 / flag-on allow', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.FF_ADVANCED_FEATURES;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('throws ForbiddenException while the flag is off (default)', () => {
      const guard = new FeatureFlagGuard(reflector, new FeatureFlagService());
      expect(() => guard.canActivate(context())).toThrow(ForbiddenException);
    });

    it('the rejection names the ADVANCED_FEATURES flag', () => {
      const guard = new FeatureFlagGuard(reflector, new FeatureFlagService());
      try {
        guard.canActivate(context());
        expect.unreachable('Expected ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        expect((err as ForbiddenException).message).toMatch(/ADVANCED_FEATURES/);
      }
    });

    it('allows once FF_ADVANCED_FEATURES=true', () => {
      process.env.FF_ADVANCED_FEATURES = 'true';
      const guard = new FeatureFlagGuard(reflector, new FeatureFlagService());
      expect(guard.canActivate(context())).toBe(true);
    });
  });

  describe('EntitlementGuard — calculation:export tier enforcement', () => {
    const originalEnv = process.env;
    const PREMIUM_USER = 'reports-premium-user';
    const FREE_USER = 'reports-free-user';

    beforeEach(() => {
      process.env = { ...originalEnv };
      // Force the FREE account-row behaviour through the documented env
      // override read by the real EntitlementService at request time.
      process.env[`ENTITLEMENT_TIER_${FREE_USER.toUpperCase()}`] = 'FREE';
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    function guard(): EntitlementGuard {
      return new EntitlementGuard(reflector, new EntitlementService());
    }

    it('allows an authenticated user (default PREMIUM)', () => {
      expect(
        guard().canActivate(context({ user: { id: PREMIUM_USER } })),
      ).toBe(true);
    });

    it('rejects a FREE-tier user with the InsufficientEntitlement body', () => {
      try {
        guard().canActivate(context({ user: { id: FREE_USER } }));
        expect.unreachable('Expected ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        expect((err as ForbiddenException).getResponse()).toMatchObject({
          statusCode: 403,
          error: 'InsufficientEntitlement',
          requiredTier: 'calculation:export',
          currentTier: 'FREE',
        });
        const message = ((err as ForbiddenException).getResponse() as {
          message: string;
        }).message;
        expect(message).toContain('calculation:export');
      }
    });

    it('rejects anonymous requests (no request.user) as FREE', () => {
      try {
        guard().canActivate(context({ user: undefined }));
        expect.unreachable('Expected ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        expect((err as ForbiddenException).getResponse()).toMatchObject({
          statusCode: 403,
          currentTier: 'FREE',
        });
      }
    });
  });

  describe('AgeGateGuard — confirmation required', () => {
    const guard = new AgeGateGuard(
      new AgeGateService(new SimpleConfirmationProvider()),
    );

    it('throws ForbiddenException without a token', async () => {
      await expect(guard.canActivate(context({ headers: {} }))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('accepts a non-empty x-age-confirmed header', async () => {
      await expect(
        guard.canActivate(context({ headers: { 'x-age-confirmed': 'token' } })),
      ).resolves.toBe(true);
    });
  });

  describe('RateLimitGuard — DECLARATION profile exhaustion yields 429', () => {
    it('allows the first 20 requests and rejects the 21st with Retry-After', async () => {
      const limiter = new InMemoryRateLimiter();
      const guard = new RateLimitGuard(
        reflector,
        new RateLimitingService(limiter),
      );
      const retryAfterValues: string[] = [];
      const response = {
        header: (name: string, value: string) => {
          if (name === 'Retry-After') retryAfterValues.push(value);
        },
      };
      const ctx = context({ ip: '203.0.113.7' }, response);

      for (let i = 1; i <= 20; i++) {
        await expect(guard.canActivate(ctx), `request ${i} must pass`).resolves.toBe(true);
      }

      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        status: 429,
        response: { statusCode: 429, error: 'TooManyRequests' },
      });

      // Retry-After was set on the response, in seconds.
      expect(retryAfterValues).toHaveLength(1);
      expect(Number(retryAfterValues[0])).toBeGreaterThan(0);
    });

    it('the limit is per client key — a different IP is unaffected', async () => {
      const guard = new RateLimitGuard(
        reflector,
        new RateLimitingService(new InMemoryRateLimiter()),
      );

      for (let i = 0; i < 20; i++) {
        await expect(guard.canActivate(context({ ip: '198.51.100.1' }))).resolves.toBe(true);
      }
      await expect(guard.canActivate(context({ ip: '198.51.100.1' }))).rejects.toThrow(
        HttpException,
      );

      // Fresh key — still allowed.
      await expect(guard.canActivate(context({ ip: '198.51.100.2' }))).resolves.toBe(true);
    });
  });
});
