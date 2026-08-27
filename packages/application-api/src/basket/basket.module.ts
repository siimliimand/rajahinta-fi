/**
 * Basket Module — basket optimization API endpoint.
 *
 * Declares BasketOptimizerController and imports the dependencies it needs:
 * OptimizerModule (for BasketOptimizerService), DataPlatformModule (for the
 * TAX_RULE_REPOSITORY_PORT binding), and IdempotencyModule (for the raw
 * IIdempotencyCache token).
 *
 * @module BasketModule
 */

import { Module } from '@nestjs/common';
import { OptimizerModule } from '@rajahinta/core-domain';
import { DataPlatformModule } from '@rajahinta/data-platform';
import { IdempotencyModule } from '../idempotency';
import { BasketOptimizerController } from './basket-optimizer.controller';

@Module({
  imports: [
    // OptimizerModule provides BasketOptimizerService; the MERCHANT_TERMS_PORT
    // and BASKET_CALCULATION_RECORD_PORT placeholders are overridden at the
    // composition root (OptimizerWiringModule in apps/backend/).
    OptimizerModule,
    // Provides TAX_RULE_REPOSITORY_PORT binding (TaxRuleRepositoryAdapter)
    // visible within this module's scope — required by the controller for
    // version-aware idempotency key derivation.
    DataPlatformModule,
    // Provides IdempotencyService + IDEMPOTENCY_CACHE for idempotency logic.
    IdempotencyModule,
  ],
  controllers: [BasketOptimizerController],
})
export class BasketModule {}