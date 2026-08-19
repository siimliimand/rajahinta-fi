/**
 * In-memory tax rule repository seeded with golden-data rates.
 *
 * This is NOT a mock — it is a plain implementation of
 * {@link ITaxRuleRepositoryPort} that returns real rate data matching the
 * official seed values.  Golden tests use this instead of null stubs so they
 * exercise the seeded-data code path, not the fallback path.
 *
 * The taxType values here match what the services query:
 * - {@link AlcoholExciseService} calls {@code findAllApplicable('excise', …)}
 * - {@link ContainerDutyService} calls {@code findApplicable('container_duty', …)}
 *
 * @module InMemoryTaxRuleRepository
 */

import type {
  ITaxRuleRepositoryPort,
  TaxRuleRecordPort,
} from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Seed data — matches packages/data-platform/src/seed/tax-rules.seed.ts
// ---------------------------------------------------------------------------

const VERIFIED_DATE = new Date('2024-03-01');
const EFFECTIVE_FROM = new Date('2024-01-01');
const VERSION = 'v1.0-2024';
const SOURCE =
  'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)';

/**
 * Canonical seed rules keyed by (taxType, productCategory).
 *
 * For categories with ABV-tier variants (wine_still, other_fermented,
 * intermediate_products) ALL active rules are stored so that
 * {@link findAllApplicable} returns them and the
 * {@link AlcoholExciseService.findMatchingRule} can select the correct tier.
 */
const SEED_RULES: TaxRuleRecordPort[] = [
  // ---- Beer ----
  // Exempt rule: ABV ≤ 0.5 → rate 0.00
  {
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
    exemptionConditions: {
      maxAlcoholByVolume: 0.5,
    },
  },
  // Full rate: ABV > 0.5 → rate 33.00 (€/hl per degree Plato)
  {
    id: 101,
    taxType: 'excise',
    productCategory: 'beer',
    rate: '33.00',
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    calculationFormulaReference: 'PER_DEGREE_PLATO',
    officialSource: SOURCE,
    verificationDate: VERIFIED_DATE,
    versionLabel: VERSION,
    exemptionConditions: {
      minAlcoholByVolume: 0.5,
    },
  },
  {
    id: 2,
    taxType: 'excise',
    productCategory: 'beer',
    rate: '16.50',
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    calculationFormulaReference: 'PER_DEGREE_PLATO',
    officialSource: SOURCE,
    verificationDate: VERIFIED_DATE,
    versionLabel: VERSION,
    exemptionConditions: {
      maxAnnualProductionHl: 100_000,
      breweryType: 'independent_small',
    },
  },

  // ---- Still wine ----
  // Exempt tier: ABV ≤ 1.2 → rate 0.00
  {
    id: 3,
    taxType: 'excise',
    productCategory: 'wine_still',
    rate: '0.00',
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    calculationFormulaReference: 'PER_LITRE_OF_PRODUCT',
    officialSource: SOURCE,
    verificationDate: VERIFIED_DATE,
    versionLabel: VERSION,
    exemptionConditions: {
      maxAlcoholByVolume: 1.2,
    },
  },
  {
    id: 4,
    taxType: 'excise',
    productCategory: 'wine_still',
    rate: '3.40',
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    calculationFormulaReference: 'PER_LITRE_OF_PRODUCT',
    officialSource: SOURCE,
    verificationDate: VERIFIED_DATE,
    versionLabel: VERSION,
    exemptionConditions: {
      minAlcoholByVolume: 1.2,
      maxAlcoholByVolume: 15,
    },
  },
  {
    id: 5,
    taxType: 'excise',
    productCategory: 'wine_still',
    rate: '4.55',
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    calculationFormulaReference: 'PER_LITRE_OF_PRODUCT',
    officialSource: SOURCE,
    verificationDate: VERIFIED_DATE,
    versionLabel: VERSION,
    exemptionConditions: {
      minAlcoholByVolume: 15,
      maxAlcoholByVolume: 18,
    },
  },

  // ---- Sparkling wine ----
  // Exempt tier: ABV ≤ 1.2 → rate 0.00
  {
    id: 6,
    taxType: 'excise',
    productCategory: 'wine_sparkling',
    rate: '0.00',
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    calculationFormulaReference: 'PER_LITRE_OF_PRODUCT',
    officialSource: SOURCE,
    verificationDate: VERIFIED_DATE,
    versionLabel: VERSION,
    exemptionConditions: {
      maxAlcoholByVolume: 1.2,
    },
  },
  // Full rate: ABV > 1.2 → rate 3.73
  {
    id: 102,
    taxType: 'excise',
    productCategory: 'wine_sparkling',
    rate: '3.73',
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    calculationFormulaReference: 'PER_LITRE_OF_PRODUCT',
    officialSource: SOURCE,
    verificationDate: VERIFIED_DATE,
    versionLabel: VERSION,
    exemptionConditions: {
      minAlcoholByVolume: 1.2,
    },
  },

  // ---- Spirits ----
  // Exempt tier: ABV ≤ 1.2 → rate 0.00
  {
    id: 7,
    taxType: 'excise',
    productCategory: 'spirits',
    rate: '0.00',
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    calculationFormulaReference: 'PER_LITRE_OF_ALCOHOL',
    officialSource: SOURCE,
    verificationDate: VERIFIED_DATE,
    versionLabel: VERSION,
    exemptionConditions: {
      maxAlcoholByVolume: 1.2,
    },
  },
  // Full rate: ABV > 1.2 → rate 29.50 / L of pure alcohol
  {
    id: 103,
    taxType: 'excise',
    productCategory: 'spirits',
    rate: '29.50',
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    calculationFormulaReference: 'PER_LITRE_OF_ALCOHOL',
    officialSource: SOURCE,
    verificationDate: VERIFIED_DATE,
    versionLabel: VERSION,
    exemptionConditions: {
      minAlcoholByVolume: 1.2,
    },
  },

  // ---- Intermediate products ----
  // Low tier: ABV 0–15 → rate 3.40 / L
  {
    id: 8,
    taxType: 'excise',
    productCategory: 'intermediate_products',
    rate: '3.40',
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    calculationFormulaReference: 'PER_LITRE_OF_PRODUCT',
    officialSource: SOURCE,
    verificationDate: VERIFIED_DATE,
    versionLabel: VERSION,
    exemptionConditions: {
      minAlcoholByVolume: 0,
      maxAlcoholByVolume: 15,
    },
  },
  {
    id: 9,
    taxType: 'excise',
    productCategory: 'intermediate_products',
    rate: '4.55',
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    calculationFormulaReference: 'PER_LITRE_OF_PRODUCT',
    officialSource: SOURCE,
    verificationDate: VERIFIED_DATE,
    versionLabel: VERSION,
    exemptionConditions: {
      minAlcoholByVolume: 15,
      maxAlcoholByVolume: 22,
    },
  },

  // ---- Other fermented ----
  {
    id: 10,
    taxType: 'excise',
    productCategory: 'other_fermented',
    rate: '0.00',
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    calculationFormulaReference: 'PER_LITRE_OF_ALCOHOL',
    officialSource: SOURCE,
    verificationDate: VERIFIED_DATE,
    versionLabel: VERSION,
    exemptionConditions: {
      maxAlcoholByVolume: 2.8,
    },
  },
  {
    id: 11,
    taxType: 'excise',
    productCategory: 'other_fermented',
    rate: '3.40',
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    calculationFormulaReference: 'PER_LITRE_OF_ALCOHOL',
    officialSource: SOURCE,
    verificationDate: VERIFIED_DATE,
    versionLabel: VERSION,
    exemptionConditions: {
      minAlcoholByVolume: 2.8,
    },
  },

  // ---- Container duty ----
  {
    id: 12,
    taxType: 'container_duty',
    productCategory: 'all_beverages',
    rate: '0.51',
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    calculationFormulaReference: 'FLAT_PER_LITRE',
    officialSource: SOURCE,
    verificationDate: VERIFIED_DATE,
    versionLabel: VERSION,
    exemptionConditions: null,
  },
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