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

/**
 * Rate in euro-cents per centilitre of ethyl alcohol (snt / cl ethanol).
 *
 * Numerically equals snt per %-litre (36.20 snt/cl ethanol × 5 cl ≡ 181 snt,
 * the official duty for 1 l of 5 % beer).  The unit is "euro-cents per
 * centilitre of pure ethyl alcohol" — what Finnish law actually levies on
 * beer and spirits, NOT per degree Plato.
 */
export const FORMULA_PER_CENTILITRE_ETHANOL = 'PER_CENTILITRE_ETHANOL';

/**
 * @deprecated Use {@link FORMULA_PER_CENTILITRE_ETHANOL} instead.
 *
 * This alias is kept so existing imports and DB-stored references keep
 * compiling and resolving.  Its string value is identical to the new
 * constant; it was renamed because "degree Plato" describes wort gravity,
 * not the actual legal unit of taxation (snt / cl ethyl alcohol).
 */
export const FORMULA_PER_DEGREE_PLATO: typeof FORMULA_PER_CENTILITRE_ETHANOL = FORMULA_PER_CENTILITRE_ETHANOL;

// ---------------------------------------------------------------------------
// Zero-rate fallback placeholders — used when no tax rule is found
// ---------------------------------------------------------------------------

/**
 * Canonical excise-duty category key.
 *
 * Re-exported from {@link TaxCategory} in `tax-categories.ts` so consumers
 * can import from this file as before.
 */
export type AlcoholExciseCategory = TaxCategory;

// ---------------------------------------------------------------------------
// Default zero-rate placeholders per category
// ---------------------------------------------------------------------------

/**
 * Zero-rate fallback entries keyed by canonical category.
 *
 * These are intentionally zero so that a missing tax rule produces
 * `reliability: ESTIMATED` and `taxCents: 0` — **never** a silent plausible
 * number.  The formula reference is kept correct per category so the
 * `calculateAlcoholExcise` dispatch remains valid; only the rate is zeroed.
 *
 * See design D6 in phase0-1-verification-fix.
 */
export const DEFAULT_RATES: Record<
  AlcoholExciseCategory,
  { formula: string; rate: number; note: string }
> = {
  beer: { formula: FORMULA_PER_CENTILITRE_ETHANOL, rate: 0, note: 'NO_FALLBACK — rate 0, reliability ESTIMATED' },
  wine_still: { formula: FORMULA_PER_LITRE_OF_PRODUCT, rate: 0, note: 'NO_FALLBACK — rate 0, reliability ESTIMATED' },
  wine_sparkling: { formula: FORMULA_PER_LITRE_OF_PRODUCT, rate: 0, note: 'NO_FALLBACK — rate 0, reliability ESTIMATED' },
  spirits: { formula: FORMULA_PER_LITRE_OF_ALCOHOL, rate: 0, note: 'NO_FALLBACK — rate 0, reliability ESTIMATED' },
  intermediate_products: { formula: FORMULA_PER_LITRE_OF_PRODUCT, rate: 0, note: 'NO_FALLBACK — rate 0, reliability ESTIMATED' },
  other_fermented: { formula: FORMULA_PER_LITRE_OF_PRODUCT, rate: 0, note: 'NO_FALLBACK — rate 0, reliability ESTIMATED' },
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
// Sub-type formula resolution for other_fermented — all variants use
// per-litre-of-product (Finnish excise taxes fermented beverages per litre
// of product, not per litre of alcohol).  Spirit-based RTDs are mapped to
// the spirits category at data-ingestion time per D2 in the
// phase0-1-verification-fix design.
// ---------------------------------------------------------------------------

/**
 * Determine the correct calculation formula for an `other_fermented` product.
 *
 * Finnish excise rules tax ALL fermented beverages per litre of product
 * (like wine) using the wine band structure.  Spirit-based RTDs (lonkero,
 * ready-to-drink) are classified as spirits at data-mapping time and do
 * not reach this function.
 *
 * The function exists as a conceptual hook for future sub-type distinctions
 * if Finnish tax law changes; currently it always returns
 * `PER_LITRE_OF_PRODUCT`.
 *
 * @param _rawCategory — The original category string (pre-normalisation).
 *        Ignored — all fermented beverages use PER_LITRE_OF_PRODUCT.
 * @returns Always `PER_LITRE_OF_PRODUCT`.
 */
export function resolveOtherFermentedFormula(
  _rawCategory: string,
): 'PER_LITRE_OF_PRODUCT' {
  return 'PER_LITRE_OF_PRODUCT';
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
 * Calculate excise using a per-centilitre-of-ethyl-alcohol formula.
 *
 * Finnish beer and spirits excise is levied at €X per centilitre of ethyl
 * alcohol.  Numerically this equals €X per %-litre (e.g. €0.3620 / %-litre),
 * which is what the code computes:
 *
 *   tax = ratePerCentilitreEthanol * abv * volumeLitres
 *
 * where `abv` is the alcohol-by-volume fraction (0–1) and the result
 * is returned in euro-cents.
 *
 * @deprecated-function-name This function was originally named for degree
 *   Plato, which describes wort gravity rather than the actual legal unit.
 *   The arithmetic is correct; only the historical name remains.
 *
 * @param ratePerCentilitreEthanol  Rate in € per centilitre of ethyl alcohol
 *   (e.g. 36.20 for the standard beer rate).
 * @param abv                       Alcohol by volume fraction (0–1, e.g. 0.047 for 4.7 %).
 * @param volumeLitres              Volume in litres.
 * @returns Excise amount in euro-cents.
 */
export function calcPerDegreePlato(
  ratePerCentilitreEthanol: number,
  abv: number,
  volumeLitres: number,
): number {
  validatePositive(volumeLitres, 'volumeLitres');
  validateRange(abv, 0, 1, 'abv');
  const amount = ratePerCentilitreEthanol * abv * volumeLitres;
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
    case FORMULA_PER_CENTILITRE_ETHANOL:
    case 'PER_DEGREE_PLATO': {
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