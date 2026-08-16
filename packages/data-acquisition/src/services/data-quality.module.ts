/**
 * Data-quality module.
 *
 * Registers and exports {@link DataQualityService} for injection into
 * the pipeline orchestrator and any other consumers that need automated
 * data-freshness checks.
 *
 * Requires {@link ReliabilityService} from core-domain which is already
 * provided by {@link CoreDomainModule}.
 *
 * @module DataQualityModule
 */

import { Module } from '@nestjs/common';
import { DataQualityService } from './data-quality.service';

@Module({
  providers: [DataQualityService],
  exports: [DataQualityService],
})
export class DataQualityModule {}