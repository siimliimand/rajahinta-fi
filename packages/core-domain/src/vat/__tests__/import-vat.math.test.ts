/**
 * Tests for import-VAT pure calculation functions.
 *
 * HIGH-LIABILITY code paths — every vector below is an exact cent value,
 * computed by hand, not derived from the implementation.
 *
 * Pinned behaviour:
 * 1. Effective-date resolution (spec scenarios): 2024-08-15 → 24 % (v1),
 *    2024-09-15 → 25.5 % (v2).
 * 2. Rounding: HALF-UP on the final cents figure (e.g. 25.5 % of 100 cents
 *    = 25.5 → 26).
 * 3. Base composition is a dataset rule: the version's component list
 *    decides what sums, never engine code.
 * 4. Version stability: appending a future version does not change
 *    past-date resolution.
 */
import { describe, it, expect } from 'vitest';
import {
  IMPORT_VAT_DATASET,
  IMPORT_VAT_VERSION_V1,
  IMPORT_VAT_VERSION_V2,
  type ImportVatVersion,
  type VatComponentAmounts,
} from '../import-vat.dataset';
import {
  calculateImportVat,
  resolveImportVatVersion,
  sumBaseComponents,
} from '../import-vat.math';

// ---------------------------------------------------------------------------
// Effective-date resolution
// ---------------------------------------------------------------------------

describe('resolveImportVatVersion', () => {
  it('resolves 24 % from v1 for a calculation dated 2024-08-15', () => {
    const version = resolveImportVatVersion(new Date('2024-08-15'));
    expect(version.versionId).toBe('import-vat-2024.1');
    expect(version.ratePercent).toBe(24);
  });

  it('resolves 25.5 % from v2 for a calculation dated 2024-09-15', () => {
    const version = resolveImportVatVersion(new Date('2024-09-15'));
    expect(version.versionId).toBe('import-vat-2024.2');
    expect(version.ratePercent).toBe(25.5);
  });

  it('keeps the old version through the last day: 2024-08-31T23:59:59.999Z → v1', () => {
    const version = resolveImportVatVersion(new Date('2024-08-31T23:59:59.999Z'));
    expect(version.versionId).toBe('import-vat-2024.1');
  });

  it('switches at the successor boundary: 2024-09-01T00:00:00Z → v2', () => {
    const version = resolveImportVatVersion(new Date('2024-09-01T00:00:00.000Z'));
    expect(version.versionId).toBe('import-vat-2024.2');
  });

  it('resolves v1 for pre-change history (2015-06-01) — past coverage holds', () => {
    const version = resolveImportVatVersion(new Date('2015-06-01'));
    expect(version.versionId).toBe('import-vat-2024.1');
    expect(version.ratePercent).toBe(24);
  });

  it('throws when no version covers the date (before 2013)', () => {
    expect(() => resolveImportVatVersion(new Date('2012-12-31'))).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Rounding — HALF-UP on the final cents figure
// ---------------------------------------------------------------------------

describe('calculateImportVat rounding vectors', () => {
  it('24 % of 10000 cents = 2400 (exact)', () => {
    expect(calculateImportVat(10000, 24)).toBe(2400);
  });

  it('25.5 % of 10000 cents = 2550 (exact)', () => {
    expect(calculateImportVat(10000, 25.5)).toBe(2550);
  });

  it('24 % of 12345 cents = 2963 (2962.8 rounds up)', () => {
    expect(calculateImportVat(12345, 24)).toBe(2963);
  });

  it('25.5 % of 100 cents = 26 (25.5 → half-up boundary)', () => {
    expect(calculateImportVat(100, 25.5)).toBe(26);
  });

  it('25.5 % of 2500 cents = 638 (637.5 → half-up boundary)', () => {
    expect(calculateImportVat(2500, 25.5)).toBe(638);
  });

  it('25.5 % of 10 cents = 3 (2.55 rounds up)', () => {
    expect(calculateImportVat(10, 25.5)).toBe(3);
  });

  it('24 % of 50 cents = 12 (exact, no drift)', () => {
    expect(calculateImportVat(50, 24)).toBe(12);
  });

  it('0 base → 0 VAT', () => {
    expect(calculateImportVat(0, 24)).toBe(0);
    expect(calculateImportVat(0, 25.5)).toBe(0);
  });

  it('throws on negative or fractional cents', () => {
    expect(() => calculateImportVat(-1, 24)).toThrow(RangeError);
    expect(() => calculateImportVat(100.5, 24)).toThrow(RangeError);
  });

  it('throws on out-of-range rates', () => {
    expect(() => calculateImportVat(100, -0.5)).toThrow(RangeError);
    expect(() => calculateImportVat(100, 100.5)).toThrow(RangeError);
    expect(() => calculateImportVat(100, NaN)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Base composition — a versioned rule, not code
// ---------------------------------------------------------------------------

const FULL_AMOUNTS: VatComponentAmounts = {
  retailPrice: 1990,
  transport: 590,
  alcoholExcise: 560,
  containerDuty: 20,
};

describe('sumBaseComponents', () => {
  it('sums exactly the v1 rule components, in rule order', () => {
    const { breakdown, baseCents } = sumBaseComponents(
      IMPORT_VAT_VERSION_V1.baseComponents,
      FULL_AMOUNTS,
    );
    expect(breakdown).toEqual([
      { component: 'retailPrice', amountCents: 1990 },
      { component: 'transport', amountCents: 590 },
      { component: 'alcoholExcise', amountCents: 560 },
      { component: 'containerDuty', amountCents: 20 },
    ]);
    expect(baseCents).toBe(3160);
  });

  it('excludes a component dropped by a version rule — dataset change, not code', () => {
    const ruleWithoutContainerDuty = ['retailPrice', 'transport', 'alcoholExcise'] as const;
    const { breakdown, baseCents } = sumBaseComponents(
      ruleWithoutContainerDuty,
      FULL_AMOUNTS,
    );
    expect(breakdown).toHaveLength(3);
    expect(baseCents).toBe(3140);
  });

  it('throws when a rule component has no valid amount', () => {
    const missing = { ...FULL_AMOUNTS, transport: -5 };
    expect(() => sumBaseComponents(IMPORT_VAT_VERSION_V1.baseComponents, missing)).toThrow(
      RangeError,
    );
  });
});

// ---------------------------------------------------------------------------
// Version stability — future versions never rewrite the past
// ---------------------------------------------------------------------------

/** A hypothetical future v3 (26 % from 2026-01-01), closing v2's window. */
const FUTURE_V3: ImportVatVersion = {
  versionId: 'import-vat-2026.1',
  ratePercent: 26,
  effectiveFrom: new Date('2026-01-01'),
  effectiveTo: null,
  baseComponents: ['retailPrice', 'transport', 'alcoholExcise', 'containerDuty'],
  officialSource: 'test-fixture',
  verificationDate: new Date('2025-12-01'),
};

/** v2 as it must be restated when a successor is appended: closed at 2025-12-31. */
const V2_CLOSED: ImportVatVersion = {
  ...IMPORT_VAT_VERSION_V2,
  effectiveTo: new Date('2025-12-31'),
};

describe('version stability', () => {
  const datasetWithFuture = [IMPORT_VAT_VERSION_V1, V2_CLOSED, FUTURE_V3];

  it('2024-08-15 still resolves 24 % from v1 after a future version is seeded', () => {
    const version = resolveImportVatVersion(new Date('2024-08-15'), datasetWithFuture);
    expect(version.versionId).toBe('import-vat-2024.1');
    expect(version.ratePercent).toBe(24);
  });

  it('2024-09-15 still resolves 25.5 % from v2 after a future version is seeded', () => {
    const version = resolveImportVatVersion(new Date('2024-09-15'), datasetWithFuture);
    expect(version.versionId).toBe('import-vat-2024.2');
    expect(version.ratePercent).toBe(25.5);
  });

  it('the future version only applies from its own date', () => {
    const version = resolveImportVatVersion(new Date('2026-03-01'), datasetWithFuture);
    expect(version.versionId).toBe('import-vat-2026.1');
    expect(version.ratePercent).toBe(26);
  });

  it('the seeded dataset windows are gapless and non-overlapping', () => {
    for (let i = 1; i < IMPORT_VAT_DATASET.length; i++) {
      const prev = IMPORT_VAT_DATASET[i - 1];
      const curr = IMPORT_VAT_DATASET[i];
      expect(prev.effectiveTo).not.toBeNull();
      // Adjacent days: a version ends the day before its successor starts.
      const prevEnd = prev.effectiveTo!.getTime();
      const nextStart = curr.effectiveFrom.getTime();
      expect(nextStart - prevEnd).toBe(24 * 60 * 60 * 1000);
    }
  });
});
