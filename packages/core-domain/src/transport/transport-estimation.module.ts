import { Module } from '@nestjs/common';
import { TransportEstimationService } from './transport-estimation.service';

/**
 * Transport Estimation Module.
 *
 * Provides transport cost estimation logic (weight-tier matching, route
 * filtering) to the rest of the application.  The actual data access must
 * be wired by the consuming layer (e.g., Data Platform) by providing an
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
  providers: [TransportEstimationService],
  exports: [TransportEstimationService],
})
export class TransportEstimationModule {}