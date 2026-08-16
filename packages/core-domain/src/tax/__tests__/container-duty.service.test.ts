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
    findHistoryRates: async () => [],
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

    it('returns VERIFIED reliability when verificationDate is set and deposit status is known', async () => {
      const result = await service.calculate(1.0, 'glass', false);
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

    it('includes depositExemption in result with default (null)', async () => {
      const result = await service.calculate(0.75, 'glass');
      expect(result.depositExemption).toBeDefined();
      expect(result.depositExemption!.exempted).toBe(false);
      expect(result.depositExemption!.reliability).toBe('ESTIMATED');
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

  // ---------------------------------------------------------------------------
  // Deposit-return system exemption tests
  // ---------------------------------------------------------------------------

  describe('deposit-return exemption', () => {
    describe('depositSystemStatus === true (exempted)', () => {
      it('returns zero duty', async () => {
        const result = await service.calculate(1.0, 'glass', true);
        expect(result.dutyCents).toBe(0);
        expect(result.ratePerLitre).toBe(0);
      });

      it('returns EXEMPTED dataset version', async () => {
        const result = await service.calculate(1.0, 'glass', true);
        expect(result.taxDatasetVersion).toBe('EXEMPTED');
      });

      it('returns VERIFIED reliability (deposit status is known)', async () => {
        const result = await service.calculate(1.0, 'glass', true);
        expect(result.reliability).toBe('VERIFIED');
      });

      it('includes depositExemption with exempted = true and clear reason', async () => {
        const result = await service.calculate(1.0, 'glass', true);
        expect(result.depositExemption).toBeDefined();
        expect(result.depositExemption!.exempted).toBe(true);
        expect(result.depositExemption!.reason).toContain('exempted');
        expect(result.depositExemption!.reason).toContain('deposit-return');
      });

      it('short-circuits regardless of volume', async () => {
        const result = await service.calculate(999, 'glass', true);
        expect(result.dutyCents).toBe(0);
      });
    });

    describe('depositSystemStatus === false (applied)', () => {
      it('applies standard rate', async () => {
        const result = await service.calculate(1.0, 'glass', false);
        expect(result.dutyCents).toBe(51);
        expect(result.ratePerLitre).toBe(0.51);
      });

      it('includes depositExemption with exempted = false and applied reason', async () => {
        const result = await service.calculate(1.0, 'glass', false);
        expect(result.depositExemption).toBeDefined();
        expect(result.depositExemption!.exempted).toBe(false);
        expect(result.depositExemption!.reason).toContain('applied');
      });

      it('returns VERIFIED deposit reliability', async () => {
        const result = await service.calculate(1.0, 'glass', false);
        expect(result.depositExemption!.reliability).toBe('VERIFIED');
      });
    });

    describe('depositSystemStatus === null / default (estimated)', () => {
      it('applies standard rate when status is unknown', async () => {
        const result = await service.calculate(1.0, 'glass', null);
        expect(result.dutyCents).toBe(51);
      });

      it('applies standard rate when param is omitted (default null)', async () => {
        const result = await service.calculate(1.0, 'glass');
        expect(result.dutyCents).toBe(51);
      });

      it('marks depositExemption reliability as ESTIMATED', async () => {
        const result = await service.calculate(1.0, 'glass');
        expect(result.depositExemption!.reliability).toBe('ESTIMATED');
        expect(result.depositExemption!.reason).toContain('estimated');
      });

      it('marks overall reliability as ESTIMATED when deposit is unknown (even with verified rule)', async () => {
        repo.findApplicable = async () => makeRule();
        const result = await service.calculate(1.0, 'glass');
        // Verified rule + unknown deposit → overall ESTIMATED
        expect(result.reliability).toBe('ESTIMATED');
        expect(result.depositExemption!.reliability).toBe('ESTIMATED');
      });
    });
  });

  describe('edge cases', () => {
    it('handles 0 volume', async () => {
      const result = await service.calculate(0, 'glass');
      expect(result.dutyCents).toBe(0);
    });

    it('throws RangeError on negative volume', async () => {
      await expect(service.calculate(-1, 'glass')).rejects.toThrow(RangeError);
    });

    it('deposit exemption short-circuits before volume validation (negative volume exempted returns 0)', async () => {
      const result = await service.calculate(-999, 'glass', true);
      expect(result.dutyCents).toBe(0);
      expect(result.taxDatasetVersion).toBe('EXEMPTED');
    });

    describe('asOf historical date parameter', () => {
      const pastRule = makeRule({
        id: 11,
        rate: '0.48',
        versionLabel: 'v0.9-2023',
        effectiveFrom: new Date('2023-01-01'),
        effectiveTo: new Date('2024-01-01'),
        verificationDate: new Date('2023-06-01'),
      });

      it('resolves rule effective on the asOf date', async () => {
        repo.findApplicable = async (_taxType, _category, asOf) => {
          return asOf < new Date('2024-01-01') ? pastRule : makeRule();
        };
        const result = await service.calculate(1.0, 'glass', false, new Date('2023-06-15'));
        expect(result.ratePerLitre).toBe(0.48);
        expect(result.taxDatasetVersion).toBe('v0.9-2023');
      });

      it('uses current rule when asOf is today', async () => {
        repo.findApplicable = async () => makeRule();
        const result = await service.calculate(1.0, 'glass', false, new Date());
        expect(result.taxDatasetVersion).toBe('2025.1');
      });

      it('uses current rule when asOf is omitted (defaults to now)', async () => {
        repo.findApplicable = async () => makeRule();
        const result = await service.calculate(1.0, 'glass', false);
        expect(result.taxDatasetVersion).toBe('2025.1');
      });
    });
  });
});