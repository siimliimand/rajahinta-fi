/**
 * RankingService — objective, deterministic sort of CalculatorResult items.
 *
 * All sort orders are purely algorithmic. There is no paid placement, boosted
 * result, or sponsored position. Tiebreakers are always alphabetical by
 * product name, ensuring a deterministic ordering even when primary sort keys
 * are equal.
 *
 * Each sort comparator is a pure function, independently testable.
 *
 * @module RankingService
 */

import { Injectable } from '@nestjs/common';
import type { CalculatorResult } from '../calculator/calculator.types';
import type { SortOrder } from './ranking.types';

// ---------------------------------------------------------------------------
// Pure comparator factories — each returns a standard Array.sort comparator
// ---------------------------------------------------------------------------

/**
 * Comparator: lowest total landed cost ascending.
 * Tiebreaker: alphabetical.
 */
function compareLowestLandedCost(
  a: CalculatorResult,
  b: CalculatorResult,
): number {
  const diff = a.totalCents - b.totalCents;
  if (diff !== 0) return diff;
  return compareAlphabetical(a, b);
}

/**
 * Comparator: lowest cost per litre ascending (totalCents / volumeLitres).
 * Tiebreaker: alphabetical.
 */
function compareLowestPerLitre(
  a: CalculatorResult,
  b: CalculatorResult,
): number {
  const costPerLitreA = a.metadata.volumeLitres > 0
    ? a.totalCents / a.metadata.volumeLitres
    : Infinity;
  const costPerLitreB = b.metadata.volumeLitres > 0
    ? b.totalCents / b.metadata.volumeLitres
    : Infinity;
  const diff = costPerLitreA - costPerLitreB;
  if (diff !== 0) return diff;
  return compareAlphabetical(a, b);
}

/**
 * Comparator: lowest cost per unit ascending (totalCents / quantity).
 * Tiebreaker: alphabetical.
 */
function compareLowestPerUnit(
  a: CalculatorResult,
  b: CalculatorResult,
): number {
  const qtyA = a.metadata.quantity > 0 ? a.metadata.quantity : 1;
  const qtyB = b.metadata.quantity > 0 ? b.metadata.quantity : 1;
  const diff = a.totalCents / qtyA - b.totalCents / qtyB;
  if (diff !== 0) return diff;
  return compareAlphabetical(a, b);
}

/**
 * Comparator: alphabetical by product name ascending (locale-aware).
 * This is the universal tiebreaker for all other sort orders.
 */
function compareAlphabetical(
  a: CalculatorResult,
  b: CalculatorResult,
): number {
  return a.metadata.productName.localeCompare(b.metadata.productName, 'fi');
}

/**
 * Comparator: alcohol by volume descending (strongest first).
 * Tiebreaker: alphabetical.
 */
function compareAlcoholPercentage(
  a: CalculatorResult,
  b: CalculatorResult,
): number {
  const diff = b.metadata.alcoholByVolume - a.metadata.alcoholByVolume;
  if (diff !== 0) return diff;
  return compareAlphabetical(a, b);
}

/**
 * Comparator: product category ascending (alphabetical).
 * Tiebreaker: alphabetical by product name.
 */
function compareProductCategory(
  a: CalculatorResult,
  b: CalculatorResult,
): number {
  const diff = a.metadata.category.localeCompare(b.metadata.category, 'fi');
  if (diff !== 0) return diff;
  return compareAlphabetical(a, b);
}

// ---------------------------------------------------------------------------
// Comparator registry — maps each SortOrder to its comparator
// ---------------------------------------------------------------------------

const COMPARATOR_REGISTRY: Record<
  SortOrder,
  (a: CalculatorResult, b: CalculatorResult) => number
> = {
  LOWEST_LANDED_COST: compareLowestLandedCost,
  LOWEST_PER_LITRE: compareLowestPerLitre,
  LOWEST_PER_UNIT: compareLowestPerUnit,
  ALPHABETICAL: compareAlphabetical,
  ALCOHOL_PERCENTAGE: compareAlcoholPercentage,
  PRODUCT_CATEGORY: compareProductCategory,
};

// ---------------------------------------------------------------------------
// Injectable service
// ---------------------------------------------------------------------------

@Injectable()
export class RankingService {
  /**
   * Rank (sort) a list of CalculatorResult items by the given sort order.
   *
   * Returns a **new** sorted array — the original list is never mutated.
   * All comparators use alphabetical product name as a tiebreaker.
   *
   * @param results - The unsorted calculation results.
   * @param sortBy  - The objective sort order to apply.
   * @returns A new array sorted according to `sortBy`.
   */
  rank(
    results: readonly CalculatorResult[],
    sortBy: SortOrder,
  ): CalculatorResult[] {
    const comparator = COMPARATOR_REGISTRY[sortBy];
    return [...results].sort(comparator);
  }
}