/**
 * Pure €/g ranking policy — the deterministic per-category product order.
 *
 * Consumes the {@link UnitPriceResult}s produced by `eurPerGram` (the
 * metric itself is never re-implemented here) and turns them into the
 * ranked rows the ranking endpoint returns:
 *
 * 1. Omission — a product whose metric is `unavailable` has no value and
 *    is dropped, never placed at an arbitrary position. A value row whose
 *    price provenance is neither VERIFIED nor ESTIMATED (STALE /
 *    UNAVAILABLE price) is dropped too: the ranking only admits rows the
 *    spec allows to be labelled VERIFIED or ESTIMATED, so a stale price
 *    must not masquerade as an ESTIMATED one.
 * 2. Best offer per product — a product is represented once, by its
 *    cheapest rankable offer; an exact value tie resolves by the lowest
 *    offer id so the selection itself is deterministic.
 * 3. Total order — €/g ascending with product id as the tiebreaker,
 *    identical on every request for the same data (spec
 *    unit-price-metrics: "Equal values SHALL resolve by a stable
 *    secondary key").
 *
 * Pure — no I/O, no persistence, no editorial or commercial signal. The
 * output never feeds search order, default ordering, or any calculation
 * input; it is a read-model ordering only.
 *
 * @module UnitPriceRanking
 */

import type {
  UnitPriceResult,
  UnitPriceValue,
} from './unitprice.types';

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

/** One ranking candidate: a product's offer with its computed metric. */
export interface UnitPriceRankingEntry {
  /** Product the offer belongs to (product_master.id). */
  readonly productId: number;
  /** The offer the metric was derived from (retail_offers.id). */
  readonly offerId: number;
  /** `eurPerGram` output for the offer — `unavailable` candidates are dropped. */
  readonly metric: UnitPriceResult;
}

/** One ranking row: the product's best rankable €/g with its status. */
export interface UnitPriceRankingRow {
  readonly productId: number;
  /** The offer the ranked value was derived from (provenance). */
  readonly offerId: number;
  /** Euro cents per gram of pure ethanol — sorted ascending. */
  readonly centsPerGram: number;
  /** Grams of pure ethanol in the unit (the metric's denominator evidence). */
  readonly ethanolGrams: number;
  /**
   * The row's reliability status — the only two values the ranking
   * admits. VERIFIED iff the metric status is 'computed', ESTIMATED
   * otherwise.
   */
  readonly reliabilityStatus: 'VERIFIED' | 'ESTIMATED';
}

// ---------------------------------------------------------------------------
// Rankability policy
// ---------------------------------------------------------------------------

/** A candidate whose metric carried a rankable value. */
type RankableEntry = UnitPriceRankingEntry & {
  readonly metric: UnitPriceValue & {
    priceReliability: 'VERIFIED' | 'ESTIMATED';
  };
};

/**
 * A candidate can carry a ranking row only when the metric produced a
 * value AND the price provenance is one the spec lets a row be labelled
 * with. A STALE or UNAVAILABLE price yields a value from `eurPerGram`
 * (its own status model must not hide the number), but for the ranking
 * it is treated as no computable unit price: the row is omitted.
 */
function isRankable(entry: UnitPriceRankingEntry): entry is RankableEntry {
  const { metric } = entry;
  if (metric.status === 'unavailable') {
    return false;
  }
  return (
    metric.priceReliability === 'VERIFIED' ||
    metric.priceReliability === 'ESTIMATED'
  );
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Rank candidates into the deterministic €/g-ascending product order.
 *
 * Pure and stable: the same input set in any input order always produces
 * the identical output order, because every comparison resolves through
 * the (value, productId, offerId) chain and no input-order-dependent
 * state is consulted.
 *
 * @param entries One entry per offer considered for the ranking.
 */
export function rankUnitPrices(
  entries: readonly UnitPriceRankingEntry[],
): UnitPriceRankingRow[] {
  // Best rankable offer per product: cheapest €/g wins; an exact tie
  // resolves by the lowest offer id so the representative offer is pinned.
  const bestPerProduct = new Map<number, RankableEntry>();
  for (const entry of entries) {
    if (!isRankable(entry)) continue;
    const current = bestPerProduct.get(entry.productId);
    if (
      current === undefined ||
      entry.metric.centsPerGram < current.metric.centsPerGram ||
      (entry.metric.centsPerGram === current.metric.centsPerGram &&
        entry.offerId < current.offerId)
    ) {
      bestPerProduct.set(entry.productId, entry);
    }
  }

  // Total order: €/g ascending, product id as the stable secondary key.
  const ranked = [...bestPerProduct.values()].sort(
    (a, b) =>
      a.metric.centsPerGram - b.metric.centsPerGram ||
      a.productId - b.productId,
  );

  return ranked.map((entry) => {
    const metric = entry.metric;
    return {
      productId: entry.productId,
      offerId: entry.offerId,
      centsPerGram: metric.centsPerGram,
      ethanolGrams: metric.ethanolGrams,
      reliabilityStatus: metric.priceReliability,
    };
  });
}
