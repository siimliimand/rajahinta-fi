/**
 * Regression test: ReportsController guard stack (task 6.2, change
 * phase2-advanced-features).
 *
 * Mirrors historical-guard-regression.test.ts — verifies at the metadata +
 * guard-unit level that the report export endpoint is protected by its
 * documented stack, with REAL guard dependencies (EntitlementService,
 * AgeGateService, InMemoryRateLimiter) and no vi.fn():
 *
 *   1. Class-level @UseGuards(RateLimitGuard, AgeGateGuard)
 *      + method-level @UseGuards(EntitlementGuard) metadata.
 *   2. The route is rate-limited with the DECLARATION profile (20 req/min).
 *   3. EntitlementGuard @RequireFeature('calculation:export') — the feature
 *      is FREE-tier, so authenticated (default-PREMIUM), FREE-tier, and
 *      anonymous requests all pass. Entitlement denial mechanics are
 *      covered in entitlement.guard.test.ts with a PREMIUM-required mock.
 *   4. AgeGateGuard rejects without a confirmation token.
 *   5. Exhausting the DECLARATION profile through the REAL in-memory
 *      limiter yields HTTP 429 with a Retry-After header.
 *
 * @module ReportsGuardRegressionTest
 */

import { describe, it, expect } from 'vitest';
import {
  ForbiddenException,
  HttpException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EntitlementService } from '@rajahinta/core-domain';
import { ReportsController } from '../reports.controller';
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
    it('carries class-level RateLimitGuard and AgeGateGuard', () => {
      // getAllAndOverride would return the method-level list (override
      // semantics), so read the class metadata directly.
      const guards = Reflect.getMetadata(GUARDS_METADATA, ReportsController) as unknown[];

      expect(guards).toBeDefined();
      expect(guards).toHaveLength(2);
      expect(guards).toContain(RateLimitGuard);
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

    it('requires the calculation:export entitlement feature', () => {
      const feature = reflector.getAllAndOverride<string>(
        REQUIRE_FEATURE_KEY,
        [HANDLER, ReportsController],
      );
      expect(feature).toBe('calculation:export');
    });
  });

  describe('EntitlementGuard — calculation:export tier enforcement', () => {
    const PREMIUM_USER = 'reports-premium-user';
    const FREE_USER = 'reports-free-user';

    function guard(): EntitlementGuard {
      return new EntitlementGuard(reflector, new EntitlementService());
    }

    it('allows an authenticated user (default PREMIUM)', () => {
      expect(
        guard().canActivate(context({ user: { id: PREMIUM_USER } })),
      ).toBe(true);
    });

    it('allows a FREE-tier user — calculation:export is a FREE feature', () => {
      // Tier from the account context (accounts.tier), the way the session
      // auth guard attaches it. FREE suffices for a FREE-tier feature.
      expect(
        guard().canActivate(
          context({ user: { id: FREE_USER, userId: FREE_USER, tier: 'FREE' } }),
        ),
      ).toBe(true);
    });

    it('allows anonymous requests (no request.user) — FREE suffices for a FREE feature', () => {
      expect(guard().canActivate(context({ user: undefined }))).toBe(true);
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
