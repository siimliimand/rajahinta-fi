import { Module, Global } from '@nestjs/common';
import { FeatureFlagService } from './feature-flag.service';
import { FeatureFlagGuard } from './feature-flags.guard';
import { LaunchGateService } from './launch-gate.service';
import { LaunchGateGuard } from './launch-gate.guard';

/**
 * Global module that provides synchronous feature-flag resolution
 * and launch-gate controls across the application-api layer.
 */
@Global()
@Module({
  providers: [
    FeatureFlagService,
    FeatureFlagGuard,
    LaunchGateService,
    LaunchGateGuard,
  ],
  exports: [
    FeatureFlagService,
    FeatureFlagGuard,
    LaunchGateService,
    LaunchGateGuard,
  ],
})
export class FeatureFlagsModule {}