/**
 * History Recording Module — composition-root wiring for price observations.
 *
 * Two responsibilities (change 2026-08-26-phase2-historical-price-intelligence,
 * task 2.2):
 *
 * 1. Import HistoryModule.forRoot so PriceObservationRecorderService exists
 *    with real port implementations:
 *      - PRICE_OBSERVATION_PORT → DrizzlePriceObservationRepository
 *        (append-only observation log; one class serves both the abstract
 *        repository and the domain port)
 *      - PRODUCT_DATA_PORT → ProductDataAdapter (same adapter the calculator
 *        uses, so observations and calculator runs resolve identical product
 *        data)
 *      - tax-rule repository → TaxRuleRepositoryAdapter (the recorder's tax
 *        engines resolve rule versions effective at observedAt)
 *    The port classes are instantiated inside the history module's scope;
 *    extraProviders register ProductDataAdapter's repository dependency
 *    there, mirroring the ApplicationApiModule.forRoot calculator wiring.
 *
 * 2. Register OfferChangeRecorderHook under OFFER_CHANGE_HOOK_TOKEN and
 *    export it globally. The ingestion pipeline (data-acquisition, imported
 *    via DataAcquisitionModule here and via JobsModule inside
 *    ApplicationApiModule) injects the token optionally; @Global makes the
 *    binding visible to the pipeline's module scope without coupling
 *    data-acquisition to core-domain history. Hosts that do not import this
 *    module run the pipeline with the hook unbound (no observations).
 *
 * The recorder executes only when the price-ingestion background job
 * processes a changed offer — this module adds nothing to the request path.
 *
 * @module HistoryRecordingModule
 */

import { Global, Module } from '@nestjs/common';
import { HistoryModule } from '@rajahinta/core-domain';
import {
  ProductRepository,
  DrizzleProductRepository,
  DrizzlePriceObservationRepository,
  TaxRuleRepositoryAdapter,
} from '@rajahinta/data-platform';
import { OFFER_CHANGE_HOOK_TOKEN } from '@rajahinta/data-acquisition';
import { ProductDataAdapter } from './adapters/product-data.adapter';
import { OfferChangeRecorderHook } from './adapters/offer-change-recorder-hook.adapter';

@Global()
@Module({
  imports: [
    HistoryModule.forRoot({
      priceObservationPort: DrizzlePriceObservationRepository,
      productDataPort: ProductDataAdapter,
      taxRuleRepository: TaxRuleRepositoryAdapter,
      extraProviders: [
        { provide: ProductRepository, useClass: DrizzleProductRepository },
      ],
    }),
  ],
  providers: [
    OfferChangeRecorderHook,
    { provide: OFFER_CHANGE_HOOK_TOKEN, useClass: OfferChangeRecorderHook },
  ],
  exports: [OFFER_CHANGE_HOOK_TOKEN],
})
export class HistoryRecordingModule {}
