/**
 * Versioned import-VAT rate dataset for Finnish import VAT.
 *
 * This dataset is the single source of truth for import-VAT rates and for
 * the VAT BASE composition. Both live here — not in engine code — so a
 * legal-base correction (design D5, alks-feed-and-import-vat) is a dataset
 * change: append a new version with the corrected component list, never an
 * edit to the calculation engine.
 *
 * Versions enter force only through the seeded dataset
 * (packages/data-platform/src/seed/import-vat-rules.seed.ts materialises
 * these rows into `tax_rules`). Nothing auto-publishes: a new version is
 * reviewed by humans before it is added to this file (project rule).
 *
 * Past calculations keep resolving against the version effective on their
 * date — effective windows are immutable once a version is seeded.
 *
 * @module ImportVatDataset
 */

// ---------------------------------------------------------------------------
// Tax-type / formula discriminators
// ---------------------------------------------------------------------------

/**
 * `taxType` column value used for import-VAT rows in `tax_rules`.
 *
 * Defined here rather than in `tax-categories.ts` because the VAT subdomain
 * owns its discriminator; the excise engines never query this type.
 */
export const IMPORT_VAT_TAX_TYPE = 'import_vat';

/**
 * Formula reference stored in `tax_rules.calculationFormulaReference`:
 * the rate is a percentage applied to the versioned base composition.
 */
export const IMPORT_VAT_FORMULA = 'PERCENT_OF_BASE';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Named components that can appear in an import-VAT base. */
export type VatBaseComponent =
  | 'retailPrice'
  | 'transport'
  | 'alcoholExcise'
  | 'containerDuty';

/** All components the calculator can supply, keyed for lookup. */
export type VatComponentAmounts = Readonly<Record<VatBaseComponent, number>>;

/** One versioned import-VAT dataset entry. */
export interface ImportVatVersion {
  /** Stable version identity — joins results, cache keys, and seed rows. */
  readonly versionId: string;
  /** Rate as a percentage of the base (e.g. 25.5 for 25.5 %). */
  readonly ratePercent: number;
  /** First day (UTC) the version is effective, inclusive. */
  readonly effectiveFrom: Date;
  /**
   * Last day (UTC) the version is effective, inclusive; null = open-ended.
   * The inclusive-day convention matches the tax-rule seed pairing
   * (a version ends the day before its successor starts).
   */
  readonly effectiveTo: Date | null;
  /**
   * The base composition for THIS version, in summation order — the legal
   * base as a versioned rule. A base correction ships a new version with a
   * different list, never an engine change.
   */
  readonly baseComponents: readonly VatBaseComponent[];
  /** Authoritative publication reference — "every number is explainable". */
  readonly officialSource: string;
  /** When the version was human/legal-confirmed; null → ESTIMATED results. */
  readonly verificationDate: Date | null;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/** Official source reference for Finnish VAT rates (vero.fi). */
const SOURCE_VERO_FI_VAT =
  'Finnish Tax Administration — Value added tax rates (vero.fi)';

/**
 * 24 % general rate — Finland's general VAT rate since 2013-01-01, so
 * historical calculations resolve it for their dates. Closed at
 * 2024-08-31: the successor version took effect the next day.
 */
export const IMPORT_VAT_VERSION_V1: ImportVatVersion = {
  versionId: 'import-vat-2024.1',
  ratePercent: 24,
  effectiveFrom: new Date('2013-01-01'),
  effectiveTo: new Date('2024-08-31'),
  baseComponents: ['retailPrice', 'transport', 'alcoholExcise', 'containerDuty'],
  officialSource: SOURCE_VERO_FI_VAT,
  verificationDate: new Date('2024-03-01'),
};

/**
 * 25.5 % general rate — in force from 2024-09-01 (Finnish general VAT
 * increase). Open-ended until a successor version is lawfully seeded.
 */
export const IMPORT_VAT_VERSION_V2: ImportVatVersion = {
  versionId: 'import-vat-2024.2',
  ratePercent: 25.5,
  effectiveFrom: new Date('2024-09-01'),
  effectiveTo: null,
  baseComponents: ['retailPrice', 'transport', 'alcoholExcise', 'containerDuty'],
  officialSource: SOURCE_VERO_FI_VAT,
  verificationDate: new Date('2024-08-21'),
};

/**
 * The versioned dataset, ordered by `effectiveFrom` ascending. Windows are
 * gapless and non-overlapping (self-checked by the seed and the unit tests),
 * so at most one version matches any date.
 */
export const IMPORT_VAT_DATASET: readonly ImportVatVersion[] = [
  IMPORT_VAT_VERSION_V1,
  IMPORT_VAT_VERSION_V2,
];
