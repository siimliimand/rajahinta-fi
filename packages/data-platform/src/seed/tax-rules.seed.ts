/**
 * Seed: initial Finnish excise duty rates (v1.0-2024).
 *
 * Sources
 * - Finnish Tax Administration (Verohallinto) — Alcohol Excise Duty rates
 *   https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-alcohol-and-alcoholic-beverages/
 * - Alcohol Act (1412/1994) and amendments
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
 * Beer excise: progressive by €/hl per degree Plato.
 *
 * Rate schedule (2024):
 *   ≤ 0.5 %ABV  → 0 (not subject to excise)
 *   > 0.5 %ABV  → standard rate €33.00/hl/°Plato
 *
 * Small independent breweries (< 500 000 l/year) receive a reduced
 * rate of €16.50/hl/°Plato on the first 100 000 hl/year, full rate above.
 */
const BEER_FULL_RATE: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'beer',
  rate: '33.00',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Beer ≤ 0.5 %ABV not subject to excise duty',
    appliesTo: { maxAlcoholByVolume: 0.5 },
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
 * Wine excise (still wine) in €/l based on alcohol content.
 *
 * 2024 rates:
 *   ≤ 1.2 %ABV  → 0
 *   1.2–15 %ABV → €3.40/l
 *   15–18 %ABV  → €4.55/l
 */
const WINE_STILL_LOW: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'wine_still',
  rate: '3.40',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Still wine ≤ 1.2 %ABV not subject to excise duty',
    appliesTo: { maxAlcoholByVolume: 1.2 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

const WINE_STILL_HIGH: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'wine_still',
  rate: '4.55',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Still wine > 15 %ABV up to 18 %ABV',
    appliesTo: { minAlcoholByVolume: 15, maxAlcoholByVolume: 18 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

/**
 * Sparkling wine excise in €/l.
 *
 * 2024 rate:
 *   ≤ 1.2 %ABV  → 0
 *   > 1.2 %ABV  → €3.73/l
 */
const WINE_SPARKLING: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'wine_sparkling',
  rate: '3.73',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Sparkling wine ≤ 1.2 %ABV not subject to excise duty',
    appliesTo: { maxAlcoholByVolume: 1.2 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

/**
 * Spirits excise: €/litre of pure alcohol.
 *
 * 2024 rate: €29.50/l of pure alcohol (100 %ABV equivalent at 20 °C).
 * Products < 1.2 %ABV exempt.
 */
const SPIRITS_RATE: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'spirits',
  rate: '29.50',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Spirits < 1.2 %ABV not subject to excise duty',
    appliesTo: { maxAlcoholByVolume: 1.2 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_ALCOHOL,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

/**
 * Intermediate products (e.g. vermouth, fortified wine).
 *
 * 2024 rates:
 *   ≤ 15 %ABV  → €3.40/l
 *   > 15 %ABV  → €4.55/l
 */
const INTERMEDIATE_LOW: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'intermediate_products',
  rate: '3.40',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Intermediate products ≤ 15 %ABV',
    appliesTo: { maxAlcoholByVolume: 15 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

const INTERMEDIATE_HIGH: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'intermediate_products',
  rate: '4.55',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Intermediate products > 15 %ABV up to 22 %ABV',
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
 * 2024 rates:
 *   ≤ 2.8 %ABV  → €0.00 (exempt)
 *   > 2.8 %ABV  → €3.40/l (same as wine)
 */
const OTHER_FERMENTED_LOW: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'other_fermented',
  rate: '0.00',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Other fermented beverages ≤ 2.8 %ABV — exempt',
    appliesTo: { maxAlcoholByVolume: 2.8 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_ALCOHOL,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

const OTHER_FERMENTED_HIGH: TaxRuleSeed = {
  taxType: 'excise_duty',
  productCategory: 'other_fermented',
  rate: '3.40',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: {
    description: 'Other fermented beverages > 2.8 %ABV',
    appliesTo: { minAlcoholByVolume: 2.8 },
  },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_ALCOHOL,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

/**
 * Container duty (pakkausvero) — general flat rate per litre.
 *
 * Applies to all beverage containers imported or manufactured in Finland.
 */
const CONTAINER_DUTY: TaxRuleSeed = {
  taxType: 'container_duty',
  productCategory: 'all_beverages',
  rate: '0.51',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: null,
  calculationFormulaReference: FORMULA_FLAT_PER_LITRE,
  officialSource: SOURCE_VERO_FI,
  verificationDate: VERIFIED_2024_Q1,
  versionLabel: VERSION,
};

// ---------------------------------------------------------------------------
// Registry – ordered for deterministic insertion
// ---------------------------------------------------------------------------

const SEED_RULES: TaxRuleSeed[] = [
  BEER_FULL_RATE,
  BEER_SMALL_BREWERY_RATE,
  WINE_STILL_LOW,
  WINE_STILL_HIGH,
  WINE_SPARKLING,
  SPIRITS_RATE,
  INTERMEDIATE_LOW,
  INTERMEDIATE_HIGH,
  OTHER_FERMENTED_LOW,
  OTHER_FERMENTED_HIGH,
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