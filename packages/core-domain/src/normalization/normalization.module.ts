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

@Module({
  providers: [NormalizationService],
  exports: [NormalizationService],
})
export class NormalizationModule {}