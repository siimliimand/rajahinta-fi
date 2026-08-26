/**
 * FeatureFlagsController — minimal public read of flag state for UI gating.
 *
 * GET /api/v1/feature-flags returns the enabled/disabled boolean of every
 * {@link FeatureFlag} so the frontend can hide flag-gated UI sections and
 * skip their requests entirely (design decision 7: a flag such as
 * `enable_historical_price_intelligence` gates both the API route and the
 * UI that calls it).
 *
 * Only booleans are exposed — rollout percentages and entity bucketing stay
 * server-side. The endpoint is a static config read with no PII; the same
 * information is already inferable from guarded routes answering 403 vs 200,
 * so it is public and carries no guards of its own.
 *
 * @module FeatureFlagsController
 */

import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FeatureFlagService } from './feature-flag.service';
import { FeatureFlag, FeatureFlagConfig } from './feature-flag.types';

/** Response shape of GET /api/v1/feature-flags. */
export interface FeatureFlagsResponseDto {
  readonly flags: FeatureFlagConfig;
}

@ApiTags('feature-flags')
@Controller('api/v1/feature-flags')
export class FeatureFlagsController {
  constructor(private readonly featureFlags: FeatureFlagService) {}

  // ---------------------------------------------------------------------------
  // GET /api/v1/feature-flags
  // ---------------------------------------------------------------------------

  @Get()
  @ApiOperation({
    summary: 'Public feature-flag states for UI gating',
    description:
      'Returns the enabled/disabled boolean of every feature flag so the ' +
      'frontend can hide gated UI and skip its requests when a flag is off. ' +
      'Booleans only — rollout percentages are not exposed.',
  })
  @ApiResponse({
    status: 200,
    description: 'Flag identifier → enabled boolean for every flag',
  })
  getFlags(): FeatureFlagsResponseDto {
    const flags = {} as FeatureFlagConfig;
    for (const flag of Object.values(FeatureFlag)) {
      flags[flag] = this.featureFlags.isEnabled(flag);
    }
    return { flags };
  }
}
