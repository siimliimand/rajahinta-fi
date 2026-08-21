import { Injectable, Inject } from '@nestjs/common';
import { ITransportOfferQuery, TRANSPORT_OFFER_QUERY } from './transport-offer-query.interface';
import type { TransportEstimate, TransportOffer } from './transport-offer.type';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check whether `weightKg` falls within the bracket defined by the offer.
 * A `null` bound means the bracket is open-ended on that side.
 */
function weightInBracket(offer: TransportOffer, weightKg: number): boolean {
  const { minKg, maxKg } = offer.weightBracket;

  if (minKg !== null && weightKg < minKg) return false;
  if (maxKg !== null && weightKg > maxKg) return false;

  return true;
}

/**
 * Select the "best" bracket for a given weight when no exact match exists.
 * Strategy: prefer the bracket whose midpoint is closest to the target weight.
 * If a bracket has an open end, use the known bound as the midpoint proxy.
 */
function closestBracket(
  offers: TransportOffer[],
  weightKg: number,
): TransportOffer {
  let best: TransportOffer | null = null;
  let bestDistance = Infinity;

  for (const offer of offers) {
    const { minKg, maxKg } = offer.weightBracket;
    let mid: number;

    if (minKg !== null && maxKg !== null) {
      mid = (minKg + maxKg) / 2;
    } else if (minKg !== null) {
      // open-ended upward — use min as anchor
      mid = minKg;
    } else if (maxKg !== null) {
      // open-ended downward — use max as anchor
      mid = maxKg;
    } else {
      // completely open bracket — distance is 0
      mid = weightKg;
    }

    const distance = Math.abs(weightKg - mid);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = offer;
    }
  }

  /* istanbul ignore next: offers array is guaranteed non-empty by caller */
  return best!;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class TransportEstimationService {
  constructor(
    @Inject(TRANSPORT_OFFER_QUERY) private readonly offerQuery: ITransportOfferQuery,
  ) {}

  /**
   * Find the single best-matching transport offer for the given parameters.
   *
   * Matching criteria (strict):
   *   1. Carrier matches
   *   2. Origin country matches
   *   3. Destination country matches
   *   4. Package tier matches
   *   5. Weight falls within the offer's weight bracket
   *
   * If no weight bracket matches exactly the result carries
   * `reliabilityStatus: 'ESTIMATED'` and uses the closest bracket.
   * An exact weight match carries `reliabilityStatus: 'VERIFIED'`.
   */
  async estimate(
    carrier: string,
    origin: string,
    destination: string,
    weightKg: number,
    packageType: string,
  ): Promise<TransportEstimate> {
    const offers = await this.offerQuery.findByCarrier(carrier);

    const candidates = offers.filter(
      (o) =>
        o.originCountry === origin &&
        o.destinationCountry === destination &&
        o.packageTier === packageType,
    );

    if (candidates.length === 0) {
      throw new NotFoundError(carrier, origin, destination, packageType);
    }

    // Try exact weight match first
    const exact = candidates.find((o) => weightInBracket(o, weightKg));
    if (exact) {
      return {
        offer: exact,
        matchedWeightBracket: exact.weightBracket,
        reliabilityStatus: 'VERIFIED',
      };
    }

    // Fall back to closest bracket → ESTIMATED
    const closest = closestBracket(candidates, weightKg);
    return {
      offer: closest,
      matchedWeightBracket: closest.weightBracket,
      reliabilityStatus: 'ESTIMATED',
    };
  }

  /**
   * Returns all transport offers for a given carrier + route.
   * Filters by origin and destination; returns across all weight tiers
   * and package tiers.
   */
  async findOffers(
    carrier: string,
    origin: string,
    destination: string,
  ): Promise<readonly TransportOffer[]> {
    const offers = await this.offerQuery.findByCarrier(carrier);

    return offers.filter(
      (o) => o.originCountry === origin && o.destinationCountry === destination,
    );
  }
}

// ---------------------------------------------------------------------------
// Domain error
// ---------------------------------------------------------------------------

export class NotFoundError extends Error {
  readonly carrier: string;
  readonly origin: string;
  readonly destination: string;
  readonly packageType: string;

  constructor(
    carrier: string,
    origin: string,
    destination: string,
    packageType: string,
  ) {
    super(
      `No transport offers found for carrier="${carrier}" route=${origin}→${destination} package="${packageType}"`,
    );
    this.name = 'NotFoundError';
    this.carrier = carrier;
    this.origin = origin;
    this.destination = destination;
    this.packageType = packageType;
  }
}