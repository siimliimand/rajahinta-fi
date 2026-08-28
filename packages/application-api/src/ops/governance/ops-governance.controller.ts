/**
 * OpsGovernanceController — governance permission endpoints of the
 * operator console (task 12.1, change technical-assessment-remediation).
 *
 * Separate auth realm: OpsAccessGuard (bearer token + IP allowlist,
 * fail-closed) runs before the feature flag; access is denied before any
 * operational data is returned to unauthenticated callers.
 *
 * @module OpsGovernanceController
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AcquisitionMethod } from '@rajahinta/core-domain';
import { OpsAccessGuard } from '../../observability';
import { FeatureFlagGuard, FeatureFlagDec, FeatureFlag } from '../../feature-flags';
import type {
  GrantGovernanceDto,
  OpsGovernanceListResponse,
  OpsGovernanceMutationResponse,
  RevokeGovernanceDto,
} from '../ops.dto';
import { OpsGovernanceService } from './ops-governance.service';

const ACQUISITION_METHODS: readonly AcquisitionMethod[] = [
  'PERMITTED_FEED',
  'RETAILER_API',
  'STRUCTURED_MERCHANT_FEED',
  'LICENSED_PROVIDER',
  'COMPLIANT_CRAWLING',
  'MANUAL_VERIFICATION',
];

/** Structural subset the operator check needs. */
interface OperatorBody {
  operator?: unknown;
  note?: unknown;
}

@ApiTags('ops')
@Controller('ops/console/governance')
@UseGuards(OpsAccessGuard, FeatureFlagGuard)
@FeatureFlagDec(FeatureFlag.OPERATOR_CONSOLE)
export class OpsGovernanceController {
  constructor(private readonly governance: OpsGovernanceService) {}

  // ---------------------------------------------------------------------------
  // GET /ops/console/governance — registry + permission state
  // ---------------------------------------------------------------------------

  @Get()
  @ApiOperation({
    summary: 'Merchant governance worklist (operator console)',
    description:
      'Registry merchants with their aggregated governance permission state. ' +
      'Granting proceeds ingestion under the governance gate; every grant and ' +
      'revoke writes a durable audit event.',
  })
  @ApiResponse({ status: 200, description: 'Merchants with permission status' })
  @ApiResponse({ status: 403, description: 'Unauthenticated, outside the allowlist, or flag off' })
  async list(): Promise<OpsGovernanceListResponse> {
    return this.governance.listMerchantGovernance();
  }

  // ---------------------------------------------------------------------------
  // POST /ops/console/governance/:merchantId/grant
  // ---------------------------------------------------------------------------

  @Post(':merchantId/grant')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Grant source-governance permission for a merchant',
    description:
      'Transitions a PENDING/EXPIRED source to GRANTED or registers a new ' +
      'GRANTED source. Recorded with operator identity and timestamp.',
  })
  @ApiResponse({ status: 200, description: 'Permission granted (or already held)' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Unauthenticated, outside the allowlist, or flag off' })
  @ApiResponse({ status: 404, description: 'Merchant not in the registry' })
  async grant(
    @Param('merchantId') merchantId: string,
    @Body() dto: GrantGovernanceDto,
  ): Promise<OpsGovernanceMutationResponse> {
    this.validateGrant(dto);
    return this.governance.grantPermission(merchantId, dto);
  }

  // ---------------------------------------------------------------------------
  // POST /ops/console/governance/:merchantId/revoke
  // ---------------------------------------------------------------------------

  @Post(':merchantId/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke source-governance permission for a merchant',
    description:
      'Marks every registered source for the merchant REVOKED — ingestion ' +
      'stops under the governance gate. Reason is mandatory; audited.',
  })
  @ApiResponse({ status: 200, description: 'Permission revoked' })
  @ApiResponse({ status: 400, description: 'Invalid input (reason required)' })
  @ApiResponse({ status: 403, description: 'Unauthenticated, outside the allowlist, or flag off' })
  @ApiResponse({ status: 404, description: 'Merchant unknown or no governance records' })
  async revoke(
    @Param('merchantId') merchantId: string,
    @Body() dto: RevokeGovernanceDto,
  ): Promise<OpsGovernanceMutationResponse> {
    this.validateOperator(dto);
    if (typeof dto.reason !== 'string' || dto.reason.trim() === '') {
      throw new BadRequestException('reason is required for revocation');
    }
    return this.governance.revokePermission(merchantId, dto);
  }

  // ---------------------------------------------------------------------------
  // Imperative validation (project-wide pattern)
  // ---------------------------------------------------------------------------

  private validateOperator(dto: OperatorBody): void {
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

  private validateGrant(dto: GrantGovernanceDto): void {
    this.validateOperator(dto);
    if (!ACQUISITION_METHODS.includes(dto.acquisitionMethod)) {
      throw new BadRequestException(
        `acquisitionMethod must be one of: ${ACQUISITION_METHODS.join(', ')}`,
      );
    }
    if (typeof dto.sourceUrl !== 'string' || dto.sourceUrl.trim() === '') {
      throw new BadRequestException('sourceUrl must be a non-empty string');
    }
  }
}
