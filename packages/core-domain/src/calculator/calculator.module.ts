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
import { Module, type Provider, type Type } from '@nestjs/common';
import { TaxModule, type TaxModuleOptions } from '../tax/tax.module';
import { NormalizationModule } from '../normalization/normalization.module';
import { ClassificationModule } from '../classification/classification.module';
import { TransportEstimationModule } from '../transport/transport-estimation.module';
import { ReliabilityModule } from '../reliability/reliability.module';
import { LandedCostCalculatorService } from './landed-cost-calculator.service';
import type { IProductDataPort, ICalculationRecordPort } from './calculator.types';
import { PRODUCT_DATA_PORT, CALCULATION_RECORD_PORT } from './calculator.types';

/**
 * Port implementations a composition root may inject via `forRoot`.
 * Omitted ports keep the null default (tests inject via overrideProvider).
 *
 * `extraProviders` registers dependencies the port adapters themselves need
 * (e.g. repository bindings from outer layers) inside this module's scope —
 * providers registered only in a host module are not visible here.
 */
export interface CalculatorPorts extends TaxModuleOptions {
  productDataPort?: Type<IProductDataPort>;
  calculationRecordPort?: Type<ICalculationRecordPort>;
  extraProviders?: Provider[];
}

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
  // The port tokens are exported so controllers in consuming layers can
  // inject whichever implementation this module was configured with.
  exports: [LandedCostCalculatorService, PRODUCT_DATA_PORT, CALCULATION_RECORD_PORT],
})
export class CalculatorModule {
  /**
   * Configure the module with concrete port implementations.
   *
   * The providers live in THIS module so they are visible to
   * LandedCostCalculatorService, which consumes the ports; providers
   * registered only at a host's AppModule are not visible across the
   * import graph (NestJS resolves within the module's own closure).
   *
   * Returns a fresh module identity (not this decorated class): reusing
   * the class would make NestJS also register the class's static
   * null-port metadata alongside the configured instance.
   */
  static forRoot(ports: CalculatorPorts) {
    const providers: Provider[] = [LandedCostCalculatorService, ...(ports.extraProviders ?? [])];
    providers.push(
      ports.productDataPort
        ? { provide: PRODUCT_DATA_PORT, useClass: ports.productDataPort }
        : { provide: PRODUCT_DATA_PORT, useValue: null },
    );
    providers.push(
      ports.calculationRecordPort
        ? { provide: CALCULATION_RECORD_PORT, useClass: ports.calculationRecordPort }
        : { provide: CALCULATION_RECORD_PORT, useValue: null },
    );

    return {
      module: CalculatorConfiguredModule,
      imports: [
        // TaxModule.forRoot so the tax-rule repository binding reaches the
        // AlcoholExciseService instance this module's calculator consumes —
        // importing the static TaxModule would shadow it with the null port.
        TaxModule.forRoot(ports),
        NormalizationModule,
        ClassificationModule,
        TransportEstimationModule,
        ReliabilityModule,
      ],
      providers,
      exports: [LandedCostCalculatorService, PRODUCT_DATA_PORT, CALCULATION_RECORD_PORT],
    };
  }
}

/**
 * Identity of the CONFIGURED calculator module returned by
 * {@link CalculatorModule.forRoot} — deliberately undecorated.
 */
export class CalculatorConfiguredModule {}