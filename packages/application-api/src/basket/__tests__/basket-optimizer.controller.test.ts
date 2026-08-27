/**
 * Unit tests for BasketOptimizerController — validation, error mapping,
 * feature-flag gating, and idempotent replay.
 *
 * Does NOT cover the full integration suite (task 5.4).
 *
 * @module BasketOptimizerControllerTest
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
  InternalServerErrorException,
  ForbiddenException,
} from '@nestjs/common';
import {
  BasketOptimizerService,
  type BasketOptimizationResult,
  BasketValidationError,
  BasketClassificationGateError,
  MAX_BASKET_ITEMS,
} from '@rajahinta/core-domain';
import { BasketOptimizerController } from '../basket-optimizer.controller';
import type { BasketOptimizeRequest } from '../basket.dto';
import { IdempotencyService } from '../../idempotency';
import type { IIdempotencyCache } from '../../idempotency';
import { FeatureFlag, FeatureFlagService } from '../../feature-flags';
import { FeatureFlagGuard } from '../../feature-flags/feature-flags.guard';
import { Reflector } from '@nestjs/core';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_RESULT: BasketOptimizationResult = {
  shipments: [
    {
      merchant: 'ALKOHOLI_TEST',
      country: 'EE',
      items: [],
      consolidatedTransport: {
        totalCents: 1500,
        weightTier: '0–5 kg',
        packageTier: 'parcel',
        reliability: 'EXACT',
      },
      retailSubtotalCents: 2500,
      thresholdCheck: {
        minimumOrderValueCents: null,
        meetsThreshold: true,
        termsReliability: null,
      },
    },
  ],
  totalCents: 4000,
  itemizedTotals: 2500,
  confidence: 'HIGH' as const,
  confidenceBreakdown: [],
  disclaimer: {
    text: 'Test disclaimer',
    language: 'fi' as const,
    version: '1.0.0',
  },
  alternatives: [],
  metadata: {
    input: {
      items: [{ productId: 1, quantity: 2 }],
      destination: 'FI',
    },
    calculationTimestamp: new Date().toISOString(),
    datasetVersions: ['v1.0-2024'],
    calculationRecordId: null,
  },
};

const VALID_REQUEST: BasketOptimizeRequest = {
  items: [{ productId: 1, quantity: 2 }],
  destination: 'FI',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockOptimizer(
  overrides?: Partial<BasketOptimizerService>,
): BasketOptimizerService {
  return {
    optimize: vi.fn().mockResolvedValue(MOCK_RESULT),
    ...(overrides ?? {}),
  } as unknown as BasketOptimizerService;
}

function createMockIdempotencyService(
  overrides?: Partial<IdempotencyService>,
): IdempotencyService {
  return {
    getContentHash: vi.fn((_result: unknown) => 'abc123'),
    ...(overrides ?? {}),
  } as unknown as IdempotencyService;
}

function createMockCache(
  overrides?: Partial<IIdempotencyCache>,
): IIdempotencyCache {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    invalidateVersions: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    size: 0,
    ...(overrides ?? {}),
  } as unknown as IIdempotencyCache;
}

function createMockTaxRepo(overrides?: object): any {
  return {
    findActiveVersionLabels: vi.fn().mockResolvedValue(['v1.0-2024']),
    ...(overrides ?? {}),
  };
}

// ---------------------------------------------------------------------------
// Controller factory
// ---------------------------------------------------------------------------

function createController(
  optimizer?: BasketOptimizerService,
  idempotency?: IdempotencyService,
  cache?: IIdempotencyCache,
  taxRepo?: object,
): BasketOptimizerController {
  return new BasketOptimizerController(
    optimizer ?? createMockOptimizer(),
    idempotency ?? createMockIdempotencyService(),
    taxRepo ?? createMockTaxRepo(),
    cache ?? createMockCache(),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BasketOptimizerController', () => {
  // ===================================================================
  // Validation errors
  // ===================================================================

  describe('input validation', () => {
    it('rejects empty items array', async () => {
      const ctrl = createController();
      const req: BasketOptimizeRequest = { items: [], destination: 'FI' };

      await expect(ctrl.optimize(req)).rejects.toThrow(BadRequestException);
    });

    it('rejects more than MAX_BASKET_ITEMS items', async () => {
      const ctrl = createController();
      const req: BasketOptimizeRequest = {
        items: Array.from({ length: MAX_BASKET_ITEMS + 1 }, (_, i) => ({
          productId: i + 1,
          quantity: 1,
        })),
        destination: 'FI',
      };

      await expect(ctrl.optimize(req)).rejects.toThrow(BadRequestException);
    });

    it('rejects non-integer productId', async () => {
      const ctrl = createController();
      const req = { items: [{ productId: 1.5, quantity: 1 }], destination: 'FI' } as unknown as BasketOptimizeRequest;

      await expect(ctrl.optimize(req)).rejects.toThrow(BadRequestException);
    });

    it('rejects quantity of 0', async () => {
      const ctrl = createController();
      const req = { items: [{ productId: 1, quantity: 0 }], destination: 'FI' } as unknown as BasketOptimizeRequest;

      await expect(ctrl.optimize(req)).rejects.toThrow(BadRequestException);
    });

    it('rejects quantity > 99', async () => {
      const ctrl = createController();
      const req = { items: [{ productId: 1, quantity: 100 }], destination: 'FI' } as unknown as BasketOptimizeRequest;

      await expect(ctrl.optimize(req)).rejects.toThrow(BadRequestException);
    });

    it('rejects non-ISO-2 destination', async () => {
      const ctrl = createController();
      const req = { items: [{ productId: 1, quantity: 1 }], destination: 'FIN' } as unknown as BasketOptimizeRequest;

      await expect(ctrl.optimize(req)).rejects.toThrow(BadRequestException);
    });

    it('rejects empty string destination', async () => {
      const ctrl = createController();
      const req = { items: [{ productId: 1, quantity: 1 }], destination: '' } as unknown as BasketOptimizeRequest;

      await expect(ctrl.optimize(req)).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid transportArrangement', async () => {
      const ctrl = createController();
      const req = {
        items: [{ productId: 1, quantity: 1 }],
        destination: 'FI',
        transportArrangement: 'INVALID',
      } as unknown as BasketOptimizeRequest;

      await expect(ctrl.optimize(req)).rejects.toThrow(BadRequestException);
    });

    it('rejects non-string transportMethod', async () => {
      const ctrl = createController();
      const req = {
        items: [{ productId: 1, quantity: 1 }],
        destination: 'FI',
        transportMethod: 123,
      } as unknown as BasketOptimizeRequest;

      await expect(ctrl.optimize(req)).rejects.toThrow(BadRequestException);
    });

    it('validation error message contains specific field info', async () => {
      const ctrl = createController();
      const req = { items: [], destination: '' } as unknown as BasketOptimizeRequest;

      try {
        await ctrl.optimize(req);
        expect.unreachable('Expected BadRequestException');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(BadRequestException);
        const br = err as BadRequestException;
        const body = br.getResponse() as Record<string, unknown>;
        expect(body.message).toContain('items');
        expect(body.message).toContain('destination');
      }
    });
  });

  // ===================================================================
  // Feature flag gating (class-level), mocked via FeatureFlagGuard
  // ===================================================================

  describe('feature flag gating', () => {
    let originalEnv: Record<string, string | undefined>;

    beforeEach(() => {
      originalEnv = { ...process.env };
      delete process.env.FF_BASKET_OPTIMIZATION;
    });

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('class carries the BASKET_OPTIMIZATION feature flag decorator', () => {
      const reflector = new Reflector();
      const flag = reflector.getAllAndOverride<FeatureFlag>(
        'feature_flag',
        [BasketOptimizerController.prototype.optimize, BasketOptimizerController],
      );
      expect(flag).toBe(FeatureFlag.BASKET_OPTIMIZATION);
    });

    it('FeatureFlagGuard rejects when BASKET_OPTIMIZATION is off', () => {
      const guard = new FeatureFlagGuard(new Reflector(), new FeatureFlagService());
      const ctx = {
        getHandler: () => BasketOptimizerController.prototype.optimize,
        getClass: () => BasketOptimizerController,
        switchToHttp: () => ({
          getRequest: () => ({ headers: {}, cookies: {} }),
          getResponse: () => ({ header: () => undefined }),
        }),
        getArgs: () => [],
        getType: () => 'http',
      } as any;

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('FeatureFlagGuard allows when BASKET_OPTIMIZATION is on', () => {
      process.env.FF_BASKET_OPTIMIZATION = 'true';
      const guard = new FeatureFlagGuard(new Reflector(), new FeatureFlagService());
      const ctx = {
        getHandler: () => BasketOptimizerController.prototype.optimize,
        getClass: () => BasketOptimizerController,
        switchToHttp: () => ({
          getRequest: () => ({ headers: {}, cookies: {} }),
          getResponse: () => ({ header: () => undefined }),
        }),
        getArgs: () => [],
        getType: () => 'http',
      } as any;

      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  // ===================================================================
  // Error mapping
  // ===================================================================

  describe('error mapping', () => {
    it('maps BasketValidationError (PRODUCT_NOT_FOUND) to 404', async () => {
      const optimizer = createMockOptimizer({
        optimize: vi.fn().mockRejectedValue(
          new BasketValidationError('Product 999 not found', 'PRODUCT_NOT_FOUND'),
        ),
      });
      const ctrl = createController(optimizer);

      await expect(ctrl.optimize(VALID_REQUEST)).rejects.toThrow(NotFoundException);
    });

    it('maps BasketValidationError (NO_OFFERS) to 404', async () => {
      const optimizer = createMockOptimizer({
        optimize: vi.fn().mockRejectedValue(
          new BasketValidationError('No retail offers for product 1', 'NO_OFFERS'),
        ),
      });
      const ctrl = createController(optimizer);

      await expect(ctrl.optimize(VALID_REQUEST)).rejects.toThrow(NotFoundException);
    });

    it('maps BasketValidationError (other codes) to 400', async () => {
      const optimizer = createMockOptimizer({
        optimize: vi.fn().mockRejectedValue(
          new BasketValidationError('Too many items', 'TOO_MANY_ITEMS'),
        ),
      });
      const ctrl = createController(optimizer);

      await expect(ctrl.optimize(VALID_REQUEST)).rejects.toThrow(BadRequestException);
    });

    it('maps BasketValidationError (INVALID_QUANTITY) to 400', async () => {
      const optimizer = createMockOptimizer({
        optimize: vi.fn().mockRejectedValue(
          new BasketValidationError('Invalid quantity', 'INVALID_QUANTITY'),
        ),
      });
      const ctrl = createController(optimizer);

      await expect(ctrl.optimize(VALID_REQUEST)).rejects.toThrow(BadRequestException);
    });

    it('maps BasketClassificationGateError to 422 with productId', async () => {
      const optimizer = createMockOptimizer({
        optimize: vi.fn().mockRejectedValue(
          new BasketClassificationGateError(7, 'Not classified for distance selling'),
        ),
      });
      const ctrl = createController(optimizer);

      try {
        await ctrl.optimize(VALID_REQUEST);
        expect.unreachable('Expected UnprocessableEntityException');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(UnprocessableEntityException);
        const ue = err as UnprocessableEntityException;
        const body = ue.getResponse() as Record<string, unknown>;
        expect(body.productId).toBe(7);
      }
    });

    it('maps unexpected errors to 500', async () => {
      const optimizer = createMockOptimizer({
        optimize: vi.fn().mockRejectedValue(new Error('Database timeout')),
      });
      const ctrl = createController(optimizer);

      await expect(ctrl.optimize(VALID_REQUEST)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ===================================================================
  // Happy path
  // ===================================================================

  describe('happy path', () => {
    it('returns the optimization result on success', async () => {
      const ctrl = createController();
      const result = await ctrl.optimize(VALID_REQUEST);

      expect(result).toEqual(MOCK_RESULT);
      expect(result.totalCents).toBe(4000);
    });

    it('passes the correct input to the optimizer', async () => {
      const optimizeSpy = vi.fn().mockResolvedValue(MOCK_RESULT);
      const optimizer = createMockOptimizer({ optimize: optimizeSpy });
      const ctrl = createController(optimizer);

      await ctrl.optimize(VALID_REQUEST);

      expect(optimizeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [{ productId: 1, quantity: 2 }],
          destination: 'FI',
        }),
      );
    });

    it('sets X-Cache MISS and X-Content-Hash headers', async () => {
      const ctrl = createController();
      const res = { header: vi.fn() };

      await ctrl.optimize(VALID_REQUEST, undefined, res);

      expect(res.header).toHaveBeenCalledWith('X-Cache', 'MISS');
      expect(res.header).toHaveBeenCalledWith('X-Content-Hash', expect.any(String));
    });
  });

  // ===================================================================
  // Idempotent replay
  // ===================================================================

  describe('idempotency', () => {
    it('returns cached result on cache hit with matching versions', async () => {
      const cache = createMockCache({
        get: vi.fn().mockResolvedValue({
          result: MOCK_RESULT,
          datasetVersions: ['v1.0-2024'],
          createdAt: new Date().toISOString(),
        }),
      });
      const ctrl = createController(createMockOptimizer(), undefined, cache);
      const res = { header: vi.fn() };

      const result = await ctrl.optimize(VALID_REQUEST, 'user-key', res);

      expect(result).toEqual(MOCK_RESULT);
      expect(res.header).toHaveBeenCalledWith('X-Cache', 'HIT');
    });

    it('calls optimizer on cache miss', async () => {
      const optSpy = vi.fn().mockResolvedValue(MOCK_RESULT);
      const optimizer = createMockOptimizer({ optimize: optSpy });
      const ctrl = createController(optimizer);

      await ctrl.optimize(VALID_REQUEST);

      expect(optSpy).toHaveBeenCalledTimes(1);
    });

    it('stores result in cache after computation', async () => {
      const cache = createMockCache();
      const ctrl = createController(createMockOptimizer(), undefined, cache);

      await ctrl.optimize(VALID_REQUEST);

      expect(cache.set).toHaveBeenCalledTimes(1);
      const [key, entry] = (cache.set as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(key).toContain('basket:');
      expect(entry).toHaveProperty('result');
      expect(entry).toHaveProperty('datasetVersions');
    });

    it('cache miss when versions differ', async () => {
      const cache = createMockCache({
        get: vi.fn().mockResolvedValue({
          result: MOCK_RESULT,
          datasetVersions: ['v1.0-2024'],
          createdAt: new Date().toISOString(),
        }),
      });
      const taxRepo = createMockTaxRepo({
        findActiveVersionLabels: vi.fn().mockResolvedValue(['v2.0-2025']),
      });
      const optSpy = vi.fn().mockResolvedValue(MOCK_RESULT);
      const optimizer = createMockOptimizer({ optimize: optSpy });
      const ctrl = createController(optimizer, undefined, cache, taxRepo);

      await ctrl.optimize(VALID_REQUEST);

      // When versions differ, optimizer should be called (cache miss)
      expect(optSpy).toHaveBeenCalledTimes(1);
    });
  });
});