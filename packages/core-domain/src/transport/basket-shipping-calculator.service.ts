import { Injectable, Inject } from '@nestjs/common';
import { ITransportOfferQuery, TRANSPORT_OFFER_QUERY } from './transport-offer-query.interface';
import { inBracket, selectBestBracketOffer } from './bracket-selection';
import { deriveShipmentTier, isPackageTier, type ShipmentTier } from './shipment-tier';
import { normalizeCarrierId } from './transport-estimation.service';
import type { TransportOffer } from './transport-offer.type';
import type {
  BasketItem,
  BasketShippingResult,
  BasketShippingThresholdCheck,
} from './basket-shipping.types';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Basket-level shipping-cost computation.
 *
 * Shipping carriers use non-linear pricing (thresholds, stepped brackets,
 * free-shipping triggers).  This service estimates the cost of shipping a
 * consolidated basket rather than summing per-item estimates, which would
 * miss better rates available at higher weight tiers.
 */
@Injectable()
export class BasketShippingCalculator {
  constructor(
    @Inject(TRANSPORT_OFFER_QUERY) private readonly offerQuery: ITransportOfferQuery,
  ) {}

  /**
   * Estimate shipping cost for a basket of items shipped together.
   *
   * Carrier resolution mirrors the single-item calculator (design D1,
   * change transport-confidence-unlock): the caller passes the already
   * resolved carrier as `transportMethod` — explicit user transportMethod,
   * else the merchant registry's `carrierId`, else the merchant name. The
   * id normalizes here exactly like TransportEstimationService.estimate
   * (design D2), so both entry points query the same rows. When no carrier
   * is resolvable (parameter omitted by a direct caller) all active offers
   * are considered.
   *
   * The parcel/pallet tier derives from the basket's total weight against
   * the carrier's own bracket ceilings (design D3) — item `packageType`
   * (container material) never selects the tier, mirroring estimate().
   *
   * When transportMethod is provided, candidates are filtered by carrier AND
   * optional originCountry (matching TransportEstimationService.estimate()'s
   * behaviour).
   *
   * @param items            Items in the basket.
   * @param destination      Destination country code (ISO 3166-1 alpha-2).
   * @param transportMethod  Optional resolved carrier identifier. When
   *                         omitted the service queries all active offers.
   * @param originCountry    Optional origin country code. When provided,
   *                         candidates are filtered to offers from this
   *                         origin, matching estimate()'s behaviour.
   */
  async calculateBasket(
    items: readonly BasketItem[],
    destination: string,
    transportMethod?: string,
    originCountry?: string,
  ): Promise<BasketShippingResult> {
    const totalWeight = items.reduce((sum, i) => sum + i.weightKg, 0);

    const offers = transportMethod
      ? await this.offerQuery.findByCarrier(normalizeCarrierId(transportMethod))
      : await this.offerQuery.findAllActive();

    // D3: the tier belongs to the shipment weight, not the container. With
    // a resolvable carrier the boundary comes from that carrier's own
    // parcel ceilings; the carrier-less fallback derives it from the union
    // of active offers. `packageType` stays display-only in the breakdown.
    const pkgTier: ShipmentTier = deriveShipmentTier(offers, totalWeight);

    const candidates = offers.filter(
      (o) =>
        o.destinationCountry === destination &&
        isPackageTier(o, pkgTier) &&
        (originCountry === undefined || o.originCountry === originCountry),
    );

    if (candidates.length === 0) {
      // No offers at all for this combination
      return {
        totalWeight,
        weightTier: 'UNAVAILABLE',
        packageTier: pkgTier,
        totalCents: 0,
        breakdown: items.map((item, idx) => ({
          itemIndex: idx,
          weightKg: item.weightKg,
          packageType: item.packageType,
          allocatedCents: 0,
        })),
        reliability: 'PARTIAL',
      };
    }

    // -----------------------------------------------------------------------
    // Unified single-line selection (Decision 4): same bracket-matching that
    // TransportEstimationService.estimate uses, so a single-product-line
    // shipment resolves identically.
    // -----------------------------------------------------------------------

    let best: TransportOffer;
    let reliability: 'EXACT' | 'ESTIMATED' | 'PARTIAL';

    if (items.length === 1) {
      // Single-line → unified bracket selection (exact-match-first,
      // closest-midpoint fallback), identical to estimate()'s logic.
      const selection = selectBestBracketOffer(candidates, totalWeight)!;
      best = selection.offer;
      reliability = selection.reliability;
    } else {
      // Multi-line → exact bracket match, cheapest fallback
      const exact = candidates.find((o) => inBracket(o, totalWeight));
      best = exact ?? candidates.reduce((a, b) =>
        a.priceCents < b.priceCents ? a : b,
      );
      reliability = exact
        ? 'EXACT'
        : totalWeight > 0
          ? 'ESTIMATED'
          : 'PARTIAL';
    }

    const weightTier = best.weightBracket.minKg !== null || best.weightBracket.maxKg !== null
      ? `${best.weightBracket.minKg ?? 0}–${best.weightBracket.maxKg ?? '∞'} kg`
      : 'any';

    // Proportional allocation by weight
    const breakdown = totalWeight > 0
      ? items.map((item, idx) => ({
          itemIndex: idx,
          weightKg: item.weightKg,
          packageType: item.packageType,
          allocatedCents: Math.round(
            (item.weightKg / totalWeight) * best.priceCents,
          ),
        }))
      : items.map((item, idx) => ({
          itemIndex: idx,
          weightKg: item.weightKg,
          packageType: item.packageType,
          allocatedCents: 0,
        }));

    // Adjust rounding so breakdown sums to totalCents
    // (simple: add/subtract rounding error from the largest allocation)
    const rawSum = breakdown.reduce((s, b) => s + b.allocatedCents, 0);
    const diff = best.priceCents - rawSum;
    if (diff !== 0 && breakdown.length > 0) {
      const largest = breakdown.reduce((a, b) =>
        a.allocatedCents >= b.allocatedCents ? a : b,
      );
      largest.allocatedCents += diff;
    }

    return {
      totalWeight,
      weightTier,
      packageTier: pkgTier,
      totalCents: best.priceCents,
      breakdown,
      reliability,
    };
  }

  /**
   * Check whether the basket qualifies for free shipping given a threshold.
   *
   * @param totalCents    The basket subtotal in euro-cents (product prices only).
   * @param thresholdCents Free-shipping threshold in euro-cents, or null if
   *                       no free-shipping offer exists for this merchant/route.
   */
  checkThreshold(
    totalCents: number,
    thresholdCents: number | null,
  ): BasketShippingThresholdCheck {
    if (thresholdCents === null || thresholdCents <= 0) {
      return {
        freeShippingThresholdCents: null,
        qualifiesForFreeShipping: false,
        remainingToFreeCents: null,
      };
    }

    const remaining = Math.max(0, thresholdCents - totalCents);

    return {
      freeShippingThresholdCents: thresholdCents,
      qualifiesForFreeShipping: remaining <= 0,
      remainingToFreeCents: remaining > 0 ? remaining : null,
    };
  }
}