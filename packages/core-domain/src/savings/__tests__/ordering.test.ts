/**
 * Unit tests for the deterministic savings-listing order (spec
 * savings-discovery): gap basis points descending, product name ascending
 * tiebreaker, fully total order regardless of runtime.
 */
import { describe, expect, it } from 'vitest';

import type { SavingsGapValue } from '../savings.types';
import { compareSavingsRows, sortSavingsRows } from '../ordering';

function row(
  productId: number,
  productName: string,
  gapBasisPoints: number,
): SavingsGapValue {
  return {
    status: 'computed',
    productId,
    productName,
    landedTotalCents: 0,
    alkoReferenceCents: 1,
    gapCents: 0,
    gapBasisPoints,
  };
}

describe('compareSavingsRows', () => {
  it('orders by gap basis points descending', () => {
    const rows = [row(1, 'A', 100), row(2, 'B', 2500), row(3, 'C', -1000)];

    const sorted = [...rows].sort(compareSavingsRows);

    expect(sorted.map((r) => r.productId)).toEqual([2, 1, 3]);
  });

  it('breaks equal gaps by product name ascending', () => {
    const rows = [row(1, 'Viina', 500), row(2, 'Olut', 500), row(3, 'Viini', 500)];

    const sorted = [...rows].sort(compareSavingsRows);

    // Code-unit order: 'Viina' < 'Viini' ('a' < 'i' at the fourth letter).
    expect(sorted.map((r) => r.productName)).toEqual(['Olut', 'Viina', 'Viini']);
  });

  it('breaks equal gaps and equal names by product id ascending', () => {
    const rows = [row(9, 'Same', 500), row(2, 'Same', 500), row(5, 'Same', 500)];

    const sorted = [...rows].sort(compareSavingsRows);

    expect(sorted.map((r) => r.productId)).toEqual([2, 5, 9]);
  });

  it('places negative gaps (import cheaper) after positive ones', () => {
    const rows = [row(1, 'A', -2500), row(2, 'B', -1000), row(3, 'C', 10)];

    const sorted = [...rows].sort(compareSavingsRows);

    expect(sorted.map((r) => r.productId)).toEqual([3, 2, 1]);
  });
});

describe('sortSavingsRows', () => {
  it('returns a new sorted array without mutating the input', () => {
    const input = [row(1, 'B', 100), row(2, 'A', 200)];
    const snapshot = [...input];

    const sorted = sortSavingsRows(input);

    expect(sorted.map((r) => r.productId)).toEqual([2, 1]);
    expect(input).toEqual(snapshot);
  });

  it('is deterministic — two sorts of the same input produce identical order', () => {
    const input = [
      row(3, 'C', 500),
      row(1, 'A', 500),
      row(2, 'B', 700),
      row(4, 'A', 500),
    ];

    const first = sortSavingsRows(input);
    const second = sortSavingsRows(input);

    expect(first).toEqual(second);
    // 700 bps first; the three 500-bps rows tie → 'A'(1), 'A'(4), 'C'(3).
    expect(first.map((r) => r.productId)).toEqual([2, 1, 4, 3]);
  });

  it('handles the empty listing (honest zero state)', () => {
    expect(sortSavingsRows([])).toEqual([]);
  });
});
