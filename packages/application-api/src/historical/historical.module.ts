/**
 * Historical Data Module — price-history API (task 4.1, change
 * 2026-08-26-phase2-historical-price-intelligence).
 *
 * Declares HistoricalDataController and the pure read-time
 * TaxChangeAttributionService. Persistence dependencies (summary /
 * observation / product repositories and the tax-rule repository port) are
 * injected as the data-platform abstract tokens exported by
 * DataPlatformModule — the module stays storage-agnostic.
 *
 * Guards resolve from the global FeatureFlagsModule / RateLimitingModule /
 * AgeGateModule, so no additional imports are needed for them.
 *
 * @module HistoricalDataModule
 */

import { Module } from '@nestjs/common';
import { DataPlatformModule } from '@rajahinta/data-platform';
import { TaxChangeAttributionService } from '@rajahinta/core-domain';
import { HistoricalDataController } from './historical.controller';

@Module({
  imports: [DataPlatformModule],
  providers: [TaxChangeAttributionService],
  controllers: [HistoricalDataController],
})
export class HistoricalDataModule {}
