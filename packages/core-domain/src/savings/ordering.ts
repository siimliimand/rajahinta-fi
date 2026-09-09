/**
 * Deterministic savings-listing order — gap basis points descending,
 * product name ascending as tiebreaker.
 *
 * The listing is a public, neutral surface (spec savings-discovery): the
 * same snapshot day must always render the same rows in the same order,
 * on every runtime. Name comparison is therefore code-unit order, not
 * `localeCompare` — locale collation varies across environments and ICU
 * versions and would break the determinism contract.
 *
 * @module SavingsOrdering
 */

import type { SavingsGapValue } from './savings.types';

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/**
 * Comparator for the public listing order: gap basis points descending
 * (largest landed-cost excess over Alko first), product name ascending as
 * the tiebreaker, product id ascending as the final tie. The id level
 * exists because two distinct products can share a name — without it the
 * order of that pair would be left to the sort implementation.
 *
 * Pure — returns a number, mutates nothing.
 */
export function compareSavingsRows(a: SavingsGapValue, b: SavingsGapValue): number {
  if (a.gapBasisPoints !== b.gapBasisPoints) {
    return b.gapBasisPoints - a.gapBasisPoints;
  }
  if (a.productName !== b.productName) {
    return a.productName < b.productName ? -1 : 1;
  }
  return a.productId - b.productId;
}

/**
 * Sort value rows into listing order, returning a new array — the input
 * (often the pass output in materialization order) is never mutated.
 */
export function sortSavingsRows(
  rows: readonly SavingsGapValue[],
): SavingsGapValue[] {
  return [...rows].sort(compareSavingsRows);
}
