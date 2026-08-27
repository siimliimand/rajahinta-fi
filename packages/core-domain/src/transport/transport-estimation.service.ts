import { Injectable, Inject } from '@nestjs/common';
import { ITransportOfferQuery, TRANSPORT_OFFER_QUERY } from './transport-offer-query.interface';
import { selectBestBracketOffer } from './bracket-selection';
import type { TransportEstimate, TransportOffer } from './transport-offer.type';

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

    const selection = selectBestBracketOffer(candidates, weightKg)!;

    return {
      offer: selection.offer,
      matchedWeightBracket: selection.offer.weightBracket,
      reliabilityStatus: selection.reliability === 'EXACT' ? 'VERIFIED' : 'ESTIMATED',
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