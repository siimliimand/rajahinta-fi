/**
 * sort-products — comparator semantics tests.
 *
 * Locks the compare view's column ordering to the backend RankingService
 * contract: every order deterministic, name ('fi' locale) as universal
 * tiebreaker, no dependence on insertion order.
 *
 * The flag-gated EUR_PER_GRAM order is the spec'd exception: metric
 * value with product id as the tiebreaker (unit-price-metrics spec).
 *
 * @module CompareSortingTest
 */
import { describe, it, expect } from 'vitest';
import type { ComparisonProduct } from '@/lib/types';
import { sortComparisonProducts, compareSortOptions } from './sort-products';

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

describe('sortComparisonProducts — EUR_PER_GRAM (flag-gated option)', () => {
  /** Value-bearing €/g metric in euro cents per gram. */
  const metric = (centsPerGram: number) => ({
    status: 'computed' as const,
    centsPerGram,
    ethanolGrams: 100,
    priceReliability: 'VERIFIED' as const,
  });

  const cheap = product({ id: 1, name: 'B Cheap', eurPerGram: metric(3.1) });
  const pricey = product({ id: 2, name: 'A Pricey', eurPerGram: metric(9.4) });

  it('orders strictly by metric value ascending', () => {
    expect(
      sortComparisonProducts([pricey, cheap], 'EUR_PER_GRAM').map((p) => p.id),
    ).toEqual([1, 2]);
  });

  it('breaks ties by product id — not by name (spec: value, then product id)', () => {
    // Names reversed relative to ids: alphabetical order would be [2, 1].
    const lowId = product({ id: 1, name: 'ZZZ', eurPerGram: metric(5) });
    const highId = product({ id: 2, name: 'AAA', eurPerGram: metric(5) });
    expect(
      sortComparisonProducts([highId, lowId], 'EUR_PER_GRAM').map((p) => p.id),
    ).toEqual([1, 2]);
  });

  it('an unavailable metric sorts last and is never a fake 0', () => {
    const noAbv = product({
      id: 3,
      name: 'C No ABV',
      eurPerGram: {
        status: 'unavailable',
        centsPerGram: null,
        ethanolGrams: null,
        reason: 'MISSING_ALCOHOL_FRACTION',
      },
    });
    expect(
      sortComparisonProducts([noAbv, pricey, cheap], 'EUR_PER_GRAM').map(
        (p) => p.id,
      ),
    ).toEqual([1, 2, 3]);
  });

  it('an absent metric (flag off / unresolved) sorts last', () => {
    const bare = product({ id: 3, name: 'C Bare' });
    expect(
      sortComparisonProducts([bare, cheap], 'EUR_PER_GRAM').map((p) => p.id),
    ).toEqual([1, 3]);
  });

  it('reads only the metric value and product id — no other field moves the order', () => {
    const decorated = {
      ...pricey,
      name: 'AAA ZZZ',
      brand: 'PromoBrand',
      category: 'sponsored-category',
      merchantName: 'Featured Merchant',
    };
    // All commercial-looking decorations, same metric + id: order unchanged.
    expect(
      sortComparisonProducts([decorated, cheap], 'EUR_PER_GRAM').map(
        (p) => p.id,
      ),
    ).toEqual([1, 2]);
  });

  it('is deterministic across repeated calls', () => {
    const first = sortComparisonProducts([pricey, cheap], 'EUR_PER_GRAM');
    const second = sortComparisonProducts([pricey, cheap], 'EUR_PER_GRAM');
    expect(first.map((p) => p.id)).toEqual(second.map((p) => p.id));
  });
});

describe('compareSortOptions — flag gating', () => {
  it('offers EUR_PER_GRAM when the unit-price flag is on', () => {
    expect(compareSortOptions(true)).toContain('EUR_PER_GRAM');
    expect(compareSortOptions(true)).toHaveLength(7);
  });

  it('removes EUR_PER_GRAM when the flag is off, keeping the six neutral orders', () => {
    const options = compareSortOptions(false);
    expect(options).not.toContain('EUR_PER_GRAM');
    expect(options).toHaveLength(6);
  });
});
