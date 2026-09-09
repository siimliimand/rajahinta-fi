/**
 * Seed: Finnish import-VAT rate dataset (import-vat-2024.1, import-vat-2024.2).
 *
 * Official source
 * - Value added tax rates: Finnish Tax Administration (Verohallinto)
 *   https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/value-added-tax/vat-rates/
 *   General rate 24 % (since 2013-01-01) → 25.5 % from 2024-09-01.
 *
 * Single source of truth
 * ──────────────────────
 * The rows are DERIVED from the core-domain dataset
 * (`IMPORT_VAT_DATASET` in packages/core-domain/src/vat/import-vat.dataset.ts)
 * — nothing is duplicated here. The rate AND the base composition
 * (retail price + transport + alcohol excise + container duty) live in the
 * versioned dataset, so a legal-base correction is a new dataset version,
 * never an engine change (design D5, alks-feed-and-import-vat).
 *
 * The rows land in `tax_rules` with taxType `import_vat`. The version's
 * `baseComponents` list is embedded in `exemption_conditions` (free-form
 * jsonb; no consumer interprets it as ABV tiers for this tax type) so the
 * seeded row alone explains the base that produced the tax.
 *
 * Rates enter force only through this seed — nothing auto-publishes
 * (project rule). Versions are appended, never mutated (append-only
 * dataset policy, same as tax-rules.seed.ts).
 *
 * @module Seed
 */

import { inArray } from 'drizzle-orm';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { taxRules } from '../index';
import {
  IMPORT_VAT_DATASET,
  IMPORT_VAT_FORMULA,
  IMPORT_VAT_TAX_TYPE,
} from '@rajahinta/core-domain/dist/vat';
import { validateEffectiveRanges } from '../repositories/effective-range-validator';

// ---------------------------------------------------------------------------
// Data — derived, never hand-copied
// ---------------------------------------------------------------------------

/** One `tax_rules` row for an import-VAT dataset version. */
export interface ImportVatSeedRule {
  taxType: string;
  productCategory: string;
  rate: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  exemptionConditions: Record<string, unknown> | null;
  calculationFormulaReference: string;
  officialSource: string;
  verificationDate: Date | null;
  versionLabel: string;
}

/** VAT applies to the whole beverage catalogue, like container duty. */
const PRODUCT_CATEGORY_ALL_BEVERAGES = 'all_beverages';

/** Format a rate percentage as the decimal string `tax_rules.rate` stores. */
function rateString(ratePercent: number): string {
  if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
    throw new Error(`import-VAT rate is not a percentage: ${ratePercent}`);
  }
  return ratePercent.toFixed(2);
}

function toSeedRule(version: (typeof IMPORT_VAT_DATASET)[number]): ImportVatSeedRule {
  return {
    taxType: IMPORT_VAT_TAX_TYPE,
    productCategory: PRODUCT_CATEGORY_ALL_BEVERAGES,
    rate: rateString(version.ratePercent),
    effectiveFrom: version.effectiveFrom,
    effectiveTo: version.effectiveTo,
    // The versioned BASE rule travels with the row (auditability).
    exemptionConditions: { baseComponents: [...version.baseComponents] },
    calculationFormulaReference: IMPORT_VAT_FORMULA,
    officialSource: version.officialSource,
    verificationDate: version.verificationDate,
    versionLabel: version.versionId,
  };
}

/** Import-VAT rows for the `tax_rules` table, one per dataset version. */
export const IMPORT_VAT_SEED_RULES: readonly ImportVatSeedRule[] =
  IMPORT_VAT_DATASET.map(toSeedRule);

// ---------------------------------------------------------------------------
// Seed function
// ---------------------------------------------------------------------------

/**
 * Seed the `taxRules` table with the import-VAT dataset versions.
 *
 * Safe to call multiple times — skips version labels that already exist.
 * Existing rows are never mutated, deleted, or repaired (append-only
 * dataset policy): a correction ships as a new labelled version.
 *
 * @param db — A Postgres.js-dialect Drizzle database instance.
 * @returns `inserted`/`skipped` counts.
 */
export async function seedImportVatRules(
  db: PostgresJsDatabase,
): Promise<{ inserted: number; skipped: number }> {
  const existing = await db
    .select({ versionLabel: taxRules.versionLabel })
    .from(taxRules)
    .where(inArray(taxRules.versionLabel, IMPORT_VAT_SEED_RULES.map((r) => r.versionLabel)));

  const existingLabels = new Set(existing.map((r: { versionLabel: string }) => r.versionLabel));
  const toInsert = IMPORT_VAT_SEED_RULES.filter((r) => !existingLabels.has(r.versionLabel));

  if (toInsert.length === 0) {
    return { inserted: 0, skipped: IMPORT_VAT_SEED_RULES.length };
  }

  await db.insert(taxRules).values(toInsert);

  return { inserted: toInsert.length, skipped: IMPORT_VAT_SEED_RULES.length - toInsert.length };
}

// ---------------------------------------------------------------------------
// Self-check: validate effective-date ranges (no gaps, no overlaps)
// ---------------------------------------------------------------------------

/**
 * Validate that the import-VAT versions form one gapless, non-overlapping
 * timeline. Throws at import time so a malformed dataset fails loudly in
 * tests and seed runs.
 */
(function selfCheckRanges(): void {
  const errors = validateEffectiveRanges(
    IMPORT_VAT_SEED_RULES.map((r) => ({
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
    })),
  );

  if (errors.length > 0) {
    const msg = `IMPORT VAT RANGE VALIDATION FAILED (${errors.length} errors):\n  ${errors.join('\n  ')}`;
    console.error(msg);
    throw new Error(msg);
  }
})();
