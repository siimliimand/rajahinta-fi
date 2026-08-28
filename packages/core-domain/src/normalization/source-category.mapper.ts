/**
 * Source-market category normalization (task 7.1, change
 * technical-assessment-remediation).
 *
 * Maps source-market category strings — Swedish assortment groups
 * ("Öl", "Vin", "Sprit", …) first, then the English/Finnish tokens
 * `normalizeCategory` already knows — onto the canonical category keys
 * the tax rules use, so gate-passing ingestion data is also
 * tax-meaningful and live feeds do not fall into the excise engine's
 * fallback rates.
 *
 * An unmappable string maps to null. Callers flag the record for the
 * correction queue; silently assigning a fallback category is
 * forbidden by the product-normalization spec.
 *
 * @module SourceCategoryMapper
 */

import { TAX_CATEGORY_KEYS, type TaxCategory } from '../tax/tax-categories';
import type { CanonicalCategory } from './normalization.types';
import { normalizeCategory } from './normalization.service';

/**
 * The result of normalizing a source category string.
 *
 * Carries both vocabularies: the granular canonical category (matching,
 * display) and the tax-rule category key (what the excise engine and the
 * taxRules.productCategory column key on).
 */
export interface SourceCategoryMapping {
  /** Granular canonical category. */
  readonly canonicalCategory: CanonicalCategory;
  /** The canonical key the tax rules use (taxRules.productCategory). */
  readonly taxCategory: TaxCategory;
}

/**
 * Swedish source-category tokens (Systembolaget assortment groups and
 * their common sub-group names) → canonical categories.
 *
 * Keys are lowercase; matching is exact after trim/lowercase because
 * assortment groups are controlled vocabulary, not free text.
 */
export const SWEDISH_SOURCE_CATEGORY_MAP: Readonly<Record<string, CanonicalCategory>> = {
  // Produktgrupp:Öl
  'öl': 'beer',
  // Produktgrupp:Vin
  'vin': 'wine',
  'rött vin': 'wine',
  'vitt vin': 'wine',
  'rosévin': 'wine',
  'rosevin': 'wine',
  // Mousserande
  'mousserande vin': 'sparkling-wine',
  mousserande: 'sparkling-wine',
  // Produktgrupp:Sprit
  sprit: 'spirits',
  likör: 'liqueur',
  // Starkvin / aperitif-desserter — fortified & aromatised wines
  starkvin: 'fortified-wine',
  aperitif: 'fortified-wine',
  'aperitif och dessert': 'fortified-wine',
  glögg: 'fortified-wine',
  // Produktgrupp:Cider och blanddrycker
  cider: 'cider',
  'cider och blanddrycker': 'cider',
  'cider & blanddrycker': 'cider',
  // Rice wine
  sake: 'sake',
  // Alkoholfritt assortment group
  alkoholfritt: 'non-alcoholic',
  alkoholfri: 'non-alcoholic',
};

/** Explicit "other" tokens in the sources we ingest — mappable, unlike garbage. */
const EXPLICIT_OTHER_TOKENS: ReadonlySet<string> = new Set([
  'other',
  'annat', // SE
  'muu', // FI
]);

/**
 * Granular canonical category → the tax-rule category key the excise
 * engine resolves rules by.
 *
 * Mirrors the engine's own alias table (alcohol-excise.math.ts
 * `normaliseCategory`) for the granular keys that table does not know,
 * so a canonical value never falls into the engine's default branch.
 */
const CANONICAL_TO_TAX_CATEGORY: Readonly<Record<CanonicalCategory, TaxCategory>> = {
  beer: 'beer',
  wine: 'wine_still',
  'sparkling-wine': 'wine_sparkling',
  'fortified-wine': 'intermediate_products',
  spirits: 'spirits',
  liqueur: 'spirits',
  cider: 'other_fermented',
  'long-drink': 'other_fermented',
  sake: 'other_fermented',
  // Every category's lowest ABV band is zero-rated, so the tax-key for a
  // 0.0 % product is numerically inert; other_fermented is the taxonomy's
  // catch-all for non-beer/wine/spirits fermented and alcohol-free drinks.
  'non-alcoholic': 'other_fermented',
  other: 'other_fermented',
};

/**
 * Normalize a source-market category string.
 *
 * Returns null when the string has no canonical mapping — the caller
 * flags the record for the correction queue instead of assigning a
 * fallback category.
 */
export function mapSourceCategory(raw: string): SourceCategoryMapping | null {
  const key = raw.trim().toLowerCase();
  if (key === '') return null;

  const canonicalCategory = SWEDISH_SOURCE_CATEGORY_MAP[key] ?? normalizeCategory(key);
  if (canonicalCategory === 'other' && !EXPLICIT_OTHER_TOKENS.has(key)) {
    // normalizeCategory collapses anything unrecognised into 'other';
    // the spec requires unmappables to be flagged, not silently assigned.
    return null;
  }

  const taxCategory = CANONICAL_TO_TAX_CATEGORY[canonicalCategory];
  return { canonicalCategory, taxCategory };
}

/**
 * Whether a tax-rule category key is valid — guard for ingestion code
 * writing `taxCategory` values it did not obtain from this mapper.
 */
export function isKnownTaxCategory(value: string): value is TaxCategory {
  return (TAX_CATEGORY_KEYS as readonly string[]).includes(value);
}
