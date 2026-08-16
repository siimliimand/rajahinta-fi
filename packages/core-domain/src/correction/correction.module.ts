/**
 * Correction Module.
 *
 * Registers the CorrectionService and exports the repository port tokens
 * so the composition root can wire concrete adapters.
 *
 * Import this module into CoreDomainModule to make CorrectionService
 * available for injection.
 *
 * @module CorrectionModule
 */
import { Module } from '@nestjs/common';
import { CorrectionService } from './correction.service';
import {
  CORRECTION_REPOSITORY_PORT,
  CORRECTION_CALCULATION_RECORD_QUERY_PORT,
} from './correction-repository.port';

@Module({
  providers: [
    CorrectionService,
    { provide: CORRECTION_REPOSITORY_PORT, useValue: null },
    { provide: CORRECTION_CALCULATION_RECORD_QUERY_PORT, useValue: null },
  ],
  exports: [CorrectionService, CORRECTION_REPOSITORY_PORT, CORRECTION_CALCULATION_RECORD_QUERY_PORT],
})
export class CorrectionModule {}