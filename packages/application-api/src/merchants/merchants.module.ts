/**
 * Merchants Module — registration and dependency wiring for the merchant
 * reliability API (task 3.4, change phase2-advanced-features).
 *
 * The factual score pipeline is assembled from package exports: offer
 * aggregates from DataPlatformModule (MerchantReliabilityRepository),
 * scoring rules from ReliabilityModule (MerchantReliabilityScoreService),
 * and per-merchant permission status from SourceGovernanceModule
 * (SourceGovernanceService). The governance repository port still carries
 * the shared null default — MerchantReliabilityService degrades unresolved
 * merchants to PENDING and never overstates permission.
 *
 * MerchantReliabilityService is exported so the search module's product
 * detail embed (same change, task 3.4) can reuse the identical pipeline.
 *
 * Guards (LaunchGateGuard, FeatureFlagGuard / AgeGateGuard) resolve from
 * the global FeatureFlagsModule / AgeGateModule — no additional imports
 * needed for them.
 *
 * @module MerchantsModule
 */

import { Module } from '@nestjs/common';
import {
  ReliabilityModule,
  SourceGovernanceModule,
} from '@rajahinta/core-domain';
import { DataPlatformModule } from '@rajahinta/data-platform';
import { MerchantReliabilityController } from './merchants.controller';
import { MerchantReliabilityService } from './merchant-reliability.service';

@Module({
  imports: [DataPlatformModule, ReliabilityModule, SourceGovernanceModule],
  providers: [MerchantReliabilityService],
  controllers: [MerchantReliabilityController],
  exports: [MerchantReliabilityService],
})
export class MerchantsModule {}
