/**
 * Tests for TaxRuleQueryService — uses a mock ITaxRuleRepositoryPort.
 *
 * Covers: rate history retrieval, empty results, mapping of
 * TaxRuleRecordPort to RateHistoryEntry shape, and isCurrent flag.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TaxRuleQueryService } from '../services/tax-rule-query.service';
import type { ITaxRuleRepositoryPort, TaxRuleRecordPort } from '../ports/tax-rule-repository.port';

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
    taxType: 'excise_duty',
    productCategory: 'beer',
    rate: '0.295',
    effectiveFrom: new Date('2024-01-01'),
    effectiveTo: null,
    calculationFormulaReference: 'progressive_abv',
    officialSource: 'Finnish Tax Administration — vero.fi',
    verificationDate: new Date('2024-03-01'),
    versionLabel: 'v1.0-2024',
    exemptionConditions: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaxRuleQueryService', () => {
  let service: TaxRuleQueryService;
  let repo: ITaxRuleRepositoryPort;

  beforeEach(() => {
    repo = createMockRepo();
    service = new TaxRuleQueryService(repo);
  });

  describe('getRateHistory', () => {
    it('returns empty array when no rules overlap the range', async () => {
      repo.findHistoryRates = async () => [];

      const result = await service.getRateHistory(
        'excise_duty',
        'beer',
        new Date('2025-01-01'),
        new Date('2025-06-01'),
      );

      expect(result).toEqual([]);
    });

    it('returns a single matching rule', async () => {
      const rule = makeRule();
      repo.findHistoryRates = async () => [rule];

      const result = await service.getRateHistory(
        'excise_duty',
        'beer',
        new Date('2024-01-01'),
        new Date('2024-12-31'),
      );

      expect(result).toHaveLength(1);
      expect(result[0].versionLabel).toBe('v1.0-2024');
      expect(result[0].rate).toBe('0.295');
      expect(result[0].source).toBe('Finnish Tax Administration — vero.fi');
      expect(result[0].verificationDate).toEqual(new Date('2024-03-01'));
    });

    it('marks isCurrent as true when effectiveTo is null', async () => {
      const rule = makeRule({ effectiveTo: null });
      repo.findHistoryRates = async () => [rule];

      const result = await service.getRateHistory('excise_duty', 'beer', new Date('2024-01-01'), new Date('2025-01-01'));

      expect(result[0].isCurrent).toBe(true);
    });

    it('marks isCurrent as false when effectiveTo is set', async () => {
      const rule = makeRule({ effectiveTo: new Date('2025-01-01') });
      repo.findHistoryRates = async () => [rule];

      const result = await service.getRateHistory('excise_duty', 'beer', new Date('2024-01-01'), new Date('2025-01-01'));

      expect(result[0].isCurrent).toBe(false);
    });

    it('returns multiple rules ordered by effectiveFrom', async () => {
      const rule2024 = makeRule({
        versionLabel: 'v1.0-2024',
        effectiveFrom: new Date('2024-01-01'),
        effectiveTo: new Date('2025-01-01'),
      });
      const rule2025 = makeRule({
        id: 2,
        versionLabel: 'v1.0-2025',
        effectiveFrom: new Date('2025-01-01'),
        effectiveTo: null,
      });
      repo.findHistoryRates = async () => [rule2024, rule2025];

      const result = await service.getRateHistory(
        'excise_duty',
        'beer',
        new Date('2024-01-01'),
        new Date('2026-01-01'),
      );

      expect(result).toHaveLength(2);
      expect(result[0].versionLabel).toBe('v1.0-2024');
      expect(result[1].versionLabel).toBe('v1.0-2025');
    });

    it('passes correct taxType and productCategory to repository', async () => {
      let capturedTaxType = '';
      let capturedCategory = '';

      repo.findHistoryRates = async (taxType, productCategory) => {
        capturedTaxType = taxType;
        capturedCategory = productCategory;
        return [];
      };

      await service.getRateHistory(
        'container_duty',
        'glass',
        new Date('2024-01-01'),
        new Date('2025-01-01'),
      );

      expect(capturedTaxType).toBe('container_duty');
      expect(capturedCategory).toBe('glass');
    });

    it('passes correct date range to repository', async () => {
      let capturedFrom: Date | null = null;
      let capturedTo: Date | null = null;

      repo.findHistoryRates = async (_taxType, _category, fromDate, toDate) => {
        capturedFrom = fromDate;
        capturedTo = toDate;
        return [];
      };

      const from = new Date('2024-06-01');
      const to = new Date('2024-12-31');

      await service.getRateHistory('excise_duty', 'wine', from, to);

      expect(capturedFrom).toBe(from);
      expect(capturedTo).toBe(to);
    });

    it('maps verificationDate of null correctly', async () => {
      const rule = makeRule({ verificationDate: null });
      repo.findHistoryRates = async () => [rule];

      const result = await service.getRateHistory('excise_duty', 'beer', new Date('2024-01-01'), new Date('2025-01-01'));

      expect(result[0].verificationDate).toBeNull();
    });
  });
});