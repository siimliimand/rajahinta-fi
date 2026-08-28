/**
 * CalculationController — legacy calculation endpoints.
 *
 * `POST /api/v1/calculations/excise` and `POST /api/v1/calculations/landed-cost`
 * are implemented directly against the domain tax engines
 * (`AlcoholExciseService`, `ContainerDutyService`), honoring the request
 * body. The previous wiring through `TaxCalculationEngineAdapter` discarded
 * the body by construction and was deleted (design D1,
 * technical-assessment-remediation) — these routes now produce the real
 * excise and container-duty math for whatever the client posts.
 *
 * Response shapes preserve the published API: `ExciseCalculation` for the
 * excise route and `LandedCostResult` for the landed-cost route.
 *
 * @module CalculationController
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  AlcoholExciseService,
  ContainerDutyService,
  type ExciseResult,
  type ContainerDutyResult,
  type ExciseCalculation,
  type ContainerDutyCalculation,
  type LandedCostResult,
  DISCLAIMER_FI,
} from '@rajahinta/core-domain';
import { AgeGateGuard } from '../age-gate';
import { RateLimitGuard, RateLimit } from '../rate-limiting';
import {
  CalculateExciseDto,
  CalculateLandedCostDto,
} from './calculations.dto';

const EXCISE_CATEGORIES = [
  'beer',
  'wine',
  'spirits',
  'intermediate',
  'other',
] as const;

const CONTAINER_TYPES = ['glass', 'plastic', 'metal', 'carton', 'other'] as const;

const TRANSACTION_CLASSES = [
  'distance-selling',
  'distance-buying',
  'traveller-import',
] as const;

@ApiTags('calculations')
@Controller('api/v1/calculations')
@UseGuards(RateLimitGuard, AgeGateGuard)
export class CalculationController {
  constructor(
    private readonly exciseService: AlcoholExciseService,
    private readonly containerDutyService: ContainerDutyService,
  ) {}

  // ---------------------------------------------------------------------------
  // POST /api/v1/calculations/excise
  // ---------------------------------------------------------------------------

  @Post('excise')
  @RateLimit('CALCULATOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Calculate alcohol excise duty for the posted inputs' })
  @ApiResponse({
    status: 200,
    description: 'Excise calculation result with provenance evidence',
  })
  @ApiResponse({ status: 400, description: 'Invalid input parameters' })
  async calculateExcise(@Body() dto: CalculateExciseDto): Promise<ExciseCalculation> {
    validateExciseBase(dto);

    const result = await this.exciseService.calculate(
      dto.category,
      dto.alcoholByVolume,
      dto.volumeLitres,
    );
    return mapExciseResult(dto, result);
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/calculations/landed-cost
  // ---------------------------------------------------------------------------

  @Post('landed-cost')
  @RateLimit('CALCULATOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Calculate full landed cost for the posted basket line' })
  @ApiResponse({
    status: 200,
    description: 'Complete landed-cost result with disclaimer',
  })
  @ApiResponse({ status: 400, description: 'Invalid input parameters' })
  async calculateLandedCost(
    @Body() dto: CalculateLandedCostDto,
  ): Promise<LandedCostResult> {
    validateLandedCostRequest(dto);

    const exciseDuty: ExciseCalculation | null =
      dto.exciseBase !== null
        ? mapExciseResult(dto.exciseBase, await this.exciseService.calculate(
            dto.exciseBase.category,
            dto.exciseBase.alcoholByVolume,
            dto.exciseBase.volumeLitres,
          ))
        : null;

    const containerDuty: ContainerDutyCalculation | null =
      dto.containerType !== null
        ? mapContainerDutyResult(
            dto.containerType,
            await this.containerDutyService.calculate(
              dto.containerVolumeLitres!,
              dto.containerType,
              dto.depositSystemVerified,
            ),
          )
        : null;

    return {
      retailPriceCents: dto.retailPriceCents,
      transportCostCents: dto.transportCostCents,
      exciseDuty,
      containerDuty,
      totalCostCents:
        dto.retailPriceCents +
        dto.transportCostCents +
        (exciseDuty?.exciseAmountCents ?? 0) +
        (containerDuty?.dutyAmountCents ?? 0),
      currency: 'EUR',
      disclaimer: DISCLAIMER_FI,
      calculationTimestamp: new Date(),
      transactionClass: dto.transactionClass,
    };
  }
}

// ---------------------------------------------------------------------------
// Mapping — domain results to the published response shapes
// ---------------------------------------------------------------------------

function mapExciseResult(
  base: CalculateExciseDto,
  result: ExciseResult,
): ExciseCalculation {
  return {
    exciseAmountCents: result.taxCents,
    // Echo the requested category literal — the service normalises to the
    // canonical seed key (e.g. wine → wine_still), which is provenance, not
    // part of the published response vocabulary.
    category: base.category,
    rateVersionId: result.taxDatasetVersion,
    calculatedAt: new Date(),
    evidence: {
      volumeLitres: result.volumeLitres,
      alcoholByVolume: result.abv,
      // rateApplied is €/litre of product; the published field is cents.
      rateAppliedCentsPerUnit: Math.round(result.rateApplied * 100),
    },
  };
}

function mapContainerDutyResult(
  containerType: NonNullable<CalculateLandedCostDto['containerType']>,
  result: ContainerDutyResult,
): ContainerDutyCalculation {
  return {
    dutyAmountCents: result.dutyCents,
    // VERIFIED (rate confirmed against the published table) is the exact
    // outcome for this route; anything less maps to ESTIMATED.
    reliability: result.reliability === 'VERIFIED' ? 'EXACT' : 'ESTIMATED',
    evidence: {
      containerType,
      volumeLitres: result.volumeLitres,
      rateAppliedCentsPerLitre: Math.round(result.ratePerLitre * 100),
      depositExemptionApplied: result.depositExemption?.exempted ?? false,
    },
  };
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function validateExciseBase(dto: CalculateExciseDto): void {
  const errors: string[] = [];

  if (!EXCISE_CATEGORIES.includes(dto.category)) {
    errors.push(`category must be one of: ${EXCISE_CATEGORIES.join(', ')}`);
  }
  if (
    typeof dto.volumeLitres !== 'number' ||
    !Number.isFinite(dto.volumeLitres) ||
    dto.volumeLitres <= 0
  ) {
    errors.push('volumeLitres must be a positive number');
  }
  if (
    typeof dto.alcoholByVolume !== 'number' ||
    !Number.isFinite(dto.alcoholByVolume) ||
    dto.alcoholByVolume < 0 ||
    dto.alcoholByVolume > 1
  ) {
    errors.push('alcoholByVolume must be a decimal fraction between 0 and 1 (e.g. 0.047 for 4.7 %)');
  }

  if (errors.length > 0) {
    throw new BadRequestException({
      statusCode: 400,
      message: errors.join('; '),
      error: 'ValidationError',
    });
  }
}

function validateLandedCostRequest(dto: CalculateLandedCostDto): void {
  const errors: string[] = [];

  if (!Number.isInteger(dto.retailPriceCents) || dto.retailPriceCents < 0) {
    errors.push('retailPriceCents must be a non-negative integer');
  }
  if (!Number.isInteger(dto.transportCostCents) || dto.transportCostCents < 0) {
    errors.push('transportCostCents must be a non-negative integer');
  }
  if (!TRANSACTION_CLASSES.includes(dto.transactionClass)) {
    errors.push(`transactionClass must be one of: ${TRANSACTION_CLASSES.join(', ')}`);
  }
  if (dto.containerType !== null && !CONTAINER_TYPES.includes(dto.containerType)) {
    errors.push(`containerType must be one of: ${CONTAINER_TYPES.join(', ')}, or null`);
  }
  if (dto.containerType !== null) {
    if (
      typeof dto.containerVolumeLitres !== 'number' ||
      !Number.isFinite(dto.containerVolumeLitres) ||
      dto.containerVolumeLitres <= 0
    ) {
      errors.push('containerVolumeLitres must be a positive number when containerType is present');
    }
    if (typeof dto.depositSystemVerified !== 'boolean') {
      errors.push('depositSystemVerified must be a boolean');
    }
  }
  if (dto.exciseBase !== null) {
    try {
      validateExciseBase(dto.exciseBase);
    } catch (err) {
      if (err instanceof BadRequestException) {
        const body = err.getResponse() as { message?: string };
        errors.push(`exciseBase: ${body.message ?? 'invalid'}`);
      } else {
        throw err;
      }
    }
  }

  if (errors.length > 0) {
    throw new BadRequestException({
      statusCode: 400,
      message: errors.join('; '),
      error: 'ValidationError',
    });
  }
}
