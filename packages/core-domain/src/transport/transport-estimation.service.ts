import { Injectable, Inject } from '@nestjs/common';
import { ITransportOfferQuery, TRANSPORT_OFFER_QUERY } from './transport-offer-query.interface';
import { selectBestBracketOffer } from './bracket-selection';
import { deriveShipmentTier, isPackageTier } from './shipment-tier';
import type { TransportWeightBasis } from './estimation-weight';
import type { TransportEstimate, TransportOffer } from './transport-offer.type';

// ---------------------------------------------------------------------------
// Domain-boundary normalization
// ---------------------------------------------------------------------------

/**
 * Carrier IDs normalize (trim + lowercase) once, here at the domain
 * boundary (design D2). Curated writes already store lowercase IDs
 * ('fransberg', 'posti'), so normalizing the requested ID closes the case
 * gap for merchant-name fallbacks like 'Fransberg' without touching the
 * schema or the query port.
 */
export function normalizeCarrierId(raw: string): string {
  return raw.trim().toLowerCase();
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
   *   1. Carrier matches (trimmed + lowercased first — design D2)
   *   2. Origin country matches
   *   3. Destination country matches
   *   4. Package tier derives from `shipmentWeightKg` against the carrier's
   *      own bracket ceilings — parcel up to the carrier's largest parcel
   *      ceiling, pallet above it (design D3). Container material is not a
   *      shipping tier and is never consulted. A derived tier with no rows
   *      for the route throws `NotFoundError`; candidates are never widened
   *      across tiers to force a match.
   *   5. Weight falls within the offer's weight bracket; otherwise the
   *      closest-midpoint bracket carries the result
   *
   * `shipmentWeightKg` is the TOTAL shipment weight: the caller resolves
   * the per-unit weight (via `resolveEstimationWeight`) and multiplies by
   * quantity before calling (design D4). The service never re-scales.
   *
   * Status (design D6): an exact bracket match on a stored product weight
   * (`storedWeightGrams` present and positive) is `VERIFIED`; everything
   * else — the closest-bracket fallback, or an exact bracket matched on a
   * volume estimate — caps at `ESTIMATED`. The rule is downgrade-only.
   *
   * `lookupWeightKg` echoes `shipmentWeightKg` and `weightBasis` states
   * what stands behind it (design D7): `STORED_PRODUCT_WEIGHT` or the
   * caller's `VOLUME_ESTIMATE`.
   */
  async estimate(
    carrier: string,
    origin: string,
    destination: string,
    shipmentWeightKg: number,
    storedWeightGrams?: number | null,
  ): Promise<TransportEstimate>;
  /**
   * Legacy call shape kept compiling until its call sites migrate: the
   * fifth slot used to be the product's containerType, which design D3
   * removed from the transport join (container material is not a shipping
   * tier). It is accepted and ignored.
   *
   * @deprecated pass `storedWeightGrams` as the fifth argument instead.
   */
  async estimate(
    carrier: string,
    origin: string,
    destination: string,
    shipmentWeightKg: number,
    legacyContainerType?: string,
    storedWeightGrams?: number | null,
  ): Promise<TransportEstimate>;
  async estimate(
    carrier: string,
    origin: string,
    destination: string,
    shipmentWeightKg: number,
    containerTypeOrStoredGrams?: string | number | null,
    storedWeightGrams?: number | null,
  ): Promise<TransportEstimate> {
    const carrierId = normalizeCarrierId(carrier);

    // D4: `shipmentWeightKg` is the caller's already-scaled total, so it is
    // the authoritative lookup weight. Stored grams only mark the weight
    // basis (the D6 VERIFIED gate) — letting them override the weight would
    // silently undo the call-site quantity scaling. Same positivity guard
    // as `resolveEstimationWeight`, which callers use to resolve the
    // per-unit weight before scaling.
    const storedGrams =
      storedWeightGrams !== undefined
        ? storedWeightGrams
        : typeof containerTypeOrStoredGrams === 'number'
          ? containerTypeOrStoredGrams
          : null;
    const basis: TransportWeightBasis =
      storedGrams != null && storedGrams > 0
        ? 'STORED_PRODUCT_WEIGHT'
        : 'VOLUME_ESTIMATE';

    const offers = await this.offerQuery.findByCarrier(carrierId);

    // D3: the tier belongs to the weight, not the container. The carrier's
    // own dataset supplies the parcel/pallet boundary, so a heavy shipment
    // degrades to NotFoundError (UNAVAILABLE upstream) on a parcel-only
    // carrier instead of being priced into a fabricated tier.
    const tier = deriveShipmentTier(offers, shipmentWeightKg);

    const candidates = offers.filter(
      (o) =>
        o.originCountry === origin &&
        o.destinationCountry === destination &&
        isPackageTier(o, tier),
    );

    if (candidates.length === 0) {
      throw new NotFoundError(carrierId, origin, destination, tier);
    }

    const selection = selectBestBracketOffer(candidates, shipmentWeightKg)!;

    return {
      offer: selection.offer,
      matchedWeightBracket: selection.offer.weightBracket,
      // D6: an exact bracket certifies VERIFIED only on a stored product
      // weight; a volume-estimate basis caps the result at ESTIMATED.
      reliabilityStatus:
        selection.reliability === 'EXACT' && basis === 'STORED_PRODUCT_WEIGHT'
          ? 'VERIFIED'
          : 'ESTIMATED',
      weightBasis: basis,
      lookupWeightKg: shipmentWeightKg,
      storedWeightGrams: basis === 'STORED_PRODUCT_WEIGHT' ? storedGrams : null,
    };
  }

  /**
   * Returns all transport offers for a given carrier + route.
   * Filters by origin and destination; returns across all weight tiers
   * and package tiers. The carrier ID is normalized like in `estimate`
   * (design D2) so both entry points resolve carriers identically.
   */
  async findOffers(
    carrier: string,
    origin: string,
    destination: string,
  ): Promise<readonly TransportOffer[]> {
    const offers = await this.offerQuery.findByCarrier(normalizeCarrierId(carrier));

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
  /**
   * The package tier that had no rows. For `estimate()` this is the
   * weight-derived tier (design D3), never the requested containerType.
   */
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
