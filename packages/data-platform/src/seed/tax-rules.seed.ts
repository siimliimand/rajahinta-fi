/**
 * Seed: initial Finnish excise duty rates (v1.0-2024).
 *
 * Official source
 * - Excise duty on alcohol: Finnish Tax Administration (Verohallinto)
 *   https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-alcohol-and-alcoholic-beverages/
 * - Excise duty table (Finnish): https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/alkoholijuomavero/alkoholi-ja-alkoholijuomaverotaulukko/
 * - Beverage container duty: https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-beverage-containers/
 *
 * ABV tier matching convention
 * ───────────────────────────────
 * The seed stores bands using the official half-open convention
 * "yli X, enintään Y" → { minAlcoholByVolume: X, maxAlcoholByVolume: Y }.
 * The evaluator (AlcoholExciseService.matchesTier) uses ≥ for min and ≤ for
 * max, so a product whose ABV equals a boundary value may mathematically match
 * two adjacent tiers.  For real products this is effectively never an issue
 * (ABV is a continuous measurement with natural variation), but behaviour at
 * exact boundaries is deterministic: the lower (narrower) tier wins because
 * `findAllApplicable` orders by effectiveFrom and insertion order, and
 * `findMatchingRule` returns the first match.  The exemption bands use
 * maxAlcoholByVolume alone, which evaluates as ABV ≤ threshold — these are
 * checked first in every category and guarantee that a product exactly at the
 * exempt boundary (e.g. 0.5 % for beer, 1.2 % for wine/spirits) is treated
 * as exempt.
 *
 * @module Seed
 */

import { inArray } from 'drizzle-orm';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { taxRules } from '../index';
import {
  FORMULA_PER_LITRE_OF_PRODUCT,
  FORMULA_PER_LITRE_OF_ALCOHOL,
  FORMULA_PER_DEGREE_PLATO,
  FORMULA_FLAT_PER_LITRE,
  TAX_TYPES,
} from '@rajahinta/core-domain';
import { validateEffectiveRanges } from '../repositories/effective-range-validator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaxRuleSeed {
  taxType: string;
  productCategory: string;
  rate: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  exemptionConditions: Record<string, unknown> | null;
  calculationFormulaReference: string;
  officialSource: string;
  verificationDate: Date;
  versionLabel: string;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/** Official source reference used across all beer/wine/spirit rates (vero.fi). */
const SOURCE_VERO_FI =
  'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)';

const VERIFIED_2024_Q1 = new Date('2024-03-01');
const VERIFIED_2026_AUG = new Date('2026-08-21');

const VERSION_2024 = 'v1.0-2024';
const VERSION_2025 = 'v2.0-2025';
const VERSION_2026 = 'v3.0-2026';

const EFFECTIVE_FROM_2024 = new Date('2024-01-01');
const EFFECTIVE_TO_2024 = new Date('2024-12-31');
const EFFECTIVE_FROM_2025 = new Date('2025-01-01');
const EFFECTIVE_TO_2025 = new Date('2025-12-31');
const EFFECTIVE_FROM_2026 = new Date('2026-01-01');

/**
 * Beer excise: progressive bands in snt per centilitre of ethyl alcohol.
 *
 * Official 2024 rates (vero.fi alcohol excise table):
 *   ≤ 0.5 %ABV  → 0 (exempt)
 *   > 0.5 – 3.5 %ABV  → 28.35 snt/cl ethanol
 *   > 3.5 %ABV  → 36.20 snt/cl ethanol
 *
 * Formula: rate(snt/cl ethanol) × abv × volumeLitres → snt.
 * Since rate unit is snt/cl ethanol, and the formula math treats rate in the
 * same units as FORMULA_PER_DEGREE_PLATO (deprecated alias — kept for
 * backward compatibility with DB-stored references). The constant imported
 * below aliases FORMULA_PER_CENTILITRE_ETHANOL.
 *
 * Small-brewery relief (pienpanimoalennus) is NOT seeded: the official
 * vero.fi scheme is a progressive 10–50 % discount by annual production
 * (ceiling 15 000 000 l/year; HE 106/2024). The current rule evaluator
 * cannot express production-volume tiers, so only the general rate is
 * shipped. Small-brewery treatment is documented as UNAVAILABLE pending
 * Phase 2 evaluator support. See vero.fi pienpanimoalennus guidance and
 * design D4 in phase0-1-verification-fix.
 */
const BEER_EXEMPT: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'beer',
  rate: '0.00',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description: 'Beer ≤ 0.5 %ABV — not subject to excise duty',
    appliesTo: { maxAlcoholByVolume: 0.5 },
  },
  calculationFormulaReference: FORMULA_PER_DEGREE_PLATO,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

const BEER_MID: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'beer',
  rate: '28.35',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description:
      'Beer > 0.5 %ABV up to 3.5 %ABV — 28.35 snt/cl ethanol',
    appliesTo: { minAlcoholByVolume: 0.5, maxAlcoholByVolume: 3.5 },
  },
  calculationFormulaReference: FORMULA_PER_DEGREE_PLATO,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

const BEER_FULL_RATE: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'beer',
  rate: '36.20',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description:
      'Beer > 3.5 %ABV — 36.20 snt/cl ethanol',
    appliesTo: { minAlcoholByVolume: 3.5 },
  },
  calculationFormulaReference: FORMULA_PER_DEGREE_PLATO,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

/**
 * Wine (still) excise: six bands in €/l of product.
 *
 * Official 2024 rates (vero.fi):
 *   ≤ 1.2 %ABV  → 0.00 €/l (exempt)
 *   > 1.2 – 2.8 %ABV  → 0.36 €/l
 *   > 2.8 – 5.5 %ABV  → 1.98 €/l
 *   > 5.5 – 8 %ABV  → 3.08 €/l
 *   > 8 – 15 %ABV  → 4.56 €/l
 *   > 15 – 18 %ABV  → 4.56 €/l
 */
const WINE_STILL_EXEMPT: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'wine_still',
  rate: '0.00',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description: 'Still wine ≤ 1.2 %ABV — exempt',
    appliesTo: { maxAlcoholByVolume: 1.2 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

/** Still wine > 1.2 %ABV up to 2.8 %ABV at 0.36 €/l. */
const WINE_STILL_BAND_1: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'wine_still',
  rate: '0.36',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description: 'Still wine > 1.2 – 2.8 %ABV — 0.36 €/l',
    appliesTo: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

/** Still wine > 2.8 %ABV up to 5.5 %ABV at 1.98 €/l. */
const WINE_STILL_BAND_2: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'wine_still',
  rate: '1.98',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description: 'Still wine > 2.8 – 5.5 %ABV — 1.98 €/l',
    appliesTo: { minAlcoholByVolume: 2.8, maxAlcoholByVolume: 5.5 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

/** Still wine > 5.5 %ABV up to 8 %ABV at 3.08 €/l. */
const WINE_STILL_BAND_3: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'wine_still',
  rate: '3.08',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description: 'Still wine > 5.5 – 8 %ABV — 3.08 €/l',
    appliesTo: { minAlcoholByVolume: 5.5, maxAlcoholByVolume: 8 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

/** Still wine > 8 %ABV up to 15 %ABV at 4.56 €/l. */
const WINE_STILL_BAND_4: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'wine_still',
  rate: '4.56',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description: 'Still wine > 8 – 15 %ABV — 4.56 €/l',
    appliesTo: { minAlcoholByVolume: 8, maxAlcoholByVolume: 15 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

/** Still wine > 15 %ABV up to 18 %ABV at 4.56 €/l. */
const WINE_STILL_BAND_5: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'wine_still',
  rate: '4.56',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description: 'Still wine > 15 – 18 %ABV — 4.56 €/l',
    appliesTo: { minAlcoholByVolume: 15, maxAlcoholByVolume: 18 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

/**
 * Sparkling wine excise: same bands and rates as still wine.
 *
 * Finnish law has no separate rate for sparkling wine — it is taxed at the
 * same wine_still rates.  The `wine_sparkling` product category is retained
 * as a data-acquisition convenience key and uses the identical band structure
 * and rates defined for still wine.
 */
const WINE_SPARKLING_EXEMPT: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'wine_sparkling',
  rate: '0.00',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description: 'Sparkling wine ≤ 1.2 %ABV — exempt',
    appliesTo: { maxAlcoholByVolume: 1.2 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

const WINE_SPARKLING_BAND_1: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'wine_sparkling',
  rate: '0.36',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description: 'Sparkling wine > 1.2 – 2.8 %ABV — 0.36 €/l',
    appliesTo: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

const WINE_SPARKLING_BAND_2: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'wine_sparkling',
  rate: '1.98',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description: 'Sparkling wine > 2.8 – 5.5 %ABV — 1.98 €/l',
    appliesTo: { minAlcoholByVolume: 2.8, maxAlcoholByVolume: 5.5 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

const WINE_SPARKLING_BAND_3: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'wine_sparkling',
  rate: '3.08',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description: 'Sparkling wine > 5.5 – 8 %ABV — 3.08 €/l',
    appliesTo: { minAlcoholByVolume: 5.5, maxAlcoholByVolume: 8 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

const WINE_SPARKLING_BAND_4: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'wine_sparkling',
  rate: '4.56',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description: 'Sparkling wine > 8 – 15 %ABV — 4.56 €/l',
    appliesTo: { minAlcoholByVolume: 8, maxAlcoholByVolume: 15 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

const WINE_SPARKLING_BAND_5: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'wine_sparkling',
  rate: '4.56',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description: 'Sparkling wine > 15 – 18 %ABV — 4.56 €/l',
    appliesTo: { minAlcoholByVolume: 15, maxAlcoholByVolume: 18 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

/**
 * Spirits excise: bands in snt per cl ethanol (== €/l pure alcohol).
 *
 * Official 2024 rates (vero.fi):
 *   ≤ 1.2 %ABV  → 0 (exempt)
 *   > 1.2 – 2.8 %ABV  → 30.90 snt/cl ethanol (30.90 €/l pure alcohol)
 *   > 2.8 %ABV  → 54.80 snt/cl ethanol (54.80 €/l pure alcohol)
 *
 * The rate string is stored in €/l of pure alcohol (30.90 / 54.80) for use
 * with FORMULA_PER_LITRE_OF_ALCOHOL: amount = rate × abv × volumeLitres.
 * This is numerically equivalent to snt/cl ethanol because 1 snt/cl =
 * 1 €/l (100 snt/€ × 1/100 cl/L scaling).
 */
const SPIRITS_EXEMPT: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'spirits',
  rate: '0.00',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description: 'Spirits ≤ 1.2 %ABV — not subject to excise duty',
    appliesTo: { maxAlcoholByVolume: 1.2 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_ALCOHOL,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

const SPIRITS_MID: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'spirits',
  rate: '30.90',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description:
      'Spirits > 1.2 %ABV up to 2.8 %ABV — 30.90 snt/cl ethanol (€30.90/l pure alcohol)',
    appliesTo: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_ALCOHOL,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

const SPIRITS_FULL_RATE: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'spirits',
  rate: '54.80',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description:
      'Spirits > 2.8 %ABV — 54.80 snt/cl ethanol (€54.80/l pure alcohol)',
    appliesTo: { minAlcoholByVolume: 2.8 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_ALCOHOL,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

/**
 * Intermediate products (fortified wine, vermouth, sherry, port, etc.).
 *
 * Official 2024 rates (vero.fi):
 *   > 1.2 – 15 %ABV  → 5.68 €/l product
 *   > 15 – 22 %ABV   → 8.63 €/l product
 *
 * Products ≤ 1.2 %ABV in this category do not match any band and would fall
 * back to the first rule (ESTIMATED).  In practice such products are re-
 * classified to wine at data-ingestion time per Finnish Excise rules.
 */
const INTERMEDIATE_LOW: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'intermediate_products',
  rate: '5.68',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description: 'Intermediate products > 1.2 – 15 %ABV — 5.68 €/l',
    appliesTo: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 15 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

const INTERMEDIATE_HIGH: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'intermediate_products',
  rate: '8.63',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description: 'Intermediate products > 15 – 22 %ABV — 8.63 €/l',
    appliesTo: { minAlcoholByVolume: 15, maxAlcoholByVolume: 22 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

/**
 * Other fermented beverages (cider, sake, mead, etc.).
 *
 * Per D2, fermented beverages are taxed per litre of product (not per litre
 * of alcohol) using the same band structure and rates as still wine.
 * Spirit-based RTDs belong to the spirits category at data-mapping time.
 *
 * Official 2024 rates (vero.fi, wine bands — Finnish law has no separate
 * rate schedule for other fermented beverages):
 *   ≤ 1.2 %ABV  → 0.00 €/l (exempt)
 *   > 1.2 – 2.8 %ABV  → 0.36 €/l
 *   > 2.8 – 5.5 %ABV  → 1.98 €/l
 *   > 5.5 – 8 %ABV  → 3.08 €/l
 *   > 8 – 15 %ABV  → 4.56 €/l
 *   > 15 – 18 %ABV  → 4.56 €/l
 */
const OTHER_FERMENTED_EXEMPT: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'other_fermented',
  rate: '0.00',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description: 'Other fermented ≤ 1.2 %ABV — exempt',
    appliesTo: { maxAlcoholByVolume: 1.2 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

const OTHER_FERMENTED_BAND_1: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'other_fermented',
  rate: '0.36',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description: 'Other fermented > 1.2 – 2.8 %ABV — 0.36 €/l',
    appliesTo: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

const OTHER_FERMENTED_BAND_2: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'other_fermented',
  rate: '1.98',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description: 'Other fermented > 2.8 – 5.5 %ABV — 1.98 €/l',
    appliesTo: { minAlcoholByVolume: 2.8, maxAlcoholByVolume: 5.5 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

const OTHER_FERMENTED_BAND_3: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'other_fermented',
  rate: '3.08',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description: 'Other fermented > 5.5 – 8 %ABV — 3.08 €/l',
    appliesTo: { minAlcoholByVolume: 5.5, maxAlcoholByVolume: 8 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

const OTHER_FERMENTED_BAND_4: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'other_fermented',
  rate: '4.56',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description: 'Other fermented > 8 – 15 %ABV — 4.56 €/l',
    appliesTo: { minAlcoholByVolume: 8, maxAlcoholByVolume: 15 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

const OTHER_FERMENTED_BAND_5: TaxRuleSeed = {
  taxType: TAX_TYPES.excise,
  productCategory: 'other_fermented',
  rate: '4.56',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: {
    description: 'Other fermented > 15 – 18 %ABV — 4.56 €/l',
    appliesTo: { minAlcoholByVolume: 15, maxAlcoholByVolume: 18 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION_2024,
};

/**
 * Container duty (juomapakkausvero) — general flat rate per litre.
 *
 * Applies to all beverage containers imported or manufactured in Finland,
 * unless exempted by deposit-return system participation, liquid packaging
 * board, or retail packages > 5 litres.
 *
 * Official source (separate from alcohol excise):
 *   https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-beverage-containers/
 *   Finnish rate table: https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/juomapakkausvero/juomapakkausverotaulukko/
 *
 * Rate confirmed: €0.51 per litre of beverage (vero.fi, "The duty is €0.51
 * per litre of beverage placed inside the container").
 */
const SOURCE_VERO_CONTAINER_DUTY =
  'Finnish Tax Administration — Excise Duty on Beverage Containers, Rate 2024 (vero.fi)';

/** Container duty page consulted and cross-referenced against the alcohol table on 2026-08-21. */
const VERIFIED_CONTAINER_DUTY = new Date('2026-08-21');

const CONTAINER_DUTY: TaxRuleSeed = {
  taxType: TAX_TYPES.containerDuty,
  productCategory: 'all_beverages',
  rate: '0.51',
  effectiveFrom: EFFECTIVE_FROM_2024,
  effectiveTo: EFFECTIVE_TO_2024,
  exemptionConditions: null,
  calculationFormulaReference: FORMULA_FLAT_PER_LITRE,
  officialSource: SOURCE_VERO_CONTAINER_DUTY,
  verificationDate: VERIFIED_CONTAINER_DUTY,
  versionLabel: VERSION_2024,
};

// ---------------------------------------------------------------------------
// Helper: produce a versioned copy of a template row
// ---------------------------------------------------------------------------

interface VersionOverride {
  rate: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  verificationDate: Date;
  versionLabel: string;
  officialSource: string;
}

function makeRule(
  template: TaxRuleSeed,
  override: VersionOverride,
): TaxRuleSeed {
  return {
    ...template,
    rate: override.rate,
    effectiveFrom: override.effectiveFrom,
    effectiveTo: override.effectiveTo,
    verificationDate: override.verificationDate,
    versionLabel: override.versionLabel,
    officialSource: override.officialSource,
  };
}

// ---------------------------------------------------------------------------
// v2.0-2025 — effective 2025-01-01 through 2025-12-31
//
// Deltas from v1.0-2024 (audit doc table):
//   Intermediate > 15–22: 8.63 → 8.74 €/l
//   Spirits > 2.8 splits into > 2.8–10 (54.80) and > 10 (55.50) snt/cl
//   All other categories/bands: same as 2024
// ---------------------------------------------------------------------------

const SOURCE_VERO_FI_2025 =
  'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)';

const V2025_BEER: TaxRuleSeed[] = [
  makeRule(BEER_EXEMPT, { rate: '0.00', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
  makeRule(BEER_MID, { rate: '28.35', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
  makeRule(BEER_FULL_RATE, { rate: '36.20', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
];

const V2025_WINE_STILL: TaxRuleSeed[] = [
  makeRule(WINE_STILL_EXEMPT, { rate: '0.00', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
  makeRule(WINE_STILL_BAND_1, { rate: '0.36', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
  makeRule(WINE_STILL_BAND_2, { rate: '1.98', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
  makeRule(WINE_STILL_BAND_3, { rate: '3.08', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
  makeRule(WINE_STILL_BAND_4, { rate: '4.56', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
  makeRule(WINE_STILL_BAND_5, { rate: '4.56', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
];

const V2025_WINE_SPARKLING: TaxRuleSeed[] = [
  makeRule(WINE_SPARKLING_EXEMPT, { rate: '0.00', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
  makeRule(WINE_SPARKLING_BAND_1, { rate: '0.36', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
  makeRule(WINE_SPARKLING_BAND_2, { rate: '1.98', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
  makeRule(WINE_SPARKLING_BAND_3, { rate: '3.08', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
  makeRule(WINE_SPARKLING_BAND_4, { rate: '4.56', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
  makeRule(WINE_SPARKLING_BAND_5, { rate: '4.56', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
];

/** v2.0-2025: intermediate > 15–22 moves to 8.74; low band unchanged at 5.68. */
const V2025_INTERMEDIATE: TaxRuleSeed[] = [
  makeRule(INTERMEDIATE_LOW, { rate: '5.68', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
  { ...INTERMEDIATE_HIGH, rate: '8.74', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025, exemptionConditions: { description: 'Intermediate products > 15 – 22 %ABV — 8.74 €/l', appliesTo: { minAlcoholByVolume: 15, maxAlcoholByVolume: 22 } } },
];

/**
 * v2.0-2025 spirits: the > 2.8 % band is split into two sub-bands —
 *   > 2.8–10 % ABV at 54.80 (unchanged from 2024)
 *   > 10 % ABV at 55.50 (new rate, previously all > 2.8 was 54.80)
 */
const V2025_SPIRITS: TaxRuleSeed[] = [
  makeRule(SPIRITS_EXEMPT, { rate: '0.00', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
  makeRule(SPIRITS_MID, { rate: '30.90', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
  { ...SPIRITS_FULL_RATE, rate: '54.80', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025, exemptionConditions: { description: 'Spirits > 2.8 – 10 %ABV — 54.80 snt/cl ethanol (€54.80/l pure alcohol)', appliesTo: { minAlcoholByVolume: 2.8, maxAlcoholByVolume: 10 } } },
  { ...SPIRITS_FULL_RATE, rate: '55.50', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025, exemptionConditions: { description: 'Spirits > 10 %ABV — 55.50 snt/cl ethanol (€55.50/l pure alcohol)', appliesTo: { minAlcoholByVolume: 10 } } },
];

const V2025_OTHER_FERMENTED: TaxRuleSeed[] = [
  makeRule(OTHER_FERMENTED_EXEMPT, { rate: '0.00', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
  makeRule(OTHER_FERMENTED_BAND_1, { rate: '0.36', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
  makeRule(OTHER_FERMENTED_BAND_2, { rate: '1.98', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
  makeRule(OTHER_FERMENTED_BAND_3, { rate: '3.08', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
  makeRule(OTHER_FERMENTED_BAND_4, { rate: '4.56', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
  makeRule(OTHER_FERMENTED_BAND_5, { rate: '4.56', effectiveFrom: EFFECTIVE_FROM_2025, effectiveTo: EFFECTIVE_TO_2025, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2025, officialSource: SOURCE_VERO_FI_2025 }),
];

const V2025_CONTAINER_DUTY: TaxRuleSeed = {
  ...CONTAINER_DUTY,
  rate: '0.51',
  effectiveFrom: EFFECTIVE_FROM_2025,
  effectiveTo: EFFECTIVE_TO_2025,
  verificationDate: VERIFIED_2026_AUG,
  versionLabel: VERSION_2025,
  officialSource: 'Finnish Tax Administration — Excise Duty on Beverage Containers, Rates 2025 (vero.fi)',
};

// ---------------------------------------------------------------------------
// v3.0-2026 — effective 2026-01-01, current (effectiveTo null)
//
// Official 2026 rates (audit doc table, snt converted to € where needed):
//
//   Beer 0.5–3.5 %:             28.75 snt/cl (2024: 28.35)
//   Beer > 3.5 %:               36.71 snt/cl (2024: 36.20)
//   Wine > 1.2–2.8 %:           0.36 €/l → 0.50 €/l from 1.4.2026 (split row)
//   Wine > 2.8–5.5 %:           2.1902 €/l  (219.02 snt/l, 2024: 1.98)
//   Wine > 5.5–8 %:             3.4070 €/l  (340.70 snt/l, 2024: 3.08)
//   Wine > 8–15 %:              5.0497 €/l  (504.97 snt/l, 2024: 4.56)
//   Wine > 15–18 %:             5.0497 €/l  (same as >8–15, 2024: 4.56)
//   Intermediate > 1.2–15:      5.7595 €/l  (575.95 snt/l, 2024: 5.68)
//   Intermediate > 15–22:       8.8624 €/l  (886.24 snt/l, 2025: 8.74)
//   Spirits > 1.2–2.8:          31.33 snt/cl (2024/25: 30.90)
//   Spirits > 2.8–10:           55.57 snt/cl (2025: 54.80)
//   Spirits > 10:               56.28 snt/cl (2025: 55.50)
//   Container duty:             0.51 €/l    (unchanged)
// ---------------------------------------------------------------------------

const SOURCE_VERO_FI_2026 =
  'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)';

const V2026_BEER: TaxRuleSeed[] = [
  makeRule(BEER_EXEMPT, { rate: '0.00', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026 }),
  makeRule(BEER_MID, { rate: '28.75', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026 }),
  makeRule(BEER_FULL_RATE, { rate: '36.71', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026 }),
];

/**
 * v3.0-2026 wine still: note the intra-year split on band 1 (> 1.2–2.8 %).
 * Row A: 0.36 €/l through 2026-03-31.
 * Row B: 0.50 €/l from 2026-04-01 onward.
 */
const V2026_WINE_STILL: TaxRuleSeed[] = [
  makeRule(WINE_STILL_EXEMPT, { rate: '0.00', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026 }),
  // Intra-year split row A: 0.36 €/l until 2026-03-31
  { ...WINE_STILL_BAND_1, rate: '0.36', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: new Date('2026-03-31'), verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026, exemptionConditions: { description: 'Still wine > 1.2 – 2.8 %ABV — 0.36 €/l (until 31.3.2026)', appliesTo: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 } } },
  // Intra-year split row B: 0.50 €/l from 2026-04-01
  { ...WINE_STILL_BAND_1, rate: '0.50', effectiveFrom: new Date('2026-04-01'), effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026, exemptionConditions: { description: 'Still wine > 1.2 – 2.8 %ABV — 0.50 €/l (from 1.4.2026)', appliesTo: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 } } },
  makeRule(WINE_STILL_BAND_2, { rate: '2.1902', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026 }),
  makeRule(WINE_STILL_BAND_3, { rate: '3.4070', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026 }),
  makeRule(WINE_STILL_BAND_4, { rate: '5.0497', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026 }),
  makeRule(WINE_STILL_BAND_5, { rate: '5.0497', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026 }),
];

/** v3.0-2026 sparkling wine mirrors still wine (same intra-year split). */
const V2026_WINE_SPARKLING: TaxRuleSeed[] = [
  makeRule(WINE_SPARKLING_EXEMPT, { rate: '0.00', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026 }),
  { ...WINE_SPARKLING_BAND_1, rate: '0.36', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: new Date('2026-03-31'), verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026, exemptionConditions: { description: 'Sparkling wine > 1.2 – 2.8 %ABV — 0.36 €/l (until 31.3.2026)', appliesTo: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 } } },
  { ...WINE_SPARKLING_BAND_1, rate: '0.50', effectiveFrom: new Date('2026-04-01'), effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026, exemptionConditions: { description: 'Sparkling wine > 1.2 – 2.8 %ABV — 0.50 €/l (from 1.4.2026)', appliesTo: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 } } },
  makeRule(WINE_SPARKLING_BAND_2, { rate: '2.1902', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026 }),
  makeRule(WINE_SPARKLING_BAND_3, { rate: '3.4070', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026 }),
  makeRule(WINE_SPARKLING_BAND_4, { rate: '5.0497', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026 }),
  makeRule(WINE_SPARKLING_BAND_5, { rate: '5.0497', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026 }),
];

const V2026_INTERMEDIATE: TaxRuleSeed[] = [
  makeRule(INTERMEDIATE_LOW, { rate: '5.7595', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026 }),
  { ...INTERMEDIATE_HIGH, rate: '8.8624', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026, exemptionConditions: { description: 'Intermediate products > 15 – 22 %ABV — 8.8624 €/l', appliesTo: { minAlcoholByVolume: 15, maxAlcoholByVolume: 22 } } },
];

const V2026_SPIRITS: TaxRuleSeed[] = [
  makeRule(SPIRITS_EXEMPT, { rate: '0.00', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026 }),
  makeRule(SPIRITS_MID, { rate: '31.33', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026 }),
  { ...SPIRITS_FULL_RATE, rate: '55.57', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026, exemptionConditions: { description: 'Spirits > 2.8 – 10 %ABV — 55.57 snt/cl ethanol (€55.57/l pure alcohol)', appliesTo: { minAlcoholByVolume: 2.8, maxAlcoholByVolume: 10 } } },
  { ...SPIRITS_FULL_RATE, rate: '56.28', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026, exemptionConditions: { description: 'Spirits > 10 %ABV — 56.28 snt/cl ethanol (€56.28/l pure alcohol)', appliesTo: { minAlcoholByVolume: 10 } } },
];

const V2026_OTHER_FERMENTED: TaxRuleSeed[] = [
  makeRule(OTHER_FERMENTED_EXEMPT, { rate: '0.00', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026 }),
  { ...OTHER_FERMENTED_BAND_1, rate: '0.36', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: new Date('2026-03-31'), verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026, exemptionConditions: { description: 'Other fermented > 1.2 – 2.8 %ABV — 0.36 €/l (until 31.3.2026)', appliesTo: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 } } },
  { ...OTHER_FERMENTED_BAND_1, rate: '0.50', effectiveFrom: new Date('2026-04-01'), effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026, exemptionConditions: { description: 'Other fermented > 1.2 – 2.8 %ABV — 0.50 €/l (from 1.4.2026)', appliesTo: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 } } },
  makeRule(OTHER_FERMENTED_BAND_2, { rate: '2.1902', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026 }),
  makeRule(OTHER_FERMENTED_BAND_3, { rate: '3.4070', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026 }),
  makeRule(OTHER_FERMENTED_BAND_4, { rate: '5.0497', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026 }),
  makeRule(OTHER_FERMENTED_BAND_5, { rate: '5.0497', effectiveFrom: EFFECTIVE_FROM_2026, effectiveTo: null, verificationDate: VERIFIED_2026_AUG, versionLabel: VERSION_2026, officialSource: SOURCE_VERO_FI_2026 }),
];

const V2026_CONTAINER_DUTY: TaxRuleSeed = {
  ...CONTAINER_DUTY,
  rate: '0.51',
  effectiveFrom: EFFECTIVE_FROM_2026,
  effectiveTo: null,
  verificationDate: VERIFIED_2026_AUG,
  versionLabel: VERSION_2026,
  officialSource: 'Finnish Tax Administration — Excise Duty on Beverage Containers, Rates 2026 (vero.fi)',
};

// ---------------------------------------------------------------------------
// Registry – ordered for deterministic insertion
// ---------------------------------------------------------------------------

export const SEED_RULES: TaxRuleSeed[] = [
  // ── v1.0-2024 ────────────────────────────────────────────────────────
  // Beer
  BEER_EXEMPT,
  BEER_MID,
  BEER_FULL_RATE,
  // Still wine
  WINE_STILL_EXEMPT,
  WINE_STILL_BAND_1,
  WINE_STILL_BAND_2,
  WINE_STILL_BAND_3,
  WINE_STILL_BAND_4,
  WINE_STILL_BAND_5,
  // Sparkling wine (same bands/values as still)
  WINE_SPARKLING_EXEMPT,
  WINE_SPARKLING_BAND_1,
  WINE_SPARKLING_BAND_2,
  WINE_SPARKLING_BAND_3,
  WINE_SPARKLING_BAND_4,
  WINE_SPARKLING_BAND_5,
  // Intermediate products
  INTERMEDIATE_LOW,
  INTERMEDIATE_HIGH,
  // Spirits
  SPIRITS_EXEMPT,
  SPIRITS_MID,
  SPIRITS_FULL_RATE,
  // Other fermented (wine bands)
  OTHER_FERMENTED_EXEMPT,
  OTHER_FERMENTED_BAND_1,
  OTHER_FERMENTED_BAND_2,
  OTHER_FERMENTED_BAND_3,
  OTHER_FERMENTED_BAND_4,
  OTHER_FERMENTED_BAND_5,
  // Container duty
  CONTAINER_DUTY,

  // ── v2.0-2025 ────────────────────────────────────────────────────────
  ...V2025_BEER,
  ...V2025_WINE_STILL,
  ...V2025_WINE_SPARKLING,
  ...V2025_INTERMEDIATE,
  ...V2025_SPIRITS,
  ...V2025_OTHER_FERMENTED,
  V2025_CONTAINER_DUTY,

  // ── v3.0-2026 ────────────────────────────────────────────────────────
  ...V2026_BEER,
  ...V2026_WINE_STILL,
  ...V2026_WINE_SPARKLING,
  ...V2026_INTERMEDIATE,
  ...V2026_SPIRITS,
  ...V2026_OTHER_FERMENTED,
  V2026_CONTAINER_DUTY,
];

// ---------------------------------------------------------------------------
// Seed function
// ---------------------------------------------------------------------------

/**
 * Seed the `taxRules` table with v1.0-2024, v2.0-2025, and v3.0-2026
 * Finnish excise duty rates.
 *
 * Safe to call multiple times — skips records where `versionLabel` already
 * exists. Uses a single batch insert for performance.
 *
 * @param db — A Postgres.js-dialect Drizzle database instance.
 */
export async function seedTaxRules(
  db: PostgresJsDatabase,
): Promise<{ inserted: number; skipped: number }> {
  // Check which version labels are already present
  const existing = await db
    .select({ versionLabel: taxRules.versionLabel })
    .from(taxRules)
    .where(inArray(taxRules.versionLabel, SEED_RULES.map((r) => r.versionLabel)));

  const existingLabels = new Set(existing.map((r: { versionLabel: string }) => r.versionLabel));
  const toInsert = SEED_RULES.filter((r) => !existingLabels.has(r.versionLabel));

  if (toInsert.length === 0) {
    return { inserted: 0, skipped: SEED_RULES.length };
  }

  await db.insert(taxRules).values(toInsert);

  return { inserted: toInsert.length, skipped: SEED_RULES.length - toInsert.length };
}

// ---------------------------------------------------------------------------
// Self-check: validate effective-date ranges (no gaps, no overlaps)
// ---------------------------------------------------------------------------

/**
 * Validate that every (taxType, productCategory, band) group in SEED_RULES
 * has contiguous, non-overlapping effective-date intervals.
 *
 * Grouping includes the ABV band: a category carries one concurrent
 * timeline PER BAND (wine has six), so ranges are contiguous within a
 * band — never across bands.
 *
 * Throws on failure so the module fails loudly at import time in tests.
 */
(function selfCheckRanges(): void {
  const groups = new Map<string, TaxRuleSeed[]>();
  for (const rule of SEED_RULES) {
    const bandKey = rule.exemptionConditions === null
      ? 'none'
      : JSON.stringify(rule.exemptionConditions);
    const key = `${rule.taxType}:${rule.productCategory}:${bandKey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(rule);
  }

  const allErrors: string[] = [];
  for (const [key, rules] of groups) {
    const errors = validateEffectiveRanges(
      rules.map((r) => ({ effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo })),
    );
    for (const err of errors) allErrors.push(`[${key}] ${err}`);
  }

  if (allErrors.length > 0) {
    const msg = `TAX RULES RANGE VALIDATION FAILED (${allErrors.length} errors):\n  ${allErrors.join('\n  ')}`;
    console.error(msg);
    throw new Error(msg);
  } else {
    console.log('TAX RULES RANGE VALIDATION PASSED — no gaps or overlaps across all versioned rule sets');
  }
})();