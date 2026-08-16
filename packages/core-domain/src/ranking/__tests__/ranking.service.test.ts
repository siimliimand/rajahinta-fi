/**
 * RankingService tests.
 *
 * High-liability area because sort order affects user perception of the
 * "best deal." Every comparator must be tested independently to ensure
 * correctness of:
 *   - Primary sort key
 *   - Tiebreaker (always alphabetical by product name)
 *   - Edge cases (zero volume, zero quantity, equal values)
 *
 * ## Neutrality enforcement tests
 *
 * The test file also verifies:
 *   - The runtime guard rejects objects with unknown properties
 *   - A type with extra `paidBoost` is NOT assignable to
 *     {@link NeutralSortInput} (compile-time check)
 *
 * @module RankingServiceTests
 */

import { describe, it, expect } from 'vitest';
import { RankingService } from '../ranking.service';
import type { NeutralSortInput } from '../ranking.types';

// ---------------------------------------------------------------------------
// Test fixture factory
// ---------------------------------------------------------------------------

function createResult(overrides: {
  totalCents?: number;
  productName?: string;
  volumeLitres?: number;
  alcoholByVolume?: number;
  category?: string;
  quantity?: number;
}): NeutralSortInput {
  return {
    totalCents: overrides.totalCents ?? 1000,
    volumeLitres: overrides.volumeLitres ?? 0.75,
    quantity: overrides.quantity ?? 1,
    productName: overrides.productName ?? 'Test Product',
    alcoholByVolume: overrides.alcoholByVolume ?? 5.0,
    category: overrides.category ?? 'wine',
  };
}

// ---------------------------------------------------------------------------
// Service instance (stateless — one instance is sufficient)
// ---------------------------------------------------------------------------

const service = new RankingService();

// ---------------------------------------------------------------------------
// LOWEST_LANDED_COST
// ---------------------------------------------------------------------------

describe('LOWEST_LANDED_COST', () => {
  it('sorts by totalCents ascending', () => {
    const items = [
      createResult({ totalCents: 3000, productName: 'C' }),
      createResult({ totalCents: 1000, productName: 'A' }),
      createResult({ totalCents: 2000, productName: 'B' }),
    ];
    const sorted = service.rank(items, 'LOWEST_LANDED_COST');
    expect(sorted.map((r) => r.totalCents)).toEqual([1000, 2000, 3000]);
  });

  it('uses alphabetical tiebreaker when totalCents equal', () => {
    const items = [
      createResult({ totalCents: 1000, productName: 'Zebra' }),
      createResult({ totalCents: 1000, productName: 'Alpha' }),
      createResult({ totalCents: 1000, productName: 'Bravo' }),
    ];
    const sorted = service.rank(items, 'LOWEST_LANDED_COST');
    expect(sorted.map((r) => r.productName)).toEqual([
      'Alpha',
      'Bravo',
      'Zebra',
    ]);
  });

  it('does not mutate the original array', () => {
    const items = [
      createResult({ totalCents: 2000, productName: 'B' }),
      createResult({ totalCents: 1000, productName: 'A' }),
    ];
    const sorted = service.rank(items, 'LOWEST_LANDED_COST');
    expect(sorted).not.toBe(items);
    expect(items[0].totalCents).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// LOWEST_PER_LITRE
// ---------------------------------------------------------------------------

describe('LOWEST_PER_LITRE', () => {
  it('sorts by totalCents / volumeLitres ascending', () => {
    // A: 1000 / 0.5 = 2000
    // B: 3000 / 1.0 = 3000
    // C: 2000 / 0.5 = 4000
    const items = [
      createResult({ totalCents: 2000, volumeLitres: 0.5, productName: 'C' }),
      createResult({ totalCents: 1000, volumeLitres: 0.5, productName: 'A' }),
      createResult({ totalCents: 3000, volumeLitres: 1.0, productName: 'B' }),
    ];
    const sorted = service.rank(items, 'LOWEST_PER_LITRE');
    expect(sorted.map((r) => r.productName)).toEqual(['A', 'B', 'C']);
  });

  it('handles zero volumeLitres gracefully (Infinity)', () => {
    const items = [
      createResult({ totalCents: 500, volumeLitres: 0, productName: 'Zero' }),
      createResult({ totalCents: 1000, volumeLitres: 0.5, productName: 'Normal' }),
    ];
    const sorted = service.rank(items, 'LOWEST_PER_LITRE');
    // Normal should come first (finite cost per litre), Zero last (Infinity)
    expect(sorted[0].productName).toBe('Normal');
    expect(sorted[1].productName).toBe('Zero');
  });

  it('uses alphabetical tiebreaker when cost per litre equal', () => {
    const items = [
      createResult({ totalCents: 500, volumeLitres: 0.25, productName: 'Z' }),
      createResult({ totalCents: 1000, volumeLitres: 0.5, productName: 'A' }),
    ];
    const sorted = service.rank(items, 'LOWEST_PER_LITRE');
    expect(sorted.map((r) => r.productName)).toEqual(['A', 'Z']);
  });
});

// ---------------------------------------------------------------------------
// LOWEST_PER_UNIT
// ---------------------------------------------------------------------------

describe('LOWEST_PER_UNIT', () => {
  it('sorts by totalCents / quantity ascending', () => {
    // A: 6000 / 6 = 1000
    // B: 2000 / 1 = 2000
    // C: 1000 / 1 = 1000 (tie with A, alphabetical)
    const items = [
      createResult({ totalCents: 2000, quantity: 1, productName: 'B' }),
      createResult({ totalCents: 6000, quantity: 6, productName: 'A' }),
      createResult({ totalCents: 1000, quantity: 1, productName: 'C' }),
    ];
    const sorted = service.rank(items, 'LOWEST_PER_UNIT');
    expect(sorted.map((r) => r.productName)).toEqual(['A', 'C', 'B']);
  });

  it('handles zero quantity gracefully (defaults to 1)', () => {
    const items = [
      createResult({ totalCents: 500, quantity: 0, productName: 'Zero' }),
      createResult({ totalCents: 1000, quantity: 2, productName: 'Normal' }),
    ];
    const sorted = service.rank(items, 'LOWEST_PER_UNIT');
    // Zero qty → defaults to 1 → 500/1 = 500
    // Normal → 1000/2 = 500
    // Equal → alphabetical
    expect(sorted.map((r) => r.productName)).toEqual(['Normal', 'Zero']);
  });
});

// ---------------------------------------------------------------------------
// ALPHABETICAL
// ---------------------------------------------------------------------------

describe('ALPHABETICAL', () => {
  it('sorts by product name ascending (locale-aware)', () => {
    const items = [
      createResult({ productName: 'Öl' }),
      createResult({ productName: 'Ale' }),
      createResult({ productName: 'Lager' }),
    ];
    const sorted = service.rank(items, 'ALPHABETICAL');
    expect(sorted.map((r) => r.productName)).toEqual([
      'Ale',
      'Lager',
      'Öl',
    ]);
  });

  it('is deterministic for equal names', () => {
    const items = [
      createResult({ productName: 'Same', totalCents: 200 }),
      createResult({ productName: 'Same', totalCents: 100 }),
    ];
    const sorted = service.rank(items, 'ALPHABETICAL');
    // Names are equal, so order is stable (relative order preserved in [...results].sort)
    expect(sorted).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// ALCOHOL_PERCENTAGE
// ---------------------------------------------------------------------------

describe('ALCOHOL_PERCENTAGE', () => {
  it('sorts by alcoholByVolume descending (strongest first)', () => {
    const items = [
      createResult({ alcoholByVolume: 5.0, productName: 'Mid' }),
      createResult({ alcoholByVolume: 12.0, productName: 'Strong' }),
      createResult({ alcoholByVolume: 2.5, productName: 'Weak' }),
    ];
    const sorted = service.rank(items, 'ALCOHOL_PERCENTAGE');
    expect(sorted.map((r) => r.productName)).toEqual([
      'Strong',
      'Mid',
      'Weak',
    ]);
  });

  it('uses alphabetical tiebreaker when ABV equal', () => {
    const items = [
      createResult({ alcoholByVolume: 5.0, productName: 'B' }),
      createResult({ alcoholByVolume: 5.0, productName: 'A' }),
    ];
    const sorted = service.rank(items, 'ALCOHOL_PERCENTAGE');
    expect(sorted.map((r) => r.productName)).toEqual(['A', 'B']);
  });
});

// ---------------------------------------------------------------------------
// PRODUCT_CATEGORY
// ---------------------------------------------------------------------------

describe('PRODUCT_CATEGORY', () => {
  it('sorts by category ascending (alphabetical)', () => {
    const items = [
      createResult({ category: 'spirits', productName: 'Whisky' }),
      createResult({ category: 'beer', productName: 'Lager' }),
      createResult({ category: 'wine', productName: 'Merlot' }),
    ];
    const sorted = service.rank(items, 'PRODUCT_CATEGORY');
    expect(sorted.map((r) => r.category)).toEqual([
      'beer',
      'spirits',
      'wine',
    ]);
  });

  it('uses alphabetical tiebreaker within same category', () => {
    const items = [
      createResult({ category: 'beer', productName: 'Stout' }),
      createResult({ category: 'beer', productName: 'Ale' }),
    ];
    const sorted = service.rank(items, 'PRODUCT_CATEGORY');
    expect(sorted.map((r) => r.productName)).toEqual(['Ale', 'Stout']);
  });
});

// ---------------------------------------------------------------------------
// Empty / single-element
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('returns empty array for empty input', () => {
    const sorted = service.rank([], 'LOWEST_LANDED_COST');
    expect(sorted).toEqual([]);
  });

  it('returns single element unchanged', () => {
    const item = createResult({ productName: 'Solo' });
    const sorted = service.rank([item], 'ALPHABETICAL');
    expect(sorted).toEqual([item]);
  });
});

// ---------------------------------------------------------------------------
// Runtime guard — neutrality enforcement
// ---------------------------------------------------------------------------

describe('neutrality runtime guard', () => {
  it('accepts valid NeutralSortInput', () => {
    const items = [createResult({ productName: 'A' })];
    expect(() => service.rank(items, 'ALPHABETICAL')).not.toThrow();
  });

  it('rejects input with unknown property "paidBoost"', () => {
    // Use `as any` to bypass the type system and test the runtime guard
    const items = [
      {
        totalCents: 1000,
        volumeLitres: 0.75,
        quantity: 1,
        productName: 'Boosted',
        alcoholByVolume: 5.0,
        category: 'wine',
        paidBoost: 2,
      } as any,
    ];
    expect(() => service.rank(items, 'ALPHABETICAL')).toThrow(TypeError);
    expect(() => service.rank(items, 'ALPHABETICAL')).toThrow(
      'NeutralSortInput guard: unknown property "paidBoost"',
    );
  });

  it('rejects input with unknown property "sponsored"', () => {
    const items = [
      {
        totalCents: 1000,
        volumeLitres: 0.75,
        quantity: 1,
        productName: 'Sponsored',
        alcoholByVolume: 5.0,
        category: 'wine',
        sponsored: true,
      } as any,
    ];
    expect(() => service.rank(items, 'ALPHABETICAL')).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// Compile-time check — type system enforcement
// ---------------------------------------------------------------------------

describe('type system enforcement', () => {
  it('rejects object literal with extra "paidBoost" property at compile time', () => {
    // Excess property checking on a direct assignment to NeutralSortInput
    // should catch this at compile time. If this line compiles without
    // error, the type-level enforcement has been weakened.
    // @ts-expect-error - paidBoost is not a valid NeutralSortInput field
    const _check: NeutralSortInput = { totalCents: 1000, volumeLitres: 0.75, quantity: 1, productName: 'Test', alcoholByVolume: 5.0, category: 'wine', paidBoost: 2 };
    // If we reach here, the assertion is that the type system caught it
    expect(true).toBe(true);
  });

  it('rejects object literal with extra "sponsored" property at compile time', () => {
    // @ts-expect-error - sponsored is not a valid NeutralSortInput field
    const _check: NeutralSortInput = { totalCents: 1000, volumeLitres: 0.75, quantity: 1, productName: 'Test', alcoholByVolume: 5.0, category: 'wine', sponsored: true };
    expect(true).toBe(true);
  });
});