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
import {
  ClassificationRuleEngine,
  createDefaultRuleSet,
  createPostReformRuleSet,
} from '../services/classification-rule-engine.service';
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
      expect(ruleSet.version).toBe('2.0-2026.1');
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
      saveRuleSet: vi.fn().mockResolvedValue(undefined),
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
        saveRuleSet: vi.fn().mockResolvedValue(undefined),
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
      // No repository record for the current date → the built-in set
      // effective now (post-reform) applies.
      expect(ruleSet.version).toBe('2.0-2026.1');
    });

    it('falls back to the pre-reform built-in set for a pre-reform date', async () => {
      const emptyRepo: IClassificationRuleRepositoryPort = {
        findEffective: vi.fn().mockResolvedValue(null),
        listVersions: vi.fn().mockResolvedValue([]),
        saveRuleSet: vi.fn().mockResolvedValue(undefined),
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

      const { ruleSet } = await fallbackEngine.classify(
        input,
        new Date('2024-06-15'),
      );
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
        saveRuleSet: vi.fn().mockResolvedValue(undefined),
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
      // Window closed by the 1 Sep 2024 joint-liability reform set.
      expect(ruleSet.effectiveTo).toEqual(new Date('2024-08-31T23:59:59.999Z'));
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

  describe('createPostReformRuleSet (v2.0-2026.1)', () => {
    it('is effective from 1 Sep 2024 with an open window', () => {
      const ruleSet = createPostReformRuleSet();
      expect(ruleSet.version).toBe('2.0-2026.1');
      expect(ruleSet.effectiveFrom).toEqual(new Date('2024-09-01T00:00:00.000Z'));
      expect(ruleSet.effectiveTo).toBeNull();
    });

    it('has the same four rule names in priority order (taxonomy unchanged)', () => {
      const ruleSet = createPostReformRuleSet();
      const names = ruleSet.rules.map((r) => r.name);
      expect(names).toEqual([
        'TravellerImport',
        'DistanceSelling',
        'DistanceBuyingKnownCarrier',
        'DistanceBuyingUnknownTransport',
      ]);
    });

    it('encodes the reform in the rule descriptions', () => {
      const ruleSet = createPostReformRuleSet();
      const byName = new Map(ruleSet.rules.map((r) => [r.name, r]));
      expect(byName.get('DistanceSelling')?.description).toContain('jointly liable');
      expect(byName.get('DistanceBuyingKnownCarrier')?.description).toContain(
        'advance notice',
      );
      expect(byName.get('DistanceBuyingKnownCarrier')?.description).toContain(
        'guarantee',
      );
      expect(byName.get('TravellerImport')?.description).toContain(
        'No advance notice',
      );
    });

    it('classifies identically to v1.0 (only obligations changed, not the taxonomy)', () => {
      const v1 = createDefaultRuleSet();
      const v2 = createPostReformRuleSet();
      const inputs: ClassificationInput[] = [
        {
          sellerInvolvementIndicator: true,
          carrierId: 'posti',
          sellerCountry: 'DE',
          buyerCountry: 'FI',
          buyerIsTravelling: false,
          sellerId: '',
        },
        {
          sellerInvolvementIndicator: false,
          carrierId: 'dhl',
          sellerCountry: 'DE',
          buyerCountry: 'FI',
          buyerIsTravelling: false,
          sellerId: '',
        },
        {
          sellerInvolvementIndicator: false,
          carrierId: '',
          sellerCountry: 'EE',
          buyerCountry: 'FI',
          buyerIsTravelling: true,
          sellerId: '',
        },
      ];
      for (const input of inputs) {
        const run = (set: typeof v1) => {
          for (const rule of set.rules) {
            const result = rule.evaluate(input);
            if (result !== null) return result;
          }
          throw new Error('no rule matched');
        };
        expect(run(v2).classification).toBe(run(v1).classification);
        expect(run(v2).confidence).toBe(run(v1).confidence);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Evidence generation content — verifies every rule produces correct evidence
  // ---------------------------------------------------------------------------

  describe('evidence generation', () => {
    const engine = new ClassificationRuleEngine();

    it('TravellerImport evidence mentions physical carrying', () => {
      const { result } = engine.classifySync({
        sellerInvolvementIndicator: false,
        carrierId: '',
        sellerCountry: 'EE',
        buyerCountry: 'FI',
        buyerIsTravelling: true,
        sellerId: '',
      });
      expect(result.evidence[0].observation).toContain('physically carrying');
      expect(result.evidence[0].supportingData).toContain('EE');
      expect(result.evidence[0].source).toBe('buyerIsTravelling');
      expect(result.evidence).toHaveLength(2);
      expect(result.evidence[1].observation).toContain('Personal import allowance');
    });

    it('DistanceSelling evidence mentions direct delivery and carrier', () => {
      const { result } = engine.classifySync({
        sellerInvolvementIndicator: true,
        carrierId: 'posti',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: 'merchant',
      });
      expect(result.evidence[0].observation).toContain('direct delivery');
      expect(result.evidence[0].supportingData).toContain('posti');
      expect(result.evidence[0].source).toBe('sellerInvolvementIndicator');
      expect(result.evidence).toHaveLength(1);
    });

    it('DistanceSelling evidence handles missing carrier gracefully', () => {
      const { result } = engine.classifySync({
        sellerInvolvementIndicator: true,
        carrierId: '',
        sellerCountry: 'EE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: '',
      });
      expect(result.evidence[0].supportingData).toContain('carrier information not available');
    });

    it('DistanceBuyingKnownCarrier HIGH has 3 evidence items with confirmed seller', () => {
      const { result } = engine.classifySync({
        sellerInvolvementIndicator: false,
        carrierId: 'dhl',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: 'known-merchant',
      });
      expect(result.evidence).toHaveLength(3);
      expect(result.evidence[0].observation).toContain('independent carrier');
      expect(result.evidence[1].observation).toContain('did not arrange transport');
      expect(result.evidence[2].observation).toContain('Seller identity confirmed');
      expect(result.confidence).toBe('HIGH');
    });

    it('DistanceBuyingKnownCarrier MEDIUM has 3 evidence items with unverified seller', () => {
      const { result } = engine.classifySync({
        sellerInvolvementIndicator: false,
        carrierId: 'dhl',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: '',
      });
      expect(result.evidence).toHaveLength(3);
      expect(result.evidence[2].observation).toContain('unverified');
      expect(result.confidence).toBe('MEDIUM');
    });

    it('DistanceBuyingUnknownTransport has 1 evidence item about undetermined transport', () => {
      const { result } = engine.classifySync({
        sellerInvolvementIndicator: false,
        carrierId: '',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: '',
      });
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0].observation).toContain('could not be determined');
      expect(result.evidence[0].source).toBe('TransportClassification');
    });
  });

  // ---------------------------------------------------------------------------
  // mapToRuleSet — unknown rule name (logger warning path)
  // ---------------------------------------------------------------------------

  describe('repository-backed mode — unknown rule name', () => {
    it('skips unknown rules with a log warning and does not throw', async () => {
      const recordWithUnknown: ClassificationRuleSetRecord = {
        versionLabel: 'v2.0-test',
        label: 'Test rule set',
        effectiveFrom: new Date('2024-06-01'),
        effectiveTo: null,
        rules: [
          { name: 'TravellerImport', version: '1.0', description: undefined },
          { name: 'NonExistentRule', version: '1.0', description: undefined },
          { name: 'DistanceSelling', version: '1.0', description: undefined },
        ],
        createdAt: new Date('2024-05-01'),
      };

      const unknownRepo: IClassificationRuleRepositoryPort = {
        findEffective: vi.fn().mockResolvedValue(recordWithUnknown),
        listVersions: vi.fn().mockResolvedValue([]),
        saveRuleSet: vi.fn().mockResolvedValue(undefined),
      };

      const unknownEngine = new ClassificationRuleEngine(unknownRepo);
      const input: ClassificationInput = {
        sellerInvolvementIndicator: true,
        carrierId: 'posti',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: '',
      };

      // Should not throw — unknown rule should be skipped
      const { result, ruleName } = await unknownEngine.classify(input, new Date('2024-07-01'));
      expect(result.classification).toBe('DistanceSelling');
      expect(ruleName).toBe('DistanceSelling');
    });
  });

  // ---------------------------------------------------------------------------
  // asOf date edge cases
  // ---------------------------------------------------------------------------

  describe('asOf date handling', () => {
    const input: ClassificationInput = {
      sellerInvolvementIndicator: true,
      carrierId: 'posti',
      sellerCountry: 'DE',
      buyerCountry: 'FI',
      buyerIsTravelling: false,
      sellerId: '',
    };

    it('classifySync uses the pre-reform set before 1 Sep 2024', () => {
      const engine = new ClassificationRuleEngine();
      const { ruleSet } = engine.classifySync(input, new Date('2024-08-31T12:00:00.000Z'));
      expect(ruleSet.version).toBe('1.0');
    });

    it('classifySync uses the reform set from 1 Sep 2024 onward', () => {
      const engine = new ClassificationRuleEngine();
      const boundary = engine.classifySync(input, new Date('2024-09-01T00:00:00.000Z'));
      expect(boundary.ruleSet.version).toBe('2.0-2026.1');

      const current = engine.classifySync(input);
      expect(current.ruleSet.version).toBe('2.0-2026.1');
    });

    it('classify (async) selects by effective date without a repository', async () => {
      const engine = new ClassificationRuleEngine();
      const pre = await engine.classify(input, new Date('2024-07-01'));
      expect(pre.ruleSet.version).toBe('1.0');

      const post = await engine.classify(input, new Date('2025-01-01'));
      expect(post.ruleSet.version).toBe('2.0-2026.1');
    });

    it('classify does not require asOf and defaults to now', async () => {
      const engine = new ClassificationRuleEngine();
      const inputNoCarrier: ClassificationInput = {
        sellerInvolvementIndicator: false,
        carrierId: 'dhl',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: 'merchant',
      };
      const { result } = await engine.classify(inputNoCarrier);
      expect(result.classification).toBe('DistanceBuying');
      expect(result.confidence).toBe('HIGH');
    });
  });
});