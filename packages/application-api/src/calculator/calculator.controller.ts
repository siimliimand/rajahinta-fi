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
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  LandedCostCalculatorService,
  CalculatorResult,
  CalculatorInput,
  ProductNotFoundError,
  NoRetailOffersError,
  ClassificationGateRejectionError,
  TAX_RULE_REPOSITORY_PORT,
  ITaxRuleRepositoryPort,
} from '@rajahinta/core-domain';
import {
  CalculationRecordRepository,
  ProductRepository,
  TaxRateRepository,
} from '@rajahinta/data-platform';
import type { CalculateRequest, CalculationResultResponse } from './calculator.dto';
import { mapCalculationRecordToResult } from './calculation-result.mapper';
import { IdempotencyService } from '../idempotency';
import { RateLimitGuard, RateLimit } from '../rate-limiting';
import { LaunchGateGuard, LaunchGate, LaunchGateType } from '../feature-flags';
import { AgeGateGuard } from '../age-gate';

@ApiTags('calculator')
@Controller('api/v1/calculator')
@LaunchGate(LaunchGateType.CALCULATION)
@UseGuards(RateLimitGuard, LaunchGateGuard, AgeGateGuard)
export class CalculatorController {
  constructor(
    private readonly calculator: LandedCostCalculatorService,
    private readonly recordRepo: CalculationRecordRepository,
    private readonly idempotency: IdempotencyService,
    @Inject(TAX_RULE_REPOSITORY_PORT)
    private readonly taxRepo: ITaxRuleRepositoryPort,
    // Read-side dependencies for GET /result — product facts (joined from
    // the product master) and tax-rule version labels (resolved by rule ID).
    // Both tokens are exported by DataPlatformModule.
    private readonly productRepo: ProductRepository,
    private readonly taxRateRepo: TaxRateRepository,
  ) {}

  // ---------------------------------------------------------------------------
  // POST /api/v1/calculator — run a landed-cost calculation
  // ---------------------------------------------------------------------------

  @Post()
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
      transportArrangement: dto.transportArrangement,
      sessionId: dto.sessionId,
    };

    // ---- Idempotency check ----
    // Resolve the active dataset versions FIRST so the derived cache key
    // is version-aware (ARCHITECTURE.md §15 known issue: hashing the
    // input before the versions made the key version-blind). A version
    // bump now produces a different key → guaranteed fresh calculation.
    // Client-supplied idempotency keys stay verbatim by contract; for
    // those, and as defense in depth for derived keys, the lookup-time
    // version comparison below still rejects stale entries.
    const currentVersions = await this.taxRepo.findActiveVersionLabels();
    const cacheKey =
      idempotencyKey ??
      this.idempotency.getCacheKey({
        ...input,
        datasetVersions: currentVersions,
      });
    const cached = await this.idempotency.lookup(cacheKey, currentVersions);
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
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retrieve a previous calculation result by record ID',
    description:
      'Returns the persisted calculation reconstructed into the LIVE response ' +
      'shape of POST /api/v1/calculator (metadata, itemized costs, disclaimer, ' +
      'dataset versions). Figures are verbatim from the record — nothing is ' +
      'recomputed. Product facts are joined from the product master; fields ' +
      'the record does not persist (per-point confidence breakdown, ' +
      'classification, transportMethod) degrade factually.',
  })
  @ApiResponse({ status: 200, description: 'Itemized landed-cost result in the live calculation shape' })
  @ApiResponse({ status: 403, description: 'Feature not available' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  async getResult(
    @Param('recordId', ParseIntPipe) recordId: number,
  ): Promise<CalculationResultResponse> {
    const record = await this.recordRepo.findById(recordId);
    if (record === null) {
      throw new NotFoundException(`Calculation record ${recordId} not found`);
    }

    // Read-side joins only — no engine runs, no price/tax recomputation.
    const [product, exciseRule, containerRule] = await Promise.all([
      this.productRepo.findById(record.productMasterId),
      record.exciseRuleVersionId !== null
        ? this.taxRateRepo.findVersionById(record.exciseRuleVersionId)
        : Promise.resolve(null),
      record.containerDutyRuleVersionId !== null
        ? this.taxRateRepo.findVersionById(record.containerDutyRuleVersionId)
        : Promise.resolve(null),
    ]);

    return mapCalculationRecordToResult({
      record,
      product,
      exciseVersionLabel: exciseRule?.versionLabel ?? null,
      containerVersionLabel: containerRule?.versionLabel ?? null,
    });
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
}