/**
 * Tests for TransactionClassificationService.
 *
 * Covers all four classification paths plus edge cases:
 * - Traveller Import
 * - Distance Selling (retailer-arranged transport)
 * - Distance Buying (independent carrier)
 * - Distance Buying (unknown transport)
 * - Boundary: seller involvement + travelling (travelling takes precedence)
 * - Boundary: empty carrierId with seller involvement
 * - Idempotence: same input → same output
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

    it('classifies as TravellerImport when buyerIsTravelling is true', () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: false,
        carrierId: '',
        sellerCountry: 'EE',
        buyerCountry: 'FI',
        buyerIsTravelling: true,
        sellerId: '',
      };

      const result = service.classify(input);
      expect(result.classification).toBe('TravellerImport');
      expect(result.confidence).toBe('HIGH');
    });

    it('classifies as TravellerImport even when seller is involved', () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: true,
        carrierId: 'posti',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: true,
        sellerId: 'some-seller',
      };

      const result = service.classify(input);
      expect(result.classification).toBe('TravellerImport');
      expect(result.confidence).toBe('HIGH');
    });

    // -----------------------------------------------------------------------
    // Distance Selling
    // -----------------------------------------------------------------------

    it('classifies as DistanceSelling when seller arranges transport', () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: true,
        carrierId: 'posti',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: 'known-seller-123',
      };

      const result = service.classify(input);
      expect(result.classification).toBe('DistanceSelling');
      expect(result.confidence).toBe('HIGH');
    });

    it('classifies as DistanceSelling regardless of carrier when seller involved', () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: true,
        carrierId: '',
        sellerCountry: 'EE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: '',
      };

      const result = service.classify(input);
      expect(result.classification).toBe('DistanceSelling');
      expect(result.confidence).toBe('HIGH');
    });

    // -----------------------------------------------------------------------
    // Distance Buying — independent carrier
    // -----------------------------------------------------------------------

    it('classifies as DistanceBuying with HIGH confidence when independent carrier', () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: false,
        carrierId: 'dhl',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: '',
      };

      const result = service.classify(input);
      expect(result.classification).toBe('DistanceBuying');
      expect(result.confidence).toBe('HIGH');
    });

    // -----------------------------------------------------------------------
    // Distance Buying — unknown transport
    // -----------------------------------------------------------------------

    it('classifies as DistanceBuying with LOW confidence when transport unknown', () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: false,
        carrierId: '',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: '',
      };

      const result = service.classify(input);
      expect(result.classification).toBe('DistanceBuying');
      expect(result.confidence).toBe('LOW');
    });

    it('classifies as DistanceBuying with LOW confidence when carrier is blank', () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: false,
        carrierId: '   ',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: '',
      };

      const result = service.classify(input);
      expect(result.classification).toBe('DistanceBuying');
      expect(result.confidence).toBe('LOW');
    });

    // -----------------------------------------------------------------------
    // Evidence summary
    // -----------------------------------------------------------------------

    it('produces a non-empty evidence summary for every classification', () => {
      const inputs: ClassificationInput[] = [
        { sellerInvolvementIndicator: true, carrierId: 'posti', sellerCountry: 'DE', buyerCountry: 'FI', buyerIsTravelling: false, sellerId: '' },
        { sellerInvolvementIndicator: false, carrierId: 'dhl', sellerCountry: 'DE', buyerCountry: 'FI', buyerIsTravelling: false, sellerId: '' },
        { sellerInvolvementIndicator: false, carrierId: '', sellerCountry: 'DE', buyerCountry: 'FI', buyerIsTravelling: false, sellerId: '' },
        { sellerInvolvementIndicator: false, carrierId: '', sellerCountry: 'EE', buyerCountry: 'FI', buyerIsTravelling: true, sellerId: '' },
      ];

      for (const input of inputs) {
        const result: ClassificationResult = service.classify(input);
        expect(result.evidenceSummary.length).toBeGreaterThan(10);
        expect(result.evidenceSummary).toContain(input.sellerCountry);
        expect(result.evidenceSummary).toContain(input.buyerCountry);
      }
    });

    // -----------------------------------------------------------------------
    // Idempotence — pure function contract
    // -----------------------------------------------------------------------

    it('returns identical results for identical inputs (idempotent)', () => {
      const input: ClassificationInput = {
        sellerInvolvementIndicator: true,
        carrierId: 'posti',
        sellerCountry: 'DE',
        buyerCountry: 'FI',
        buyerIsTravelling: false,
        sellerId: 'known-seller-123',
      };

      const a = service.classify(input);
      const b = service.classify(input);
      expect(a).toEqual(b);
    });
  });
});