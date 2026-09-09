/**
 * Pure calculation functions for Finnish import VAT.
 *
 * No framework or I/O dependencies — deterministic, testable, safe to
 * isolate (mirrors alcohol-excise.math.ts).
 *
 * Rounding rule (binding for every vector in the unit tests): the final
 * cents figure is rounded HALF-UP — a fractional result of exactly .5
 * cents rounds upward. VAT amounts are non-negative, so this matches the
 * `Math.round` HALF-UP convention documented in alcohol-excise.math.ts.
 *
 * @module ImportVatMath
 */

import {
  IMPORT_VAT_DATASET,
  type ImportVatVersion,
  type VatBaseComponent,
  type VatComponentAmounts,
} from './import-vat.dataset';

// ---------------------------------------------------------------------------
// Effective-date resolution
// ---------------------------------------------------------------------------

/**
 * Reduce a timestamp to its UTC calendar day so resolution follows
 * calendar dates, not clock times: a transaction during 2024-08-31
 * resolves the old version; any time on 2024-09-01 resolves the new one.
 */
function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Resolve the dataset version effective on `asOf`.
 *
 * `effectiveFrom` is inclusive and `effectiveTo` names the last inclusive
 * day, mirroring the tax-rule seed pairing where a version ends the day
 * before its successor starts. Windows never overlap, so at most one
 * version matches; array order is irrelevant to the outcome.
 *
 * @param asOf     Calculation date (any time of day).
 * @param dataset  Version list; defaults to the seeded dataset. Tests for
 *                 version stability pass extended copies here.
 * @returns The effective version.
 * @throws RangeError when no version is effective on the date — never a
 *         silent plausible rate.
 */
export function resolveImportVatVersion(
  asOf: Date,
  dataset: readonly ImportVatVersion[] = IMPORT_VAT_DATASET,
): ImportVatVersion {
  const day = utcDay(asOf);
  for (const version of dataset) {
    const from = utcDay(version.effectiveFrom);
    const to = version.effectiveTo === null ? Infinity : utcDay(version.effectiveTo);
    if (day >= from && day <= to) {
      return version;
    }
  }
  throw new RangeError(
    `No import-VAT dataset version is effective on ${asOf.toISOString()}; ` +
      `seeded coverage starts at ${dataset[0]?.effectiveFrom.toISOString() ?? 'n/a'}`,
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Money inputs must be whole euro-cents — never fractions, never negative. */
function validateCents(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer (cents), got ${value}`);
  }
}

/** Validate a rate percentage (0–100 inclusive). */
function validateRate(ratePercent: number): void {
  if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
    throw new RangeError(`ratePercent must be between 0 and 100, got ${ratePercent}`);
  }
}

// ---------------------------------------------------------------------------
// Base composition
// ---------------------------------------------------------------------------

/** One named base component with its own amount — the traceability unit. */
export interface VatBaseComponentAmount {
  readonly component: VatBaseComponent;
  readonly amountCents: number;
}

/**
 * Sum the base from exactly the components the version's rule names, in
 * the rule's order. Components outside the rule are excluded from the sum
 * — that exclusion is how a legal-base change behaves without code edits.
 *
 * @returns The named breakdown plus the base total in euro-cents.
 */
export function sumBaseComponents(
  rule: readonly VatBaseComponent[],
  amounts: VatComponentAmounts,
): { breakdown: VatBaseComponentAmount[]; baseCents: number } {
  const breakdown: VatBaseComponentAmount[] = [];
  let baseCents = 0;
  for (const component of rule) {
    const amountCents = amounts[component];
    validateCents(amountCents, `base component "${component}"`);
    breakdown.push({ component, amountCents });
    baseCents += amountCents;
  }
  return { breakdown, baseCents };
}

// ---------------------------------------------------------------------------
// Rate application
// ---------------------------------------------------------------------------

/**
 * Apply the rate percentage to a base and round HALF-UP to whole cents.
 * `baseCents * ratePercent` stays far below 2^53 for realistic amounts, so
 * the product is exact and the only rounding step is the final one.
 *
 * @param baseCents    Base amount in whole euro-cents.
 * @param ratePercent  Rate as a percentage (24, 25.5, …).
 * @returns VAT amount in whole euro-cents.
 */
export function calculateImportVat(baseCents: number, ratePercent: number): number {
  validateCents(baseCents, 'baseCents');
  validateRate(ratePercent);
  return Math.round((baseCents * ratePercent) / 100);
}
