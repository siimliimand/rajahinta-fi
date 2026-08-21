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
} from '@rajahinta/core-domain';

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

/** Official source reference used across all 2024 beer/wine/spirit rates. */
const SOURCE_VERO_FI =
  'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)';

const VERIFIED_2024_Q1 = new Date('2024-03-01');

const VERSION = 'v1.0-2024';
const EFFECTIVE_FROM = new Date('2024-01-01');

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
 * backward compatibility with DB-stored references), the string constant
 * imported below is the OLD name; it aliases FORMULA_PER_CENTILITRE_ETHANOL.
 *
 * Small independent breweries (< 500 000 l/year) receive a reduced rate
 * on the first 100 000 hl/year — handled by a separate row below
 * (BEER_SMALL_BREWERY_RATE, preserved as-is from the original seed pending
 * WS1.4 which corrects the progressive tier structure).
 */
const BEER_EXEMPT: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'beer',
  rate: '0.00',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Beer ≤ 0.5 %ABV — not subject to excise duty',
    appliesTo: { maxAlcoholByVolume: 0.5 },
  },
  calculationFormulaReference: FORMULA_PER_DEGREE_PLATO,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

const BEER_MID: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'beer',
  rate: '28.35',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description:
      'Beer > 0.5 %ABV up to 3.5 %ABV — 28.35 snt/cl ethanol',
    appliesTo: { minAlcoholByVolume: 0.5, maxAlcoholByVolume: 3.5 },
  },
  calculationFormulaReference: FORMULA_PER_DEGREE_PLATO,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

const BEER_FULL_RATE: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'beer',
  rate: '36.20',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description:
      'Beer > 3.5 %ABV — 36.20 snt/cl ethanol',
    appliesTo: { minAlcoholByVolume: 3.5 },
  },
  calculationFormulaReference: FORMULA_PER_DEGREE_PLATO,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

const BEER_SMALL_BREWERY_RATE: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'beer',
  rate: '16.50',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description:
      'Reduced rate for small independent breweries (< 500 000 l/year) on first 100 000 hl',
    appliesTo: {
      maxAnnualProductionHl: 100_000,
      breweryType: 'independent_small',
    },
  },
  calculationFormulaReference: FORMULA_PER_DEGREE_PLATO,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
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
  taxType: 'excise_duty',
  productCategory: 'wine_still',
  rate: '0.00',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Still wine ≤ 1.2 %ABV — exempt',
    appliesTo: { maxAlcoholByVolume: 1.2 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

/** Still wine > 1.2 %ABV up to 2.8 %ABV at 0.36 €/l. */
const WINE_STILL_BAND_1: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'wine_still',
  rate: '0.36',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Still wine > 1.2 – 2.8 %ABV — 0.36 €/l',
    appliesTo: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

/** Still wine > 2.8 %ABV up to 5.5 %ABV at 1.98 €/l. */
const WINE_STILL_BAND_2: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'wine_still',
  rate: '1.98',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Still wine > 2.8 – 5.5 %ABV — 1.98 €/l',
    appliesTo: { minAlcoholByVolume: 2.8, maxAlcoholByVolume: 5.5 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

/** Still wine > 5.5 %ABV up to 8 %ABV at 3.08 €/l. */
const WINE_STILL_BAND_3: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'wine_still',
  rate: '3.08',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Still wine > 5.5 – 8 %ABV — 3.08 €/l',
    appliesTo: { minAlcoholByVolume: 5.5, maxAlcoholByVolume: 8 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

/** Still wine > 8 %ABV up to 15 %ABV at 4.56 €/l. */
const WINE_STILL_BAND_4: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'wine_still',
  rate: '4.56',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Still wine > 8 – 15 %ABV — 4.56 €/l',
    appliesTo: { minAlcoholByVolume: 8, maxAlcoholByVolume: 15 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

/** Still wine > 15 %ABV up to 18 %ABV at 4.56 €/l. */
const WINE_STILL_BAND_5: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'wine_still',
  rate: '4.56',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Still wine > 15 – 18 %ABV — 4.56 €/l',
    appliesTo: { minAlcoholByVolume: 15, maxAlcoholByVolume: 18 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
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
  taxType: 'excise_duty',
  productCategory: 'wine_sparkling',
  rate: '0.00',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Sparkling wine ≤ 1.2 %ABV — exempt',
    appliesTo: { maxAlcoholByVolume: 1.2 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

const WINE_SPARKLING_BAND_1: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'wine_sparkling',
  rate: '0.36',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Sparkling wine > 1.2 – 2.8 %ABV — 0.36 €/l',
    appliesTo: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

const WINE_SPARKLING_BAND_2: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'wine_sparkling',
  rate: '1.98',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Sparkling wine > 2.8 – 5.5 %ABV — 1.98 €/l',
    appliesTo: { minAlcoholByVolume: 2.8, maxAlcoholByVolume: 5.5 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

const WINE_SPARKLING_BAND_3: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'wine_sparkling',
  rate: '3.08',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Sparkling wine > 5.5 – 8 %ABV — 3.08 €/l',
    appliesTo: { minAlcoholByVolume: 5.5, maxAlcoholByVolume: 8 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

const WINE_SPARKLING_BAND_4: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'wine_sparkling',
  rate: '4.56',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Sparkling wine > 8 – 15 %ABV — 4.56 €/l',
    appliesTo: { minAlcoholByVolume: 8, maxAlcoholByVolume: 15 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

const WINE_SPARKLING_BAND_5: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'wine_sparkling',
  rate: '4.56',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Sparkling wine > 15 – 18 %ABV — 4.56 €/l',
    appliesTo: { minAlcoholByVolume: 15, maxAlcoholByVolume: 18 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
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
  taxType: 'excise_duty',
  productCategory: 'spirits',
  rate: '0.00',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Spirits ≤ 1.2 %ABV — not subject to excise duty',
    appliesTo: { maxAlcoholByVolume: 1.2 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_ALCOHOL,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

const SPIRITS_MID: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'spirits',
  rate: '30.90',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description:
      'Spirits > 1.2 %ABV up to 2.8 %ABV — 30.90 snt/cl ethanol (€30.90/l pure alcohol)',
    appliesTo: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_ALCOHOL,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

const SPIRITS_FULL_RATE: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'spirits',
  rate: '54.80',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description:
      'Spirits > 2.8 %ABV — 54.80 snt/cl ethanol (€54.80/l pure alcohol)',
    appliesTo: { minAlcoholByVolume: 2.8 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_ALCOHOL,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
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
  taxType: 'excise_duty',
  productCategory: 'intermediate_products',
  rate: '5.68',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Intermediate products > 1.2 – 15 %ABV — 5.68 €/l',
    appliesTo: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 15 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

const INTERMEDIATE_HIGH: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'intermediate_products',
  rate: '8.63',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Intermediate products > 15 – 22 %ABV — 8.63 €/l',
    appliesTo: { minAlcoholByVolume: 15, maxAlcoholByVolume: 22 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
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
  taxType: 'excise_duty',
  productCategory: 'other_fermented',
  rate: '0.00',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Other fermented ≤ 1.2 %ABV — exempt',
    appliesTo: { maxAlcoholByVolume: 1.2 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

const OTHER_FERMENTED_BAND_1: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'other_fermented',
  rate: '0.36',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Other fermented > 1.2 – 2.8 %ABV — 0.36 €/l',
    appliesTo: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

const OTHER_FERMENTED_BAND_2: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'other_fermented',
  rate: '1.98',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Other fermented > 2.8 – 5.5 %ABV — 1.98 €/l',
    appliesTo: { minAlcoholByVolume: 2.8, maxAlcoholByVolume: 5.5 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

const OTHER_FERMENTED_BAND_3: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'other_fermented',
  rate: '3.08',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Other fermented > 5.5 – 8 %ABV — 3.08 €/l',
    appliesTo: { minAlcoholByVolume: 5.5, maxAlcoholByVolume: 8 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

const OTHER_FERMENTED_BAND_4: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'other_fermented',
  rate: '4.56',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Other fermented > 8 – 15 %ABV — 4.56 €/l',
    appliesTo: { minAlcoholByVolume: 8, maxAlcoholByVolume: 15 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

const OTHER_FERMENTED_BAND_5: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'other_fermented',
  rate: '4.56',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Other fermented > 15 – 18 %ABV — 4.56 €/l',
    appliesTo: { minAlcoholByVolume: 15, maxAlcoholByVolume: 18 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
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
  taxType: 'container_duty',
  productCategory: 'all_beverages',
  rate: '0.51',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: null,
  calculationFormulaReference: FORMULA_FLAT_PER_LITRE,
  officialSource: SOURCE_VERO_CONTAINER_DUTY,
  verificationDate: VERIFIED_CONTAINER_DUTY,
  versionLabel: VERSION,
};

// ---------------------------------------------------------------------------
// Registry – ordered for deterministic insertion
// ---------------------------------------------------------------------------

const SEED_RULES: TaxRuleSeed[] = [
  // Beer
  BEER_EXEMPT,
  BEER_MID,
  BEER_FULL_RATE,
  BEER_SMALL_BREWERY_RATE,
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
];

// ---------------------------------------------------------------------------
// Seed function
// ---------------------------------------------------------------------------

/**
 * Seed the `taxRules` table with v1.0-2024 Finnish excise duty rates.
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