/**
 * Pure unit-price metric — euro cents per gram of pure ethanol.
 *
 * Every function here is deterministic and side-effect free: the metric
 * is derived at read time from an offer's price and the product's
 * physical inputs and is NEVER persisted as a column (spec
 * unit-price-metrics). Validation policy lives in the domain, not the
 * caller, so every consumer ranks offers against the same definition.
 *
 * @module EurPerGram
 */

import type {
  UnitPriceResult,
  UnitPriceUnavailableReason,
} from './unitprice.types';
import type { ReliabilityStatus } from '../reliability/reliability.types';

// ---------------------------------------------------------------------------
// Ethanol density
// ---------------------------------------------------------------------------

/**
 * Density of ethanol: 789 grams per litre (at 20 °C, the convention used
 * across the tax and excise formulas).
 *
 * This constant converts a unit's pure-alcohol volume into mass — the
 * common denominator that makes a 0.5 l 40% spirit and a 0.33 l 4.7%
 * beer comparable on a cents-per-gram basis. The spec fixes the value
 * at exactly 789 g/l; changing it changes every ranked offer, so it is
 * exported and pinned by test.
 */
export const ETHANOL_DENSITY_G_PER_L = 789;

// ---------------------------------------------------------------------------
// Metric
// ---------------------------------------------------------------------------

/**
 * Euro cents per gram of pure ethanol for one offer.
 *
 * ```
 * centsPerGram = priceCents / (unitVolumeL × alcoholFraction × 789 g/l)
 * ```
 *
 * Pure — no I/O, no persistence; derive at read time only.
 *
 * Validation policy (single reported reason, checked in this order):
 *
 * 1. `unitVolumeL` is `null`/`undefined` → `MISSING_VOLUME`; then
 *    `alcoholFraction` is `null`/`undefined` → `MISSING_ALCOHOL_FRACTION`
 *    (known unknowns are reported before value-level faults).
 * 2. Volume must be a finite number > 0 → else `INVALID_VOLUME`.
 *    `alcoholFraction` is a fraction, not a percent: it must be a finite
 *    number in `(0, 1]` — else `INVALID_ALCOHOL_FRACTION` (e.g. passing
 *    40 instead of 0.4 is rejected, not clamped).
 * 3. Price must be a finite number ≥ 0 → else `INVALID_PRICE`. A zero
 *    price is structurally valid (the metric is 0 cents/gram); ranking
 *    policy may treat free offers separately, that is not this
 *    function's concern.
 *
 * Invalid inputs yield an explicit `unavailable` result rather than a
 * throw: the metric is computed per offer inside ranking sweeps, where
 * one malformed record must degrade that offer only — never abort the
 * sweep, and never fall back to a silently substituted value.
 *
 * Price reliability is inherited by the metric: the default `'VERIFIED'`
 * (three-argument call) yields status `'computed'`; any other
 * {@link ReliabilityStatus} yields `'ESTIMATED'` with the value still
 * returned, so an uncertain price is visible without hiding the number.
 *
 * @param priceCents      Offer price in euro cents (finite, ≥ 0).
 * @param unitVolumeL     Unit volume in litres (finite, > 0), or
 *                        `null`/`undefined` when unknown.
 * @param alcoholFraction ABV as a fraction in `(0, 1]` (0.4 = 40%),
 *                        or `null`/`undefined` when unknown.
 * @param priceReliability Reliability of the offer price; default `'VERIFIED'`.
 */
export function eurPerGram(
  priceCents: number,
  unitVolumeL: number | null | undefined,
  alcoholFraction: number | null | undefined,
  priceReliability: ReliabilityStatus = 'VERIFIED',
): UnitPriceResult {
  if (unitVolumeL === null || unitVolumeL === undefined) {
    return unavailable('MISSING_VOLUME');
  }
  if (alcoholFraction === null || alcoholFraction === undefined) {
    return unavailable('MISSING_ALCOHOL_FRACTION');
  }
  if (!Number.isFinite(unitVolumeL) || unitVolumeL <= 0) {
    return unavailable('INVALID_VOLUME');
  }
  if (
    !Number.isFinite(alcoholFraction) ||
    alcoholFraction <= 0 ||
    alcoholFraction > 1
  ) {
    return unavailable('INVALID_ALCOHOL_FRACTION');
  }
  if (!Number.isFinite(priceCents) || priceCents < 0) {
    return unavailable('INVALID_PRICE');
  }

  const ethanolGrams = unitVolumeL * alcoholFraction * ETHANOL_DENSITY_G_PER_L;
  const centsPerGram = priceCents / ethanolGrams;

  if (priceReliability === 'VERIFIED') {
    return { status: 'computed', centsPerGram, ethanolGrams, priceReliability };
  }
  return { status: 'ESTIMATED', centsPerGram, ethanolGrams, priceReliability };
}

/** Build the explicit no-value result. Never substitute a number. */
function unavailable(reason: UnitPriceUnavailableReason): UnitPriceResult {
  return { status: 'unavailable', centsPerGram: null, ethanolGrams: null, reason };
}
