/**
 * Tests for TransactionClassificationService.
 *
 * Covers all four classification paths plus edge cases:
 * - Traveller Import (HIGH)
 * - Distance Selling (HIGH)
 * - Distance Buying — known seller (HIGH)
 * - Distance Buying — unknown seller (MEDIUM)
 * - Distance Buying — unknown transport (LOW)
 * - Boundary: seller involvement + travelling (travelling takes precedence)
 * - Boundary: empty carrierId with seller involvement
 * - Idempotence: same input → same output
 * - Evidence: structured evidence for every classification type
 */
import { describe, it, expect } from 'vitest';
import { TransportClassificationService } from '../../transport/transport-classification.service';
import { TransactionClassificationService } from '../transaction-classification.service';
import type { ClassificationInput, ClassificationResult } from '../classification.types';

const transportService = new TransportClassificationService();
const service = new TransactionClassificationService(transportService);

describe('TransactionClassificationService', () => {
  describe('classify', () => {
    // -----------------------------------------------------------------------
    // Traveller Import
    // -----------------------------------------------------------------------

    it('classifies as TravellerImport when buyerIsTravelling is true', async () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: false,
        carrierId: '',
        sellerCountry: 'EE',
        buyerCountry: 'FI',
        buyerIsTravelling: true,
        sellerId: '',
      };

      const result = await service.classify(input);
      expect(result.classification).toBe('TravellerImport');
      expect(result.confidence).toBe('HIGH');
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0].observation).toContain('physically carrying');
    });

    it('classifies as TravellerImport even when seller is involved', async () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: true,
        carrierId: 'posti',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: true,
        sellerId: 'some-seller',
      };

      const result = await service.classify(input);
      expect(result.classification).toBe('TravellerImport');
      expect(result.confidence).toBe('HIGH');
    });

    // -----------------------------------------------------------------------
    // Distance Selling
    // -----------------------------------------------------------------------

    it('classifies as DistanceSelling when seller arranges transport', async () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: true,
        carrierId: 'posti',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: 'known-seller-123',
      };

      const result = await service.classify(input);
      expect(result.classification).toBe('DistanceSelling');
      expect(result.confidence).toBe('HIGH');
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0].observation).toContain('direct delivery');
      expect(result.evidence[0].supportingData).toContain('carrier: posti');
    });

    it('classifies as DistanceSelling regardless of carrier when seller involved', async () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: true,
        carrierId: '',
        sellerCountry: 'EE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: '',
      };

      const result = await service.classify(input);
      expect(result.classification).toBe('DistanceSelling');
      expect(result.confidence).toBe('HIGH');
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0].supportingData).toContain('carrier information not available');
    });

    // -----------------------------------------------------------------------
    // Distance Buying — independent carrier, known seller (HIGH)
    // -----------------------------------------------------------------------

    it('classifies as DistanceBuying with HIGH confidence when independent carrier and known seller', async () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: false,
        carrierId: 'dhl',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: 'known-merchant',
      };

      const result = await service.classify(input);
      expect(result.classification).toBe('DistanceBuying');
      expect(result.confidence).toBe('HIGH');
      expect(result.evidence).toHaveLength(3);
      expect(result.evidence[0].observation).toContain('independent carrier');
      expect(result.evidence[0].supportingData).toContain('carrier: dhl');
      expect(result.evidence[2].observation).toContain('Seller identity confirmed');
    });

    // -----------------------------------------------------------------------
    // Distance Buying — independent carrier, unknown seller (MEDIUM)
    // -----------------------------------------------------------------------

    it('classifies as DistanceBuying with MEDIUM confidence when independent carrier but seller unknown', async () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: false,
        carrierId: 'dhl',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: '',
      };

      const result = await service.classify(input);
      expect(result.classification).toBe('DistanceBuying');
      expect(result.confidence).toBe('MEDIUM');
      expect(result.evidence).toHaveLength(3);
      expect(result.evidence[0].observation).toContain('independent carrier');
      expect(result.evidence[0].supportingData).toContain('carrier: dhl');
      expect(result.evidence[2].observation).toContain('unverified');
      expect(result.evidenceSummary).toContain('unverified');
    });

    it('classifies as DistanceBuying with MEDIUM confidence when sellerId is whitespace', async () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: false,
        carrierId: 'posti',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: '   ',
      };

      const result = await service.classify(input);
      expect(result.classification).toBe('DistanceBuying');
      expect(result.confidence).toBe('MEDIUM');
    });

    // -----------------------------------------------------------------------
    // Distance Buying — unknown transport
    // -----------------------------------------------------------------------

    it('classifies as DistanceBuying with LOW confidence when transport unknown', async () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: false,
        carrierId: '',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: '',
      };

      const result = await service.classify(input);
      expect(result.classification).toBe('DistanceBuying');
      expect(result.confidence).toBe('LOW');
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0].observation).toContain('could not be determined');
    });

    it('classifies as DistanceBuying with LOW confidence when carrier is blank', async () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: false,
        carrierId: '   ',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: '',
      };

      const result = await service.classify(input);
      expect(result.classification).toBe('DistanceBuying');
      expect(result.confidence).toBe('LOW');
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0].observation).toContain('could not be determined');
    });

    // -----------------------------------------------------------------------
    // Evidence structure
    // -----------------------------------------------------------------------

    it('every evidence item has observation, supportingData, and source', async () => {
      const inputs: ClassificationInput[] = [
        { sellerInvolvementIndicator: true, carrierId: 'posti', sellerCountry: 'DE', buyerCountry: 'FI', buyerIsTravelling: false, sellerId: '' },
        { sellerInvolvementIndicator: false, carrierId: 'dhl', sellerCountry: 'DE', buyerCountry: 'FI', buyerIsTravelling: false, sellerId: 'merchant' },
        { sellerInvolvementIndicator: false, carrierId: '', sellerCountry: 'DE', buyerCountry: 'FI', buyerIsTravelling: false, sellerId: '' },
        { sellerInvolvementIndicator: false, carrierId: '', sellerCountry: 'EE', buyerCountry: 'FI', buyerIsTravelling: true, sellerId: '' },
      ];

      for (const input of inputs) {
        const result: ClassificationResult = await service.classify(input);
        for (const item of result.evidence) {
          expect(item).toHaveProperty('observation');
          expect(item).toHaveProperty('supportingData');
          expect(item).toHaveProperty('source');
          expect(typeof item.observation).toBe('string');
          expect(item.observation.length).toBeGreaterThan(5);
          expect(typeof item.supportingData).toBe('string');
          expect(item.supportingData.length).toBeGreaterThan(3);
          expect(typeof item.source).toBe('string');
          expect(item.source.length).toBeGreaterThan(2);
        }
      }
    });

    it('evidence items are never bare legal conclusions — always observed patterns', async () => {
      const inputs: ClassificationInput[] = [
        { sellerInvolvementIndicator: true, carrierId: 'posti', sellerCountry: 'DE', buyerCountry: 'FI', buyerIsTravelling: false, sellerId: '' },
        { sellerInvolvementIndicator: false, carrierId: 'dhl', sellerCountry: 'DE', buyerCountry: 'FI', buyerIsTravelling: false, sellerId: '' },
        { sellerInvolvementIndicator: false, carrierId: '', sellerCountry: 'DE', buyerCountry: 'FI', buyerIsTravelling: false, sellerId: '' },
        { sellerInvolvementIndicator: false, carrierId: '', sellerCountry: 'EE', buyerCountry: 'FI', buyerIsTravelling: true, sellerId: '' },
      ];

      for (const input of inputs) {
        const result: ClassificationResult = await service.classify(input);
        for (const item of result.evidence) {
          // Every observation should be a factual statement, not a legal conclusion
          expect(item.observation).not.toMatch(/is liable|shall pay|must register/i);
        }
      }
    });

    it('evidenceSummary is always derived from evidence array and mentions all observations', async () => {
      const inputs: ClassificationInput[] = [
        { sellerInvolvementIndicator: true, carrierId: 'posti', sellerCountry: 'DE', buyerCountry: 'FI', buyerIsTravelling: false, sellerId: '' },
        { sellerInvolvementIndicator: false, carrierId: 'dhl', sellerCountry: 'DE', buyerCountry: 'FI', buyerIsTravelling: false, sellerId: 'merchant' },
        { sellerInvolvementIndicator: false, carrierId: '', sellerCountry: 'DE', buyerCountry: 'FI', buyerIsTravelling: false, sellerId: '' },
        { sellerInvolvementIndicator: false, carrierId: '', sellerCountry: 'EE', buyerCountry: 'FI', buyerIsTravelling: true, sellerId: '' },
      ];

      for (const input of inputs) {
        const result: ClassificationResult = await service.classify(input);
        // Single-item evidence starts with "Based on:", multi-item starts with "Classification based on..."
        expect(result.evidenceSummary).toMatch(/^(Based on:|Classification based on)/);
        // evidenceSummary should contain at least some data from each evidence item
        for (const item of result.evidence) {
          expect(result.evidenceSummary).toContain(item.observation);
        }
      }
    });

    // -----------------------------------------------------------------------
    // Evidence summary
    // -----------------------------------------------------------------------

    it('produces a non-empty evidence summary for every classification', async () => {
      const inputs: ClassificationInput[] = [
        { sellerInvolvementIndicator: true, carrierId: 'posti', sellerCountry: 'DE', buyerCountry: 'FI', buyerIsTravelling: false, sellerId: '' },
        { sellerInvolvementIndicator: false, carrierId: 'dhl', sellerCountry: 'DE', buyerCountry: 'FI', buyerIsTravelling: false, sellerId: 'merchant' },
        { sellerInvolvementIndicator: false, carrierId: '', sellerCountry: 'DE', buyerCountry: 'FI', buyerIsTravelling: false, sellerId: '' },
        { sellerInvolvementIndicator: false, carrierId: '', sellerCountry: 'EE', buyerCountry: 'FI', buyerIsTravelling: true, sellerId: '' },
      ];

      for (const input of inputs) {
        const result: ClassificationResult = await service.classify(input);
        expect(result.evidenceSummary.length).toBeGreaterThan(10);
        expect(result.evidenceSummary).toContain(input.sellerCountry);
        expect(result.evidenceSummary).toContain(input.buyerCountry);
      }
    });

    // -----------------------------------------------------------------------
    // Idempotence — pure function contract
    // -----------------------------------------------------------------------

    it('returns identical results for identical inputs (idempotent)', async () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: true,
        carrierId: 'posti',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: 'known-seller-123',
      };

      const a = await service.classify(input);
      const b = await service.classify(input);
      expect(a).toEqual(b);
    });

    // -----------------------------------------------------------------------
    // Sync mode - classifySync
    // -----------------------------------------------------------------------

    it('classifySync returns identical results to classify', async () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: false,
        carrierId: 'dhl',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: '',
      };

      const asyncResult = await service.classify(input);
      const syncResult = service.classifySync(input);
      expect(syncResult).toEqual(asyncResult);
    });
  });
});