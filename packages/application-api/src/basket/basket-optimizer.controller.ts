/**
 * BasketOptimizerController — multi-item basket landed-cost optimization endpoint.
 *
 * Groups basket operations under `/api/v1/basket`.
 *
 * @module BasketOptimizerController
 */

import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
  InternalServerErrorException,
  UseGuards,
  Headers,
  Res,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  BasketOptimizerService,
  type BasketOptimizationResult,
  type BasketOptimizationInput,
  BasketValidationError,
  BasketClassificationGateError,
  type ITaxRuleRepositoryPort,
  TAX_RULE_REPOSITORY_PORT,
  MAX_BASKET_ITEMS,
} from '@rajahinta/core-domain';
import type { BasketOptimizeRequest } from './basket.dto';
import { RateLimitGuard, RateLimit } from '../rate-limiting';
import {
  FeatureFlagGuard,
  FeatureFlagDec,
  FeatureFlag,
} from '../feature-flags';
import { IdempotencyService, IDEMPOTENCY_CACHE, hashInput } from '../idempotency';
import type { IIdempotencyCache, CacheKeyInput } from '../idempotency';

@ApiTags('basket')
@Controller('api/v1/basket')
@UseGuards(RateLimitGuard, FeatureFlagGuard)
@FeatureFlagDec(FeatureFlag.BASKET_OPTIMIZATION)
export class BasketOptimizerController {
  constructor(
    private readonly optimizer: BasketOptimizerService,
    private readonly idempotencyService: IdempotencyService,
    @Inject(TAX_RULE_REPOSITORY_PORT)
    private readonly taxRepo: ITaxRuleRepositoryPort,
    @Inject(IDEMPOTENCY_CACHE)
    private readonly idempotencyCache: IIdempotencyCache,
  ) {}

  // ---------------------------------------------------------------------------
  // POST /api/v1/basket/optimize — optimize a multi-item basket
  // ---------------------------------------------------------------------------

  @Post('optimize')
  @RateLimit('BASKET')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Optimize a multi-item basket across merchants',
    description:
      'Enumerates merchant-split combinations, computes per-shipment landed ' +
      'costs, and returns the lowest-total assignment with up to 3 alternatives. ' +
      'Idempotent: repeated identical requests return the cached result when ' +
      'dataset versions have not changed.',
  })
  @ApiResponse({
    status: 200,
    description: 'Optimized basket result with per-shipment breakdown',
    headers: {
      'X-Content-Hash': {
        description: 'SHA-256 hash of the response body — stable across cache hits',
        schema: { type: 'string' },
      },
      'X-Cache': {
        description: 'Indicates whether the result was served from cache (HIT) or computed (MISS)',
        schema: { type: 'string', enum: ['HIT', 'MISS'] },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input parameters' })
  @ApiResponse({ status: 403, description: 'Feature not available' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 422, description: 'Product rejected by classification gate or no covering offers' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async optimize(
    @Body() dto: BasketOptimizeRequest,
    @Headers('x-idempotency-key') idempotencyKey?: string,
    @Res({ passthrough: true }) res?: any,
  ): Promise<BasketOptimizationResult> {
    this.validateOptimizeRequest(dto);

    const input: BasketOptimizationInput = {
      items: dto.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      destination: dto.destination,
      transportMethod: dto.transportMethod,
      transportArrangement: dto.transportArrangement,
      sessionId: dto.sessionId,
    };

    // ---- Idempotency check ----
    // Derive a deterministic cache key from basket input, namespaced under
    // "basket:" to avoid collision with calculator entries.
    const cacheKeyInput: CacheKeyInput = {
      productId: 0,    // unused when items is present
      quantity: 0,     // unused when items is present
      destination: dto.destination,
      transportMethod: dto.transportMethod,
      items: dto.items,
    };
    const rawKey = hashInput(cacheKeyInput);
    const cacheKey = idempotencyKey ?? `basket:${rawKey}`;
    const currentVersions = await this.taxRepo.findActiveVersionLabels();
    const cached = await this.lookupCached(cacheKey, currentVersions);
    if (cached !== null) {
      const contentHash = this.idempotencyService.getContentHash(cached as never);
      res?.header('X-Cache', 'HIT');
      res?.header('X-Content-Hash', contentHash);
      return cached;
    }

    try {
      const result = await this.optimizer.optimize(input);

      // ---- Cache the result ----
      await this.storeCached(cacheKey, currentVersions, result);

      const contentHash = this.idempotencyService.getContentHash(result as never);
      res?.header('X-Cache', 'MISS');
      res?.header('X-Content-Hash', contentHash);

      return result;
    } catch (err: unknown) {
      if (err instanceof BasketValidationError) {
        // Map specific error codes to appropriate HTTP statuses
        if (err.code === 'PRODUCT_NOT_FOUND' || err.code === 'NO_OFFERS') {
          throw new NotFoundException(err.message);
        }
        throw new BadRequestException({
          statusCode: 400,
          message: err.message,
          error: 'BasketValidationError',
          code: err.code,
        });
      }
      if (err instanceof BasketClassificationGateError) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          message: err.message,
          error: 'BasketClassificationGateRejection',
          productId: err.productId,
        });
      }
      throw new InternalServerErrorException(
        err instanceof Error ? err.message : 'Unexpected basket optimization error',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Input validation
  // ---------------------------------------------------------------------------

  /**
   * Validate required fields before forwarding to the domain layer.
   * Throws a descriptive 400 with a payload the client can surface.
   */
  private validateOptimizeRequest(dto: BasketOptimizeRequest): void {
    const errors: string[] = [];

    // Items
    if (!Array.isArray(dto.items)) {
      errors.push('items must be an array');
    } else {
      if (dto.items.length < 1) {
        errors.push('items must contain at least 1 item');
      } else if (dto.items.length > MAX_BASKET_ITEMS) {
        errors.push(`items must contain at most ${MAX_BASKET_ITEMS} items`);
      }

      for (let i = 0; i < dto.items.length; i++) {
        const item = dto.items[i];
        if (
          typeof item !== 'object' ||
          item === null ||
          !Number.isInteger(item.productId) ||
          item.productId <= 0
        ) {
          errors.push(`items[${i}].productId must be a positive integer`);
        }
        if (
          typeof item !== 'object' ||
          item === null ||
          !Number.isInteger(item.quantity) ||
          item.quantity < 1 ||
          item.quantity > 99
        ) {
          errors.push(`items[${i}].quantity must be a positive integer between 1 and 99`);
        }
      }
    }

    // Destination
    if (typeof dto.destination !== 'string' || dto.destination.length !== 2) {
      errors.push('destination must be a 2-letter ISO 3166-1 alpha-2 country code');
    }

    // Optional fields
    if (dto.transportMethod !== undefined && typeof dto.transportMethod !== 'string') {
      errors.push('transportMethod must be a string when provided');
    }
    if (
      dto.transportArrangement !== undefined &&
      !['SELLER_ARRANGED', 'INDEPENDENT_CARRIER', 'PERSONAL'].includes(dto.transportArrangement)
    ) {
      errors.push(
        'transportArrangement must be one of: SELLER_ARRANGED, INDEPENDENT_CARRIER, PERSONAL',
      );
    }
    if (dto.sessionId !== undefined && typeof dto.sessionId !== 'string') {
      errors.push('sessionId must be a string when provided');
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: errors.join('; '),
        error: 'ValidationError',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Idempotency helpers — generic over the cache interface
  // ---------------------------------------------------------------------------

  /**
   * Look up a cached basket result by key, checking dataset version match.
   * Returns null on cache miss or version mismatch.
   */
  private async lookupCached(
    key: string,
    currentVersions: readonly string[],
  ): Promise<BasketOptimizationResult | null> {
    const entry = await this.idempotencyCache.get(key);
    if (entry === null) return null;

    if (
      currentVersions !== undefined &&
      currentVersions.length > 0 &&
      !this.versionsMatch(entry.datasetVersions, currentVersions)
    ) {
      return null;
    }

    return entry.result as unknown as BasketOptimizationResult;
  }

  /**
   * Store a basket result in the idempotency cache.
   */
  private async storeCached(
    key: string,
    currentVersions: readonly string[],
    result: BasketOptimizationResult,
  ): Promise<void> {
    const entry = {
      result: result as never,
      datasetVersions: currentVersions.length > 0
        ? (result.metadata.datasetVersions.length > 0
            ? result.metadata.datasetVersions
            : currentVersions)
        : [],
      createdAt: new Date().toISOString(),
    };
    await this.idempotencyCache.set(key, entry);
  }

  /**
   * Compare two version arrays for equality (order-independent).
   */
  private versionsMatch(
    a: readonly string[],
    b: readonly string[],
  ): boolean {
    if (a.length !== b.length) return false;
    const setB = new Set(b);
    return a.every((v) => setB.has(v));
  }
}