/**
 * Tests for alcohol-excise pure calculation functions.
 *
 * These are HIGH-LIABILITY code paths — the exact cent values must be
 * preserved.  Every formula variant is tested with known inputs/outputs.
 */
import { describe, it, expect } from 'vitest';
import {
  calcPerLitreOfProduct,
  calcPerLitreOfAlcohol,
  calcProgressiveAbv,
  calculateAlcoholExcise,
  normaliseCategory,
  FORMULA_PER_LITRE_OF_PRODUCT,
  FORMULA_PER_LITRE_OF_ALCOHOL,
  FORMULA_PROGRESSIVE_ABV,
  DEFAULT_BEER_TIERS,
} from '../services/alcohol-excise.math';

// ---------------------------------------------------------------------------
// calcPerLitreOfProduct
// ---------------------------------------------------------------------------

describe('calcPerLitreOfProduct', () => {
  it('returns 0 for 0 volume', () => {
    expect(calcPerLitreOfProduct(0.355, 0)).toBe(0);
  });

  it('calculates wine excise correctly: 0.75L × €0.355/L = €0.26625 → 27 cents', () => {
    // 0.355 * 0.75 = 0.26625 → round → 27
    const result = calcPerLitreOfProduct(0.355, 0.75);
    expect(result).toBe(27);
  });

  it('calculates 1.5L × €0.710/L = €1.065 → 107 cents', () => {
    expect(calcPerLitreOfProduct(0.71, 1.5)).toBe(107);
  });

  it('throws on negative volume', () => {
    expect(() => calcPerLitreOfProduct(0.355, -1)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// calcPerLitreOfAlcohol
// ---------------------------------------------------------------------------

describe('calcPerLitreOfAlcohol', () => {
  it('returns 0 for 0 ABV', () => {
    expect(calcPerLitreOfAlcohol(0.565, 0, 0.75)).toBe(0);
  });

  it('calculates spirits: 0.75L × 40% ABV × €0.565 = 0.1695 → 17 cents', () => {
    // 0.565 * 0.40 * 0.75 = 0.1695 → round → 17
    const result = calcPerLitreOfAlcohol(0.565, 0.40, 0.75);
    expect(result).toBe(17);
  });

  it('calculates 1L of 80% ABV neutral spirit: 0.565 × 0.80 × 1 = 0.452 → 45 cents', () => {
    expect(calcPerLitreOfAlcohol(0.565, 0.80, 1.0)).toBe(45);
  });

  it('throws on ABV > 1', () => {
    expect(() => calcPerLitreOfAlcohol(0.565, 1.1, 0.75)).toThrow(RangeError);
  });

  it('throws on negative ABV', () => {
    expect(() => calcPerLitreOfAlcohol(0.565, -0.1, 0.75)).toThrow(RangeError);
  });

  it('handles 0 volume (returns 0 cents)', () => {
    expect(calcPerLitreOfAlcohol(0.565, 0.40, 0)).toBe(0);
  });

  it('handles 100% ABV (abv = 1.0): 0.75L × 1.0 × €0.565 = 0.42375 → 42 cents', () => {
    expect(calcPerLitreOfAlcohol(0.565, 1.0, 0.75)).toBe(42);
  });

  it('handles ABV of exactly 0 (non-alcoholic): returns 0 cents even with volume', () => {
    expect(calcPerLitreOfAlcohol(0.565, 0, 0.75)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calcProgressiveAbv
// ---------------------------------------------------------------------------

describe('calcProgressiveAbv', () => {
  it('applies lowest tier for low ABV (2.5% → < 2.8% → €0)', () => {
    const result = calcProgressiveAbv(DEFAULT_BEER_TIERS, 0.025, 1.0);
    expect(result).toBe(0);
  });

  it('applies mid tier for 4.0% ABV: €0.295/L × 1L = 30 cents', () => {
    const result = calcProgressiveAbv(DEFAULT_BEER_TIERS, 0.04, 1.0);
    expect(result).toBe(30); // 0.295 * 1.0 = 0.295 → round → 30
  });

  it('applies high tier for 5.0% ABV: €0.435/L × 1L = 44 cents', () => {
    const result = calcProgressiveAbv(DEFAULT_BEER_TIERS, 0.05, 1.0);
    expect(result).toBe(44); // 0.435 * 1.0 = 0.435 → round → 44
  });

  it('applies top tier for 9.0% ABV: €0.580/L × 1L = 58 cents', () => {
    const result = calcProgressiveAbv(DEFAULT_BEER_TIERS, 0.09, 1.0);
    expect(result).toBe(58);
  });

  it('handles partial litres correctly: 0.33L × €0.295 = 0.09735 → 10 cents', () => {
    const result = calcProgressiveAbv(DEFAULT_BEER_TIERS, 0.04, 0.33);
    expect(result).toBe(10); // 0.295 * 0.33 = 0.09735 → round → 10
  });

  it('applies lowest tier just below boundary: 2.7% ABV → €0', () => {
    expect(calcProgressiveAbv(DEFAULT_BEER_TIERS, 0.027, 1.0)).toBe(0);
  });

  it('applies mid tier just below 4.7% boundary: 4.6% ABV → €0.295/L', () => {
    expect(calcProgressiveAbv(DEFAULT_BEER_TIERS, 0.046, 1.0)).toBe(30);
  });

  it('applies high tier just below 8.0% boundary: 7.9% ABV → €0.435/L', () => {
    expect(calcProgressiveAbv(DEFAULT_BEER_TIERS, 0.079, 1.0)).toBe(44);
  });

  it('applies top tier for ABV above 8.0% (last tier fallback): 12% → €0.580/L', () => {
    expect(calcProgressiveAbv(DEFAULT_BEER_TIERS, 0.12, 1.0)).toBe(58); // 0.580 * 1.0 = 0.580 → 58
  });

  it('handles 0 volume at a mid tier', () => {
    expect(calcProgressiveAbv(DEFAULT_BEER_TIERS, 0.04, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateAlcoholExcise — top-level dispatch
// ---------------------------------------------------------------------------

describe('calculateAlcoholExcise', () => {
  it('PER_LITRE_OF_PRODUCT: 0.75L wine at €0.355/L → 27 cents', () => {
    const result = calculateAlcoholExcise(
      FORMULA_PER_LITRE_OF_PRODUCT,
      0.355,
      0.12,
      0.75,
      'wine',
    );
    expect(result.taxCents).toBe(27);
    expect(result.rateApplied).toBeCloseTo(0.355);
  });

  it('PER_LITRE_OF_ALCOHOL: 0.75L spirit at 40% ABV, €0.565 → 17 cents, effective rate 0.226', () => {
    const result = calculateAlcoholExcise(
      FORMULA_PER_LITRE_OF_ALCOHOL,
      0.565,
      0.40,
      0.75,
      'spirits',
    );
    expect(result.taxCents).toBe(17);
    expect(result.rateApplied).toBeCloseTo(0.565 * 0.40, 3);
  });

  it('PROGRESSIVE_ABV: 1L beer at 4.0% ABV → 30 cents, rate 0.295', () => {
    const result = calculateAlcoholExcise(
      FORMULA_PROGRESSIVE_ABV,
      0.295, // ignored for progressive
      0.04,
      1.0,
      'beer',
    );
    expect(result.taxCents).toBe(30);
    expect(result.rateApplied).toBeCloseTo(0.295);
  });

  it('intermediate: 0.75L at €0.710/L → 53 cents', () => {
    const result = calculateAlcoholExcise(
      FORMULA_PER_LITRE_OF_PRODUCT,
      0.710,
      0.18,
      0.75,
      'intermediate',
    );
    expect(result.taxCents).toBe(53); // 0.710 * 0.75 = 0.5325 → 53
    expect(result.rateApplied).toBeCloseTo(0.710);
  });

  it('RTD (ready-to-drink): 0.33L at 5.5% ABV, €0.565/L alcohol → 1 cent', () => {
    const result = calculateAlcoholExcise(
      FORMULA_PER_LITRE_OF_ALCOHOL,
      0.565,
      0.055,
      0.33,
      'rtd',
    );
    // 0.565 * 0.055 * 0.33 = 0.01025475 → round → 1
    expect(result.taxCents).toBe(1);
    expect(result.rateApplied).toBeCloseTo(0.565 * 0.055);
  });

  it('"other" category defaults to per-litre-of-product wine rate', () => {
    const result = calculateAlcoholExcise(
      FORMULA_PER_LITRE_OF_PRODUCT,
      0.355,
      0.12,
      0.75,
      'other',
    );
    expect(result.taxCents).toBe(27); // 0.355 * 0.75 = 0.26625 → 27
    expect(result.rateApplied).toBeCloseTo(0.355);
  });

  it('unknown formula reference falls back to PER_LITRE_OF_PRODUCT', () => {
    const result = calculateAlcoholExcise(
      'UNKNOWN_FORMULA',
      0.500,
      0.40,
      1.0,
      'spirits',
    );
    // Default branch treats unknown as PER_LITRE_OF_PRODUCT
    expect(result.taxCents).toBe(50); // 0.500 * 1.0 = 0.50 → 50
    expect(result.rateApplied).toBeCloseTo(0.500);
  });

  it('handles 0 volume: returns 0 cents regardless of category', () => {
    expect(calculateAlcoholExcise(FORMULA_PER_LITRE_OF_PRODUCT, 0.355, 0.12, 0, 'wine').taxCents).toBe(0);
    expect(calculateAlcoholExcise(FORMULA_PER_LITRE_OF_ALCOHOL, 0.565, 0.40, 0, 'spirits').taxCents).toBe(0);
    expect(calculateAlcoholExcise(FORMULA_PROGRESSIVE_ABV, 0.295, 0.04, 0, 'beer').taxCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// normaliseCategory
// ---------------------------------------------------------------------------

describe('normaliseCategory', () => {
  it('maps "beer" → "beer"', () => expect(normaliseCategory('beer')).toBe('beer'));
  it('maps "cider" → "cider"', () => expect(normaliseCategory('cider')).toBe('cider'));
  it('maps "whisky" → "spirits"', () => expect(normaliseCategory('whisky')).toBe('spirits'));
  it('maps unknown → "other"', () => expect(normaliseCategory('unknown')).toBe('other'));
  it('trims and lowercases', () => expect(normaliseCategory('  BEER ')).toBe('beer'));

  // Finnish and common aliases
  it('maps "olut" (fi) → "beer"', () => expect(normaliseCategory('olut')).toBe('beer'));
  it('maps "viini" (fi) → "wine"', () => expect(normaliseCategory('viini')).toBe('wine'));
  it('maps "viina" (fi) → "spirits"', () => expect(normaliseCategory('viina')).toBe('spirits'));
  it('maps "vodka" → "spirits"', () => expect(normaliseCategory('vodka')).toBe('spirits'));
  it('maps "whiskey" (irish) → "spirits"', () => expect(normaliseCategory('whiskey')).toBe('spirits'));
  it('maps "siideri" (fi) → "cider"', () => expect(normaliseCategory('siideri')).toBe('cider'));
  it('maps "lonkero" (fi) → "rtd"', () => expect(normaliseCategory('lonkero')).toBe('rtd'));
  it('maps "ready-to-drink" → "rtd"', () => expect(normaliseCategory('ready-to-drink')).toBe('rtd'));
  it('maps "väli" (fi) → "intermediate"', () => expect(normaliseCategory('väli')).toBe('intermediate'));
  it('maps "portviini" (fi) → "intermediate"', () => expect(normaliseCategory('portviini')).toBe('intermediate'));
  it('maps "sherry" → "intermediate"', () => expect(normaliseCategory('sherry')).toBe('intermediate'));
});