/**
 * OpsDatasetConfirmationController — tax-rate and FX dataset-version
 * confirmation endpoints of the operator console (task 12.1, change
 * technical-assessment-remediation).
 *
 * The queue lists PENDING_CONFIRMATION FX datasets (incl. their rates for
 * provenance) and pending tax rate-review entries; confirmation publishes
 * (FX) or resolves (tax) with a durable audit event per action. FX
 * publication additionally invalidates idempotency-cache entries keyed on
 * the replaced dataset version.
 *
 * @module OpsDatasetConfirmationController
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OpsAccessGuard } from '../../observability';
import { FeatureFlagGuard, FeatureFlagDec, FeatureFlag } from '../../feature-flags';
import type {
  OpsConfirmationListResponse,
  OpsFxDatasetConfirmedResponse,
  OpsTaxReviewResolvedResponse,
  OperatorActionDto,
} from '../ops.dto';
import { OpsDatasetConfirmationService } from './ops-dataset-confirmation.service';

@ApiTags('ops')
@Controller('ops/console/confirmations')
@UseGuards(OpsAccessGuard, FeatureFlagGuard)
@FeatureFlagDec(FeatureFlag.OPERATOR_CONSOLE)
export class OpsDatasetConfirmationController {
  constructor(private readonly confirmations: OpsDatasetConfirmationService) {}

  // ---------------------------------------------------------------------------
  // GET /ops/console/confirmations — the confirmation queue
  // ---------------------------------------------------------------------------

  @Get()
  @ApiOperation({
    summary: 'Pending dataset-version confirmations (operator console)',
    description:
      'FX datasets in PENDING_CONFIRMATION with provenance and rates, plus ' +
      'pending tax rate-review entries. Nothing here is effective yet — ' +
      'nothing auto-publishes.',
  })
  @ApiResponse({ status: 200, description: 'Pending FX datasets and tax reviews' })
  @ApiResponse({ status: 403, description: 'Unauthenticated, outside the allowlist, or flag off' })
  async list(): Promise<OpsConfirmationListResponse> {
    return this.confirmations.listPendingConfirmations();
  }

  // ---------------------------------------------------------------------------
  // POST /ops/console/confirmations/fx/:id/confirm — publish an FX dataset
  // ---------------------------------------------------------------------------

  @Post('fx/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm (publish) a pending FX dataset version',
    description:
      'The only PENDING_CONFIRMATION → PUBLISHED transition. On publication, ' +
      'idempotency-cache entries keyed on the previously effective FX dataset ' +
      'version are invalidated (dataset-version convention). Audited with ' +
      'operator identity.',
  })
  @ApiResponse({ status: 200, description: 'Dataset published; replaced version reported' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Unauthenticated, outside the allowlist, or flag off' })
  @ApiResponse({ status: 404, description: 'Dataset not found' })
  @ApiResponse({ status: 409, description: 'Dataset is not PENDING_CONFIRMATION' })
  async confirmFx(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: OperatorActionDto,
  ): Promise<OpsFxDatasetConfirmedResponse> {
    this.validateOperator(dto);
    return this.confirmations.confirmFxDataset(id, dto);
  }

  // ---------------------------------------------------------------------------
  // POST /ops/console/confirmations/tax/:id/approve
  // ---------------------------------------------------------------------------

  @Post('tax/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a pending tax rate-review entry',
    description:
      'Moves the reviewed version toward effectiveness and resolves the ' +
      'legal-compliance record. Audited with operator identity.',
  })
  @ApiResponse({ status: 200, description: 'Review resolved as approved' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Unauthenticated, outside the allowlist, or flag off' })
  @ApiResponse({ status: 404, description: 'Review not found' })
  @ApiResponse({ status: 409, description: 'Review already resolved' })
  async approveTax(
    @Param('id') id: string,
    @Body() dto: OperatorActionDto,
  ): Promise<OpsTaxReviewResolvedResponse> {
    this.validateOperator(dto);
    return this.confirmations.approveTaxReview(id, dto);
  }

  // ---------------------------------------------------------------------------
  // POST /ops/console/confirmations/tax/:id/reject
  // ---------------------------------------------------------------------------

  @Post('tax/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject a pending tax rate-review entry',
    description:
      'Resolves the review while keeping the previous version effective — ' +
      'no dataset transition, no cache invalidation. Audited with operator identity.',
  })
  @ApiResponse({ status: 200, description: 'Review resolved as rejected' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Unauthenticated, outside the allowlist, or flag off' })
  @ApiResponse({ status: 404, description: 'Review not found' })
  @ApiResponse({ status: 409, description: 'Review already resolved' })
  async rejectTax(
    @Param('id') id: string,
    @Body() dto: OperatorActionDto,
  ): Promise<OpsTaxReviewResolvedResponse> {
    this.validateOperator(dto);
    return this.confirmations.rejectTaxReview(id, dto);
  }

  // ---------------------------------------------------------------------------
  // Imperative validation (project-wide pattern)
  // ---------------------------------------------------------------------------

  private validateOperator(dto: OperatorActionDto): void {
    if (
      typeof dto.operator !== 'string' ||
      dto.operator.trim() === '' ||
      dto.operator.trim().length > 128
    ) {
      throw new BadRequestException('operator must be a non-empty string (max 128 chars)');
    }
    if (dto.note !== undefined && typeof dto.note !== 'string') {
      throw new BadRequestException('note must be a string when provided');
    }
  }
}
