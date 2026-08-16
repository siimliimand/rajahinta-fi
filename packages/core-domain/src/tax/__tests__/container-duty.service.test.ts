/**
 * Tests for ContainerDutyService — uses a mock ITaxRuleRepositoryPort.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ContainerDutyService } from '../services/container-duty.service';
import type { ITaxRuleRepositoryPort, TaxRuleRecordPort } from '../ports/tax-rule-repository.port';
import { FORMULA_FLAT_PER_LITRE } from '../services/container-duty.math';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function createMockRepo(
  overrides?: Partial<ITaxRuleRepositoryPort>,
): ITaxRuleRepositoryPort {
  return {
    findApplicable: async () => null,
    ...overrides,
  };
}

function makeRule(
  overrides?: Partial<TaxRuleRecordPort>,
): TaxRuleRecordPort {
  return {
    id: 10,
    taxType: 'container_duty',
    productCategory: 'glass',
    rate: '0.51',
    effectiveFrom: new Date('2025-01-01'),
    effectiveTo: null,
    calculationFormulaReference: FORMULA_FLAT_PER_LITRE,
    officialSource: 'Finnish Tax Administration',
    verificationDate: new Date('2025-06-01'),
    versionLabel: '2025.1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContainerDutyService', () => {
  let service: ContainerDutyService;
  let repo: ITaxRuleRepositoryPort;

  beforeEach(() => {
    repo = createMockRepo();
    service = new ContainerDutyService(repo);
  });

  describe('when a tax rule exists', () => {
    beforeEach(() => {
      repo.findApplicable = async () => makeRule();
    });

    it('returns VERIFIED reliability when verificationDate is set', async () => {
      const result = await service.calculate(1.0, 'glass');
      expect(result.reliability).toBe('VERIFIED');
    });

    it('returns ESTIMATED reliability when verificationDate is null', async () => {
      repo.findApplicable = async () => makeRule({ verificationDate: null });
      const result = await service.calculate(1.0, 'glass');
      expect(result.reliability).toBe('ESTIMATED');
    });

    it('returns correct version label', async () => {
      const result = await service.calculate(1.0, 'glass');
      expect(result.taxDatasetVersion).toBe('2025.1');
    });

    it('calculates duty for 0.75L glass bottle: 0.51 × 0.75 = 0.3825 → 38 cents', async () => {
      const result = await service.calculate(0.75, 'glass');
      expect(result.dutyCents).toBe(38);
      expect(result.ratePerLitre).toBe(0.51);
    });

    it('calculates duty for 0.33L can: 0.51 × 0.33 = 0.1683 → 17 cents', async () => {
      const result = await service.calculate(0.33, 'can');
      expect(result.dutyCents).toBe(17);
    });
  });

  describe('when no tax rule exists (fallback)', () => {
    it('returns ESTIMATED reliability', async () => {
      const result = await service.calculate(1.0, 'glass');
      expect(result.reliability).toBe('ESTIMATED');
    });

    it('returns FALLBACK dataset version', async () => {
      const result = await service.calculate(1.0, 'glass');
      expect(result.taxDatasetVersion).toBe('FALLBACK');
    });

    it('uses default €0.51/L rate', async () => {
      const result = await service.calculate(1.0, 'glass');
      expect(result.dutyCents).toBe(51);
      expect(result.ratePerLitre).toBe(0.51);
    });
  });

  describe('non-standard packaging', () => {
    it('uses default rate for keg (no rule → ESTIMATED)', async () => {
      const result = await service.calculate(50, 'keg');
      expect(result.reliability).toBe('ESTIMATED');
      expect(result.dutyCents).toBe(2550); // 50 * 0.51 * 100
    });

    it('uses default rate for bulk (no rule → ESTIMATED)', async () => {
      const result = await service.calculate(100, 'bulk');
      expect(result.reliability).toBe('ESTIMATED');
    });
  });

  describe('edge cases', () => {
    it('handles 0 volume', async () => {
      const result = await service.calculate(0, 'glass');
      expect(result.dutyCents).toBe(0);
    });
  });
});