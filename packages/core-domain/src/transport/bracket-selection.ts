/**
 * Bracket-selection logic — shared between TransportEstimationService and
 * BasketShippingCalculator so single-line shipments resolve identically.
 *
 * Strategy (per Decision 4):
 *  1. Exact bracket match first (weight falls within the bracket → VERIFIED/EXACT)
 *  2. Closest-midpoint bracket fallback (→ ESTIMATED)
 *
 * @module BracketSelection
 */

import type { TransportOffer } from './transport-offer.type';

// ---------------------------------------------------------------------------
// Bracket matching
// ---------------------------------------------------------------------------

/**
 * Check whether `weightKg` falls within the bracket defined by the offer.
 * A `null` bound means the bracket is open-ended on that side.
 */
export function inBracket(offer: TransportOffer, weightKg: number): boolean {
  const { minKg, maxKg } = offer.weightBracket;

  if (minKg !== null && weightKg < minKg) return false;
  if (maxKg !== null && weightKg > maxKg) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Fallback selection (closest midpoint)
// ---------------------------------------------------------------------------

/**
 * Select the "best" bracket for a given weight when no exact match exists.
 * Strategy: prefer the bracket whose midpoint is closest to the target weight.
 * If a bracket has an open end, use the known bound as the midpoint proxy.
 */
export function closestBracket(
  offers: readonly TransportOffer[],
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
// Unified entrypoint
// ---------------------------------------------------------------------------

/**
 * Result of a bracket selection — the offer and its reliability classification.
 *
 * - `EXACT`   ↔ TransportEstimation's `VERIFIED` (exact weight match)
 * - `ESTIMATED` (closest fallback, no exact match)
 */
export interface BracketSelectionResult {
  readonly offer: TransportOffer;
  readonly reliability: 'EXACT' | 'ESTIMATED';
}

/**
 * Select the best-matching transport offer for a given weight.
 *
 * 1. Exact weight-bracket match first → `{ reliability: 'EXACT' }`.
 * 2. Closest-midpoint bracket fallback → `{ reliability: 'ESTIMATED' }`.
 *
 * Returns `null` when `candidates` is empty (caller handles PARTIAL or error
 * per its own contract — different services degrade differently).
 */
export function selectBestBracketOffer(
  candidates: readonly TransportOffer[],
  weightKg: number,
): BracketSelectionResult | null {
  if (candidates.length === 0) return null;

  // Try exact weight match first
  const exact = candidates.find((o) => inBracket(o, weightKg));
  if (exact) {
    return { offer: exact, reliability: 'EXACT' };
  }

  // Fall back to closest bracket → ESTIMATED
  const closest = closestBracket(candidates, weightKg);
  return { offer: closest, reliability: 'ESTIMATED' };
}