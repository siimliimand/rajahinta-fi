/**
 * Current-best-price selection (task 3.2, change insight-surfaces, spec
 * price-context / design D5) — THE lowest-current-offer rule.
 *
 * "Current best price" is the lowest priceCents among a product's
 * current offers. retail_offers is the current-state offer table (the
 * historical series lives in the price-history summary buckets), so the
 * offer list the product detail route returns IS the current-offer set.
 * This module is the one implementation: the product detail response
 * embeds the figure and the price-context route computes against it, so
 * the context line can never contradict the price panel next to it.
 *
 * Pure — no I/O, no availability second-guessing: an offer row's
 * presence in the current-state table is its currency.
 *
 * @module CurrentBestPrice
 */

/** The one field the selection reads. */
export interface PriceOnlyOffer {
  readonly priceCents: number;
}

/**
 * Lowest offer price in euro cents, or null when the product has no
 * current offers — an absent price is never a substituted value. A
 * single integer minimum wins regardless of iteration order.
 */
export function lowestCurrentOfferPriceCents(
  offers: readonly PriceOnlyOffer[],
): number | null {
  let lowest: number | null = null;
  for (const offer of offers) {
    if (lowest === null || offer.priceCents < lowest) {
      lowest = offer.priceCents;
    }
  }
  return lowest;
}
