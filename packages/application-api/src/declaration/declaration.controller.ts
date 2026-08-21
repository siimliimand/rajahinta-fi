/**
 * DeclarationController — excise declaration assistant endpoints.
 *
 * Groups all declaration operations under `/api/v1/declaration`.
 *
 * @module DeclarationController
 */

import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  NotFoundException,
  InternalServerErrorException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  ExciseDeclarationService,
  DeclarationSummary,
  CalculationRecordNotFoundError,
} from '@rajahinta/core-domain';
import { EntitlementGuard, RequireFeature } from '../entitlement';
import { AgeGateGuard } from '../age-gate';

@ApiTags('declaration')
@Controller('api/v1/declaration')
@UseGuards(AgeGateGuard)
export class DeclarationController {
  constructor(
    private readonly declarationService: ExciseDeclarationService,
  ) {}

  // ---------------------------------------------------------------------------
  // GET /api/v1/declaration/:recordId — prepare declaration summary
  // ---------------------------------------------------------------------------

  @Get(':recordId')
  @UseGuards(EntitlementGuard)
  @RequireFeature('declaration:summary')
  @ApiOperation({
    summary: 'Prepare a structured excise declaration summary',
    description:
      'Packages a completed landed-cost calculation into a declaration-friendly ' +
      'format for Finnish customs / MyTax reference. Read-only — does NOT submit ' +
      'to any external system.  Requires PREMIUM entitlement.',
  })
  @ApiResponse({
    status: 200,
    description: 'Structured declaration summary with excise breakdown and advance-notice info',
  })
  @ApiResponse({ status: 404, description: 'Calculation record not found' })
  async prepareDeclaration(
    @Param('recordId', ParseIntPipe) recordId: number,
  ): Promise<DeclarationSummary> {
    try {
      return await this.declarationService.prepareDeclaration(recordId);
    } catch (err) {
      if (err instanceof CalculationRecordNotFoundError) {
        throw new NotFoundException(err.message);
      }
      throw new InternalServerErrorException(
        err instanceof Error ? err.message : 'Failed to prepare declaration summary',
      );
    }
  }
}