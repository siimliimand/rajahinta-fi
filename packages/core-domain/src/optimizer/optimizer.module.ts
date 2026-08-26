/**
 * Basket Optimizer Module.
 *
 * Registers the basket optimization engine, the BasketOptimizerService,
 * and its injected dependencies.  Imports the NormalizationModule (for
 * ClassificationGateService), CalculatorModule (for LandedCostCalculatorService
 * and its IProductDataPort), and TransportEstimationModule (for
 * BasketShippingCalculator).
 *
 * The MERCHANT_TERMS_PORT token is declared here with a null default;
 * the composition root wires a concrete adapter (e.g. Drizzle adapter
 * in apps/backend/).
 *
 * Import this module into CoreDomainModule to make the optimizer available
 * for injection.
 *
 * @module OptimizerModule
 */
import { Module } from '@nestjs/common';
import { NormalizationModule } from '../normalization/normalization.module';
import { CalculatorModule } from '../calculator/calculator.module';
import { TransportEstimationModule } from '../transport/transport-estimation.module';
import { BasketOptimizerService } from './services/basket-optimizer.service';
import { MERCHANT_TERMS_PORT } from './ports/merchant-terms.port';

@Module({
  imports: [
    NormalizationModule,
    CalculatorModule,
    TransportEstimationModule,
  ],
  providers: [
    BasketOptimizerService,
    { provide: MERCHANT_TERMS_PORT, useValue: null },
  ],
  exports: [
    BasketOptimizerService,
    MERCHANT_TERMS_PORT,
  ],
})
export class OptimizerModule {}