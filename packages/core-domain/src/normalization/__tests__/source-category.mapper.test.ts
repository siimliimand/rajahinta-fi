/**
 * Tests for the source-category mapper (task 7.1).
 *
 * High-liability: a wrong mapping sends products down the wrong excise
 * category (wrong duty), and a silent fallback mapping hides unmappable
 * feeds. Swedish strings come from the Systembolaget assortment
 * vocabulary; golden behaviour is pinned per group.
 *
 * @module SourceCategoryMapperTests
 */
import { describe, it, expect } from 'vitest';
import {
  mapSourceCategory,
  isKnownTaxCategory,
  SWEDISH_SOURCE_CATEGORY_MAP,
} from '../source-category.mapper';
import { TAX_CATEGORY_KEYS } from '../../tax/tax-categories';

describe('mapSourceCategory — Swedish assortment categories', () => {
  it('maps "Öl" to the canonical beer category the excise engine keys on', () => {
    const result = mapSourceCategory('Öl');
    expect(result).not.toBeNull();
    expect(result!.canonicalCategory).toBe('beer');
    expect(result!.taxCategory).toBe('beer');
  });

  it('maps "Vin" to still wine', () => {
    const result = mapSourceCategory('Vin');
    expect(result!.canonicalCategory).toBe('wine');
    expect(result!.taxCategory).toBe('wine_still');
  });

  it('maps "Mousserande vin" to sparkling wine — never the fallback rate', () => {
    const result = mapSourceCategory('Mousserande vin');
    expect(result!.canonicalCategory).toBe('sparkling-wine');
    expect(result!.taxCategory).toBe('wine_sparkling');
  });

  it('maps "Sprit" to spirits', () => {
    const result = mapSourceCategory('Sprit');
    expect(result!.canonicalCategory).toBe('spirits');
    expect(result!.taxCategory).toBe('spirits');
  });

  it('maps "Cider och blanddrycker" to cider / other fermented', () => {
    const result = mapSourceCategory('Cider och blanddrycker');
    expect(result!.canonicalCategory).toBe('cider');
    expect(result!.taxCategory).toBe('other_fermented');
  });

  it('maps "Starkvin" and "Glögg" to fortified wine / intermediate products', () => {
    expect(mapSourceCategory('Starkvin')!.taxCategory).toBe('intermediate_products');
    expect(mapSourceCategory('Glögg')!.taxCategory).toBe('intermediate_products');
  });

  it('maps "Likör" to liqueur (spirits tax category)', () => {
    const result = mapSourceCategory('Likör');
    expect(result!.canonicalCategory).toBe('liqueur');
    expect(result!.taxCategory).toBe('spirits');
  });

  it('maps "Alkoholfritt" to non-alcoholic', () => {
    expect(mapSourceCategory('Alkoholfritt')!.canonicalCategory).toBe('non-alcoholic');
  });

  it('matches case-insensitively and trims surrounding whitespace', () => {
    expect(mapSourceCategory('  öl ')).toEqual(mapSourceCategory('Öl'));
  });

  it('every Swedish map entry resolves to a valid tax category', () => {
    for (const [token] of Object.entries(SWEDISH_SOURCE_CATEGORY_MAP)) {
      const result = mapSourceCategory(token);
      expect(result, `token "${token}" must map`).not.toBeNull();
      expect(TAX_CATEGORY_KEYS).toContain(result!.taxCategory);
    }
  });
});

describe('mapSourceCategory — non-Swedish sources keep working', () => {
  it('maps English and Finnish tokens already known to normalizeCategory', () => {
    expect(mapSourceCategory('beer')!.taxCategory).toBe('beer');
    expect(mapSourceCategory('olut')!.taxCategory).toBe('beer');
    expect(mapSourceCategory('cider')!.canonicalCategory).toBe('cider');
  });

  it('maps explicit "other" tokens', () => {
    expect(mapSourceCategory('other')!.canonicalCategory).toBe('other');
    expect(mapSourceCategory('annat')!.canonicalCategory).toBe('other');
    expect(mapSourceCategory('muu')!.canonicalCategory).toBe('other');
  });
});

describe('mapSourceCategory — unmappable categories', () => {
  it('returns null for an unrecognized string — flagged, never fallback-assigned', () => {
    expect(mapSourceCategory('Kaffe')).toBeNull();
    expect(mapSourceCategory('melon-flavoured something')).toBeNull();
  });

  it('returns null for an empty or whitespace-only string', () => {
    expect(mapSourceCategory('')).toBeNull();
    expect(mapSourceCategory('   ')).toBeNull();
  });
});

describe('isKnownTaxCategory', () => {
  it('accepts the canonical tax keys', () => {
    for (const key of TAX_CATEGORY_KEYS) {
      expect(isKnownTaxCategory(key)).toBe(true);
    }
  });

  it('rejects non-members', () => {
    expect(isKnownTaxCategory('wine')).toBe(false);
    expect(isKnownTaxCategory('unknown')).toBe(false);
  });
});
