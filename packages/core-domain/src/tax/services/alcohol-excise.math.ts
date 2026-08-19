/**
 * Pure calculation functions for Finnish alcohol excise duty.
 *
 * These functions have NO framework or I/O dependencies — they are
 * deterministic, testable, and safe to isolate.
 *
 * @module AlcoholExciseMath
 */

import type { TaxCategory } from '../tax-categories';

// ---------------------------------------------------------------------------
// Formula reference constants — values stored in taxRules.calculationFormulaReference
// ---------------------------------------------------------------------------

/** Rate is applied per litre of product (rate €/l × volumeLitres). */
export const FORMULA_PER_LITRE_OF_PRODUCT = 'PER_LITRE_OF_PRODUCT';

/**
 * Rate is applied per litre of pure alcohol (rate €/l × abv × volumeLitres).
 * Used for spirits and high-proof products.
 */
export const FORMULA_PER_LITRE_OF_ALCOHOL = 'PER_LITRE_OF_ALCOHOL';

/** Rate is applied per hectolitre per degree Plato (€/hl-°P). */
export const FORMULA_PER_DEGREE_PLATO = 'PER_DEGREE_PLATO';

// ---------------------------------------------------------------------------
// Fallback rates — used when no tax rule is found in the repository
// (reliability: ESTIMATED)
// ---------------------------------------------------------------------------

/**
 * Canonical excise-duty category key.
 *
 * Re-exported from {@link TaxCategory} in `tax-categories.ts` so consumers
 * can import from this file as before.
 */
export type AlcoholExciseCategory = TaxCategory;

// ---------------------------------------------------------------------------
// Default flat rates per category (€/litre of product unless noted)
// ---------------------------------------------------------------------------

export const DEFAULT_RATES: Record<
  AlcoholExciseCategory,
  { formula: string; rate: number; note: string }
> = {
  beer: { formula: FORMULA_PER_DEGREE_PLATO, rate: 33.00, note: '€/hl per degree Plato (seed: 33.00)' },
  wine_still: { formula: FORMULA_PER_LITRE_OF_PRODUCT, rate: 3.40, note: 'Still wine > 1.2 % ABV (seed: 3.40)' },
  wine_sparkling: { formula: FORMULA_PER_LITRE_OF_PRODUCT, rate: 3.73, note: 'Sparkling wine > 1.2 % ABV (seed: 3.73)' },
  spirits: { formula: FORMULA_PER_LITRE_OF_ALCOHOL, rate: 29.50, note: 'Per litre of pure alcohol (seed: 29.50)' },
  intermediate_products: { formula: FORMULA_PER_LITRE_OF_PRODUCT, rate: 3.40, note: '≤ 15 % ABV (seed: 3.40)' },
  other_fermented: { formula: FORMULA_PER_LITRE_OF_ALCOHOL, rate: 3.40, note: 'Cider, RTD, etc. > 2.8 % ABV (seed: 3.40/l alcohol)' },
};

// ---------------------------------------------------------------------------
// Category normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise a raw product-category string to the canonical seed key.
 *
 * Canonical keys are idempotent — passing an already-canonical key returns it
 * unchanged.  This ensures the function is safe to call on keys that may or
 * may not have been normalised already.
 *
 * Mapping rules:
 *   beer / olut / already-canonical    → beer
 *   wine / viini (default)             → wine_still
 *   sparkling / champagne / kuohuviini → wine_sparkling
 *   spirits / viina / vodka / whisky/whiskey → spirits
 *   cider / siideri                    → other_fermented
 *   rtd / ready-to-drink / lonkero     → other_fermented
 *   intermediate / väli / portviini / sherry → intermediate_products
 *   already-canonical (wine_still, wine_sparkling, other_fermented, intermediate_products) → unchanged
 *   (anything else)                    → other_fermented
 *
 * @returns The canonical category key.
 */
export function normaliseCategory(raw: string): AlcoholExciseCategory {
  const lower = raw.toLowerCase().trim();
  switch (lower) {
    // Canonical keys (idempotent passthrough)
    case 'beer':
    case 'wine_still':
    case 'wine_sparkling':
    case 'spirits':
    case 'intermediate_products':
    case 'other_fermented':
      return lower as AlcoholExciseCategory;

    // Finnish / common aliases
    case 'olut':
      return 'beer';
    case 'wine':
    case 'viini':
      return 'wine_still';
    case 'sparkling':
    case 'champagne':
    case 'kuohuviini':
      return 'wine_sparkling';
    case 'viina':
    case 'vodka':
    case 'whisky':
    case 'whiskey':
      return 'spirits';
    case 'cider':
    case 'siideri':
    case 'rtd':
    case 'ready-to-drink':
    case 'lonkero':
      return 'other_fermented';
    case 'intermediate':
    case 'väli':
    case 'portviini':
    case 'sherry':
      return 'intermediate_products';
    default:
      return 'other_fermented';
  }
}

// ---------------------------------------------------------------------------
// Sub-type formula resolution for other_fermented (cider vs RTD)
// ---------------------------------------------------------------------------

/**
 * Determine the correct calculation formula for an `other_fermented` product
 * based on its original (pre-normalisation) category string.
 *
 * Finnish excise rules distinguish:
 *   - **Cider** (cider, siideri): per litre of **product** at flat rate (€3.40/l),
 *     like wine.
 *   - **RTD / long-drink** (rtd, ready-to-drink, lonkero): per litre of **alcohol**
 *     (€3.40/l of pure alcohol), like spirits.
 *
 * The default (any unrecognised `other_fermented` sub-type, or a canonical
 * `other_fermented` passed directly) defaults to per-litre-of-alcohol as the
 * more conservative (higher-tax) option for estimation.
 *
 * @param rawCategory — The original category string (pre-normalisation).
 * @returns The formula reference constant for the correct formula type.
 */
export function resolveOtherFermentedFormula(
  rawCategory: string,
): 'PER_LITRE_OF_PRODUCT' | 'PER_LITRE_OF_ALCOHOL' {
  const lower = rawCategory.toLowerCase().trim();
  if (lower === 'cider' || lower === 'siideri') {
    return 'PER_LITRE_OF_PRODUCT';
  }
  // RTD, lonkero, ready-to-drink, unknown, or canonical 'other_fermented'
  // Default: per-litre-of-alcohol (like spirits, conservative estimate)
  return 'PER_LITRE_OF_ALCOHOL';
}

// ---------------------------------------------------------------------------
// Pure calculation helpers
// ---------------------------------------------------------------------------

/**
 * Calculate excise using a per-litre-of-product formula.
 *
 * @param ratePerLitre  Rate in € per litre of product.
 * @param volumeLitres  Volume in litres.
 * @returns Excise amount in euro-cents (€0.01 granularity).
 */
export function calcPerLitreOfProduct(
  ratePerLitre: number,
  volumeLitres: number,
): number {
  validatePositive(volumeLitres, 'volumeLitres');
  const amount = ratePerLitre * volumeLitres;
  return roundToCents(amount);
}

/**
 * Calculate excise using a per-litre-of-pure-alcohol formula.
 *
 * @param ratePerAlcoholLitre  Rate in € per litre of pure alcohol.
 * @param abv                  Alcohol by volume fraction (e.g. 0.40 for 40 % ABV).
 * @param volumeLitres         Volume in litres.
 * @returns Excise amount in euro-cents.
 */
export function calcPerLitreOfAlcohol(
  ratePerAlcoholLitre: number,
  abv: number,
  volumeLitres: number,
): number {
  validatePositive(volumeLitres, 'volumeLitres');
  validateRange(abv, 0, 1, 'abv');
  const pureAlcoholLitres = abv * volumeLitres;
  const amount = ratePerAlcoholLitre * pureAlcoholLitres;
  return roundToCents(amount);
}

/**
 * Calculate excise using a per-degree-Plato (hectolitre-percent) formula.
 *
 * Finnish beer excise is levied at €X per hectolitre per degree Plato
 * of original wort.  Degree Plato is approximately equal to ABV for
 * finished beer, so the formula is:
 *
 *   tax = ratePerHectolitrePercent * abv * volumeLitres
 *
 * where `abv` is the alcohol-by-volume fraction (0–1) and the result
 * is returned in euro-cents.
 *
 * @param ratePerHectolitrePercent  Rate in € per hectolitre per percent (e.g. 33.00).
 * @param abv                       Alcohol by volume fraction (0–1, e.g. 0.047 for 4.7 %).
 * @param volumeLitres              Volume in litres.
 * @returns Excise amount in euro-cents.
 */
export function calcPerDegreePlato(
  ratePerHectolitrePercent: number,
  abv: number,
  volumeLitres: number,
): number {
  validatePositive(volumeLitres, 'volumeLitres');
  validateRange(abv, 0, 1, 'abv');
  const amount = ratePerHectolitrePercent * abv * volumeLitres;
  return roundToCents(amount);
}

// ---------------------------------------------------------------------------
// Top-level dispatch
// ---------------------------------------------------------------------------

/**
 * Pure calculation dispatch: apply the correct formula based on
 * `formulaRef` and return (taxCents, rateApplied).
 *
 * @returns `[taxCents, rateApplied]` — the final excise in euro-cents and
 *          the effective *per-unit* rate (€/l of product) that was applied.
 */
export function calculateAlcoholExcise(
  formulaRef: string,
  rateValue: number,
  abv: number,
  volumeLitres: number,
  _category: AlcoholExciseCategory,
): { taxCents: number; rateApplied: number } {
  switch (formulaRef) {
    case FORMULA_PER_LITRE_OF_ALCOHOL: {
      const taxCents = calcPerLitreOfAlcohol(rateValue, abv, volumeLitres);
      // Effective per-litre-of-product rate for evidence
      const effectiveRate = rateValue * abv;
      return { taxCents, rateApplied: effectiveRate };
    }
    case FORMULA_PER_DEGREE_PLATO: {
      const taxCents = calcPerDegreePlato(rateValue, abv, volumeLitres);
      // Effective per-litre-of-product rate for evidence
      const effectiveRate = rateValue * abv;
      return { taxCents, rateApplied: effectiveRate };
    }
    case FORMULA_PER_LITRE_OF_PRODUCT:
    default: {
      const taxCents = calcPerLitreOfProduct(rateValue, volumeLitres);
      return { taxCents, rateApplied: rateValue };
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function validatePositive(value: number, name: string): void {
  if (value < 0) {
    throw new RangeError(`${name} must not be negative, got ${value}`);
  }
}

function validateRange(value: number, min: number, max: number, name: string): void {
  if (value < min || value > max) {
    throw new RangeError(`${name} must be between ${min} and ${max}, got ${value}`);
  }
}

/**
 * Round to nearest euro-cent, with HALF_UP semantics (Math.round).
 */
function roundToCents(amount: number): number {
  return Math.round(amount * 100);
}