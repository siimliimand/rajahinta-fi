/**
 * Tests for ImportVatService — result-shape and provenance pins.
 *
 * Exact cent vectors: base 3160 (1990 price + 590 transport + 560 excise
 * + 20 container duty) at 24 % → 758.4 → 758; at 25.5 % → 805.8 → 806.
 */
import { describe, it, expect } from 'vitest';
import { IMPORT_VAT_DATASET, type ImportVatVersion } from '../import-vat.dataset';
import { resolveImportVatVersion } from '../import-vat.math';
import { ImportVatService } from '../import-vat.service';

const INPUT = {
  retailPriceCents: 1990,
  transportCents: 590,
  alcoholExciseCents: 560,
  containerDutyCents: 20,
};

describe('ImportVatService', () => {
  it('2024-08-15: 24 % of 3160 cents → 758, v1 provenance, full breakdown', () => {
    const result = new ImportVatService().calculate(INPUT, new Date('2024-08-15'));
    expect(result.vatCents).toBe(758);
    expect(result.ratePercent).toBe(24);
    expect(result.rateVersionId).toBe('import-vat-2024.1');
    expect(result.baseCents).toBe(3160);
    expect(result.baseBreakdown).toEqual([
      { component: 'retailPrice', amountCents: 1990 },
      { component: 'transport', amountCents: 590 },
      { component: 'alcoholExcise', amountCents: 560 },
      { component: 'containerDuty', amountCents: 20 },
    ]);
    expect(result.reliability).toBe('VERIFIED');
    expect(result.calculatedAt).toEqual(new Date('2024-08-15'));
  });

  it('2024-09-15: 25.5 % of 3160 cents → 806, v2 provenance', () => {
    const result = new ImportVatService().calculate(INPUT, new Date('2024-09-15'));
    expect(result.vatCents).toBe(806);
    expect(result.ratePercent).toBe(25.5);
    expect(result.rateVersionId).toBe('import-vat-2024.2');
    expect(result.baseCents).toBe(3160);
    expect(result.reliability).toBe('VERIFIED');
  });

  it('breakdown amounts are integer cents and sum to baseCents', () => {
    const result = new ImportVatService().calculate(INPUT, new Date('2024-09-15'));
    for (const entry of result.baseBreakdown) {
      expect(Number.isInteger(entry.amountCents)).toBe(true);
    }
    const sum = result.baseBreakdown.reduce((acc, e) => acc + e.amountCents, 0);
    expect(sum).toBe(result.baseCents);
  });

  it('defaults asOf to now and resolves whatever version is effective today', () => {
    const result = new ImportVatService().calculate(INPUT);
    const expected = resolveImportVatVersion(new Date(), IMPORT_VAT_DATASET);
    expect(result.rateVersionId).toBe(expected.versionId);
    expect(result.ratePercent).toBe(expected.ratePercent);
  });

  it('a version without a confirmation date yields ESTIMATED', () => {
    const unconfirmedV3: ImportVatVersion = {
      versionId: 'import-vat-fixture-unconfirmed',
      ratePercent: 26,
      effectiveFrom: new Date('2026-01-01'),
      effectiveTo: null,
      baseComponents: ['retailPrice', 'transport', 'alcoholExcise', 'containerDuty'],
      officialSource: 'test-fixture',
      verificationDate: null,
    };
    const service = new ImportVatService([
      ...IMPORT_VAT_DATASET.map((v) =>
        v.versionId === 'import-vat-2024.2' ? { ...v, effectiveTo: new Date('2025-12-31') } : v,
      ),
      unconfirmedV3,
    ]);
    const result = service.calculate(INPUT, new Date('2026-01-15'));
    expect(result.rateVersionId).toBe('import-vat-fixture-unconfirmed');
    expect(result.reliability).toBe('ESTIMATED');
  });

  it('propagates the no-version error for uncovered dates', () => {
    expect(() => new ImportVatService().calculate(INPUT, new Date('2012-06-01'))).toThrow(
      RangeError,
    );
  });
});
