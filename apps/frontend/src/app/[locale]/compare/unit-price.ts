/**
 * €/g metric derivation for the compare view.
 *
 * The API attaches a per-offer `eurPerGram` to the product detail's
 * offers while enable_unit_price_eur_per_gram is on (key absent when
 * off). The compare column shows one figure per product: the best
 * offer metric, chosen deterministically by (centsPerGram, offer id) —
 * an objective minimum, never a commercial selection.
 *
 * An `unavailable` result is passed through with the API's own reason;
 * nothing here substitutes or recomputes a value.
 *
 * @module CompareUnitPrice
 */

import type { RetailOffer, UnitPriceResult } from '@/lib/types';

interface OfferMetric {
  readonly offerId: number;
  readonly metric: UnitPriceResult;
}

/** Numeric €/g of a value result; null for unavailable (no value exists). */
function valueCents(metric: UnitPriceResult): number | null {
  return metric.status === 'unavailable' ? null : metric.centsPerGram;
}

/**
 * Whether `candidate` should replace `incumbent` as the shown metric:
 * a numeric value beats no value; two values order by cents with offer
 * id as the tiebreaker; two unavailable results order by offer id so
 * the shown reason is deterministic regardless of offer array order.
 */
function isBetter(candidate: OfferMetric, incumbent: OfferMetric): boolean {
  const candidateCents = valueCents(candidate.metric);
  const incumbentCents = valueCents(incumbent.metric);

  if (candidateCents === null && incumbentCents === null) {
    return candidate.offerId < incumbent.offerId;
  }
  if (candidateCents === null || incumbentCents === null) {
    return incumbentCents === null;
  }
  return candidateCents !== incumbentCents
    ? candidateCents < incumbentCents
    : candidate.offerId < incumbent.offerId;
}

/**
 * The best €/g metric across a product's retail offers, or undefined
 * when the API did not supply the metric (flag off, empty offer list,
 * or a failed detail fetch) — undefined renders as "no value", never 0.
 */
export function bestOfferUnitPrice(
  offers: readonly RetailOffer[],
): UnitPriceResult | undefined {
  let best: OfferMetric | null = null;

  for (const offer of offers) {
    if (offer.eurPerGram === undefined) continue;
    const candidate = { offerId: offer.id, metric: offer.eurPerGram };
    if (best === null || isBetter(candidate, best)) {
      best = candidate;
    }
  }

  return best === null ? undefined : best.metric;
}
