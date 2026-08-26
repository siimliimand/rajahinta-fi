/**
 * Optimizer Wiring Module — composition-root bindings for basket optimization.
 *
 * Imports OptimizerModule from core-domain and wires the concrete
 * MerchantTermsAdapter under the MERCHANT_TERMS_PORT injection token,
 * overriding the skeleton `useValue: null` placeholder the module ships
 * with (the module-level provider is shadowed by this module-level one).
 *
 * Import this module into AppModule to make optimizer services available
 * for injection across the application graph.
 *
 * @module OptimizerWiringModule
 */

import { Module } from '@nestjs/common';
import { OptimizerModule, MERCHANT_TERMS_PORT } from '@rajahinta/core-domain';
import { MerchantTermsAdapter } from './adapters/merchant-terms.adapter';

@Module({
  imports: [OptimizerModule],
  providers: [
    MerchantTermsAdapter,
    { provide: MERCHANT_TERMS_PORT, useClass: MerchantTermsAdapter },
  ],
})
export class OptimizerWiringModule {}
