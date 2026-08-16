/**
 * Transport Offer — domain-level read model for a carrier's shipping rate.
 *
 * Defined here so consuming layers (TransportEstimationService, Application API)
 * never import Drizzle ORM types or the Data Platform's internal schema.
 *
 * @module TransportOffer
 */

/** Weight bracket for a transport offer. Either bound may be null (open-ended). */
export interface WeightBracket {
  readonly minKg: number | null;
  readonly maxKg: number | null;
}

/** A single carrier shipping offer for a route + package tier combination. */
export interface TransportOffer {
  readonly id: number;
  readonly carrier: string;
  readonly originCountry: string;
  readonly destinationCountry: string;
  readonly weightBracket: WeightBracket;
  readonly packageTier: string;
  readonly priceCents: number;
  readonly currency: string;
  readonly sellerInvolvementIndicator: boolean;
  readonly observedAt: Date;
  readonly refreshedAt: Date;
  readonly reliabilityStatus: string;
}

/** Result of an estimation lookup. */
export interface TransportEstimate {
  readonly offer: TransportOffer;
  readonly matchedWeightBracket: WeightBracket;
  readonly reliabilityStatus: 'EXACT' | 'ESTIMATED';
}