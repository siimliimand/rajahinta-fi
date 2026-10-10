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
  Query,
  NotFoundException,
  InternalServerErrorException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import {
  ExciseDeclarationService,
  DeclarationSummary,
  CalculationRecordNotFoundError,
} from '@rajahinta/core-domain';
import { EntitlementGuard, RequireFeature } from '../entitlement';
import { AgeGateGuard } from '../age-gate';
import type { DeclarationSummaryResponse } from './declaration.dto';

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
      'to any external system.  Requires PREMIUM entitlement. ' +
      'Optionally accepts a planned dispatch date (dispatchDate) that anchors the ' +
      'dated pre-dispatch filing checklist with the guarantee figure; an absent or ' +
      'unparseable date degrades factually to the undated checklist — never an error.',
  })
  @ApiQuery({
    name: 'dispatchDate',
    required: false,
    description:
      'Planned dispatch date as an ISO calendar date (YYYY-MM-DD). Anchors the dated ' +
      'pre-dispatch checklist: DATED (today or ahead), POST_DEADLINE (past relative to ' +
      'the filing state), UNDATED (absent, empty, or malformed — the same steps and ' +
      'citations render undated, with no deadline or derived dates). The date is a ' +
      'request parameter and is never persisted.',
    example: '2026-12-01',
  })
  @ApiResponse({
    status: 200,
    description:
      'Structured declaration summary with excise breakdown and advance-notice info; ' +
      'includes the guidance object and — additively — the dated pre-dispatch ' +
      'checklist (cited steps incl. the reference-number capture step), the guarantee ' +
      'figure with availability and reliability status, the return-due estimate when ' +
      'a usable date is supplied, and the deadline state ' +
      '(DATED / POST_DEADLINE / UNDATED)',
  })
  @ApiResponse({ status: 404, description: 'Calculation record not found' })
  async prepareDeclaration(
    @Param('recordId', ParseIntPipe) recordId: number,
    @Query('dispatchDate') dispatchDate?: string,
  ): Promise<DeclarationSummaryResponse> {
    try {
      // Read-only request parameter (design D2): absent/empty normalizes to
      // null; malformed values are passed through — the service's strict
      // calendar-date parse degrades them to the undated checklist.
      const summary: DeclarationSummary = await this.declarationService.prepareDeclaration(
        recordId,
        { plannedDispatchDate: dispatchDate ?? null },
      );

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