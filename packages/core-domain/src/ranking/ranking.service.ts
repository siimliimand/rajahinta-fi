/**
 * RankingService — objective, deterministic sort of beverage cost data.
 *
 * ## Neutrality guarantee
 *
 * {@link NeutralSortInput} is the **only** input type accepted by
 * `RankingService.rank()`. It contains no field for paid placement,
 * promotional boost, merchant scoring, sponsored position, or any
 * form of manual curation.
 *
 * Enforcement layers (strongest to weakest):
 *
 * 1. **Type-system boundary** — `rank()` accepts `NeutralSortInput[]`,
 *    a tight interface with only the fields needed for sorting.
 * 2. **Compile-time assertion** — `_NeutralityTypeCheck` in
 *    `ranking.types.ts` proves a type with `paidBoost` is NOT
 *    assignable to `NeutralSortInput`.
 * 3. **Runtime guard** — `rank()` calls `guardNeutralInput()` which
 *    rejects any object with properties not declared on
 *    `NeutralSortInput`, catching accidental data leakage at runtime.
 *
 * All sort orders are purely algorithmic. There is no paid placement,
 * boosted result, or sponsored position. Tiebreakers are always
 * alphabetical by product name, ensuring a deterministic ordering even
 * when primary sort keys are equal.
 *
 * Every comparator is a pure function, independently testable.
 *
 * @module RankingService
 */

import { Injectable } from '@nestjs/common';
import type { NeutralSortInput, SortOrder } from './ranking.types';

// ---------------------------------------------------------------------------
// Known-key set for the runtime guard
// ---------------------------------------------------------------------------

const NEUTRAL_SORT_INPUT_KEYS: ReadonlySet<string> = new Set([
  'totalCents',
  'volumeLitres',
  'quantity',
  'productName',
  'alcoholByVolume',
  'category',
]);

// ---------------------------------------------------------------------------
// Runtime guard
// ---------------------------------------------------------------------------

/**
 * Reject any input object that carries properties not declared on
 * `NeutralSortInput`.
 *
 * This is a safety net against accidental data leakage — e.g. a
 * `CalculatorResult` or API DTO being passed through without being
 * mapped to `NeutralSortInput` first. It uses `Object.keys()` at
 * runtime, so it catches structurally valid but semantically leaked
 * objects even when the type system has been bypassed.
 *
 * @throws {TypeError} When an input object has unknown properties.
 */
function guardNeutralInput(
  items: readonly NeutralSortInput[],
): asserts items is readonly NeutralSortInput[] {
  for (const item of items) {
    for (const key of Object.keys(item)) {
      if (!NEUTRAL_SORT_INPUT_KEYS.has(key)) {
        throw new TypeError(
          `NeutralSortInput guard: unknown property "${key}". ` +
            'Only fields declared on NeutralSortInput are allowed. ' +
            'Map your data to NeutralSortInput before calling rank().',
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pure comparator factories — each returns a standard Array.sort comparator
// ---------------------------------------------------------------------------

/**
 * Comparator: lowest total landed cost ascending.
 * Tiebreaker: alphabetical.
 */
function compareLowestLandedCost(
  a: NeutralSortInput,
  b: NeutralSortInput,
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
  a: NeutralSortInput,
  b: NeutralSortInput,
): number {
  const costPerLitreA = a.volumeLitres > 0
    ? a.totalCents / a.volumeLitres
    : Infinity;
  const costPerLitreB = b.volumeLitres > 0
    ? b.totalCents / b.volumeLitres
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
  a: NeutralSortInput,
  b: NeutralSortInput,
): number {
  const qtyA = a.quantity > 0 ? a.quantity : 1;
  const qtyB = b.quantity > 0 ? b.quantity : 1;
  const diff = a.totalCents / qtyA - b.totalCents / qtyB;
  if (diff !== 0) return diff;
  return compareAlphabetical(a, b);
}

/**
 * Comparator: alphabetical by product name ascending (locale-aware).
 * This is the universal tiebreaker for all other sort orders.
 */
function compareAlphabetical(
  a: NeutralSortInput,
  b: NeutralSortInput,
): number {
  return a.productName.localeCompare(b.productName, 'fi');
}

/**
 * Comparator: alcohol by volume descending (strongest first).
 * Tiebreaker: alphabetical.
 */
function compareAlcoholPercentage(
  a: NeutralSortInput,
  b: NeutralSortInput,
): number {
  const diff = b.alcoholByVolume - a.alcoholByVolume;
  if (diff !== 0) return diff;
  return compareAlphabetical(a, b);
}

/**
 * Comparator: product category ascending (alphabetical).
 * Tiebreaker: alphabetical by product name.
 */
function compareProductCategory(
  a: NeutralSortInput,
  b: NeutralSortInput,
): number {
  const diff = a.category.localeCompare(b.category, 'fi');
  if (diff !== 0) return diff;
  return compareAlphabetical(a, b);
}

// ---------------------------------------------------------------------------
// Comparator registry — maps each SortOrder to its comparator
// ---------------------------------------------------------------------------

const COMPARATOR_REGISTRY: Record<
  SortOrder,
  (a: NeutralSortInput, b: NeutralSortInput) => number
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
   * Rank (sort) a list of items by the given sort order.
   *
   * Returns a **new** sorted array — the original list is never mutated.
   * All comparators use alphabetical product name as a tiebreaker.
   *
   * ## Neutrality
   *
   * The input type {@link NeutralSortInput} contains **no** field for paid
   * placement, promotional boost, merchant scoring, or any form of manual
   * curation. A runtime guard also rejects objects with unknown properties,
   * preventing accidental data leakage.
   *
   * @param items  - The unsorted items to rank (must conform to
   *                 {@link NeutralSortInput} exactly — no extra properties).
   * @param sortBy - The objective sort order to apply.
   * @returns A new array sorted according to `sortBy`.
   * @throws {TypeError} When any item has properties not declared on
   *                     `NeutralSortInput`.
   */
  rank(
    items: readonly NeutralSortInput[],
    sortBy: SortOrder,
  ): NeutralSortInput[] {
    guardNeutralInput(items);
    const comparator = COMPARATOR_REGISTRY[sortBy];
    return [...items].sort(comparator);
  }
}