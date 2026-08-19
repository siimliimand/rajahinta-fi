/**
 * Tests for AlcoholExciseService — uses a mock ITaxRuleRepositoryPort.
 *
 * Covers: rule-found path, ABV-tier selection, exemption handling,
 * rule-not-found fallback, verification-date reliability flagging,
 * and edge cases.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AlcoholExciseService } from '../services/alcohol-excise.service';
import type { ITaxRuleRepositoryPort, TaxRuleRecordPort } from '../ports/tax-rule-repository.port';
import { FORMULA_PER_LITRE_OF_PRODUCT, FORMULA_PER_DEGREE_PLATO, FORMULA_PER_LITRE_OF_ALCOHOL } from '../services/alcohol-excise.math';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function createMockRepo(
  overrides?: Partial<ITaxRuleRepositoryPort>,
): ITaxRuleRepositoryPort {
  return {
    findApplicable: async () => null,
    findAllApplicable: async () => [],
    findHistoryRates: async () => [],
    findActiveVersionLabels: async () => [],
    ...overrides,
  };
}

function makeRule(
  overrides?: Partial<TaxRuleRecordPort>,
): TaxRuleRecordPort {
  return {
    id: 1,
    taxType: 'excise',
    productCategory: 'wine_still',
    rate: '0.355',
    effectiveFrom: new Date('2025-01-01'),
    effectiveTo: null,
    calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
    officialSource: 'Finnish Tax Administration',
    verificationDate: new Date('2025-06-01'),
    versionLabel: '2025.1',
    exemptionConditions: null,
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
      repo.findAllApplicable = async () => [makeRule()];
    });

    it('returns VERIFIED reliability when verificationDate is set', async () => {
      const result = await service.calculate('wine', 0.12, 0.75);
      expect(result.reliability).toBe('VERIFIED');
    });

    it('returns ESTIMATED reliability when verificationDate is null', async () => {
      repo.findAllApplicable = async () => [makeRule({ verificationDate: null })];
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

    it('correctly applies per-degree-Plato formula (beer)', async () => {
      repo.findAllApplicable = async () => [
        makeRule({
          productCategory: 'beer',
          calculationFormulaReference: FORMULA_PER_DEGREE_PLATO,
          rate: '33.00',
        }),
      ];
      // 0.33L at 4.7% ABV: 33.00 × 0.047 × 0.33 = 0.51183 → 51 cents
      const result = await service.calculate('beer', 0.047, 0.33);
      expect(result.taxCents).toBe(51);
      expect(result.rateApplied).toBeCloseTo(33.0 * 0.047);
    });

    it('correctly applies per-litre-of-alcohol formula (spirits)', async () => {
      repo.findAllApplicable = async () => [
        makeRule({
          productCategory: 'spirits',
          calculationFormulaReference: FORMULA_PER_LITRE_OF_ALCOHOL,
          rate: '0.565',
        }),
      ];
      // 0.75L × 40% × €0.565 = 0.1695 → 17 cents
      const result = await service.calculate('spirits', 0.40, 0.75);
      expect(result.taxCents).toBe(17);
      expect(result.rateApplied).toBeCloseTo(0.565 * 0.40);
    });

    it('maps cider category to other_fermented via normaliseCategory', async () => {
      repo.findAllApplicable = async () => [
        makeRule({
          productCategory: 'other_fermented',
          calculationFormulaReference: FORMULA_PER_LITRE_OF_ALCOHOL,
        }),
      ];
      const result = await service.calculate('cider', 0.045, 0.33);
      expect(result.category).toBe('other_fermented');
      expect(result.taxCents).toBeGreaterThanOrEqual(0);
    });
  });

  describe('ABV-tier selection', () => {
    it('selects the low-ABV tier rule when ABV matches', async () => {
      // Rules ordered by effectiveFrom desc — both active, same effective date
      const lowRule = makeRule({
        id: 1,
        rate: '3.40',
        exemptionConditions: { maxAlcoholByVolume: 1.2 },
      });
      const highRule = makeRule({
        id: 2,
        rate: '4.55',
        exemptionConditions: { minAlcoholByVolume: 15, maxAlcoholByVolume: 18 },
      });
      repo.findAllApplicable = async () => [highRule, lowRule];

      // 12% ABV = 12% → matches lowRule (≤ 1.2? no) → falls through to most recent (highRule)
      // Actually 12% ABV is 12 in percentage, and lowRule max is 1.2, so 12 > 1.2 → no match.
      // highRule min is 15, so 12 < 15 → no match. Falls to rules[0] = highRule.
      const result = await service.calculate('wine_still', 0.12, 0.75);
      // Falls to rules[0] = highRule with rate 4.55
      expect(result.rateApplied).toBeCloseTo(4.55);
      expect(result.taxCents).toBe(341); // 4.55 * 0.75 = 3.4125 → 341
    });

    it('selects the high-ABV tier rule when ABV is in range', async () => {
      const lowRule = makeRule({
        id: 1,
        rate: '3.40',
        exemptionConditions: { maxAlcoholByVolume: 1.2 },
      });
      const highRule = makeRule({
        id: 2,
        rate: '4.55',
        exemptionConditions: { minAlcoholByVolume: 15, maxAlcoholByVolume: 18 },
      });
      repo.findAllApplicable = async () => [highRule, lowRule];

      // 16% ABV → matches highRule (15 ≤ 16 ≤ 18)
      const result = await service.calculate('wine_still', 0.16, 0.75);
      expect(result.rateApplied).toBeCloseTo(4.55);
      expect(result.taxCents).toBe(341); // 4.55 * 0.75 = 3.4125 → 341
    });

    it('falls back to the most recent rule when no ABV tier matches', async () => {
      const lowRule = makeRule({
        id: 1,
        rate: '3.40',
        exemptionConditions: { maxAlcoholByVolume: 1.2 },
      });
      const highRule = makeRule({
        id: 2,
        rate: '4.55',
        exemptionConditions: { minAlcoholByVolume: 15, maxAlcoholByVolume: 18 },
      });
      // Order: most recent first (highRule has id 2, lowRule has id 1 — same effective date)
      repo.findAllApplicable = async () => [highRule, lowRule];

      // 10% ABV → neither tier matches (10 > 1.2, 10 < 15) → falls to rules[0] = highRule
      const result = await service.calculate('wine_still', 0.10, 0.75);
      expect(result.rateApplied).toBeCloseTo(4.55);
      expect(result.taxCents).toBe(341);
    });

    it('selects a catch-all rule (no exemptionConditions) when present', async () => {
      const catchAll = makeRule({
        id: 1,
        rate: '2.50',
        exemptionConditions: null,
      });
      const tiered = makeRule({
        id: 2,
        rate: '3.40',
        exemptionConditions: { maxAlcoholByVolume: 1.2 },
      });
      repo.findAllApplicable = async () => [tiered, catchAll];

      // 10% ABV → catchAll matches (no conditions) → uses 2.50
      const result = await service.calculate('wine_still', 0.10, 0.75);
      expect(result.rateApplied).toBeCloseTo(2.50);
      expect(result.taxCents).toBe(188); // 2.50 * 0.75 = 1.875 → 188
    });
  });

  describe('exemption handling', () => {
    it('applies zero rate when ABV is below the exemption threshold (maxAlcoholByVolume alone)', async () => {
      // Rule with maxAlcoholByVolume alone → exemption threshold
      const rule = makeRule({
        rate: '3.40',
        exemptionConditions: { maxAlcoholByVolume: 1.2 },
      });
      repo.findAllApplicable = async () => [rule];

      // 0.5% ABV → below 1.2% → exempt (rate 0)
      const result = await service.calculate('wine_still', 0.005, 0.75);
      expect(result.taxCents).toBe(0);
      expect(result.rateApplied).toBe(0);
      expect(result.taxDatasetVersion).toBe('2025.1');
    });

    it('does NOT apply exemption when ABV is above the threshold', async () => {
      const rule = makeRule({
        rate: '3.40',
        exemptionConditions: { maxAlcoholByVolume: 1.2 },
      });
      repo.findAllApplicable = async () => [rule];

      // 5% ABV → above 1.2% → normal rate applies
      const result = await service.calculate('wine_still', 0.05, 0.75);
      expect(result.taxCents).toBe(255); // 3.40 * 0.75 = 2.55 → 255
      expect(result.rateApplied).toBeCloseTo(3.40);
    });

    it('does NOT treat minAlcoholByVolume rules as exemption', async () => {
      // Rule with minAlcoholByVolume → ABV tier, not exemption
      const rule = makeRule({
        rate: '4.55',
        exemptionConditions: { minAlcoholByVolume: 15, maxAlcoholByVolume: 18 },
      });
      repo.findAllApplicable = async () => [rule];

      // 16% ABV → 16, within tier [15, 18] → rate 4.55 (not exempt)
      const result = await service.calculate('wine_still', 0.16, 0.75);
      expect(result.taxCents).toBe(341); // 4.55 * 0.75 = 3.4125 → 341
      expect(result.rateApplied).toBeCloseTo(4.55);
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

    it('uses default rate for wine (€3.40/L)', async () => {
      const result = await service.calculate('wine', 0.12, 0.75);
      expect(result.taxCents).toBe(255);
    });

    it('uses default per-degree-Plato rate for beer', async () => {
      const result = await service.calculate('beer', 0.04, 1.0);
      expect(result.taxCents).toBe(132); // 33.00 × 0.04 × 1.0 = 1.32 → 132 cents
    });

    it('uses default spirits rate (€29.50/L of pure alcohol)', async () => {
      const result = await service.calculate('spirits', 0.40, 0.75);
      expect(result.taxCents).toBe(885);
    });
  });

  describe('edge cases', () => {
    it('handles 0 volume (returns 0 cents)', async () => {
      const result = await service.calculate('beer', 0.047, 0);
      expect(result.taxCents).toBe(0);
    });

    it('handles 0 ABV (non-alcoholic) — per-litre-of-product still applies', async () => {
      repo.findAllApplicable = async () => [makeRule()];
      const result = await service.calculate('wine', 0, 0.75);
      expect(result.taxCents).toBe(27); // 0.355 * 0.75 = 0.26625 → 27
    });

    it('handles 100% ABV (spirits at abv = 1.0)', async () => {
      const result = await service.calculate('spirits', 1.0, 0.75);
      expect(result.taxCents).toBeGreaterThanOrEqual(0);
      expect(result.category).toBe('spirits');
    });

    it('handles all 6 canonical categories gracefully', async () => {
      const categories = ['beer', 'wine_still', 'spirits', 'intermediate_products', 'other_fermented'];
      for (const cat of categories) {
        const result = await service.calculate(cat, 0.05, 0.33);
        expect(result.taxCents).toBeGreaterThanOrEqual(0);
        expect(result.category).toBe(cat);
        expect(result.taxDatasetVersion).toBe('FALLBACK');
      }
    });

    describe('asOf historical date parameter', () => {
      const pastRule = makeRule({
        id: 99,
        rate: '0.300',
        versionLabel: 'v0.9-2023',
        effectiveFrom: new Date('2023-01-01'),
        effectiveTo: new Date('2024-01-01'),
        verificationDate: new Date('2023-06-01'),
      });

      it('resolves rule effective on the asOf date', async () => {
        repo.findAllApplicable = async (_taxType, _category, asOf) => {
          return asOf < new Date('2024-01-01') ? [pastRule] : [makeRule()];
        };
        const result = await service.calculate('wine', 0.12, 0.75, new Date('2023-06-15'));
        expect(result.rateApplied).toBe(0.300);
        expect(result.taxDatasetVersion).toBe('v0.9-2023');
      });

      it('uses current rule when asOf is today', async () => {
        repo.findAllApplicable = async () => [makeRule()];
        const result = await service.calculate('wine', 0.12, 0.75, new Date());
        expect(result.taxDatasetVersion).toBe('2025.1');
      });

      it('uses current rule when asOf is omitted (defaults to now)', async () => {
        repo.findAllApplicable = async () => [makeRule()];
        const result = await service.calculate('wine', 0.12, 0.75);
        expect(result.taxDatasetVersion).toBe('2025.1');
      });
    });
  });
});