/**
 * sort-products — comparator semantics tests.
 *
 * Locks the compare view's column ordering to the backend RankingService
 * contract: every order deterministic, name ('fi' locale) as universal
 * tiebreaker, no dependence on insertion order.
 *
 * @module CompareSortingTest
 */
import { describe, it, expect } from 'vitest';
import type { ComparisonProduct } from '@/lib/types';
import { sortComparisonProducts } from './sort-products';

function product(overrides: Partial<ComparisonProduct>): ComparisonProduct {
  return {
    id: 1,
    name: 'Product',
    brand: 'Brand',
    category: 'beer',
    unitVolume: '0.500',
    alcoholByVolume: 0.047,
    totalCents: 1000,
    itemizedCosts: [],
    confidence: 'HIGH',
    reliability: 'VERIFIED',
    ...overrides,
  };
}

const beer = product({
  id: 1,
  name: 'TEST Beer — Lorem Ipsum Dolor',
  category: 'beer',
  unitVolume: '0.500',
  alcoholByVolume: 0.047,
  totalCents: 1499,
});

const wine = product({
  id: 2,
  name: 'TEST Wine — Lorem Ipsum',
  category: 'wine_still',
  unitVolume: '0.750',
  alcoholByVolume: 0.12,
  totalCents: 5999,
});

describe('sortComparisonProducts', () => {
  it('LOWEST_LANDED_COST orders by total cost ascending', () => {
    expect(
      sortComparisonProducts([wine, beer], 'LOWEST_LANDED_COST').map((p) => p.id),
    ).toEqual([1, 2]);
  });

  it('LOWEST_PER_UNIT matches total-cost order for quantity-1 columns', () => {
    expect(
      sortComparisonProducts([wine, beer], 'LOWEST_PER_UNIT').map((p) => p.id),
    ).toEqual([1, 2]);
  });

  it('LOWEST_PER_LITRE divides by parsed unit volume (beer 1499/0.5 < wine 5999/0.75)', () => {
    expect(
      sortComparisonProducts([wine, beer], 'LOWEST_PER_LITRE').map((p) => p.id),
    ).toEqual([1, 2]);
    // The order flips when the per-litre relationship does.
    const cheapBigWine = { ...wine, totalCents: 1500 }; // 2000 €/l vs beer 2998 €/l
    expect(
      sortComparisonProducts([beer, cheapBigWine], 'LOWEST_PER_LITRE').map(
        (p) => p.id,
      ),
    ).toEqual([2, 1]);
  });

  it('LOWEST_PER_LITRE treats unparseable volume as infinitely expensive', () => {
    const mystery = product({ id: 3, name: 'TEST Mystery', totalCents: 1, unitVolume: 'n/a' });
    expect(
      sortComparisonProducts([mystery, beer], 'LOWEST_PER_LITRE').map((p) => p.id),
    ).toEqual([1, 3]);
  });

  it('ALPHABETICAL sorts by name, Finnish locale', () => {
    expect(
      sortComparisonProducts([wine, beer], 'ALPHABETICAL').map((p) => p.name),
    ).toEqual([beer.name, wine.name]);
  });

  it('ALCOHOL_PERCENTAGE sorts strongest first; null ABV ranks last', () => {
    const virgin = product({ id: 3, name: 'TEST Virgin', alcoholByVolume: null });
    expect(
      sortComparisonProducts([beer, virgin, wine], 'ALCOHOL_PERCENTAGE').map(
        (p) => p.id,
      ),
    ).toEqual([2, 1, 3]);
  });

  it('PRODUCT_CATEGORY groups by category, name within', () => {
    const anotherBeer = product({ id: 4, name: 'A Another Beer', category: 'beer' });
    expect(
      sortComparisonProducts([wine, anotherBeer, beer], 'PRODUCT_CATEGORY').map(
        (p) => p.id,
      ),
    ).toEqual([4, 1, 2]);
  });

  it('uses the product name as universal tiebreaker (equal totals)', () => {
    const twin = { ...beer, id: 9, name: 'ZZZ Same Price' };
    expect(
      sortComparisonProducts([twin, beer], 'LOWEST_LANDED_COST').map((p) => p.id),
    ).toEqual([1, 9]);
  });

  it('never mutates the input array', () => {
    const input = [wine, beer];
    sortComparisonProducts(input, 'ALCOHOL_PERCENTAGE');
    expect(input.map((p) => p.id)).toEqual([2, 1]);
  });

  it('is deterministic: same input + order → same output across calls', () => {
    const first = sortComparisonProducts([wine, beer], 'LOWEST_PER_LITRE');
    const second = sortComparisonProducts([wine, beer], 'LOWEST_PER_LITRE');
    expect(first.map((p) => p.id)).toEqual(second.map((p) => p.id));
  });
});
