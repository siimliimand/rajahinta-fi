/**
 * Normalization Module — transforms raw product data into canonical form.
 *
 * Import this module into CoreDomainModule to make NormalizationService
 * available for injection throughout the domain layer.
 *
 * @module NormalizationModule
 */
import { Module } from '@nestjs/common';
import { NormalizationService } from './normalization.service';
import { ClassificationGateService } from './classification-gate.service';

@Module({
  providers: [NormalizationService, ClassificationGateService],
  exports: [NormalizationService, ClassificationGateService],
})
export class NormalizationModule {}