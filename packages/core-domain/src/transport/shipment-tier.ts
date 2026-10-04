/**
 * Shipping-tier derivation (task 3.2, design D3 — weight against the
 * dataset's own ceilings).
 *
 * Container material (bottle, can, …) is not shipping packaging, so the
 * parcel/pallet decision cannot come from the product. The threshold lives
 * in the carrier's own rate data: a shipment is a `parcel` while its weight
 * fits within the carrier's largest parcel bracket ceiling, and a `pallet`
 * above it. No policy constant is introduced here on purpose — the curated
 * dataset is the threshold, so transcribing a carrier's new rate table
 * moves the boundary automatically.
 *
 * Pure and side-effect-free so BasketShippingCalculator (task 3.4) can
 * derive the identical tier for basket parity.
 *
 * @module ShipmentTier
 */

import type { TransportOffer } from './transport-offer.type';

/** The shipping-packaging tiers carrier rate tables are keyed by. */
export type ShipmentTier = 'parcel' | 'pallet';

/**
 * Case-insensitive tier match. Curated writes store lowercase tiers
 * ('parcel', 'pallet'); the derivation matches tolerantly so a row is
 * never silently dropped over casing or stray whitespace.
 */
export function isPackageTier(
  offer: TransportOffer,
  tier: ShipmentTier,
): boolean {
  return offer.packageTier.trim().toLowerCase() === tier;
}

/**
 * Derive the shipping tier for a shipment weight from the carrier's own
 * offers.
 *
 * The ceiling is the largest `maxKg` across the carrier's parcel-tier rows;
 * an open-ended parcel row (null `maxKg`) means the carrier prices parcels
 * at any weight. A carrier with no parcel rows at all has ceiling 0 — every
 * positive shipment is pallet freight. Weight exactly at the ceiling stays
 * parcel, mirroring `inBracket`, where the ceiling bound is inclusive.
 */
export function deriveShipmentTier(
  carrierOffers: readonly TransportOffer[],
  shipmentWeightKg: number,
): ShipmentTier {
  let ceiling = 0;

  for (const offer of carrierOffers) {
    if (!isPackageTier(offer, 'parcel')) continue;

    const { maxKg } = offer.weightBracket;
    if (maxKg === null) return 'parcel';
    if (maxKg > ceiling) ceiling = maxKg;
  }

  return shipmentWeightKg <= ceiling ? 'parcel' : 'pallet';
}
