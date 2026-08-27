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
import { Module, type Provider, type Type } from '@nestjs/common';
import { CalculatorModule } from '../calculator/calculator.module';
import {
  type IProductDataPort,
  type ICalculationRecordPort,
} from '../calculator/calculator.types';
import { type TaxModuleOptions } from '../tax/tax.module';
import { NormalizationModule } from '../normalization/normalization.module';
import {
  TransportEstimationModule,
} from '../transport/transport-estimation.module';
import {
  TRANSPORT_OFFER_QUERY,
  type ITransportOfferQuery,
} from '../transport/transport-offer-query.interface';
import { BasketShippingCalculator } from '../transport/basket-shipping-calculator.service';
import { ReliabilityModule } from '../reliability/reliability.module';
import { BasketOptimizerService } from './services/basket-optimizer.service';
import { MERCHANT_TERMS_PORT, type IMerchantTermsPort } from './ports/merchant-terms.port';
import {
  BASKET_CALCULATION_RECORD_PORT,
  type IBasketCalculationRecordPort,
} from './ports/basket-calculation-record.port';

/**
 * Ports for {@link OptimizerModule.forRoot}. Omitted ports keep the null
 * default (tests inject via overrideProvider). `extraProviders` registers
 * dependencies the port adapters themselves need inside the optimizer
 * module's scope (mirrors HistoryModulePorts).
 */
export interface OptimizerModulePorts extends TaxModuleOptions {
  productDataPort?: Type<IProductDataPort>;
  calculationRecordPort?: Type<ICalculationRecordPort>;
  merchantTermsPort?: Type<IMerchantTermsPort>;
  basketCalculationRecordPort?: Type<IBasketCalculationRecordPort>;
  transportOfferQuery?: Type<ITransportOfferQuery>;
  extraProviders?: Provider[];
}

@Module({
  imports: [
    NormalizationModule,
    CalculatorModule,
    TransportEstimationModule,
    ReliabilityModule,
  ],
  providers: [
    BasketOptimizerService,
    { provide: MERCHANT_TERMS_PORT, useValue: null },
    { provide: BASKET_CALCULATION_RECORD_PORT, useValue: null },
  ],
  exports: [
    BasketOptimizerService,
    MERCHANT_TERMS_PORT,
    BASKET_CALCULATION_RECORD_PORT,
  ],
})
export class OptimizerModule {
  /**
   * Configure the optimizer with concrete port implementations. The ports
   * are bound inside this module's own scope so BasketOptimizerService sees
   * them — providers registered only at the host's composition root are
   * shadowed by the local null defaults above (same rationale as
   * CalculatorModule.forRoot / HistoryModule.forRoot).
   */
  static forRoot(ports: OptimizerModulePorts) {
    // The optimizer consumes LandedCostCalculatorService.computeItemCosts,
    // so its scope needs the CONFIGURED calculator — importing the static
    // CalculatorModule would give it null product-data and tax-rule ports.
    // CalculatorModule.forRoot also brings TaxModule.forRoot, so the tax
    // engines this optimizer's calculator calls resolve real rule versions.
    const calculator = CalculatorModule.forRoot({
      productDataPort: ports.productDataPort,
      calculationRecordPort: ports.calculationRecordPort,
      taxRuleRepository: ports.taxRuleRepository,
      extraProviders: ports.extraProviders,
    });

    const providers: Provider[] = [
      BasketOptimizerService,
      // Re-hosted locally so its TRANSPORT_OFFER_QUERY resolves against the
      // binding below (the TransportEstimationModule export carries that
      // module's local null binding instead).
      BasketShippingCalculator,
      // PRODUCT_DATA_PORT and CALCULATION_RECORD_PORT resolve from the
      // configured calculator's exports; only the optimizer-specific ports
      // are bound here, in this module's own scope.
      ...(ports.extraProviders ?? []),
    ];
    providers.push(
      ports.transportOfferQuery
        ? { provide: TRANSPORT_OFFER_QUERY, useClass: ports.transportOfferQuery }
        : { provide: TRANSPORT_OFFER_QUERY, useValue: null },
    );
    providers.push(
      ports.merchantTermsPort
        ? { provide: MERCHANT_TERMS_PORT, useClass: ports.merchantTermsPort }
        : { provide: MERCHANT_TERMS_PORT, useValue: null },
    );
    providers.push(
      ports.basketCalculationRecordPort
        ? { provide: BASKET_CALCULATION_RECORD_PORT, useClass: ports.basketCalculationRecordPort }
        : { provide: BASKET_CALCULATION_RECORD_PORT, useValue: null },
    );

    // Fresh identity per call (see HistoryModule.forRoot for the rationale):
    // a shared class identity would collapse configured and port-less
    // instances, letting null bindings overwrite the real adapters.
    const configured = class ConfiguredOptimizerModule {};

    return {
      module: configured,
      imports: [
        calculator,
        NormalizationModule,
        TransportEstimationModule,
        ReliabilityModule,
      ],
      providers,
      exports: [BasketOptimizerService],
    };
  }
}