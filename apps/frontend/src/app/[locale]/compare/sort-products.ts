/**
 * Client-side comparators for the compare view's sort selector.
 *
 * Mirrors the objective comparator semantics of the backend
 * RankingService (packages/core-domain/src/ranking/ranking.service.ts):
 * every order is deterministic and neutral, and the product name is the
 * universal tiebreaker. Compare columns always render quantity 1, so
 * LOWEST_PER_UNIT is equivalent to total-cost order but is kept for
 * parity with the shared SortOrder contract.
 *
 * No field other than the factual product/cost attributes below can
 * influence ordering — no merchant, promotion, or paid-placement input
 * exists on ComparisonProduct.
 *
 * @module CompareSorting
 */

import type { ComparisonProduct, SortOrder } from '@/lib/types';

/** Cost per litre; an unparseable or non-positive volume is infinitely
 *  expensive (never a fake 0 €/l). */
function costPerLitre(product: ComparisonProduct): number {
  const litres = Number.parseFloat(product.unitVolume);
  return Number.isFinite(litres) && litres > 0
    ? product.totalCents / litres
    : Number.POSITIVE_INFINITY;
}

/** Alphabetical by product name, Finnish locale — the universal tiebreaker. */
function compareAlphabetical(
  a: ComparisonProduct,
  b: ComparisonProduct,
): number {
  return a.name.localeCompare(b.name, 'fi');
}

function compareLowestLandedCost(
  a: ComparisonProduct,
  b: ComparisonProduct,
): number {
  const diff = a.totalCents - b.totalCents;
  return diff !== 0 ? diff : compareAlphabetical(a, b);
}

function compareLowestPerLitre(
  a: ComparisonProduct,
  b: ComparisonProduct,
): number {
  const diff = costPerLitre(a) - costPerLitre(b);
  return diff !== 0 ? diff : compareAlphabetical(a, b);
}

function compareAlcoholPercentage(
  a: ComparisonProduct,
  b: ComparisonProduct,
): number {
  const diff =
    (b.alcoholByVolume ?? 0) - (a.alcoholByVolume ?? 0);
  return diff !== 0 ? diff : compareAlphabetical(a, b);
}

function compareProductCategory(
  a: ComparisonProduct,
  b: ComparisonProduct,
): number {
  const diff = a.category.localeCompare(b.category, 'fi');
  return diff !== 0 ? diff : compareAlphabetical(a, b);
}

const COMPARATORS: Record<
  SortOrder,
  (a: ComparisonProduct, b: ComparisonProduct) => number
> = {
  LOWEST_LANDED_COST: compareLowestLandedCost,
  LOWEST_PER_LITRE: compareLowestPerLitre,
  // Compare columns are always quantity-1 calculations, so per-unit cost
  // IS the total cost; keep the explicit alias for contract parity.
  LOWEST_PER_UNIT: compareLowestLandedCost,
  ALPHABETICAL: compareAlphabetical,
  ALCOHOL_PERCENTAGE: compareAlcoholPercentage,
  PRODUCT_CATEGORY: compareProductCategory,
};

/**
 * Return a new array sorted by the given order. The input array is never
 * mutated; the output order is fully determined by (sortBy, products).
 */
export function sortComparisonProducts(
  products: readonly ComparisonProduct[],
  sortBy: SortOrder,
): ComparisonProduct[] {
  return [...products].sort(COMPARATORS[sortBy]);
}
