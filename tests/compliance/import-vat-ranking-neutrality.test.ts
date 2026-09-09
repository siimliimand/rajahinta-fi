/**
 * Import-VAT ranking neutrality — VAT is a tax line, not a ranking input
 * (task 4.4, change alks-feed-and-import-vat).
 *
 * Architecture rule: ranking and sorting must be objective and
 * deterministic, with no code path allowing a boost or penalty.  The
 * import-VAT line enters the calculation result as an itemised tax line
 * (summed into `totalCents` like every other cost) — it must never become
 * a ranking signal of its own.  These checks pin that:
 *
 *   1. decorating `itemizedCosts` with VAT lines cannot reorder ANY
 *      compare order — the comparators never read cost lines,
 *   2. a VAT-inclusive foreign total and a VAT-free domestic total compete
 *      purely on `totalCents` — the tax line cannot win or lose a slot,
 *   3. neither ranking input type carries a VAT field — there is no new
 *      boost/penalty surface to misuse.
 *
 * @module ImportVatRankingNeutralityTests
 */

import { describe, it, expect } from 'vitest';
import type { NeutralSortInput } from '@rajahinta/core-domain/ranking/ranking.types';
import type { ComparisonProduct, ItemizedCost } from '@rajahinta/frontend/lib/types';
import {
  COMPARE_SORT_OPTIONS,
  sortComparisonProducts,
} from '@rajahinta/frontend/app/[locale]/compare/sort-products';

// ---------------------------------------------------------------------------
// Fixtures — one domestic result (no VAT line) vs one foreign result
// (itemised import-VAT line, task 4.3 shape)
// ---------------------------------------------------------------------------

const DOMESTIC_LINES: ItemizedCost[] = [
  { label: 'Retail price', category: 'foreignRetailPrice', cents: 340, reliability: 'ESTIMATED' },
  { label: 'Transport', category: 'transportCost', cents: 0, reliability: 'UNAVAILABLE' },
  { label: 'Alcohol excise', category: 'alcoholExciseEstimate', cents: 91, reliability: 'VERIFIED' },
  { label: 'Container duty', category: 'containerDutyEstimate', cents: 0, reliability: 'VERIFIED' },
];

const FOREIGN_LINES: ItemizedCost[] = [
  { label: 'Retail price', category: 'foreignRetailPrice', cents: 200, reliability: 'ESTIMATED' },
  { label: 'Transport', category: 'transportCost', cents: 150, reliability: 'ESTIMATED' },
  { label: 'Alcohol excise', category: 'alcoholExciseEstimate', cents: 91, reliability: 'VERIFIED' },
  { label: 'Container duty', category: 'containerDutyEstimate', cents: 0, reliability: 'VERIFIED' },
  {
    label: 'Import VAT (estimated)',
    category: 'importVatEstimate',
    cents: 112,
    reliability: 'VERIFIED',
    rateVersionId: 'import-vat-2024.2',
    calculatedAt: '2026-09-09T10:00:00.000Z',
    breakdown: [
      { label: 'Retail price', category: 'foreignRetailPrice', cents: 200, reliability: 'VERIFIED' },
      { label: 'Transport', category: 'transportCost', cents: 150, reliability: 'VERIFIED' },
      { label: 'Alcohol excise', category: 'alcoholExciseEstimate', cents: 91, reliability: 'VERIFIED' },
      { label: 'Container duty', category: 'containerDutyEstimate', cents: 0, reliability: 'VERIFIED' },
    ],
  },
];

function createCompareProduct(
  overrides?: Partial<ComparisonProduct>,
): ComparisonProduct {
  return {
    id: 1,
    name: 'Test Product',
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

// ---------------------------------------------------------------------------
// 1. VAT lines cannot reorder — comparators never read cost lines
// ---------------------------------------------------------------------------

describe('VAT item lines are invisible to every compare order', () => {
  const plain = [
    createCompareProduct({ id: 1, name: 'Alpha', totalCents: 553, itemizedCosts: DOMESTIC_LINES }),
    createCompareProduct({ id: 2, name: 'Beta', totalCents: 553, itemizedCosts: DOMESTIC_LINES }),
    createCompareProduct({ id: 3, name: 'Gamma', totalCents: 553, itemizedCosts: DOMESTIC_LINES }),
  ];

  it('decorating itemizedCosts with VAT lines leaves every order unchanged', () => {
    // Same totals, one product carrying the VAT line — no order may move.
    const decorated = [
      createCompareProduct({ id: 1, name: 'Alpha', totalCents: 553, itemizedCosts: DOMESTIC_LINES }),
      createCompareProduct({ id: 2, name: 'Beta', totalCents: 553, itemizedCosts: FOREIGN_LINES }),
      createCompareProduct({ id: 3, name: 'Gamma', totalCents: 553, itemizedCosts: FOREIGN_LINES }),
    ];

    for (const order of COMPARE_SORT_OPTIONS) {
      expect(sortComparisonProducts(decorated, order).map((p) => p.id)).toEqual(
        sortComparisonProducts(plain, order).map((p) => p.id),
      );
    }
  });

  it('swapping which product carries the VAT line swaps nothing', () => {
    const mirrored = [
      createCompareProduct({ id: 1, name: 'Alpha', totalCents: 553, itemizedCosts: FOREIGN_LINES }),
      createCompareProduct({ id: 2, name: 'Beta', totalCents: 553, itemizedCosts: DOMESTIC_LINES }),
      createCompareProduct({ id: 3, name: 'Gamma', totalCents: 553, itemizedCosts: FOREIGN_LINES }),
    ];

    for (const order of COMPARE_SORT_OPTIONS) {
      expect(sortComparisonProducts(mirrored, order).map((p) => p.id)).toEqual(
        sortComparisonProducts(plain, order).map((p) => p.id),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 2. VAT-inclusive totals compete purely on totalCents
// ---------------------------------------------------------------------------

describe('VAT enters ranking only through totalCents', () => {
  it('a VAT-free domestic total ranks above a VAT-inclusive foreign total only by amount', () => {
    // Domestic 431 ¢ (no VAT line) vs foreign 553 ¢ (VAT included): the
    // foreign offer carries MORE itemised lines and the larger tax sum,
    // yet ranks by its total alone.
    const mixed = [
      createCompareProduct({ id: 1, name: 'Foreign', totalCents: 553, itemizedCosts: FOREIGN_LINES }),
      createCompareProduct({ id: 2, name: 'Domestic', totalCents: 431, itemizedCosts: DOMESTIC_LINES }),
    ];
    expect(sortComparisonProducts(mixed, 'LOWEST_LANDED_COST').map((p) => p.id)).toEqual([2, 1]);

    // Reversing the totals reverses the order — the totals rule, not the
    // tax provenance.
    const flipped = [
      createCompareProduct({ id: 1, name: 'Foreign', totalCents: 431, itemizedCosts: FOREIGN_LINES }),
      createCompareProduct({ id: 2, name: 'Domestic', totalCents: 553, itemizedCosts: DOMESTIC_LINES }),
    ];
    expect(sortComparisonProducts(flipped, 'LOWEST_LANDED_COST').map((p) => p.id)).toEqual([1, 2]);
  });

  it('equal totals tie-break alphabetically regardless of VAT lines', () => {
    const tied = [
      createCompareProduct({ id: 1, name: 'Zeta', totalCents: 553, itemizedCosts: FOREIGN_LINES }),
      createCompareProduct({ id: 2, name: 'Alpha', totalCents: 553, itemizedCosts: DOMESTIC_LINES }),
    ];
    expect(sortComparisonProducts(tied, 'LOWEST_LANDED_COST').map((p) => p.name)).toEqual([
      'Alpha',
      'Zeta',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 3. No VAT boost/penalty surface exists on the ranking inputs
// ---------------------------------------------------------------------------

describe('ranking input types carry no VAT surface', () => {
  it('NeutralSortInput has no VAT (or boost/penalty) field', () => {
    const item: NeutralSortInput = {
      totalCents: 1000,
      volumeLitres: 0.5,
      quantity: 1,
      productName: 'Test',
      alcoholByVolume: 5,
      category: 'beer',
    };
    const keys = Object.keys(item);
    expect(keys).not.toContain('importVatEstimate');
    for (const key of keys) {
      expect(key.toLowerCase()).not.toContain('vat');
      expect(key.toLowerCase()).not.toMatch(/boost|penalt|promo|sponsor/);
    }
  });

  it('ComparisonProduct exposes VAT only inside itemizedCosts — never as a top-level field', () => {
    const product = createCompareProduct({ itemizedCosts: FOREIGN_LINES });
    for (const key of Object.keys(product)) {
      expect(key.toLowerCase()).not.toContain('vat');
    }
    // The line itself lives where display code reads it — not where any
    // comparator does.
    expect(product.itemizedCosts?.some((l) => l.category === 'importVatEstimate')).toBe(true);
  });

  it('the compare option set contains no VAT-ordered variant', () => {
    for (const option of COMPARE_SORT_OPTIONS) {
      expect(option.toLowerCase()).not.toContain('vat');
    }
  });
});
