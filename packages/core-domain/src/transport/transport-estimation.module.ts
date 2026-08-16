import { Module } from '@nestjs/common';
import { TransportEstimationService } from './transport-estimation.service';
import { BasketShippingCalculator } from './basket-shipping-calculator.service';
import { TransportClassificationService } from './transport-classification.service';
import { TRANSPORT_OFFER_QUERY } from './transport-offer-query.interface';

/**
 * Transport Estimation Module.
 *
 * Provides transport cost estimation logic (weight-tier matching, route
 * filtering, basket-level aggregation) and transport-arrangement
 * classification to the rest of the application.  The actual data access
 * must be wired by the consuming layer (e.g., Data Platform) by providing an
 * implementation of {@link ITransportOfferQuery}.
 *
 * Usage from a consuming module:
 *
 * ```ts
 * @Module({
 *   imports: [TransportEstimationModule],
 *   providers: [
 *     { provide: ITransportOfferQuery, useClass: MyAdapter },
 *   ],
 * })
 * export class MyModule {}
 * ```
 */
@Module({
  providers: [
    TransportEstimationService,
    BasketShippingCalculator,
    TransportClassificationService,
    { provide: TRANSPORT_OFFER_QUERY, useValue: null },
  ],
  exports: [
    TransportEstimationService,
    BasketShippingCalculator,
    TransportClassificationService,
  ],
})
export class TransportEstimationModule {}