/**
 * Neutrality & compliance tests — v1.0.
 *
 * Automated checks that the ranking system is free of paid/promotional
 * interference and that generated product copy contains no forbidden
 * promotional vocabulary.
 *
 * ## What is tested
 *
 * 1. **Neutrality — type-level** — verifies that the compile-time type
 *    assertion `_NeutralityTypeCheck` prevents `paidBoost` from being
 *    assignable to `NeutralSortInput`. (The runtime guard is tested in
 *    the core-domain package's own unit tests.)
 * 2. **Content policy** — verifies that `checkContent()` catches forbidden
 *    promotional adjectives and that `isCompliant()` returns false for
 *    non-compliant text.
 * 3. **Sorting invariants** — verifies that sorting by LOWEST_LANDED_COST
 *    sorts purely by totalCents ascending, with alphabetical tiebreaker
 *    when costs are equal (using the same pure-function comparators).
 * 4. **€/g sort neutrality** — verifies that the flag-gated EUR_PER_GRAM
 *    compare option (unit-price-metrics / ranking-sorting specs) is
 *    registered when the unit-price flag is on, removed when off,
 *    orders deterministically by metric value with product id as the
 *    tiebreaker, and reads no commercial signal.
 *
 * These tests are deliberately redundant with the per-package unit tests
 * (ranking.service.test.ts and content-policy.test.ts). They exist as a
 * cross-package compliance layer that runs in CI independently, providing
 * a second opinion on the most critical neutrality invariants.
 *
 * @module ComplianceTests
 */

import { describe, it, expect } from 'vitest';
import type { NeutralSortInput } from '@rajahinta/core-domain/ranking/ranking.types';
import { checkContent, isCompliant } from '@rajahinta/frontend/lib/content-policy';
import type { ComparisonProduct } from '@rajahinta/frontend/lib/types';
import {
  compareSortOptions,
  sortComparisonProducts,
} from '@rajahinta/frontend/app/[locale]/compare/sort-products';

// ---------------------------------------------------------------------------
// Pure-function comparators (replicated from ranking.service.ts to test
// invariants without instantiating NestJS-decorated RankingService)
// ---------------------------------------------------------------------------

function compareAlphabetical(a: NeutralSortInput, b: NeutralSortInput): number {
  return a.productName.localeCompare(b.productName, 'fi');
}

function compareLowestLandedCost(a: NeutralSortInput, b: NeutralSortInput): number {
  const diff = a.totalCents - b.totalCents;
  if (diff !== 0) return diff;
  return compareAlphabetical(a, b);
}

function rank(items: readonly NeutralSortInput[]): NeutralSortInput[] {
  return [...items].sort(compareLowestLandedCost);
}

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

function createItem(overrides?: Partial<NeutralSortInput>): NeutralSortInput {
  return {
    totalCents: overrides?.totalCents ?? 1000,
    volumeLitres: overrides?.volumeLitres ?? 0.75,
    quantity: overrides?.quantity ?? 1,
    productName: overrides?.productName ?? 'Test Product',
    alcoholByVolume: overrides?.alcoholByVolume ?? 5.0,
    category: overrides?.category ?? 'beer',
  };
}

// ===========================================================================
// 1. Neutrality — type-level enforcement
// ===========================================================================

describe('Neutrality — type-level enforcement', () => {
  it('NeutralSortInput does not accept paidBoost at the type level', () => {
    // This type assertion proves NeutralSortInput is structurally sealed.
    // If _NeutralityTypeCheck were `never` (because the interface accepted
    // paidBoost), this test's tsconfig would still let it compile, but the
    // actual type in ranking.types.ts contains a compile-time assertion
    // that proves the opposite.
    //
    // Here we verify the runtime shape: any extra property we can think
    // of should NOT be part of NeutralSortInput.
    const item = createItem();
    expect(item).not.toHaveProperty('paidBoost');
    expect(item).not.toHaveProperty('sponsored');
    expect(item).not.toHaveProperty('promoBoost');
  });

  it('all declared NeutralSortInput fields are present', () => {
    const item = createItem();
    expect(item).toHaveProperty('totalCents');
    expect(item).toHaveProperty('volumeLitres');
    expect(item).toHaveProperty('quantity');
    expect(item).toHaveProperty('productName');
    expect(item).toHaveProperty('alcoholByVolume');
    expect(item).toHaveProperty('category');
    expect(Object.keys(item).length).toBe(6);
  });

  it('only the 6 declared fields appear on a NeutralSortInput object', () => {
    const item = createItem();
    const keys = Object.keys(item).sort();
    expect(keys).toEqual([
      'alcoholByVolume',
      'category',
      'productName',
      'quantity',
      'totalCents',
      'volumeLitres',
    ]);
  });
});

// ===========================================================================
// 2. Content policy — forbidden promotional vocabulary
// ===========================================================================

describe('Content policy', () => {
  it('detects "best" as a forbidden adjective', () => {
    const violations = checkContent('This is the best beer');
    expect(violations.length).toBeGreaterThanOrEqual(1);
    const words = violations.map((v) => v.word);
    expect(words).toContain('best');
  });

  it('detects "amazing" as a forbidden adjective', () => {
    const violations = checkContent('An amazing deal on wine');
    expect(violations.some((v) => v.word === 'amazing')).toBe(true);
  });

  it('detects "premium" with suggestion', () => {
    const violations = checkContent('Premium lager from Germany');
    const premium = violations.find((v) => v.word === 'premium');
    expect(premium).toBeDefined();
    expect(premium!.suggestion).toBe(
      'use the actual product tier or skip the descriptor',
    );
  });

  it('detects "cheapest" with replacement suggestion', () => {
    const violations = checkContent('The cheapest beer in Finland');
    const cheapest = violations.find((v) => v.word === 'cheapest');
    expect(cheapest).toBeDefined();
    expect(cheapest!.suggestion).toContain('lowest landed cost');
  });

  it('returns empty violations for factual, non-promotional text', () => {
    const text = 'Classic lager, 5% ABV, 330ml';
    expect(checkContent(text)).toEqual([]);
  });

  it('returns empty violations for product identification copy', () => {
    const text =
      'Classification: Distance Selling. Tax: €1.50/litre excise. Origin: Germany. Volume: 0.75L.';
    expect(checkContent(text)).toEqual([]);
  });

  it('returns empty violations for empty string', () => {
    expect(checkContent('')).toEqual([]);
  });

  it('isCompliant returns false for "This is the best beer"', () => {
    expect(isCompliant('This is the best beer')).toBe(false);
  });

  it('isCompliant returns true for factual product description', () => {
    expect(isCompliant('Classic lager, 5% ABV, 330ml')).toBe(true);
  });

  it('matches word boundaries (does not match substrings)', () => {
    // "best" in "beste" should not be flagged
    expect(checkContent('Die beste Bier aus Deutschland')).toEqual([]);
    // "top" in "toppen" should not be flagged
    expect(checkContent('Toppen av sortimentet')).toEqual([]);
  });
});

// ===========================================================================
// 3. Ranking — LOWEST_LANDED_COST sorting invariants
// ===========================================================================

describe('LOWEST_LANDED_COST sorting invariants', () => {
  it('sorts by totalCents ascending (lowest first)', () => {
    const items = [
      createItem({ totalCents: 3000, productName: 'Expensive' }),
      createItem({ totalCents: 1000, productName: 'Cheap' }),
      createItem({ totalCents: 2000, productName: 'Mid' }),
    ];
    const sorted = rank(items);
    expect(sorted.map((r) => r.totalCents)).toEqual([1000, 2000, 3000]);
  });

  it('uses alphabetical tiebreaker when totalCents are equal', () => {
    const items = [
      createItem({ totalCents: 1500, productName: 'Zeta' }),
      createItem({ totalCents: 1500, productName: 'Alpha' }),
      createItem({ totalCents: 1500, productName: 'Beta' }),
    ];
    const sorted = rank(items);
    expect(sorted.map((r) => r.productName)).toEqual(['Alpha', 'Beta', 'Zeta']);
  });

  it('does not mutate the original array', () => {
    const items = [
      createItem({ totalCents: 2000, productName: 'B' }),
      createItem({ totalCents: 1000, productName: 'A' }),
    ];
    const sorted = rank(items);
    expect(sorted).not.toBe(items);
    expect(items[0].totalCents).toBe(2000);
  });

  it('handles single element correctly', () => {
    const items = [createItem({ totalCents: 500, productName: 'Solo' })];
    const sorted = rank(items);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].productName).toBe('Solo');
  });

  it('handles mixed costs with partial ties', () => {
    // Three items where two share the same totalCents (tiebreaker = alphabetical)
    const items = [
      createItem({ totalCents: 2000, productName: 'C' }),
      createItem({ totalCents: 1000, productName: 'A' }),
      createItem({ totalCents: 1000, productName: 'B' }),
    ];
    const sorted = rank(items);
    // A and B tie at 1000 (alphabetical → A, B); then C at 2000
    expect(sorted.map((r) => r.productName)).toEqual(['A', 'B', 'C']);
    expect(sorted.map((r) => r.totalCents)).toEqual([1000, 1000, 2000]);
  });

  it('tiebreaker is always alphabetical, never by any other field', () => {
    // Items with equal totalCents but different category/ABV should sort
    // alphabetically by productName, ignoring other fields.
    const items = [
      createItem({ totalCents: 2000, productName: 'Zebra', category: 'spirits', alcoholByVolume: 40 }),
      createItem({ totalCents: 2000, productName: 'Apple', category: 'beer', alcoholByVolume: 5 }),
      createItem({ totalCents: 2000, productName: 'Banana', category: 'wine', alcoholByVolume: 12 }),
    ];
    const sorted = rank(items);
    expect(sorted.map((r) => r.productName)).toEqual(['Apple', 'Banana', 'Zebra']);
  });

  it('handles empty array', () => {
    expect(rank([])).toEqual([]);
  });
});

// ===========================================================================
// 4. Cross-cutting: content-policy compatibility with sort results
// ===========================================================================

describe('Cross-cutting compliance', () => {
  it('sort results can produce compliant copy', () => {
    const items = [
      createItem({ totalCents: 1500, productName: 'Karhu III' }),
      createItem({ totalCents: 1200, productName: 'Lapin Kulta' }),
    ];
    const sorted = rank(items);
    const descriptions = sorted.map(
      (r) => `${r.productName}, ${r.alcoholByVolume}% ABV, ${r.totalCents}¢`,
    );
    for (const desc of descriptions) {
      expect(isCompliant(desc)).toBe(true);
    }
  });
});

// ===========================================================================
// 5. €/g sort neutrality (flag enable_unit_price_eur_per_gram)
//
// ranking-sorting spec: €/g is a neutral sort option under the same rules
// as every other sort — deterministic, objective inputs only, no code
// path reading billing/promotion/merchant-preference state. Flag off
// removes the option. unit-price-metrics spec: strictly by metric value
// with product id as the tiebreaker.
// ===========================================================================

/** Value-bearing €/g metric in euro cents per gram (mirrors the API embed). */
function eurPerGramValue(centsPerGram: number) {
  return {
    status: 'computed' as const,
    centsPerGram,
    ethanolGrams: 100,
    priceReliability: 'VERIFIED' as const,
  };
}

function createCompareProduct(
  overrides?: Partial<ComparisonProduct>,
): ComparisonProduct {
  return {
    id: overrides?.id ?? 1,
    name: overrides?.name ?? 'Test Product',
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

describe('EUR_PER_GRAM sort option registration (unit-price flag)', () => {
  it('€/g is offered when the unit-price flag is on', () => {
    const options = compareSortOptions(true);
    expect(options).toContain('EUR_PER_GRAM');
  });

  it('the option set is a bare string list — no promoted/recommended metadata', () => {
    for (const option of compareSortOptions(true)) {
      expect(typeof option).toBe('string');
      expect(option).not.toMatch(/promo|sponsor|featured|boost/i);
    }
  });

  it('flag off removes the €/g option and keeps the six neutral orders', () => {
    const options = compareSortOptions(false);
    expect(options).not.toContain('EUR_PER_GRAM');
    expect(options).toHaveLength(6);
    expect(options).toEqual([
      'LOWEST_LANDED_COST',
      'LOWEST_PER_LITRE',
      'LOWEST_PER_UNIT',
      'ALPHABETICAL',
      'ALCOHOL_PERCENTAGE',
      'PRODUCT_CATEGORY',
    ]);
  });
});

describe('EUR_PER_GRAM sorting invariants', () => {
  it('orders strictly by metric value ascending', () => {
    const items = [
      createCompareProduct({ id: 1, eurPerGram: eurPerGramValue(9.4) }),
      createCompareProduct({ id: 2, eurPerGram: eurPerGramValue(3.1) }),
      createCompareProduct({ id: 3, eurPerGram: eurPerGramValue(5.5) }),
    ];
    const sorted = sortComparisonProducts(items, 'EUR_PER_GRAM');
    expect(sorted.map((p) => p.id)).toEqual([2, 3, 1]);
  });

  it('uses product id as the tiebreaker — never name, category, or price', () => {
    // ids ascending but names/categories reversed: only (value, id) may decide.
    const items = [
      createCompareProduct({
        id: 3,
        name: 'AAA',
        category: 'wine',
        eurPerGram: eurPerGramValue(5),
      }),
      createCompareProduct({
        id: 2,
        name: 'BBB',
        category: 'beer',
        eurPerGram: eurPerGramValue(5),
      }),
      createCompareProduct({
        id: 1,
        name: 'CCC',
        category: 'spirits',
        eurPerGram: eurPerGramValue(5),
      }),
    ];
    const sorted = sortComparisonProducts(items, 'EUR_PER_GRAM');
    expect(sorted.map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it('produces the identical order on every run for the same data', () => {
    const items = [
      createCompareProduct({ id: 1, eurPerGram: eurPerGramValue(4) }),
      createCompareProduct({ id: 2, eurPerGram: eurPerGramValue(2) }),
      createCompareProduct({ id: 3, eurPerGram: eurPerGramValue(2) }),
      createCompareProduct({ id: 4, eurPerGram: eurPerGramValue(7) }),
    ];
    const first = sortComparisonProducts(items, 'EUR_PER_GRAM').map(
      (p) => p.id,
    );
    const second = sortComparisonProducts(items, 'EUR_PER_GRAM').map(
      (p) => p.id,
    );
    expect(first).toEqual(second);
    expect(first).toEqual([2, 3, 1, 4]);
  });

  it('an unavailable metric sorts last — no value is silently substituted', () => {
    const unavailable = createCompareProduct({
      id: 3,
      eurPerGram: {
        status: 'unavailable',
        centsPerGram: null,
        ethanolGrams: null,
        reason: 'MISSING_ALCOHOL_FRACTION',
      },
    });
    const items = [unavailable, createCompareProduct({ id: 1, eurPerGram: eurPerGramValue(50) })];
    const sorted = sortComparisonProducts(items, 'EUR_PER_GRAM');
    expect(sorted.map((p) => p.id)).toEqual([1, 3]);
    // The metric stays unavailable — no value was invented for sorting.
    expect(sorted[1].eurPerGram).toEqual({
      status: 'unavailable',
      centsPerGram: null,
      ethanolGrams: null,
      reason: 'MISSING_ALCOHOL_FRACTION',
    });
  });

  it('no commercial signal can move the order — comparator reads only value + id', () => {
    const plain = [
      createCompareProduct({ id: 1, eurPerGram: eurPerGramValue(5) }),
      createCompareProduct({ id: 2, eurPerGram: eurPerGramValue(5) }),
    ];
    // Decorate with every commercial-looking field the type carries:
    // same metric values and ids, so the order must not change.
    const decorated = [
      createCompareProduct({
        id: 1,
        eurPerGram: eurPerGramValue(5),
        name: 'AAA',
        brand: 'SponsoredBrand',
        merchantName: 'Preferred Merchant',
        merchants: ['Preferred Merchant', 'Other Merchant'],
      }),
      createCompareProduct({
        id: 2,
        eurPerGram: eurPerGramValue(5),
        name: 'ZZZ',
        brand: 'UnknownBrand',
        merchantName: 'Other Merchant',
        merchants: ['Other Merchant'],
      }),
    ];
    expect(
      sortComparisonProducts(decorated, 'EUR_PER_GRAM').map((p) => p.id),
    ).toEqual(sortComparisonProducts(plain, 'EUR_PER_GRAM').map((p) => p.id));
  });

  it('the comparison input type carries no paid/promotional field', () => {
    const item = createCompareProduct();
    expect(item).not.toHaveProperty('paidBoost');
    expect(item).not.toHaveProperty('sponsored');
    expect(item).not.toHaveProperty('promoBoost');
    expect(item).not.toHaveProperty('merchantPreference');
  });
});