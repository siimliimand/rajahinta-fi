/**
 * EntitlementGuard tests — feature-access tier enforcement.
 *
 * Covers:
 * - Pass when sufficient tier
 * - 403 when insufficient tier
 * - Pass when no feature requirement
 *
 * @module EntitlementGuardTest
 */

import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EntitlementGuard, RequireFeature, REQUIRE_FEATURE_KEY } from '../entitlement.guard';
import { EntitlementService } from '@rajahinta/core-domain';
import type { Entitlement, FeatureId } from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a Reflector that returns the given feature (or null). */
function mockReflector(feature: FeatureId | null | undefined): Reflector {
  return {
    getAllAndOverride: vi.fn().mockReturnValue(feature),
  } as unknown as Reflector;
}

/** Create an EntitlementService with a canned checkAccess result. */
function mockEntitlementService(result: Entitlement): EntitlementService {
  return {
    checkAccess: vi.fn().mockReturnValue(result),
  } as unknown as EntitlementService;
}

/** Create an ExecutionContext with an optional user on the request. */
function mockContext(user?: { id: string }): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: user ?? null }),
    }),
    getArgs: () => [],
    getType: () => 'http',
  } as ExecutionContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EntitlementGuard', () => {
  // -----------------------------------------------------------------------
  // No feature requirement — always pass
  // -----------------------------------------------------------------------

  describe('when no feature is required', () => {
    it('returns true when reflector returns undefined', () => {
      const guard = new EntitlementGuard(
        mockReflector(undefined),
        mockEntitlementService({ allowed: true, tier: 'FREE' }),
      );
      const ctx = mockContext();
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('returns true when reflector returns null', () => {
      const guard = new EntitlementGuard(
        mockReflector(null),
        mockEntitlementService({ allowed: true, tier: 'FREE' }),
      );
      const ctx = mockContext();
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('does not call EntitlementService.checkAccess when no feature is set', () => {
      const service = mockEntitlementService({ allowed: true, tier: 'FREE' });
      const guard = new EntitlementGuard(mockReflector(undefined), service);
      const ctx = mockContext();
      guard.canActivate(ctx);
      expect(service.checkAccess).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Sufficient tier — pass
  // -----------------------------------------------------------------------

  describe('when user has sufficient tier', () => {
    it('returns true for FREE-tier feature with anonymous user', () => {
      const guard = new EntitlementGuard(
        mockReflector('product:browse'),
        mockEntitlementService({ allowed: true, tier: 'FREE' }),
      );
      const ctx = mockContext();
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('returns true for PREMIUM-tier feature with authenticated user', () => {
      const guard = new EntitlementGuard(
        mockReflector('calculation:detail'),
        mockEntitlementService({ allowed: true, tier: 'PREMIUM', reason: undefined }),
      );
      const ctx = mockContext({ id: 'user-1' });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('returns true for PROFESSIONAL-tier feature with professional user', () => {
      const guard = new EntitlementGuard(
        mockReflector('api:batch'),
        mockEntitlementService({ allowed: true, tier: 'PROFESSIONAL', reason: undefined }),
      );
      const ctx = mockContext({ id: 'user-pro' });
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Insufficient tier — 403
  // -----------------------------------------------------------------------

  describe('when user has insufficient tier', () => {
    it('throws ForbiddenException for PREMIUM feature with anonymous (FREE) user', () => {
      const guard = new EntitlementGuard(
        mockReflector('declaration:summary'),
        mockEntitlementService({
          allowed: false,
          tier: 'FREE',
          reason: 'Feature "declaration:summary" requires PREMIUM tier. Sign in or upgrade.',
        }),
      );
      const ctx = mockContext();
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException for PROFESSIONAL feature with PREMIUM user', () => {
      const guard = new EntitlementGuard(
        mockReflector('api:access'),
        mockEntitlementService({
          allowed: false,
          tier: 'PREMIUM',
          reason: 'Feature "api:access" requires PROFESSIONAL tier. Current tier: PREMIUM.',
        }),
      );
      const ctx = mockContext({ id: 'user-premium' });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('includes structured error body with statusCode, reason, currentTier', () => {
      const guard = new EntitlementGuard(
        mockReflector('api:batch'),
        mockEntitlementService({
          allowed: false,
          tier: 'FREE',
          reason: 'Feature "api:batch" requires PROFESSIONAL tier. Sign in or upgrade.',
        }),
      );
      const ctx = mockContext();

      try {
        guard.canActivate(ctx);
        expect.unreachable('Expected ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const fb = err as ForbiddenException;
        const response = fb.getResponse() as Record<string, unknown>;
        expect(response.statusCode).toBe(403);
        expect(response.error).toBe('InsufficientEntitlement');
        expect(response.requiredTier).toBe('api:batch');
        expect(response.currentTier).toBe('FREE');
      }
    });
  });

  // -----------------------------------------------------------------------
  // Request structure variations
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles request.user being undefined (no auth middleware)', () => {
      const guard = new EntitlementGuard(
        mockReflector('product:browse'),
        mockEntitlementService({ allowed: true, tier: 'FREE' }),
      );
      const ctx = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({}),
        }),
        getArgs: () => [],
        getType: () => 'http',
      } as ExecutionContext;
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // RequireFeature decorator is a simple SetMetadata wrapper
  // -----------------------------------------------------------------------

  describe('RequireFeature decorator', () => {
    it('exports the metadata key constant', () => {
      expect(REQUIRE_FEATURE_KEY).toBe('require_feature');
    });

    it('RequireFeature is a function that returns a decorator', () => {
      const decorator = RequireFeature('declaration:summary');
      expect(typeof decorator).toBe('function');
    });
  });
});