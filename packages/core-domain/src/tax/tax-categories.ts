/**
 * Canonical tax-category taxonomy for Finnish alcohol excise duty.
 *
 * These keys MUST match the `productCategory` values stored in the seed
 * data and database so that `normaliseCategory()` always produces a key
 * that the repository can resolve.
 *
 * Finnish Tax Administration official 2024 bands (Verohallinto):
 *   - beer:             beer — 0 / 28.35 / 36.20 snt per cl ethanol
 *                        (≤0.5 %ABV exempt; ≤8.0 %ABV reduced; >8.0 %ABV standard;
 *                         includes small-brewery progressive relief as sub-category)
 *   - wine_still:       still wine — six ABV bands: 0 / 0.36 / 1.98 / 3.08 / 4.56 / 4.56 €/l
 *   - wine_sparkling:   sparkling wine / champagne — same band structure as wine_still
 *   - spirits:          distilled spirits — 0 / 30.90 / 54.80 €/l of pure alcohol
 *   - intermediate_products: port, sherry, vermouth — 5.68 / 8.63 €/l of product
 *   - other_fermented:  cider, RTD, sake, mead, etc. — wine band structure per litre of product
 *
 * Container duty (`container_duty` / `all_beverages`) is a separate tax type
 * handled by the ContainerDutyService — it is NOT an alcohol excise category.
 *
 * @module TaxCategories
 */

// ---------------------------------------------------------------------------
// Tax-type discriminator — used as the `taxType` column value in the seed
// and as the first argument to every ITaxRuleRepositoryPort query method.
// Every consumer SHALL reference these constants, never a string literal.
// ---------------------------------------------------------------------------

/** Map of canonical tax-type values used throughout the system. */
export const TAX_TYPES = {
  excise: 'excise',
  containerDuty: 'container_duty',
} as const;

/** Union of all valid tax-type discriminators. */
export type TaxType = (typeof TAX_TYPES)[keyof typeof TAX_TYPES];

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