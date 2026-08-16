/**
 * Tests for NormalizationService and its pure helpers.
 *
 * These are HIGH-LIABILITY code paths — the normalization rules determine
 * which products get matched, which tax rates apply, and ultimately which
 * prices the user sees. Every edge case is covered.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeBrandName,
  normalizeCategory,
  standardizeVolume,
  validateAbv,
  standardizeContainerType,
  NormalizationService,
} from '../normalization.service';
import type { RawProductInput } from '../normalization.types';

// ---------------------------------------------------------------------------
// normalizeBrandName
// ---------------------------------------------------------------------------

describe('normalizeBrandName', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeBrandName('  Heineken  ')).toBe('Heineken');
  });

  it('applies title case', () => {
    expect(normalizeBrandName('the north brewery')).toBe('The North Brewery');
  });

  it('handles ALL CAPS', () => {
    expect(normalizeBrandName('HEINEKEN')).toBe('Heineken');
  });

  it('handles mixed case', () => {
    expect(normalizeBrandName('hEiNeKeN')).toBe('Heineken');
  });

  it('handles O\' prefix (O\'Doherty)', () => {
    expect(normalizeBrandName("o'doherty")).toBe("O'Doherty");
  });

  it('handles Mc prefix (McDonald)', () => {
    expect(normalizeBrandName('mcdonald')).toBe('McDonald');
  });

  it('handles multiple words', () => {
    expect(normalizeBrandName('  brewdog   brewing  ')).toBe('Brewdog Brewing');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeBrandName('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeBrandName('   ')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// normalizeCategory
// ---------------------------------------------------------------------------

describe('normalizeCategory', () => {
  it('maps "beer" → "beer"', () => {
    expect(normalizeCategory('beer')).toBe('beer');
  });

  it('maps "olut" (fi) → "beer"', () => {
    expect(normalizeCategory('olut')).toBe('beer');
  });

  it('maps "IPA" → "beer"', () => {
    expect(normalizeCategory('IPA')).toBe('beer');
  });

  it('maps "cider" → "cider"', () => {
    expect(normalizeCategory('cider')).toBe('cider');
  });

  it('maps "siideri" → "cider"', () => {
    expect(normalizeCategory('siideri')).toBe('cider');
  });

  it('maps "wine" → "wine"', () => {
    expect(normalizeCategory('wine')).toBe('wine');
  });

  it('maps "sparkling wine" → "sparkling-wine"', () => {
    expect(normalizeCategory('sparkling wine')).toBe('sparkling-wine');
  });

  it('maps "champagne" → "sparkling-wine"', () => {
    expect(normalizeCategory('champagne')).toBe('sparkling-wine');
  });

  it('maps "port" → "fortified-wine"', () => {
    expect(normalizeCategory('port')).toBe('fortified-wine');
  });

  it('maps "whisky" → "spirits"', () => {
    expect(normalizeCategory('whisky')).toBe('spirits');
  });

  it('maps "vodka" → "spirits"', () => {
    expect(normalizeCategory('vodka')).toBe('spirits');
  });

  it('maps "liqueur" → "liqueur"', () => {
    expect(normalizeCategory('liqueur')).toBe('liqueur');
  });

  it('maps "lonkero" → "long-drink"', () => {
    expect(normalizeCategory('lonkero')).toBe('long-drink');
  });

  it('maps "sake" → "sake"', () => {
    expect(normalizeCategory('sake')).toBe('sake');
  });

  it('maps "non-alcoholic" → "non-alcoholic"', () => {
    expect(normalizeCategory('non-alcoholic')).toBe('non-alcoholic');
  });

  it('maps "alkoholiton" → "non-alcoholic"', () => {
    expect(normalizeCategory('alkoholiton')).toBe('non-alcoholic');
  });

  it('maps unknown → "other"', () => {
    expect(normalizeCategory('unknown')).toBe('other');
  });

  it('trims and lowercases', () => {
    expect(normalizeCategory('  BEER ')).toBe('beer');
  });
});

// ---------------------------------------------------------------------------
// standardizeVolume
// ---------------------------------------------------------------------------

describe('standardizeVolume', () => {
  it('converts litres (identity)', () => {
    expect(standardizeVolume(1, 'L')).toBe(1);
  });

  it('converts ml to litres', () => {
    expect(standardizeVolume(500, 'ml')).toBe(0.5);
  });

  it('converts cl to litres', () => {
    expect(standardizeVolume(33, 'cl')).toBe(0.33);
  });

  it('converts dl to litres', () => {
    expect(standardizeVolume(5, 'dl')).toBe(0.5);
  });

  it('converts gallons to litres', () => {
    const result = standardizeVolume(1, 'gal');
    expect(result).toBeCloseTo(3.78541, 5);
  });

  it('converts fluid ounces to litres', () => {
    const result = standardizeVolume(12, 'floz');
    expect(result).toBeCloseTo(0.354882, 5);
  });

  it('defaults to litres when unit is omitted', () => {
    expect(standardizeVolume(0.75)).toBe(0.75);
  });

  it('throws on negative volume', () => {
    expect(() => standardizeVolume(-1, 'L')).toThrow(RangeError);
  });

  it('throws on unknown unit', () => {
    expect(() => standardizeVolume(1, 'xyz' as any)).toThrow(RangeError);
  });

  it('handles zero volume', () => {
    expect(standardizeVolume(0, 'ml')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// validateAbv
// ---------------------------------------------------------------------------

describe('validateAbv', () => {
  it('accepts 0 ABV', () => {
    expect(validateAbv(0)).toBe(0);
  });

  it('accepts 4.5 %', () => {
    expect(validateAbv(4.5)).toBe(4.5);
  });

  it('accepts 100 %', () => {
    expect(validateAbv(100)).toBe(100);
  });

  it('throws on negative ABV', () => {
    expect(() => validateAbv(-1)).toThrow(RangeError);
  });

  it('throws on ABV > 100', () => {
    expect(() => validateAbv(101)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// standardizeContainerType
// ---------------------------------------------------------------------------

describe('standardizeContainerType', () => {
  it('maps "glass bottle" → "glass-bottle"', () => {
    expect(standardizeContainerType('glass bottle')).toBe('glass-bottle');
  });

  it('maps "bottle" → "glass-bottle" (default)', () => {
    // When only "bottle" is specified without material, assume glass
    expect(standardizeContainerType('bottle')).toBe('glass-bottle');
  });

  it('maps "plastic bottle" → "plastic-bottle"', () => {
    expect(standardizeContainerType('plastic bottle')).toBe('plastic-bottle');
  });

  it('maps "PET pullo" → "plastic-bottle"', () => {
    expect(standardizeContainerType('PET pullo')).toBe('plastic-bottle');
  });

  it('maps "can" → "metal-can"', () => {
    expect(standardizeContainerType('can')).toBe('metal-can');
  });

  it('maps "aluminum can" → "metal-can"', () => {
    expect(standardizeContainerType('aluminum can')).toBe('metal-can');
  });

  it('maps "tölkki" → "metal-can"', () => {
    expect(standardizeContainerType('tölkki')).toBe('metal-can');
  });

  it('maps "tetrapak" → "carton"', () => {
    expect(standardizeContainerType('tetrapak')).toBe('carton');
  });

  it('maps "bag-in-box" → "bag-in-box"', () => {
    expect(standardizeContainerType('bag-in-box')).toBe('bag-in-box');
  });

  it('maps "keg" → "keg"', () => {
    expect(standardizeContainerType('keg')).toBe('keg');
  });

  it('maps "pouch" → "pouch"', () => {
    expect(standardizeContainerType('pouch')).toBe('pouch');
  });

  it('maps unknown → "other"', () => {
    expect(standardizeContainerType('unknown')).toBe('other');
  });

  it('trims and lowercases', () => {
    expect(standardizeContainerType('  GLASS BOTTLE  ')).toBe('glass-bottle');
  });
});

// ---------------------------------------------------------------------------
// NormalizationService.normalize — integration scenarios
// ---------------------------------------------------------------------------

describe('NormalizationService', () => {
  const service = new NormalizationService();

  it('normalizes a typical beer product', () => {
    const input: RawProductInput = {
      name: '  Session IPA 4.5%  ',
      brand: '  BREWDOG  ',
      category: 'IPA',
      volume: 33,
      volumeUnit: 'cl',
      abv: 4.5,
      packaging: 'can',
    };

    const result = service.normalize(input);

    expect(result.normalizedName).toBe('Session IPA 4.5%');
    expect(result.normalizedBrand).toBe('Brewdog');
    expect(result.canonicalCategory).toBe('beer');
    expect(result.volumeLitres).toBe(0.33);
    expect(result.alcoholByVolume).toBe(4.5);
    expect(result.containerType).toBe('metal-can');
    expect(result.normalizationWarnings).toEqual([]);
    expect(result.originalInput).toBe(input);
  });

  it('normalizes a wine product in litres', () => {
    const input: RawProductInput = {
      name: 'Château Margaux 2015',
      brand: 'château margaux',
      category: 'wine',
      volume: 0.75,
      abv: 13.5,
      packaging: 'glass bottle',
    };

    const result = service.normalize(input);

    expect(result.normalizedBrand).toBe('Château Margaux');
    expect(result.canonicalCategory).toBe('wine');
    expect(result.volumeLitres).toBe(0.75);
    expect(result.alcoholByVolume).toBe(13.5);
    expect(result.containerType).toBe('glass-bottle');
    expect(result.normalizationWarnings).toEqual([]);
  });

  it('normalizes a spirits product in ml', () => {
    const input: RawProductInput = {
      name: 'Finlandia Vodka',
      brand: 'finlandia',
      category: 'vodka',
      volume: 700,
      volumeUnit: 'ml',
      abv: 40,
      packaging: 'glass bottle',
    };

    const result = service.normalize(input);

    expect(result.normalizedBrand).toBe('Finlandia');
    expect(result.canonicalCategory).toBe('spirits');
    expect(result.volumeLitres).toBeCloseTo(0.7, 10);
    expect(result.alcoholByVolume).toBe(40);
  });

  it('handles missing ABV gracefully (defaults to 0)', () => {
    const input: RawProductInput = {
      name: 'Non-Alcoholic Beer',
      brand: 'Brand',
      category: 'non-alcoholic',
      volume: 0.33,
      packaging: 'can',
    };

    const result = service.normalize(input);

    expect(result.alcoholByVolume).toBe(0);
    expect(result.normalizationWarnings).toEqual([]);
  });

  it('handles invalid ABV with a warning', () => {
    const input: RawProductInput = {
      name: 'Bad ABV',
      brand: 'Brand',
      category: 'beer',
      volume: 0.5,
      abv: 999,
      packaging: 'can',
    };

    const result = service.normalize(input);

    expect(result.alcoholByVolume).toBe(0);
    expect(result.normalizationWarnings).toHaveLength(1);
    expect(result.normalizationWarnings[0]).toContain('ABV 999 is invalid');
  });

  it('handles unrecognised packaging with a warning', () => {
    const input: RawProductInput = {
      name: 'Product',
      brand: 'Brand',
      category: 'beer',
      volume: 0.5,
      packaging: 'obscure-vessel',
    };

    const result = service.normalize(input);

    expect(result.containerType).toBe('other');
    expect(result.normalizationWarnings).toHaveLength(1);
    expect(result.normalizationWarnings[0]).toContain('Unrecognised packaging');
  });

  it('handles missing packaging (defaults to "other", no warning)', () => {
    const input: RawProductInput = {
      name: 'Product',
      brand: 'Brand',
      category: 'beer',
      volume: 0.5,
    };

    const result = service.normalize(input);

    expect(result.containerType).toBe('other');
    expect(result.normalizationWarnings).toEqual([]);
  });

  it('throws on negative volume', () => {
    const input: RawProductInput = {
      name: 'Bad Volume',
      brand: 'Brand',
      category: 'beer',
      volume: -1,
    };

    expect(() => service.normalize(input)).toThrow('Volume normalisation failed');
  });

  it('passes through images and description', () => {
    const input: RawProductInput = {
      name: 'Test',
      brand: 'Test',
      category: 'beer',
      volume: 0.5,
      images: ['https://example.com/img1.jpg'],
      description: '  A fine   beer  ',
    };

    const result = service.normalize(input);

    expect(result.images).toEqual(['https://example.com/img1.jpg']);
    expect(result.description).toBe('A fine beer');
  });

  it('defaults images to empty array when undefined', () => {
    const input: RawProductInput = {
      name: 'Test',
      brand: 'Test',
      category: 'beer',
      volume: 0.5,
    };

    const result = service.normalize(input);

    expect(result.images).toEqual([]);
  });

  it('handles O\'Doherty-style brand names in context', () => {
    const input: RawProductInput = {
      name: 'Whiskey',
      brand: "o'doherty distillery",
      category: 'whiskey',
      volume: 0.7,
      abv: 43,
      packaging: 'glass bottle',
    };

    const result = service.normalize(input);

    expect(result.normalizedBrand).toBe("O'Doherty Distillery");
  });
});