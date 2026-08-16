/**
 * Transport Offer Query — the data-access port consumed by
 * TransportEstimationService.
 *
 * Defining this port in Core Domain ensures that the estimation logic never
 * depends on Drizzle, SQL, or Data Platform internals.  The Data Platform
 * layer provides the implementation by adapting its own ITransportOfferRepository
 * to this interface.
 *
 * @module TransportOfferQuery
 */

import type { TransportOffer } from './transport-offer.type';

/**
 * Narrow query surface that TransportEstimationService needs from
 * the data layer.  Consumers inject this, not the full IRepositoryRegistry.
 */
export interface ITransportOfferQuery {
  /** All currently active transport offers. */
  findAllActive(): Promise<TransportOffer[]>;

  /** Offers for a specific carrier. */
  findByCarrier(carrierId: string): Promise<TransportOffer[]>;
}