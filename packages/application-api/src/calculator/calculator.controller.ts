/**
 * CalculatorController — landed-cost calculation endpoints.
 *
 * Groups all calculator operations under `/api/v1/calculator`.
 *
 * @module CalculatorController
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
  InternalServerErrorException,
  UseGuards,
  Headers,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  LandedCostCalculatorService,
  CalculatorResult,
  CalculatorInput,
  ProductNotFoundError,
  NoRetailOffersError,
  ClassificationGateRejectionError,
} from '@rajahinta/core-domain';
import {
  CalculationRecordRepository,
  CalculationRecord,
} from '@rajahinta/data-platform';
import type { CalculateRequest } from './calculator.dto';
import { IdempotencyService } from '../idempotency';
import { RateLimitGuard, RateLimit } from '../rate-limiting';
import { LaunchGateGuard, LaunchGate, LaunchGateType } from '../feature-flags';
import { AgeGateGuard } from '../age-gate';

@ApiTags('calculator')
@Controller('api/v1/calculator')
export class CalculatorController {
  constructor(
    private readonly calculator: LandedCostCalculatorService,
    private readonly recordRepo: CalculationRecordRepository,
    private readonly idempotency: IdempotencyService,
  ) {}

  // ---------------------------------------------------------------------------
  // POST /api/v1/calculator — run a landed-cost calculation
  // ---------------------------------------------------------------------------

  @Post()
  @LaunchGate(LaunchGateType.CALCULATION)
  @UseGuards(RateLimitGuard, LaunchGateGuard, AgeGateGuard)
  @RateLimit('CALCULATOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Calculate landed cost for a cross-border beverage product',
    description:
      'Runs the full orchestrator: classification gate, product master + retail offer lookup, ' +
      'transport estimation, alcohol excise + container duty, transaction classification, ' +
      'confidence computation, and itemized-result assembly.  Idempotent: repeated identical ' +
      'requests return the cached result when dataset versions have not changed.',
  })
  @ApiResponse({
    status: 200,
    description: 'Itemized landed-cost result with confidence and provenance evidence',
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
  @ApiResponse({ status: 404, description: 'Product not found or no retail offers available' })
  @ApiResponse({ status: 422, description: 'Product rejected by classification gate' })
  @ApiResponse({ status: 400, description: 'Invalid input parameters' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async calculate(
    @Body() dto: CalculateRequest,
    @Headers('x-idempotency-key') idempotencyKey?: string,
    @Res({ passthrough: true }) res?: any,
  ): Promise<CalculatorResult> {
    this.validateCalculateRequest(dto);

    const input: CalculatorInput = {
      productId: dto.productId,
      quantity: dto.quantity,
      destination: dto.destination,
      transportMethod: dto.transportMethod,
      sessionId: dto.sessionId,
    };

    // ---- Idempotency check ----
    const cacheKey = idempotencyKey ?? this.idempotency.getCacheKey(input);
    const cached = await this.idempotency.lookup(cacheKey);
    if (cached !== null) {
      const contentHash = this.idempotency.getContentHash(cached);
      res?.header('X-Cache', 'HIT');
      res?.header('X-Content-Hash', contentHash);
      return cached;
    }

    try {
      const result = await this.calculator.calculate(input);

      // ---- Cache the result ----
      await this.idempotency.store(cacheKey, result);

      const contentHash = this.idempotency.getContentHash(result);
      res?.header('X-Cache', 'MISS');
      res?.header('X-Content-Hash', contentHash);

      return result;
    } catch (err) {
      if (err instanceof ProductNotFoundError || err instanceof NoRetailOffersError) {
        throw new NotFoundException(err.message);
      }
      if (err instanceof ClassificationGateRejectionError) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          message: err.message,
          error: 'ClassificationGateRejection',
          productId: err.productId,
          reason: err.reason,
        });
      }
      throw new InternalServerErrorException(
        err instanceof Error ? err.message : 'Unexpected calculation error',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/calculator/result/:recordId — retrieve a previous result
  // ---------------------------------------------------------------------------

  @Get('result/:recordId')
  @ApiOperation({
    summary: 'Retrieve a previous calculation result by record ID',
    description:
      'Returns the persisted calculation record including cost breakdown, ' +
      'confidence level, and metadata.',
  })
  @ApiResponse({ status: 200, description: 'Calculation record' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  async getResult(
    @Param('recordId', ParseIntPipe) recordId: number,
  ): Promise<CalculationRecord> {
    const record = await this.recordRepo.findById(recordId);
    if (record === null) {
      throw new NotFoundException(`Calculation record ${recordId} not found`);
    }
    return record;
  }

  // ---------------------------------------------------------------------------
  // Input validation
  // ---------------------------------------------------------------------------

  /**
   * Validate required fields before forwarding to the domain layer.
   * Throws a descriptive error so NestJS returns a 400 with a payload
   * the client can surface.
   */
  private validateCalculateRequest(dto: CalculateRequest): void {
    const errors: string[] = [];

    if (!Number.isInteger(dto.productId) || dto.productId <= 0) {
      errors.push('productId must be a positive integer');
    }
    if (!Number.isInteger(dto.quantity) || dto.quantity < 1) {
      errors.push('quantity must be a positive integer');
    }
    if (typeof dto.destination !== 'string' || dto.destination.length !== 2) {
      errors.push('destination must be a 2-letter ISO 3166-1 alpha-2 country code');
    }
    if (dto.transportMethod !== undefined && typeof dto.transportMethod !== 'string') {
      errors.push('transportMethod must be a string when provided');
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
}