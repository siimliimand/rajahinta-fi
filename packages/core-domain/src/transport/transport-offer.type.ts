/**
 * Transport Offer — domain-level read model for a carrier's shipping rate.
 *
 * Defined here so consuming layers (TransportEstimationService, Application API)
 * never import Drizzle ORM types or the Data Platform's internal schema.
 *
 * @module TransportOffer
 */

import type { ReliabilityStatus } from '../reliability/reliability.types';
import type { TransportWeightBasis } from './estimation-weight';

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
  readonly reliabilityStatus: ReliabilityStatus;
  /** Which weight produced the carrier-rate lookup (design D7). */
  readonly weightBasis: TransportWeightBasis;
  /** The kg value fed to bracket matching — the number the lookup is traceable to. */
  readonly lookupWeightKg: number;
  /**
   * Product-master grams behind `lookupWeightKg`; null when the basis is
   * the volume estimate (no stored weight exists).
   */
  readonly storedWeightGrams: number | null;
}