import { Module, Global } from '@nestjs/common';
import { FeatureFlagService } from './feature-flag.service';
import { FeatureFlagGuard } from './feature-flags.guard';

/**
 * Global module that provides synchronous feature-flag resolution
 * across the application-api layer.
 */
@Global()
@Module({
  providers: [FeatureFlagService, FeatureFlagGuard],
  exports: [FeatureFlagService, FeatureFlagGuard],
})
export class FeatureFlagsModule {}