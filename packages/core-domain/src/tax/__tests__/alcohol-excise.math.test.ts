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
  calcPerDegreePlato,
  calculateAlcoholExcise,
  normaliseCategory,
  resolveOtherFermentedFormula,
  FORMULA_PER_LITRE_OF_PRODUCT,
  FORMULA_PER_LITRE_OF_ALCOHOL,
  FORMULA_PER_DEGREE_PLATO,
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
// calcPerDegreePlato
// ---------------------------------------------------------------------------

describe('calcPerDegreePlato', () => {
  it('returns 0 for 0 ABV (alcohol-free beer)', () => {
    const result = calcPerDegreePlato(33.0, 0, 0.33);
    expect(result).toBe(0);
  });

  it('returns 0 for 0 volume', () => {
    expect(calcPerDegreePlato(33.0, 0.047, 0)).toBe(0);
  });

  it('calculates 0.33L at 4.7% ABV: 33.00 × 0.047 × 0.33 = 0.51183 → 51 cents', () => {
    // 33.00 * 0.047 * 0.33 = 0.51183 → round → 51
    const result = calcPerDegreePlato(33.0, 0.047, 0.33);
    expect(result).toBe(51);
  });

  it('calculates 1L at 4.7% ABV: 33.00 × 0.047 × 1.0 = 1.551 → 155 cents', () => {
    expect(calcPerDegreePlato(33.0, 0.047, 1.0)).toBe(155);
  });

  it('calculates 0.5L at 8.0% ABV: 33.00 × 0.080 × 0.5 = 1.32 → 132 cents', () => {
    expect(calcPerDegreePlato(33.0, 0.08, 0.5)).toBe(132);
  });

  it('handles small-brewery reduced rate: 16.50 × 0.047 × 0.33 = 0.2559 → 26 cents', () => {
    expect(calcPerDegreePlato(16.5, 0.047, 0.33)).toBe(26);
  });

  it('throws on ABV > 1', () => {
    expect(() => calcPerDegreePlato(33.0, 1.1, 0.33)).toThrow(RangeError);
  });

  it('throws on negative ABV', () => {
    expect(() => calcPerDegreePlato(33.0, -0.1, 0.33)).toThrow(RangeError);
  });

  it('throws on negative volume', () => {
    expect(() => calcPerDegreePlato(33.0, 0.047, -1)).toThrow(RangeError);
  });

  it('handles high ABV near the limit: 0.99 × 33.00 × 0.33 = 10.7811 → 1078 cents', () => {
    expect(calcPerDegreePlato(33.0, 0.99, 0.33)).toBe(1078);
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
      'wine_still',
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

  it('PER_DEGREE_PLATO: 0.33L beer at 4.7% ABV → 51 cents, rate 1.551', () => {
    const result = calculateAlcoholExcise(
      FORMULA_PER_DEGREE_PLATO,
      33.0,
      0.047,
      0.33,
      'beer',
    );
    expect(result.taxCents).toBe(51);
    expect(result.rateApplied).toBeCloseTo(33.0 * 0.047, 3);
  });

  it('intermediate: 0.75L at €0.710/L → 53 cents', () => {
    const result = calculateAlcoholExcise(
      FORMULA_PER_LITRE_OF_PRODUCT,
      0.710,
      0.18,
      0.75,
      'intermediate_products',
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
      'other_fermented',
    );
    // 0.565 * 0.055 * 0.33 = 0.01025475 → round → 1
    expect(result.taxCents).toBe(1);
    expect(result.rateApplied).toBeCloseTo(0.565 * 0.055);
  });

  it('"other_fermented" category defaults to per-litre-of-product wine rate', () => {
    const result = calculateAlcoholExcise(
      FORMULA_PER_LITRE_OF_PRODUCT,
      0.355,
      0.12,
      0.75,
      'other_fermented',
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
    expect(calculateAlcoholExcise(FORMULA_PER_LITRE_OF_PRODUCT, 0.355, 0.12, 0, 'wine_still').taxCents).toBe(0);
    expect(calculateAlcoholExcise(FORMULA_PER_LITRE_OF_ALCOHOL, 0.565, 0.40, 0, 'spirits').taxCents).toBe(0);
    expect(calculateAlcoholExcise(FORMULA_PER_DEGREE_PLATO, 33.0, 0.047, 0, 'beer').taxCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// normaliseCategory
// ---------------------------------------------------------------------------

describe('normaliseCategory', () => {
  it('maps "beer" → "beer"', () => expect(normaliseCategory('beer')).toBe('beer'));
  it('maps "cider" → "other_fermented"', () => expect(normaliseCategory('cider')).toBe('other_fermented'));
  it('maps "whisky" → "spirits"', () => expect(normaliseCategory('whisky')).toBe('spirits'));
  it('maps unknown → "other_fermented"', () => expect(normaliseCategory('unknown')).toBe('other_fermented'));
  it('trims and lowercases', () => expect(normaliseCategory('  BEER ')).toBe('beer'));

  // Finnish and common aliases
  it('maps "olut" (fi) → "beer"', () => expect(normaliseCategory('olut')).toBe('beer'));
  it('maps "viini" (fi) → "wine_still"', () => expect(normaliseCategory('viini')).toBe('wine_still'));
  it('maps "viina" (fi) → "spirits"', () => expect(normaliseCategory('viina')).toBe('spirits'));
  it('maps "vodka" → "spirits"', () => expect(normaliseCategory('vodka')).toBe('spirits'));
  it('maps "whiskey" (irish) → "spirits"', () => expect(normaliseCategory('whiskey')).toBe('spirits'));
  it('maps "siideri" (fi) → "other_fermented"', () => expect(normaliseCategory('siideri')).toBe('other_fermented'));
  it('maps "lonkero" (fi) → "other_fermented"', () => expect(normaliseCategory('lonkero')).toBe('other_fermented'));
  it('maps "ready-to-drink" → "other_fermented"', () => expect(normaliseCategory('ready-to-drink')).toBe('other_fermented'));
  it('maps "väli" (fi) → "intermediate_products"', () => expect(normaliseCategory('väli')).toBe('intermediate_products'));
  it('maps "portviini" (fi) → "intermediate_products"', () => expect(normaliseCategory('portviini')).toBe('intermediate_products'));
  it('maps "sherry" → "intermediate_products"', () => expect(normaliseCategory('sherry')).toBe('intermediate_products'));

  // Sparkling wine
  it('maps "sparkling" → "wine_sparkling"', () => expect(normaliseCategory('sparkling')).toBe('wine_sparkling'));
  it('maps "champagne" → "wine_sparkling"', () => expect(normaliseCategory('champagne')).toBe('wine_sparkling'));
  it('maps "kuohuviini" (fi) → "wine_sparkling"', () => expect(normaliseCategory('kuohuviini')).toBe('wine_sparkling'));

  // RTD is now under other_fermented (cider and rtd merge)
  it('maps "rtd" → "other_fermented"', () => expect(normaliseCategory('rtd')).toBe('other_fermented'));

  // Idempotency — canonical keys pass through unchanged
  it('canonical key "wine_still" is idempotent', () => expect(normaliseCategory('wine_still')).toBe('wine_still'));
  it('canonical key "wine_sparkling" is idempotent', () => expect(normaliseCategory('wine_sparkling')).toBe('wine_sparkling'));
  it('canonical key "intermediate_products" is idempotent', () => expect(normaliseCategory('intermediate_products')).toBe('intermediate_products'));
  it('canonical key "other_fermented" is idempotent', () => expect(normaliseCategory('other_fermented')).toBe('other_fermented'));
  it('canonical key "spirits" is idempotent', () => expect(normaliseCategory('spirits')).toBe('spirits'));
});

// ---------------------------------------------------------------------------
// resolveOtherFermentedFormula
// ---------------------------------------------------------------------------

describe('resolveOtherFermentedFormula', () => {
  it('returns PER_LITRE_OF_PRODUCT for "cider"', () => {
    expect(resolveOtherFermentedFormula('cider')).toBe(FORMULA_PER_LITRE_OF_PRODUCT);
  });

  it('returns PER_LITRE_OF_PRODUCT for "siideri" (fi)', () => {
    expect(resolveOtherFermentedFormula('siideri')).toBe(FORMULA_PER_LITRE_OF_PRODUCT);
  });

  it('returns PER_LITRE_OF_PRODUCT for uppercase "CIDER"', () => {
    expect(resolveOtherFermentedFormula('CIDER')).toBe(FORMULA_PER_LITRE_OF_PRODUCT);
  });

  it('returns PER_LITRE_OF_ALCOHOL for "rtd"', () => {
    expect(resolveOtherFermentedFormula('rtd')).toBe(FORMULA_PER_LITRE_OF_ALCOHOL);
  });

  it('returns PER_LITRE_OF_ALCOHOL for "lonkero" (fi)', () => {
    expect(resolveOtherFermentedFormula('lonkero')).toBe(FORMULA_PER_LITRE_OF_ALCOHOL);
  });

  it('returns PER_LITRE_OF_ALCOHOL for "ready-to-drink"', () => {
    expect(resolveOtherFermentedFormula('ready-to-drink')).toBe(FORMULA_PER_LITRE_OF_ALCOHOL);
  });

  it('returns PER_LITRE_OF_ALCOHOL for canonical "other_fermented"', () => {
    expect(resolveOtherFermentedFormula('other_fermented')).toBe(FORMULA_PER_LITRE_OF_ALCOHOL);
  });

  it('returns PER_LITRE_OF_ALCOHOL for unknown sub-type', () => {
    expect(resolveOtherFermentedFormula('sake')).toBe(FORMULA_PER_LITRE_OF_ALCOHOL);
  });
});