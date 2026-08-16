import { describe, it, expect } from 'vitest';
import { TransportClassificationService } from '../transport-classification.service';
import type { TransactionTransportType } from '../transport-classification.types';

const service = new TransportClassificationService();

describe('TransportClassificationService', () => {
  describe('classifyTransport', () => {
    it('classifies as RETAILER_ARRANGED when sellerInvolvementIndicator is true', () => {
      const result: TransactionTransportType = service.classifyTransport(true, 'posti');
      expect(result).toBe('RETAILER_ARRANGED');
    });

    it('classifies as RETAILER_ARRANGED regardless of carrier when seller involved', () => {
      const result: TransactionTransportType = service.classifyTransport(true, '');
      expect(result).toBe('RETAILER_ARRANGED');
    });

    it('classifies as INDEPENDENT_CARRIER when seller not involved and carrier known', () => {
      const result: TransactionTransportType = service.classifyTransport(false, 'dhl');
      expect(result).toBe('INDEPENDENT_CARRIER');
    });

    it('classifies as INDEPENDENT_CARRIER for any non-empty carrier string', () => {
      const result: TransactionTransportType = service.classifyTransport(false, 'schenker');
      expect(result).toBe('INDEPENDENT_CARRIER');
    });

    it('classifies as UNKNOWN when seller not involved and carrier is empty', () => {
      const result: TransactionTransportType = service.classifyTransport(false, '');
      expect(result).toBe('UNKNOWN');
    });

    it('classifies as UNKNOWN when seller not involved and carrier is blank', () => {
      const result: TransactionTransportType = service.classifyTransport(false, '   ');
      expect(result).toBe('UNKNOWN');
    });

    it('is a pure function — no side effects', () => {
      const a = service.classifyTransport(true, 'posti');
      const b = service.classifyTransport(true, 'posti');
      expect(a).toBe(b);
    });
  });
});