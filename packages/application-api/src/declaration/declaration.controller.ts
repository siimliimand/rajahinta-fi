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
import { FeatureFlag, FeatureFlagService } from '../feature-flags';
import type { DeclarationSummaryResponse } from './declaration.dto';

@ApiTags('declaration')
@Controller('api/v1/declaration')
@UseGuards(AgeGateGuard)
export class DeclarationController {
  constructor(
    private readonly declarationService: ExciseDeclarationService,
    private readonly featureFlags: FeatureFlagService,
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
    description:
      'Structured declaration summary with excise breakdown and advance-notice info; ' +
      'includes the guidance object only when the ADVANCED_FEATURES flag is enabled',
  })
  @ApiResponse({ status: 404, description: 'Calculation record not found' })
  async prepareDeclaration(
    @Param('recordId', ParseIntPipe) recordId: number,
  ): Promise<DeclarationSummaryResponse> {
    try {
      const summary: DeclarationSummary =
        await this.declarationService.prepareDeclaration(recordId);

      // Design D5 — the guidance FIELD is gated by ADVANCED_FEATURES while
      // the route stays entitled as before. Flag off: strip guidance so the
      // key is absent (undefined, not null) and the response stays
      // byte-compatible with pre-guidance payloads.
      if (!this.featureFlags.isEnabled(FeatureFlag.ADVANCED_FEATURES)) {
        const { guidance: _gatedOff, ...withoutGuidance } = summary;
        return withoutGuidance;
      }

      return summary;
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