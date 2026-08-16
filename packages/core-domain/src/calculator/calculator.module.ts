/**
 * Calculator Module.
 *
 * Aggregates the LandedCostCalculatorService orchestrator and declares
 * the ports that consuming layers must provide:
 *
 * - {@link PRODUCT_DATA_PORT} — product master + retail offer lookups
 * - {@link CALCULATION_RECORD_PORT} — persistence of calculation results
 *
 * ## Wiring from the app composition root
 *
 * ```typescript
 * @Module({
 *   imports: [CalculatorModule],
 *   providers: [
 *     { provide: PRODUCT_DATA_PORT, useClass: MyProductAdapter },
 *     { provide: CALCULATION_RECORD_PORT, useClass: MyCalculationRecordAdapter },
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * @module CalculatorModule
 */
import { Module } from '@nestjs/common';
import { TaxModule } from '../tax/tax.module';
import { NormalizationModule } from '../normalization/normalization.module';
import { ClassificationModule } from '../classification/classification.module';
import { TransportEstimationModule } from '../transport/transport-estimation.module';
import { ReliabilityModule } from '../reliability/reliability.module';
import { LandedCostCalculatorService } from './landed-cost-calculator.service';
import { PRODUCT_DATA_PORT, CALCULATION_RECORD_PORT } from './calculator.types';

@Module({
  imports: [
    TaxModule,
    NormalizationModule,
    ClassificationModule,
    TransportEstimationModule,
    ReliabilityModule,
  ],
  providers: [
    LandedCostCalculatorService,
    { provide: PRODUCT_DATA_PORT, useValue: null },
    { provide: CALCULATION_RECORD_PORT, useValue: null },
  ],
  exports: [LandedCostCalculatorService],
})
export class CalculatorModule {}