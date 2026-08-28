/**
 * MerchantReliabilityController — factual per-merchant reliability scores
 * (task 3.4, change phase2-advanced-features).
 *
 * GET /api/v1/merchants/reliability returns one score per merchant that
 * holds at least one current offer. The score is informational only —
 * counts, shares, strictest status, and governance permission status; it
 * is never a merchant endorsement and never a ranking input.
 *
 * Guards: reliability is derived from price data, so the endpoint carries
 * the PRICE_DATA launch gate; the age gate applies because the product
 * catalog is alcohol; the ADVANCED_FEATURES flag allows instant rollback.
 *
 * @module MerchantReliabilityController
 */

import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  FeatureFlag,
  FeatureFlagDec,
  FeatureFlagGuard,
  LaunchGate,
  LaunchGateGuard,
  LaunchGateType,
} from '../feature-flags';
import { AgeGateGuard } from '../age-gate';
import { MerchantReliabilityService } from './merchant-reliability.service';
import type { MerchantReliabilityListResponse } from './merchants.dto';

@UseGuards(LaunchGateGuard, AgeGateGuard, FeatureFlagGuard)
@LaunchGate(LaunchGateType.PRICE_DATA)
@FeatureFlagDec(FeatureFlag.ADVANCED_FEATURES)
@ApiTags('merchants')
@Controller('api/v1/merchants')
export class MerchantReliabilityController {
  constructor(
    private readonly reliability: MerchantReliabilityService,
  ) {}

  // ---------------------------------------------------------------------------
  // GET /api/v1/merchants/reliability — scores for all merchants
  // ---------------------------------------------------------------------------

  @Get('reliability')
  @ApiOperation({
    summary: 'Factual reliability scores for all merchants',
    description:
      'Per-merchant counts, shares, and strictest status over that ' +
      "merchant's current retail offers, plus the governance permission " +
      'status of their data sources. Informational only — never a ranking input.',
  })
  @ApiResponse({
    status: 200,
    description: 'Reliability score per merchant with current offers',
  })
  @ApiResponse({
    status: 403,
    description: 'Launch gate, age gate, or feature flag not satisfied',
  })
  async getReliability(): Promise<MerchantReliabilityListResponse> {
    return { merchants: await this.reliability.getReliabilityScores() };
  }
}
