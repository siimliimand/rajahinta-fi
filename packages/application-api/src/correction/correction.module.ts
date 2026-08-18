/**
 * CorrectionModule — registration and dependency wiring for the correction API.
 *
 * Wires {@link CorrectionController}, {@link CorrectionService}, and the
 * in-memory {@link InMemoryCorrectionRepository} under the
 * {@link CORRECTION_REPOSITORY_PORT} token.
 *
 * **Production swap:** Replace `InMemoryCorrectionRepository` with
 * `DrizzleCorrectionRepository` from `@rajahinta/data-platform` by changing
 * the `useClass` binding below.
 *
 * @module CorrectionModule
 */

import { Module } from '@nestjs/common';
import { CorrectionController } from './correction.controller';
import { CorrectionService } from './correction.service';
import { InMemoryCorrectionRepository } from './in-memory-correction.repository';
import { CORRECTION_REPOSITORY_PORT } from './correction-repository.port';

@Module({
  controllers: [CorrectionController],
  providers: [
    CorrectionService,
    {
      provide: CORRECTION_REPOSITORY_PORT,
      useClass: InMemoryCorrectionRepository,
    },
    InMemoryCorrectionRepository,
  ],
  exports: [CorrectionService, CORRECTION_REPOSITORY_PORT],
})
export class CorrectionModule {}

export { CorrectionService } from './correction.service';
export { InMemoryCorrectionRepository } from './in-memory-correction.repository';
export {
  CORRECTION_REPOSITORY_PORT,
  type ICorrectionRepository,
} from './correction-repository.port';
export type {
  CreateCorrectionDto,
  CorrectionItem,
  CorrectionListResponse,
} from './correction.dto';