/**
 * Basket Optimizer Module.
 *
 * Registers the basket optimization engine and exports the merchant-terms
 * port token so the composition root can wire a concrete adapter.
 *
 * Services are registered as they are added in subsequent tasks; this
 * module is initially empty (skeleton for the module identity).
 *
 * Import this module into CoreDomainModule to make the optimizer available
 * for injection.
 *
 * @module OptimizerModule
 */
import { Module } from '@nestjs/common';
import { MERCHANT_TERMS_PORT } from './ports/merchant-terms.port';

@Module({
  providers: [
    { provide: MERCHANT_TERMS_PORT, useValue: null },
  ],
  exports: [
    MERCHANT_TERMS_PORT,
  ],
})
export class OptimizerModule {}