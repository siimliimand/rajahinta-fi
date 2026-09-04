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
 * The flag-gated EUR_PER_GRAM order is the one deliberate contract
 * deviation: unit-price-metrics spec requires the metric value with
 * product id as the tiebreaker, so that comparator reads ONLY the €/g
 * value and the product id — no name, merchant, or promotion input
 * exists on ComparisonProduct.
 *
 * @module CompareSorting
 */

import type {
  ComparisonProduct,
  CompareSortOrder,
} from '@/lib/types';

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

/**
 * The product's €/g value in euro cents per gram of pure ethanol, or
 * +Infinity when the metric is unavailable or was not resolved — an
 * unknown metric is never a fake 0 and always sorts last. Reads ONLY
 * `eurPerGram`: the neutrality guard for this order.
 */
export function eurPerGramCents(product: ComparisonProduct): number {
  return product.eurPerGram !== undefined &&
    product.eurPerGram.status !== 'unavailable'
    ? product.eurPerGram.centsPerGram
    : Number.POSITIVE_INFINITY;
}

/**
 * EUR_PER_GRAM order: strictly by metric value ascending, product id as
 * the tiebreaker (unit-price-metrics spec: identical order on every
 * request for the same data, no commercial signal).
 */
function compareEurPerGram(
  a: ComparisonProduct,
  b: ComparisonProduct,
): number {
  const diff = eurPerGramCents(a) - eurPerGramCents(b);
  return diff !== 0 ? diff : a.id - b.id;
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
  CompareSortOrder,
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
  EUR_PER_GRAM: compareEurPerGram,
};

/**
 * Every compare sort order, selector display order. EUR_PER_GRAM is the
 * flag-gated option (unit-price-metrics / ranking-sorting specs).
 */
export const COMPARE_SORT_OPTIONS: readonly CompareSortOrder[] = [
  'LOWEST_LANDED_COST',
  'LOWEST_PER_LITRE',
  'LOWEST_PER_UNIT',
  'ALPHABETICAL',
  'ALCOHOL_PERCENTAGE',
  'PRODUCT_CATEGORY',
  'EUR_PER_GRAM',
];

/**
 * The sort orders currently offered, resolved from the unit-price flag.
 * Flag off removes the €/g option entirely (ranking-sorting spec) —
 * the selector renders no such entry and the page never sorts by it.
 */
export function compareSortOptions(
  unitPriceEnabled: boolean,
): readonly CompareSortOrder[] {
  return unitPriceEnabled
    ? COMPARE_SORT_OPTIONS
    : COMPARE_SORT_OPTIONS.filter((order) => order !== 'EUR_PER_GRAM');
}

/**
 * Return a new array sorted by the given order. The input array is never
 * mutated; the output order is fully determined by (sortBy, products).
 */
export function sortComparisonProducts(
  products: readonly ComparisonProduct[],
  sortBy: CompareSortOrder,
): ComparisonProduct[] {
  return [...products].sort(COMPARATORS[sortBy]);
}
