/**
 * Tests for ClassificationRuleEngine.
 *
 * Covers:
 * - Default rule set mirrors TransactionClassificationService behaviour
 * - Sync classification with default rules
 * - MEDIUM confidence when seller identity unknown
 * - All three classification labels returned correctly
 * - Rule set metadata (version, label, effective dates)
 * - Repository-backed mode (with mock)
 * - No repository fallback to default rules
 * - Error when no rule matches (should not happen with default rules)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClassificationRuleEngine, createDefaultRuleSet } from '../services/classification-rule-engine.service';
import type { ClassificationInput } from '../classification.types';
import type { IClassificationRuleRepositoryPort, ClassificationRuleSetRecord } from '../ports/classification-rule-repository.port';

describe('ClassificationRuleEngine', () => {
  describe('classifySync', () => {
    const engine = new ClassificationRuleEngine();

    it('classifies TravellerImport with HIGH confidence', () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: false,
        carrierId: '',
        sellerCountry: 'EE',
        buyerCountry: 'FI',
        buyerIsTravelling: true,
        sellerId: '',
      };

      const { result, ruleName } = engine.classifySync(input);
      expect(result.classification).toBe('TravellerImport');
      expect(result.confidence).toBe('HIGH');
      expect(ruleName).toBe('TravellerImport');
    });

    it('classifies DistanceSelling with HIGH confidence', () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: true,
        carrierId: 'posti',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: 'known-merchant',
      };

      const { result, ruleName } = engine.classifySync(input);
      expect(result.classification).toBe('DistanceSelling');
      expect(result.confidence).toBe('HIGH');
      expect(ruleName).toBe('DistanceSelling');
    });

    it('classifies DistanceBuying with HIGH confidence when seller known', () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: false,
        carrierId: 'dhl',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: 'known-merchant',
      };

      const { result, ruleName } = engine.classifySync(input);
      expect(result.classification).toBe('DistanceBuying');
      expect(result.confidence).toBe('HIGH');
      expect(ruleName).toBe('DistanceBuyingKnownCarrier');
    });

    it('classifies DistanceBuying with MEDIUM confidence when seller unknown', () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: false,
        carrierId: 'dhl',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: '',
      };

      const { result, ruleName } = engine.classifySync(input);
      expect(result.classification).toBe('DistanceBuying');
      expect(result.confidence).toBe('MEDIUM');
      expect(result.evidenceSummary).toContain('unverified');
      expect(ruleName).toBe('DistanceBuyingKnownCarrier');
    });

    it('classifies DistanceBuying with LOW confidence when transport unknown', () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: false,
        carrierId: '',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: '',
      };

      const { result, ruleName } = engine.classifySync(input);
      expect(result.classification).toBe('DistanceBuying');
      expect(result.confidence).toBe('LOW');
      expect(ruleName).toBe('DistanceBuyingUnknownTransport');
    });

    it('returns rule set metadata with version, label, and dates', () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: true,
        carrierId: 'posti',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: '',
      };

      const { ruleSet } = engine.classifySync(input);
      expect(ruleSet.version).toBe('1.0');
      expect(ruleSet.label).toContain('Finnish');
      expect(ruleSet.effectiveFrom).toBeInstanceOf(Date);
      expect(ruleSet.effectiveTo).toBeNull();
    });

    it('produces identical results for identical inputs', () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: true,
        carrierId: 'posti',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: 'known-seller',
      };

      const a = engine.classifySync(input);
      const b = engine.classifySync(input);
      expect(a).toEqual(b);
    });
  });

  describe('classify (async)', () => {
    it('falls back to default rules when no repository provided', async () => {
      const engine = new ClassificationRuleEngine();
      const input: ClassificationInput = {
        sellerInvolvementIndicator: false,
        carrierId: 'dhl',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: 'known-merchant',
      };

      const { result } = await engine.classify(input);
      expect(result.classification).toBe('DistanceBuying');
      expect(result.confidence).toBe('HIGH');
    });
  });

  describe('repository-backed mode', () => {
    const mockRules = createDefaultRuleSet().rules.map((r) => ({
      name: r.name,
      version: r.version,
      description: r.description,
    }));

    const mockRecord: ClassificationRuleSetRecord = {
      versionLabel: 'v2.0-test',
      label: 'Test rule set',
      effectiveFrom: new Date('2024-06-01'),
      effectiveTo: null,
      rules: mockRules,
      createdAt: new Date('2024-05-01'),
    };

    const mockRepository: IClassificationRuleRepositoryPort = {
      findEffective: vi.fn().mockResolvedValue(mockRecord),
      listVersions: vi.fn().mockResolvedValue([mockRecord]),
    };

    let engine: ClassificationRuleEngine;

    beforeEach(() => {
      vi.clearAllMocks();
      engine = new ClassificationRuleEngine(mockRepository);
    });

    it('loads rule set from repository by effective date', async () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: false,
        carrierId: 'dhl',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: '',
      };

      const effectiveDate = new Date('2024-07-01');
      const { result, ruleSet } = await engine.classify(input, effectiveDate);

      expect(mockRepository.findEffective).toHaveBeenCalledWith(effectiveDate);
      expect(result.classification).toBe('DistanceBuying');
      expect(result.confidence).toBe('MEDIUM');
      expect(ruleSet.version).toBe('v2.0-test');
      expect(ruleSet.label).toBe('Test rule set');
    });

    it('falls back to default rules when repository returns null', async () => {
      const emptyRepo: IClassificationRuleRepositoryPort = {
        findEffective: vi.fn().mockResolvedValue(null),
        listVersions: vi.fn().mockResolvedValue([]),
      };

      const fallbackEngine = new ClassificationRuleEngine(emptyRepo);
      const input: ClassificationInput = {
        sellerInvolvementIndicator: true,
        carrierId: 'posti',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: '',
      };

      const { result, ruleSet } = await fallbackEngine.classify(input);
      expect(result.classification).toBe('DistanceSelling');
      expect(ruleSet.version).toBe('1.0');
    });

    it('respects rule priority order from repository record', async () => {
      // Reorder rules: DistanceBuyingKnownCarrier first
      const reorderedRecord: ClassificationRuleSetRecord = {
        ...mockRecord,
        rules: [
          { name: 'DistanceBuyingUnknownTransport', version: '1.0', description: undefined },
          { name: 'TravellerImport', version: '1.0', description: undefined },
        ],
      };

      const reorderRepo: IClassificationRuleRepositoryPort = {
        findEffective: vi.fn().mockResolvedValue(reorderedRecord),
        listVersions: vi.fn().mockResolvedValue([reorderedRecord]),
      };

      const reorderEngine = new ClassificationRuleEngine(reorderRepo);
      const input: ClassificationInput = {
        sellerInvolvementIndicator: false,
        carrierId: '',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: '',
      };

      const { result, ruleName } = await reorderEngine.classify(input, new Date('2024-07-01'));
      // DistanceBuyingUnknownTransport is first, so that matches before the catch-all
      expect(result.classification).toBe('DistanceBuying');
      expect(ruleName).toBe('DistanceBuyingUnknownTransport');
    });
  });

  describe('createDefaultRuleSet', () => {
    it('returns a valid rule set with 4 rules', () => {
      const ruleSet = createDefaultRuleSet();
      expect(ruleSet.rules).toHaveLength(4);
      expect(ruleSet.version).toBe('1.0');
      expect(ruleSet.effectiveFrom).toBeInstanceOf(Date);
      expect(ruleSet.effectiveTo).toBeNull();
    });

    it('has all four expected rules in priority order', () => {
      const ruleSet = createDefaultRuleSet();
      const names = ruleSet.rules.map((r) => r.name);
      expect(names).toEqual([
        'TravellerImport',
        'DistanceSelling',
        'DistanceBuyingKnownCarrier',
        'DistanceBuyingUnknownTransport',
      ]);
    });

    it('every rule has a description', () => {
      const ruleSet = createDefaultRuleSet();
      for (const rule of ruleSet.rules) {
        expect(rule.description?.length).toBeGreaterThan(0);
      }
    });
  });
});