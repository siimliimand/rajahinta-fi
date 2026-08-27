/**
 * Optimizer Wiring Module — composition-root bindings for basket optimization.
 *
 * Imports OptimizerModule from core-domain and wires concrete adapters
 * under the MERCHANT_TERMS_PORT and BASKET_CALCULATION_RECORD_PORT injection
 * tokens, overriding the skeleton `useValue: null` placeholders the module
 * ships with (module-level providers are shadowed by these).
 *
 * Import this module into AppModule to make optimizer services available
 * for injection across the application graph.
 *
 * @module OptimizerWiringModule
 */

import { Module } from '@nestjs/common';
import { OptimizerModule, MERCHANT_TERMS_PORT, BASKET_CALCULATION_RECORD_PORT } from '@rajahinta/core-domain';
import { MerchantTermsAdapter } from './adapters/merchant-terms.adapter';
import { BasketCalculationRecordAdapter } from './adapters/basket-calculation-record.adapter';

@Module({
  imports: [OptimizerModule],
  providers: [
    MerchantTermsAdapter,
    BasketCalculationRecordAdapter,
    { provide: MERCHANT_TERMS_PORT, useClass: MerchantTermsAdapter },
    { provide: BASKET_CALCULATION_RECORD_PORT, useClass: BasketCalculationRecordAdapter },
  ],
})
export class OptimizerWiringModule {}
