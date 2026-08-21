/**
 * DeclarationController tests.
 *
 * Covers:
 *   - Delegation to ExciseDeclarationService (happy path)
 *   - Error handling (CalculationRecordNotFoundError → 404, unknown errors → 500)
 *   - EntitlementGuard enforcement (feature check, tier denial)
 *
 * Follows the project pattern — direct instantiation with manual mocks
 * (no @nestjs/testing).
 *
 * @module DeclarationControllerTest
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  NotFoundException,
  InternalServerErrorException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ExciseDeclarationService,
  DeclarationSummary,
  CalculationRecordNotFoundError,
  EntitlementService,
} from '@rajahinta/core-domain';
import { DeclarationController } from '../declaration.controller';
import {
  EntitlementGuard,
  REQUIRE_FEATURE_KEY,
} from '../../entitlement';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_SUMMARY: DeclarationSummary = {
  product: {
    name: 'Koff III',
    brand: 'Sinebrychoff',
    category: 'beer',
    abv: 4.7,
    volumeLitres: 0.33,
  },
  units: 6,
  container: {
    type: 'bottle',
    volumeLitres: 0.33,
    depositSystemStatus: false,
  },
  transport: {
    carrier: 'Posti',
    origin: 'DE',
    destination: 'FI',
  },
  estimatedExcise: {
    alcoholExciseCents: 1550,
    containerDutyCents: 0,
    totalCents: 1550,
    confidence: 'HIGH',
  },
  advanceNoticeInfo: {
    required: false,
  },
  myTaxLink: 'https://www.vero.fi/asioi-verkossa/mytax/',
  declarationDate: '2026-08-21T10:00:00.000Z',
  disclaimer: {
    text: 'This is an estimate.',
    language: 'en',
    version: '1.0.0',
  },
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockDeclarationService(): ExciseDeclarationService {
  return {
    prepareDeclaration: vi.fn(
      async (recordId: number): Promise<DeclarationSummary> => {
        if (recordId === 42) return MOCK_SUMMARY;
        throw new CalculationRecordNotFoundError(recordId);
      },
    ),
    noSubmissionGuarantee:
      'This module never submits data to any external service',
  } as unknown as ExciseDeclarationService;
}

function createMockEntitlementService(): EntitlementService {
  return {
    checkAccess: vi.fn(
      (userId: string | null, _feature: string) => {
        // Anonymous or FREE-tier users get denied on premium features
        if (userId === null) {
          return {
            allowed: false,
            tier: 'FREE' as const,
            reason: 'Feature "declaration:summary" requires PREMIUM tier. Sign in or upgrade.',
          };
        }
        if (userId === 'premium-user') {
          return { allowed: true, tier: 'PREMIUM' as const };
        }
        return {
          allowed: false,
          tier: 'FREE' as const,
          reason: 'Feature "declaration:summary" requires PREMIUM tier. Current tier: FREE.',
        };
      },
    ),
    resolveUserTier: vi.fn(),
    parseTier: vi.fn(),
  } as unknown as EntitlementService;
}

// ---------------------------------------------------------------------------
// Controller delegation + error handling
// ---------------------------------------------------------------------------

describe('DeclarationController — prepareDeclaration', () => {
  let controller: DeclarationController;
  let mockService: ExciseDeclarationService;

  beforeEach(() => {
    mockService = createMockDeclarationService();
    controller = new DeclarationController(mockService);
  });

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  describe('when the service returns a summary', () => {
    it('returns the DeclarationSummary for a known record', async () => {
      const result = await controller.prepareDeclaration(42);
      expect(result).toEqual(MOCK_SUMMARY);
    });

    it('delegates to ExciseDeclarationService.prepareDeclaration', async () => {
      await controller.prepareDeclaration(42);
      expect(mockService.prepareDeclaration).toHaveBeenCalledWith(42);
      expect(mockService.prepareDeclaration).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling — 404
  // ---------------------------------------------------------------------------

  describe('when the record is not found', () => {
    it('throws NotFoundException for a missing record id', async () => {
      try {
        await controller.prepareDeclaration(999);
        expect.unreachable('Expected NotFoundException');
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoundException);
        const response = (err as NotFoundException).getResponse();
        expect(response).toMatchObject({
          statusCode: 404,
          message: 'Calculation record 999 not found',
        });
      }
    });

    it('propagates CalculationRecordNotFoundError from the service', async () => {
      try {
        await controller.prepareDeclaration(0);
        expect.unreachable('Expected NotFoundException');
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoundException);
        expect((err as NotFoundException).message).toContain(
          'Calculation record',
        );
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling — 500
  // ---------------------------------------------------------------------------

  describe('when the service throws an unexpected error', () => {
    beforeEach(() => {
      // Override the mock to throw a generic Error
      (mockService.prepareDeclaration as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Database connection timeout'),
      );
    });

    it('throws InternalServerErrorException', async () => {
      try {
        await controller.prepareDeclaration(1);
        expect.unreachable('Expected InternalServerErrorException');
      } catch (err) {
        expect(err).toBeInstanceOf(InternalServerErrorException);
        const response = (err as InternalServerErrorException).getResponse();
        expect(response).toMatchObject({
          statusCode: 500,
          message: 'Database connection timeout',
        });
      }
    });
  });

  describe('when the service throws a non-Error value', () => {
    beforeEach(() => {
      (mockService.prepareDeclaration as ReturnType<typeof vi.fn>).mockRejectedValue(
        'string error',
      );
    });

    it('throws InternalServerErrorException with fallback message', async () => {
      try {
        await controller.prepareDeclaration(1);
        expect.unreachable('Expected InternalServerErrorException');
      } catch (err) {
        expect(err).toBeInstanceOf(InternalServerErrorException);
        const response = (err as InternalServerErrorException).getResponse();
        expect(response).toMatchObject({
          statusCode: 500,
          message: 'Failed to prepare declaration summary',
        });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// EntitlementGuard enforcement
// ---------------------------------------------------------------------------

describe('EntitlementGuard — declaration:summary enforcement', () => {
  let guard: EntitlementGuard;
  let mockReflector: Reflector;
  let mockEntitlement: EntitlementService;

  beforeEach(() => {
    mockEntitlement = createMockEntitlementService();
    mockReflector = {
      getAllAndOverride: vi.fn(),
    } as unknown as Reflector;
    guard = new EntitlementGuard(mockReflector, mockEntitlement);
  });

  // ---------------------------------------------------------------------------
  // No feature requirement (no @RequireFeature decorator)
  // ---------------------------------------------------------------------------

  describe('when no feature is required', () => {
    it('allows access when reflector returns undefined', () => {
      (mockReflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockReturnValue(
        undefined,
      );
      const context = {
        getHandler: vi.fn(),
        getClass: vi.fn(),
        switchToHttp: vi.fn(),
      } as unknown as any;

      expect(guard.canActivate(context)).toBe(true);
    });

    it('allows access when reflector returns null', () => {
      (mockReflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockReturnValue(
        null,
      );
      const context = {
        getHandler: vi.fn(),
        getClass: vi.fn(),
        switchToHttp: vi.fn(),
      } as unknown as any;

      expect(guard.canActivate(context)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Feature required — premium user (allowed)
  // ---------------------------------------------------------------------------

  describe('when user is PREMIUM tier', () => {
    beforeEach(() => {
      (mockReflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockReturnValue(
        'declaration:summary',
      );
    });

    it('allows access for premium-tier user', () => {
      const context = {
        getHandler: vi.fn(),
        getClass: vi.fn(),
        switchToHttp: () => ({
          getRequest: () => ({ user: { id: 'premium-user' } }),
        }),
      } as unknown as any;

      expect(guard.canActivate(context)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Feature required — anonymous user (denied)
  // ---------------------------------------------------------------------------

  describe('when user is anonymous', () => {
    beforeEach(() => {
      (mockReflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockReturnValue(
        'declaration:summary',
      );
    });

    it('throws ForbiddenException with FREE tier info', () => {
      const context = {
        getHandler: vi.fn(),
        getClass: vi.fn(),
        switchToHttp: () => ({
          getRequest: () => ({ user: null }),
        }),
      } as unknown as any;

      try {
        guard.canActivate(context);
        expect.unreachable('Expected ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const response = (err as ForbiddenException).getResponse();
        expect(response).toMatchObject({
          statusCode: 403,
          error: 'InsufficientEntitlement',
          requiredTier: 'declaration:summary',
          currentTier: 'FREE',
        });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Feature required — user without premium (denied)
  // ---------------------------------------------------------------------------

  describe('when user is FREE tier', () => {
    beforeEach(() => {
      (mockReflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockReturnValue(
        'declaration:summary',
      );
    });

    it('throws ForbiddenException with FREE tier and reason', () => {
      const context = {
        getHandler: vi.fn(),
        getClass: vi.fn(),
        switchToHttp: () => ({
          getRequest: () => ({ user: { id: 'free-user' } }),
        }),
      } as unknown as any;

      try {
        guard.canActivate(context);
        expect.unreachable('Expected ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const response = (err as ForbiddenException).getResponse();
        expect(response).toMatchObject({
          statusCode: 403,
          error: 'InsufficientEntitlement',
          requiredTier: 'declaration:summary',
          currentTier: 'FREE',
        });
        // The reason should mention the feature name and tier
        expect((response as Record<string, unknown>).message as string).toContain(
          'declaration:summary',
        );
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Reflector integration — ensures metadata key is correct
  // ---------------------------------------------------------------------------

  describe('reflector integration', () => {
    it('uses REQUIRE_FEATURE_KEY to read metadata', () => {
      const context = {
        getHandler: vi.fn(),
        getClass: vi.fn(),
        switchToHttp: () => ({
          getRequest: () => ({ user: { id: 'premium-user' } }),
        }),
      } as unknown as any;

      guard.canActivate(context);
      expect(mockReflector.getAllAndOverride).toHaveBeenCalledWith(
        REQUIRE_FEATURE_KEY,
        [context.getHandler(), context.getClass()],
      );
    });
  });
});