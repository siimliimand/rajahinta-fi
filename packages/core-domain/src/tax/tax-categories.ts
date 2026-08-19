/**
 * Canonical tax-category taxonomy for Finnish alcohol excise duty.
 *
 * These keys MUST match the `productCategory` values stored in the seed
 * data and database so that `normaliseCategory()` always produces a key
 * that the repository can resolve.
 *
 * Finnish Tax Administration categories (Verohallinto, 2024):
 *   - beer:             beer (includes small-brewery variant as sub-category)
 *   - wine_still:       still wine (≤15 %ABV → €3.40/l, 15–18 %ABV → €4.55/l)
 *   - wine_sparkling:   sparkling wine / champagne (>1.2 %ABV → €3.73/l)
 *   - spirits:          distilled spirits (€29.50/l of pure alcohol)
 *   - intermediate_products: port, sherry, vermouth (≤15 % → €3.40/l, >15 % → €4.55/l)
 *   - other_fermented:  cider, RTD, sake, mead, etc. (≤2.8 %ABV exempt, >2.8 % → €3.40/l)
 *
 * Container duty (`container_duty` / `all_beverages`) is a separate tax type
 * handled by the ContainerDutyService — it is NOT an alcohol excise category.
 *
 * @module TaxCategories
 */

// ---------------------------------------------------------------------------
// Canonical category keys (excise duty)
// ---------------------------------------------------------------------------

/** Ordered list of all canonical excise-category keys for iteration/validation. */
export const TAX_CATEGORY_KEYS = [
  'beer',
  'wine_still',
  'wine_sparkling',
  'spirits',
  'intermediate_products',
  'other_fermented',
] as const;

/** Canonical excise-category discriminant. Every value is a valid seed key. */
export type TaxCategory = (typeof TAX_CATEGORY_KEYS)[number];

// ---------------------------------------------------------------------------
// Formula types
// ---------------------------------------------------------------------------

/**
 * Tax-formula type discriminant.
 *
 * Values correspond to the `calculationFormulaReference` column in the seed
 * and database.  The string constants are defined alongside the formula
 * implementations in `alcohol-excise.math.ts`.
 */
export type FormulaType =
  | 'PER_LITRE_OF_PRODUCT'
  | 'PER_LITRE_OF_ALCOHOL'
  | 'PER_DEGREE_PLATO';

// ---------------------------------------------------------------------------
// Default formula per category (used when no seed rule is found)
// ---------------------------------------------------------------------------

/**
 * Default formula type for each canonical category.
 *
 * These are the fallback formula types applied when the repository has no
 * applicable rule.  Category-to-formula *resolution* (the logic that decides
 * which formula a cider or RTD product should use at calculation time) is
 * handled by the dedicated resolver in task 1.3.
 */
export const CATEGORY_DEFAULT_FORMULA: Record<TaxCategory, FormulaType> = {
  beer: 'PER_DEGREE_PLATO',
  wine_still: 'PER_LITRE_OF_PRODUCT',
  wine_sparkling: 'PER_LITRE_OF_PRODUCT',
  spirits: 'PER_LITRE_OF_ALCOHOL',
  intermediate_products: 'PER_LITRE_OF_PRODUCT',
  other_fermented: 'PER_LITRE_OF_PRODUCT',
} as const;