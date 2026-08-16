/**
 * Tests for AlcoholExciseService — uses a mock ITaxRuleRepositoryPort.
 *
 * Covers: rule-found path, rule-not-found fallback, verification-date
 * reliability flagging, and edge cases.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AlcoholExciseService } from '../services/alcohol-excise.service';
import type { ITaxRuleRepositoryPort, TaxRuleRecordPort } from '../ports/tax-rule-repository.port';
import { FORMULA_PER_LITRE_OF_PRODUCT, FORMULA_PROGRESSIVE_ABV, FORMULA_PER_LITRE_OF_ALCOHOL } from '../services/alcohol-excise.math';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function createMockRepo(
  overrides?: Partial<ITaxRuleRepositoryPort>,
): ITaxRuleRepositoryPort {
  return {
    findApplicable: async () => null,
    findHistoryRates: async () => [],
    ...overrides,
  };
}

function makeRule(
  overrides?: Partial<TaxRuleRecordPort>,
): TaxRuleRecordPort {
  return {
    id: 1,
    taxType: 'excise',
    productCategory: 'wine',
    rate: '0.355',
    effectiveFrom: new Date('2025-01-01'),
    effectiveTo: null,
    calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
    officialSource: 'Finnish Tax Administration',
    verificationDate: new Date('2025-06-01'),
    versionLabel: '2025.1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AlcoholExciseService', () => {
  let service: AlcoholExciseService;
  let repo: ITaxRuleRepositoryPort;

  beforeEach(() => {
    repo = createMockRepo();
    service = new AlcoholExciseService(repo);
  });

  describe('when a tax rule exists', () => {
    beforeEach(() => {
      repo.findApplicable = async () => makeRule();
    });

    it('returns VERIFIED reliability when verificationDate is set', async () => {
      const result = await service.calculate('wine', 0.12, 0.75);
      expect(result.reliability).toBe('VERIFIED');
    });

    it('returns ESTIMATED reliability when verificationDate is null', async () => {
      repo.findApplicable = async () => makeRule({ verificationDate: null });
      const result = await service.calculate('wine', 0.12, 0.75);
      expect(result.reliability).toBe('ESTIMATED');
    });

    it('returns the correct dataset version', async () => {
      const result = await service.calculate('wine', 0.12, 0.75);
      expect(result.taxDatasetVersion).toBe('2025.1');
    });

    it('correctly applies per-litre-of-product formula (wine)', async () => {
      // 0.355 × 0.75 = 0.26625 → 27 cents
      const result = await service.calculate('wine', 0.12, 0.75);
      expect(result.taxCents).toBe(27);
      expect(result.rateApplied).toBeCloseTo(0.355);
    });

    it('correctly applies progressive formula (beer)', async () => {
      repo.findApplicable = async () =>
        makeRule({
          productCategory: 'beer',
          calculationFormulaReference: FORMULA_PROGRESSIVE_ABV,
        });
      // 1L at 4.0% ABV → €0.295 → 30 cents
      const result = await service.calculate('beer', 0.04, 1.0);
      expect(result.taxCents).toBe(30);
      expect(result.rateApplied).toBeCloseTo(0.295);
    });

    it('correctly applies per-litre-of-alcohol formula (spirits)', async () => {
      repo.findApplicable = async () =>
        makeRule({
          productCategory: 'spirits',
          calculationFormulaReference: FORMULA_PER_LITRE_OF_ALCOHOL,
          rate: '0.565',
        });
      // 0.75L × 40% × €0.565 = 0.1695 → 17 cents
      const result = await service.calculate('spirits', 0.40, 0.75);
      expect(result.taxCents).toBe(17);
      expect(result.rateApplied).toBeCloseTo(0.565 * 0.40);
    });

    it('maps cider category to beer rules via normaliseCategory', async () => {
      repo.findApplicable = async () =>
        makeRule({
          productCategory: 'cider',
          calculationFormulaReference: FORMULA_PROGRESSIVE_ABV,
        });
      const result = await service.calculate('cider', 0.045, 0.33);
      expect(result.category).toBe('cider');
      expect(result.taxCents).toBeGreaterThanOrEqual(0);
    });
  });

  describe('when no tax rule exists', () => {
    it('returns ESTIMATED reliability', async () => {
      const result = await service.calculate('wine', 0.12, 0.75);
      expect(result.reliability).toBe('ESTIMATED');
    });

    it('returns FALLBACK dataset version', async () => {
      const result = await service.calculate('wine', 0.12, 0.75);
      expect(result.taxDatasetVersion).toBe('FALLBACK');
    });

    it('uses default rate for wine (€0.355/L)', async () => {
      const result = await service.calculate('wine', 0.12, 0.75);
      expect(result.taxCents).toBe(27);
    });

    it('uses default progressive rate for beer', async () => {
      const result = await service.calculate('beer', 0.04, 1.0);
      expect(result.taxCents).toBe(30);
    });

    it('uses default spirits rate (€0.565/L of pure alcohol)', async () => {
      const result = await service.calculate('spirits', 0.40, 0.75);
      expect(result.taxCents).toBe(17);
    });
  });

  describe('edge cases', () => {
    it('handles 0 volume (returns 0 cents)', async () => {
      const result = await service.calculate('beer', 0.04, 0);
      expect(result.taxCents).toBe(0);
    });

    it('handles 0 ABV (non-alcoholic)', async () => {
      const result = await service.calculate('wine', 0, 0.75);
      expect(result.taxCents).toBe(27); // still taxed at product rate
    });
  });
});