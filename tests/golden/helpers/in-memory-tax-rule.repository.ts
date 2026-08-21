/**
 * In-memory tax rule repository seeded with golden-data rates.
 *
 * This is NOT a mock — it is a plain implementation of
 * {@link ITaxRuleRepositoryPort} that returns real rate data matching the
 * official Finnish Tax Administration values (v1.0-2024).
 *
 * Rates sourced from:
 *   https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-alcohol-and-alcoholic-beverages/
 *   https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/alkoholijuomavero/alkoholi-ja-alkoholijuomaverotaulukko/
 *   https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-beverage-containers/
 *
 * Golden tests use this instead of null stubs so they exercise the seeded-data
 * code path, not the fallback path.
 *
 * The taxType values here match what the services query:
 * - {@link AlcoholExciseService} calls {@code findAllApplicable('excise', …)}
 * - {@link ContainerDutyService} calls {@code findApplicable('container_duty', …)}
 *
 * @version 2.0 — aligned with v1.0-2024 of the official seed
 *   (packages/data-platform/src/seed/tax-rules.seed.ts)
 *
 * @module InMemoryTaxRuleRepository
 */

import type {
  ITaxRuleRepositoryPort,
  TaxRuleRecordPort,
} from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Seed data — official Finnish Tax Administration rates v1.0-2024
// ---------------------------------------------------------------------------

const VERIFIED_DATE = new Date('2024-03-01');
const EFFECTIVE_FROM = new Date('2024-01-01');
const VERSION = 'v1.0-2024';
const SOURCE =
  'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)';
const CONTAINER_SOURCE =
  'Finnish Tax Administration — Beverage Container Duty Rate 2024 (vero.fi)';

// ─────────────────────────────────────────────────────────────────────────────
// Beer — progressive bands in snt/cl ethanol
//
//   ≤ 0.5 %ABV  → 0.00 snt/cl ethanol (exempt)
//   > 0.5 – 3.5 %ABV  → 28.35 snt/cl ethanol
//   > 3.5 %ABV  → 36.20 snt/cl ethanol
//
// Small-brewery relief (pienpanimoalennus) is NOT seeded: the official
// vero.fi scheme is a progressive 10–50 % discount by annual production
// (ceiling 15 000 000 l/year; HE 106/2024). The current rule evaluator
// cannot express production-volume tiers, so only the general rate is
// shipped. Small-brewery treatment is documented as UNAVAILABLE pending
// Phase 2 evaluator support.
//
// Formula: rate(snt/cl) × abv × volumeLitres → euro-cents (Math.round)
// ─────────────────────────────────────────────────────────────────────────────

const BEER_EXEMPT: TaxRuleRecordPort = {
  id: 1,
  taxType: 'excise',
  productCategory: 'beer',
  rate: '0.00',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_DEGREE_PLATO',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { maxAlcoholByVolume: 0.5 },
};

const BEER_MID: TaxRuleRecordPort = {
  id: 101,
  taxType: 'excise',
  productCategory: 'beer',
  rate: '28.35',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_DEGREE_PLATO',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { minAlcoholByVolume: 0.5, maxAlcoholByVolume: 3.5 },
};

const BEER_FULL: TaxRuleRecordPort = {
  id: 102,
  taxType: 'excise',
  productCategory: 'beer',
  rate: '36.20',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_DEGREE_PLATO',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { minAlcoholByVolume: 3.5 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Still wine — six bands per litre of product
//
//   ≤ 1.2 %ABV   → 0.00 €/l (exempt)
//   > 1.2 – 2.8  → 0.36 €/l
//   > 2.8 – 5.5  → 1.98 €/l
//   > 5.5 – 8    → 3.08 €/l
//   > 8 – 15     → 4.56 €/l
//   > 15 – 18    → 4.56 €/l
//
// Formula: rate(€/l) × volumeLitres → euro-cents (Math.round)
// ─────────────────────────────────────────────────────────────────────────────

const WINE_EXEMPT: TaxRuleRecordPort = {
  id: 2,
  taxType: 'excise',
  productCategory: 'wine_still',
  rate: '0.00',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_LITRE_OF_PRODUCT',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { maxAlcoholByVolume: 1.2 },
};

const WINE_BAND_1: TaxRuleRecordPort = {
  id: 3,
  taxType: 'excise',
  productCategory: 'wine_still',
  rate: '0.36',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_LITRE_OF_PRODUCT',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 },
};

const WINE_BAND_2: TaxRuleRecordPort = {
  id: 4,
  taxType: 'excise',
  productCategory: 'wine_still',
  rate: '1.98',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_LITRE_OF_PRODUCT',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { minAlcoholByVolume: 2.8, maxAlcoholByVolume: 5.5 },
};

const WINE_BAND_3: TaxRuleRecordPort = {
  id: 5,
  taxType: 'excise',
  productCategory: 'wine_still',
  rate: '3.08',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_LITRE_OF_PRODUCT',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { minAlcoholByVolume: 5.5, maxAlcoholByVolume: 8 },
};

const WINE_BAND_4: TaxRuleRecordPort = {
  id: 6,
  taxType: 'excise',
  productCategory: 'wine_still',
  rate: '4.56',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_LITRE_OF_PRODUCT',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { minAlcoholByVolume: 8, maxAlcoholByVolume: 15 },
};

const WINE_BAND_5: TaxRuleRecordPort = {
  id: 7,
  taxType: 'excise',
  productCategory: 'wine_still',
  rate: '4.56',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_LITRE_OF_PRODUCT',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { minAlcoholByVolume: 15, maxAlcoholByVolume: 18 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Sparkling wine — same band structure and rates as still wine
// ─────────────────────────────────────────────────────────────────────────────

const SPARKLING_EXEMPT: TaxRuleRecordPort = {
  ...WINE_EXEMPT,
  id: 8,
  productCategory: 'wine_sparkling',
};
const SPARKLING_BAND_1: TaxRuleRecordPort = {
  ...WINE_BAND_1,
  id: 9,
  productCategory: 'wine_sparkling',
};
const SPARKLING_BAND_2: TaxRuleRecordPort = {
  ...WINE_BAND_2,
  id: 10,
  productCategory: 'wine_sparkling',
};
const SPARKLING_BAND_3: TaxRuleRecordPort = {
  ...WINE_BAND_3,
  id: 11,
  productCategory: 'wine_sparkling',
};
const SPARKLING_BAND_4: TaxRuleRecordPort = {
  ...WINE_BAND_4,
  id: 12,
  productCategory: 'wine_sparkling',
};
const SPARKLING_BAND_5: TaxRuleRecordPort = {
  ...WINE_BAND_5,
  id: 13,
  productCategory: 'wine_sparkling',
};

// ─────────────────────────────────────────────────────────────────────────────
// Spirits — bands in €/l of pure alcohol (== snt/cl ethanol)
//
//   ≤ 1.2 %ABV    → 0.00 €/l (exempt)
//   > 1.2 – 2.8   → 30.90 €/l pure alcohol
//   > 2.8 %ABV    → 54.80 €/l pure alcohol
//
// Formula: rate(€/l) × abv × volumeLitres → euro-cents
// ─────────────────────────────────────────────────────────────────────────────

const SPIRITS_EXEMPT: TaxRuleRecordPort = {
  id: 14,
  taxType: 'excise',
  productCategory: 'spirits',
  rate: '0.00',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_LITRE_OF_ALCOHOL',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { maxAlcoholByVolume: 1.2 },
};

const SPIRITS_MID: TaxRuleRecordPort = {
  id: 15,
  taxType: 'excise',
  productCategory: 'spirits',
  rate: '30.90',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_LITRE_OF_ALCOHOL',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 },
};

const SPIRITS_FULL: TaxRuleRecordPort = {
  id: 16,
  taxType: 'excise',
  productCategory: 'spirits',
  rate: '54.80',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_LITRE_OF_ALCOHOL',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { minAlcoholByVolume: 2.8 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Intermediate products — per litre of product
//
//   > 1.2 – 15 %ABV  → 5.68 €/l
//   > 15 – 22 %ABV   → 8.63 €/l
//
// Formula: rate(€/l) × volumeLitres → euro-cents
// ─────────────────────────────────────────────────────────────────────────────

const INTERMEDIATE_LOW: TaxRuleRecordPort = {
  id: 17,
  taxType: 'excise',
  productCategory: 'intermediate_products',
  rate: '5.68',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_LITRE_OF_PRODUCT',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 15 },
};

const INTERMEDIATE_HIGH: TaxRuleRecordPort = {
  id: 18,
  taxType: 'excise',
  productCategory: 'intermediate_products',
  rate: '8.63',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_LITRE_OF_PRODUCT',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { minAlcoholByVolume: 15, maxAlcoholByVolume: 22 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Other fermented — same band structure and rates as wine (per litre of product)
//
//   ≤ 1.2 %ABV      → 0.00 €/l (exempt)
//   > 1.2 – 2.8     → 0.36 €/l
//   > 2.8 – 5.5     → 1.98 €/l
//   > 5.5 – 8       → 3.08 €/l
//   > 8 – 15        → 4.56 €/l
//   > 15 – 18       → 4.56 €/l
//
// NOTE: The engine's resolveOtherFermentedFormula may override the formula
// reference to PER_LITRE_OF_ALCOHOL for non-cider subtypes (e.g. 'other').
// The rates below are stored as-published (PER_LITRE_OF_PRODUCT) in the
// repository; the sub-type dispatch happens in AlcoholExciseService.
// ─────────────────────────────────────────────────────────────────────────────

const OTHER_EXEMPT: TaxRuleRecordPort = {
  id: 19,
  taxType: 'excise',
  productCategory: 'other_fermented',
  rate: '0.00',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_LITRE_OF_PRODUCT',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { maxAlcoholByVolume: 1.2 },
};

const OTHER_BAND_1: TaxRuleRecordPort = {
  id: 20,
  taxType: 'excise',
  productCategory: 'other_fermented',
  rate: '0.36',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_LITRE_OF_PRODUCT',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { minAlcoholByVolume: 1.2, maxAlcoholByVolume: 2.8 },
};

const OTHER_BAND_2: TaxRuleRecordPort = {
  id: 21,
  taxType: 'excise',
  productCategory: 'other_fermented',
  rate: '1.98',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_LITRE_OF_PRODUCT',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { minAlcoholByVolume: 2.8, maxAlcoholByVolume: 5.5 },
};

const OTHER_BAND_3: TaxRuleRecordPort = {
  id: 22,
  taxType: 'excise',
  productCategory: 'other_fermented',
  rate: '3.08',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_LITRE_OF_PRODUCT',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { minAlcoholByVolume: 5.5, maxAlcoholByVolume: 8 },
};

const OTHER_BAND_4: TaxRuleRecordPort = {
  id: 23,
  taxType: 'excise',
  productCategory: 'other_fermented',
  rate: '4.56',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_LITRE_OF_PRODUCT',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { minAlcoholByVolume: 8, maxAlcoholByVolume: 15 },
};

const OTHER_BAND_5: TaxRuleRecordPort = {
  id: 24,
  taxType: 'excise',
  productCategory: 'other_fermented',
  rate: '4.56',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_LITRE_OF_PRODUCT',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { minAlcoholByVolume: 15, maxAlcoholByVolume: 18 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Container duty — flat rate per litre
//
//   All containers (unless deposit-return-exempted): 0.51 €/l
//
// Formula: rate(€/l) × volumeLitres → euro-cents (Math.round)
// Source: https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-beverage-containers/
// ─────────────────────────────────────────────────────────────────────────────

const CONTAINER_DUTY: TaxRuleRecordPort = {
  id: 25,
  taxType: 'container_duty',
  productCategory: 'all_beverages',
  rate: '0.51',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'FLAT_PER_LITRE',
  officialSource: CONTAINER_SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: null,
};

// ---------------------------------------------------------------------------
// Full seed registry — ordered by category for deterministic iteration
// ---------------------------------------------------------------------------

const SEED_RULES: TaxRuleRecordPort[] = [
  // Beer
  BEER_EXEMPT,
  BEER_MID,
  BEER_FULL,

  // Wine (still)
  WINE_EXEMPT,
  WINE_BAND_1,
  WINE_BAND_2,
  WINE_BAND_3,
  WINE_BAND_4,
  WINE_BAND_5,

  // Wine (sparkling)
  SPARKLING_EXEMPT,
  SPARKLING_BAND_1,
  SPARKLING_BAND_2,
  SPARKLING_BAND_3,
  SPARKLING_BAND_4,
  SPARKLING_BAND_5,

  // Intermediate products
  INTERMEDIATE_LOW,
  INTERMEDIATE_HIGH,

  // Spirits
  SPIRITS_EXEMPT,
  SPIRITS_MID,
  SPIRITS_FULL,

  // Other fermented
  OTHER_EXEMPT,
  OTHER_BAND_1,
  OTHER_BAND_2,
  OTHER_BAND_3,
  OTHER_BAND_4,
  OTHER_BAND_5,

  // Container duty
  CONTAINER_DUTY,
];

// ---------------------------------------------------------------------------
// In-memory repository
// ---------------------------------------------------------------------------

export class InMemoryTaxRuleRepository implements ITaxRuleRepositoryPort {
  async findApplicable(
    taxType: string,
    productCategory: string,
    _asOf: Date,
  ): Promise<TaxRuleRecordPort | null> {
    // Prefer exact match on both taxType and productCategory
    const exact = SEED_RULES.find(
      (r) => r.taxType === taxType && r.productCategory === productCategory,
    );
    if (exact) return exact;

    // Fallback: any rule for this taxType (e.g. container_duty + unknown category)
    return SEED_RULES.find((r) => r.taxType === taxType) ?? null;
  }

  async findAllApplicable(
    taxType: string,
    productCategory: string,
    _asOf: Date,
  ): Promise<TaxRuleRecordPort[]> {
    return SEED_RULES.filter(
      (r) => r.taxType === taxType && r.productCategory === productCategory,
    );
  }

  async findHistoryRates(
    taxType: string,
    productCategory: string,
    _fromDate: Date,
    _toDate: Date,
  ): Promise<TaxRuleRecordPort[]> {
    return SEED_RULES.filter(
      (r) => r.taxType === taxType && r.productCategory === productCategory,
    );
  }

  async findActiveVersionLabels(): Promise<readonly string[]> {
    const now = new Date();
    const labels = SEED_RULES
      .filter(
        (r) =>
          r.effectiveFrom <= now &&
          (r.effectiveTo === null || r.effectiveTo > now),
      )
      .map((r) => r.versionLabel);
    return [...new Set(labels)];
  }
}