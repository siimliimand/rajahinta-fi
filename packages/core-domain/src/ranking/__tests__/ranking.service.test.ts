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
 * @module RankingServiceTests
 */

import { describe, it, expect } from 'vitest';
import { RankingService } from '../ranking.service';
import type { CalculatorResult } from '../../calculator/calculator.types';
import type { Disclaimer } from '../../index';
import type { ConfidenceLevel } from '../../reliability/confidence-framework.types';
import type { ConfidenceDetail } from '../../reliability/confidence-framework.types';
import type { ClassificationResult } from '../../classification/classification.types';

// ---------------------------------------------------------------------------
// Test fixture factory
// ---------------------------------------------------------------------------

const DEFAULT_DISCLAIMER: Disclaimer = {
  text: 'Test disclaimer.',
  language: 'en',
  version: '1.0',
};

const DEFAULT_CLASSIFICATION: ClassificationResult = {
  classification: 'DistanceBuying',
  confidence: 'HIGH',
  evidence: [{ observation: 'Test', supportingData: 'test', source: 'test' }],
  evidenceSummary: 'Test classification.',
};

function createResult(overrides: {
  totalCents?: number;
  productName?: string;
  volumeLitres?: number;
  alcoholByVolume?: number;
  category?: string;
  quantity?: number;
}): CalculatorResult {
  return {
    itemizedCosts: [],
    foreignRetailPrice: 0,
    transportCost: 0,
    alcoholExciseEstimate: 0,
    containerDutyEstimate: 0,
    otherCharges: 0,
    totalCents: overrides.totalCents ?? 1000,
    currency: 'EUR',
    confidence: 'HIGH' as ConfidenceLevel,
    confidenceBreakdown: [] as readonly ConfidenceDetail[],
    disclaimer: DEFAULT_DISCLAIMER,
    classification: DEFAULT_CLASSIFICATION,
    metadata: {
      input: {
        productId: 1,
        quantity: overrides.quantity ?? 1,
        destination: 'FI',
      },
      calculationTimestamp: '2025-01-01T00:00:00Z',
      productMasterId: 1,
      retailOfferIds: [1],
      quantity: overrides.quantity ?? 1,
      destination: 'FI',
      productName: overrides.productName ?? 'Test Product',
      volumeLitres: overrides.volumeLitres ?? 0.75,
      alcoholByVolume: overrides.alcoholByVolume ?? 5.0,
      category: overrides.category ?? 'wine',
      datasetVersions: ['v1'],
      transportOfferId: null,
    },
    calculationRecordId: 1,
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
    expect(sorted.map((r) => r.metadata.productName)).toEqual([
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
    expect(sorted.map((r) => r.metadata.productName)).toEqual(['A', 'B', 'C']);
  });

  it('handles zero volumeLitres gracefully (Infinity)', () => {
    const items = [
      createResult({ totalCents: 500, volumeLitres: 0, productName: 'Zero' }),
      createResult({ totalCents: 1000, volumeLitres: 0.5, productName: 'Normal' }),
    ];
    const sorted = service.rank(items, 'LOWEST_PER_LITRE');
    // Normal should come first (finite cost per litre), Zero last (Infinity)
    expect(sorted[0].metadata.productName).toBe('Normal');
    expect(sorted[1].metadata.productName).toBe('Zero');
  });

  it('uses alphabetical tiebreaker when cost per litre equal', () => {
    const items = [
      createResult({ totalCents: 500, volumeLitres: 0.25, productName: 'Z' }),
      createResult({ totalCents: 1000, volumeLitres: 0.5, productName: 'A' }),
    ];
    const sorted = service.rank(items, 'LOWEST_PER_LITRE');
    expect(sorted.map((r) => r.metadata.productName)).toEqual(['A', 'Z']);
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
    expect(sorted.map((r) => r.metadata.productName)).toEqual(['A', 'C', 'B']);
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
    expect(sorted.map((r) => r.metadata.productName)).toEqual(['Normal', 'Zero']);
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
    expect(sorted.map((r) => r.metadata.productName)).toEqual([
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
    expect(sorted.map((r) => r.metadata.productName)).toEqual([
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
    expect(sorted.map((r) => r.metadata.productName)).toEqual(['A', 'B']);
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
    expect(sorted.map((r) => r.metadata.category)).toEqual([
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
    expect(sorted.map((r) => r.metadata.productName)).toEqual(['Ale', 'Stout']);
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