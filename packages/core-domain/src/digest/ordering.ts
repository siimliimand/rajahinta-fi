/**
 * Deterministic digest order — category ascending, then price ascending
 * (spec preference-digest: "Deterministic, preference-filtered ordering").
 *
 * The digest is a neutral surface (design D1): the same summaries must
 * always produce item-for-item identical output on every runtime, and no
 * preference, ranking, or commercial signal has any say in the order —
 * the comparator reads only fields echoed from the facts themselves.
 * String comparison is code-unit order, not `localeCompare` — locale
 * collation varies across environments and ICU versions and would break
 * the determinism contract (the savings-ordering precedent).
 *
 * @module DigestOrdering
 */

import type { DigestFact } from './digest.types';

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/**
 * Comparator for the digest order: category ascending (code-unit), then
 * price ascending. Two further keys exist solely to make ties
 * deterministic — they resolve only among facts that are already equal on
 * the spec's two keys:
 *
 * 1. fact kind ascending — within one category the minimum and the new
 *    low can share a price (a new low IS the window minimum), and the
 *    pair must still render in one fixed order;
 * 2. product id ascending — two distinct products can tie on price, and
 *    without this the order of that pair would be left to the sort
 *    implementation.
 *
 * Both tiebreakers are fact-identity fields, not signals: nothing is
 * ordered by anything a user, merchant, or preference could influence
 * beyond the facts themselves.
 *
 * Pure — returns a number, mutates nothing.
 */
export function compareDigestFacts(a: DigestFact, b: DigestFact): number {
  if (a.category !== b.category) {
    return a.category < b.category ? -1 : 1;
  }
  if (a.priceCloseCents !== b.priceCloseCents) {
    return a.priceCloseCents - b.priceCloseCents;
  }
  if (a.kind !== b.kind) {
    return a.kind < b.kind ? -1 : 1;
  }
  return a.productId - b.productId;
}

/**
 * Sort digest facts into stated order, returning a new array — the input
 * (the computation's grouping order) is never mutated.
 */
export function sortDigestFacts(
  facts: readonly DigestFact[],
): DigestFact[] {
  return [...facts].sort(compareDigestFacts);
}
