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
  InternalServerErrorException,
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

@ApiTags('calculator')
@Controller('api/v1/calculator')
export class CalculatorController {
  constructor(
    private readonly calculator: LandedCostCalculatorService,
    private readonly recordRepo: CalculationRecordRepository,
  ) {}

  // ---------------------------------------------------------------------------
  // POST /api/v1/calculator — run a landed-cost calculation
  // ---------------------------------------------------------------------------

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Calculate landed cost for a cross-border beverage product',
    description:
      'Runs the full orchestrator: classification gate, product master + retail offer lookup, ' +
      'transport estimation, alcohol excise + container duty, transaction classification, ' +
      'confidence computation, and itemized-result assembly.',
  })
  @ApiResponse({
    status: 200,
    description: 'Itemized landed-cost result with confidence and provenance evidence',
  })
  @ApiResponse({ status: 404, description: 'Product not found or no retail offers available' })
  @ApiResponse({ status: 422, description: 'Product rejected by classification gate' })
  @ApiResponse({ status: 400, description: 'Invalid input parameters' })
  async calculate(@Body() dto: CalculateRequest): Promise<CalculatorResult> {
    this.validateCalculateRequest(dto);

    const input: CalculatorInput = {
      productId: dto.productId,
      quantity: dto.quantity,
      destination: dto.destination,
      transportMethod: dto.transportMethod,
      sessionId: dto.sessionId,
    };

    try {
      return await this.calculator.calculate(input);
    } catch (err) {
      if (err instanceof ProductNotFoundError || err instanceof NoRetailOffersError) {
        throw new NotFoundException(err.message);
      }
      if (err instanceof ClassificationGateRejectionError) {
        throw new InternalServerErrorException({
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
      throw new InternalServerErrorException({
        statusCode: 400,
        message: errors.join('; '),
        error: 'ValidationError',
      });
    }
  }
}