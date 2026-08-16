/**
 * Declaration Module.
 *
 * Provides the ExciseDeclarationService that packages a completed landed-cost
 * calculation into a structured declaration summary.
 *
 * Consuming layers must wire the calculation-record query port:
 *
 * ```typescript
 * @Module({
 *   imports: [DeclarationModule],
 *   providers: [
 *     { provide: CALCULATION_RECORD_QUERY_PORT, useClass: MyRecordQueryAdapter },
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * @module DeclarationModule
 */

import { Module } from '@nestjs/common';
import { ExciseDeclarationService } from './excise-declaration.service';

@Module({
  imports: [],
  providers: [ExciseDeclarationService],
  exports: [ExciseDeclarationService],
})
export class DeclarationModule {}