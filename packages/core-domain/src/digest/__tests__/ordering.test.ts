/**
 * Unit tests for the deterministic digest order (spec preference-digest):
 * category ascending, then price ascending — with nothing else in the
 * comparator beyond deterministic fact-identity tiebreaks.
 */
import { describe, expect, it } from 'vitest';

import type { DigestFact } from '../digest.types';
import { compareDigestFacts, sortDigestFacts } from '../ordering';

function fact(overrides: Partial<DigestFact>): DigestFact {
  return {
    category: 'beer',
    kind: 'CATEGORY_MINIMUM',
    priceCloseCents: 100,
    productId: 1,
    merchant: null,
    periodStart: '2026-10-05',
    ...overrides,
  };
}

describe('compareDigestFacts', () => {
  it('orders by category ascending', () => {
    const facts = [
      fact({ category: 'spirits' }),
      fact({ category: 'beer' }),
      fact({ category: 'wine_still' }),
    ];

    const sorted = [...facts].sort(compareDigestFacts);

    expect(sorted.map((f) => f.category)).toEqual([
      'beer',
      'spirits',
      'wine_still',
    ]);
  });

  it('orders equal categories by price ascending', () => {
    const facts = [
      fact({ category: 'beer', priceCloseCents: 350, productId: 1 }),
      fact({ category: 'beer', priceCloseCents: 199, productId: 2 }),
      fact({ category: 'beer', priceCloseCents: 275, productId: 3 }),
    ];

    const sorted = [...facts].sort(compareDigestFacts);

    expect(sorted.map((f) => f.priceCloseCents)).toEqual([199, 275, 350]);
  });

  it('breaks equal category and price by fact kind ascending', () => {
    // A new low IS the window minimum, so the pair shares a price; the
    // kind tiebreaker keeps the pair in one fixed order.
    const facts = [
      fact({ category: 'beer', priceCloseCents: 199, kind: 'NOTABLE_NEW_LOW', productId: 7 }),
      fact({ category: 'beer', priceCloseCents: 199, kind: 'CATEGORY_MINIMUM', productId: 7 }),
    ];

    const sorted = [...facts].sort(compareDigestFacts);

    expect(sorted.map((f) => f.kind)).toEqual(['CATEGORY_MINIMUM', 'NOTABLE_NEW_LOW']);
  });

  it('breaks equal category, price, and kind by product id ascending', () => {
    const facts = [
      fact({ category: 'beer', priceCloseCents: 199, productId: 9 }),
      fact({ category: 'beer', priceCloseCents: 199, productId: 2 }),
      fact({ category: 'beer', priceCloseCents: 199, productId: 5 }),
    ];

    const sorted = [...facts].sort(compareDigestFacts);

    expect(sorted.map((f) => f.productId)).toEqual([2, 5, 9]);
  });

  it('is a total order — no pair compares equal unless all identity fields match', () => {
    const facts = [
      fact({ category: 'wine_sparkling', priceCloseCents: 2000, kind: 'NOTABLE_NEW_LOW', productId: 3, merchant: 'S' }),
      fact({ category: 'beer', priceCloseCents: 2000, kind: 'NOTABLE_NEW_LOW', productId: 3, merchant: 'S' }),
      fact({ category: 'wine_sparkling', priceCloseCents: 1000, kind: 'CATEGORY_MINIMUM', productId: 1, merchant: null }),
      fact({ category: 'spirits', priceCloseCents: 5000, kind: 'CATEGORY_MINIMUM', productId: 8, merchant: 'M' }),
    ];

    const sorted = [...facts].sort(compareDigestFacts);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(compareDigestFacts(sorted[i - 1], sorted[i])).toBeLessThan(0);
    }
  });
});

describe('sortDigestFacts', () => {
  it('returns a new sorted array without mutating the input', () => {
    const input = [
      fact({ category: 'wine_still' }),
      fact({ category: 'beer' }),
    ];
    const snapshot = [...input];

    const sorted = sortDigestFacts(input);

    expect(input).toEqual(snapshot);
    expect(sorted).not.toBe(input);
    expect(sorted.map((f) => f.category)).toEqual(['beer', 'wine_still']);
  });
});
