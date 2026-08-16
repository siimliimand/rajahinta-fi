/**
 * ConfidenceFrameworkService tests.
 *
 * High-liability logic coverage:
 *   - computeResultConfidence mapping rules (HIGH / MEDIUM / LOW)
 *   - confidenceFromStatus one-to-one mapping
 *   - composeStatuses delegates to ReliabilityService
 *   - buildReport produces correct overall + breakdown
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ConfidenceFrameworkService } from '../confidence-framework.service';
import { ReliabilityService } from '../reliability.service';
import type { ReliabilityStatus } from '../reliability.types';
import type { LandingCostInputStatuses } from '../confidence-framework.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a ConfidenceFrameworkService with a real ReliabilityService. */
function createService(): ConfidenceFrameworkService {
  return new ConfidenceFrameworkService(new ReliabilityService());
}

describe('ConfidenceFrameworkService', () => {
  let service: ConfidenceFrameworkService;

  beforeAll(() => {
    service = createService();
  });

  // -------------------------------------------------------------------------
  // computeResultConfidence
  // -------------------------------------------------------------------------

  describe('computeResultConfidence', () => {
    it('returns LOW for empty input', () => {
      expect(service.computeResultConfidence([])).toBe('LOW');
    });

    it('returns HIGH when all statuses are VERIFIED', () => {
      const statuses: ReliabilityStatus[] = ['VERIFIED', 'VERIFIED', 'VERIFIED'];
      expect(service.computeResultConfidence(statuses)).toBe('HIGH');
    });

    it('returns HIGH for a single VERIFIED', () => {
      expect(service.computeResultConfidence(['VERIFIED'])).toBe('HIGH');
    });

    it('returns MEDIUM when at least one ESTIMATED and no STALE/UNAVAILABLE', () => {
      const statuses: ReliabilityStatus[] = ['VERIFIED', 'ESTIMATED'];
      expect(service.computeResultConfidence(statuses)).toBe('MEDIUM');
    });

    it('returns MEDIUM when all are ESTIMATED', () => {
      const statuses: ReliabilityStatus[] = ['ESTIMATED', 'ESTIMATED'];
      expect(service.computeResultConfidence(statuses)).toBe('MEDIUM');
    });

    it('returns LOW when at least one STALE', () => {
      const statuses: ReliabilityStatus[] = ['VERIFIED', 'ESTIMATED', 'STALE'];
      expect(service.computeResultConfidence(statuses)).toBe('LOW');
    });

    it('returns LOW when at least one UNAVAILABLE', () => {
      const statuses: ReliabilityStatus[] = ['VERIFIED', 'ESTIMATED', 'UNAVAILABLE'];
      expect(service.computeResultConfidence(statuses)).toBe('LOW');
    });

    it('returns LOW when all are STALE', () => {
      const statuses: ReliabilityStatus[] = ['STALE', 'STALE'];
      expect(service.computeResultConfidence(statuses)).toBe('LOW');
    });

    it('returns LOW when statuses include both STALE and UNAVAILABLE', () => {
      const statuses: ReliabilityStatus[] = ['VERIFIED', 'UNAVAILABLE', 'STALE'];
      expect(service.computeResultConfidence(statuses)).toBe('LOW');
    });

    it('is consistent: VERIFIED+ESTIMATED+STALE and ESTIMATED+STALE both produce LOW', () => {
      expect(service.computeResultConfidence(['VERIFIED', 'ESTIMATED', 'STALE'])).toBe('LOW');
      expect(service.computeResultConfidence(['ESTIMATED', 'STALE'])).toBe('LOW');
    });
  });

  // -------------------------------------------------------------------------
  // composeStatuses — delegates to ReliabilityService.composeReliability
  // -------------------------------------------------------------------------

  describe('composeStatuses', () => {
    it('returns UNAVAILABLE for empty input', () => {
      expect(service.composeStatuses([])).toBe('UNAVAILABLE');
    });

    it('returns the strictest status among inputs', () => {
      expect(service.composeStatuses(['VERIFIED', 'ESTIMATED', 'STALE'])).toBe('STALE');
    });

    it('returns VERIFIED when all inputs are VERIFIED', () => {
      expect(service.composeStatuses(['VERIFIED', 'VERIFIED'])).toBe('VERIFIED');
    });

    it('returns UNAVAILABLE when input includes UNAVAILABLE', () => {
      expect(service.composeStatuses(['VERIFIED', 'UNAVAILABLE'])).toBe('UNAVAILABLE');
    });

    it('delegates to ReliabilityService (verify same behaviour as direct call)', () => {
      const reliability = new ReliabilityService();
      const svc = new ConfidenceFrameworkService(reliability);

      const statuses: ReliabilityStatus[] = ['VERIFIED', 'ESTIMATED'];
      expect(svc.composeStatuses(statuses)).toBe(reliability.composeReliability(statuses));
    });
  });

  // -------------------------------------------------------------------------
  // confidenceFromStatus
  // -------------------------------------------------------------------------

  describe('confidenceFromStatus', () => {
    it('maps VERIFIED to HIGH', () => {
      expect(service.confidenceFromStatus('VERIFIED')).toBe('HIGH');
    });

    it('maps ESTIMATED to MEDIUM', () => {
      expect(service.confidenceFromStatus('ESTIMATED')).toBe('MEDIUM');
    });

    it('maps STALE to LOW', () => {
      expect(service.confidenceFromStatus('STALE')).toBe('LOW');
    });

    it('maps UNAVAILABLE to LOW', () => {
      expect(service.confidenceFromStatus('UNAVAILABLE')).toBe('LOW');
    });

    it('covers all ReliabilityStatus values exhaustively', () => {
      const statuses: ReliabilityStatus[] = ['VERIFIED', 'ESTIMATED', 'STALE', 'UNAVAILABLE'];
      const results = statuses.map((s) => service.confidenceFromStatus(s));
      expect(results).toEqual(['HIGH', 'MEDIUM', 'LOW', 'LOW']);
    });
  });

  // -------------------------------------------------------------------------
  // buildReport
  // -------------------------------------------------------------------------

  describe('buildReport', () => {
    it('produces overall HIGH with VERIFIED-only inputs', () => {
      const report = service.buildReport([
        { status: 'VERIFIED', label: 'price' },
        { status: 'VERIFIED', label: 'transport' },
      ]);

      expect(report.overall).toBe('HIGH');
      expect(report.breakdown).toHaveLength(2);
      expect(report.breakdown[0].status).toBe('VERIFIED');
      expect(report.breakdown[0].detail).toContain('price');
      expect(report.breakdown[1].status).toBe('VERIFIED');
      expect(report.breakdown[1].detail).toContain('transport');
    });

    it('produces overall MEDIUM when inputs include ESTIMATED', () => {
      const report = service.buildReport([
        { status: 'VERIFIED', label: 'price' },
        { status: 'ESTIMATED', label: 'transport' },
      ]);

      expect(report.overall).toBe('MEDIUM');
      expect(report.breakdown).toHaveLength(2);
    });

    it('produces overall LOW when inputs include STALE or UNAVAILABLE', () => {
      const report = service.buildReport([
        { status: 'VERIFIED', label: 'price' },
        { status: 'STALE', label: 'transport' },
      ]);

      expect(report.overall).toBe('LOW');
    });

    it('breakdown detail contains the label for each status', () => {
      const report = service.buildReport([
        { status: 'STALE', label: 'transport' },
        { status: 'UNAVAILABLE', label: 'classification' },
      ]);

      expect(report.breakdown[0].detail).toMatch(/\[transport\]/);
      expect(report.breakdown[1].detail).toMatch(/\[classification\]/);
    });
  });

  // -------------------------------------------------------------------------
  // computeLandingCostConfidence — domain-specific variant
  // -------------------------------------------------------------------------

  describe('computeLandingCostConfidence', () => {
    function allVerified(): LandingCostInputStatuses {
      return {
        productPrice: 'VERIFIED',
        transport: 'VERIFIED',
        excise: 'VERIFIED',
        containerDuty: 'VERIFIED',
        classification: 'VERIFIED',
      };
    }

    it('returns HIGH when all five inputs are VERIFIED', () => {
      expect(service.computeLandingCostConfidence(allVerified())).toBe('HIGH');
    });

    it('returns MEDIUM when one input is ESTIMATED and rest VERIFIED', () => {
      const inputs: LandingCostInputStatuses = {
        ...allVerified(),
        transport: 'ESTIMATED',
      };
      expect(service.computeLandingCostConfidence(inputs)).toBe('MEDIUM');
    });

    it('returns MEDIUM when multiple inputs are ESTIMATED', () => {
      const inputs: LandingCostInputStatuses = {
        ...allVerified(),
        productPrice: 'ESTIMATED',
        transport: 'ESTIMATED',
      };
      expect(service.computeLandingCostConfidence(inputs)).toBe('MEDIUM');
    });

    it('returns LOW when any input is STALE', () => {
      const inputs: LandingCostInputStatuses = {
        ...allVerified(),
        classification: 'STALE',
      };
      expect(service.computeLandingCostConfidence(inputs)).toBe('LOW');
    });

    it('returns LOW when any input is UNAVAILABLE', () => {
      const inputs: LandingCostInputStatuses = {
        ...allVerified(),
        containerDuty: 'UNAVAILABLE',
      };
      expect(service.computeLandingCostConfidence(inputs)).toBe('LOW');
    });

    it('returns LOW when inputs include both STALE and ESTIMATED', () => {
      const inputs: LandingCostInputStatuses = {
        productPrice: 'VERIFIED',
        transport: 'ESTIMATED',
        excise: 'STALE',
        containerDuty: 'VERIFIED',
        classification: 'ESTIMATED',
      };
      expect(service.computeLandingCostConfidence(inputs)).toBe('LOW');
    });

    it('returns LOW when all five inputs are STALE', () => {
      const inputs: LandingCostInputStatuses = {
        productPrice: 'STALE',
        transport: 'STALE',
        excise: 'STALE',
        containerDuty: 'STALE',
        classification: 'STALE',
      };
      expect(service.computeLandingCostConfidence(inputs)).toBe('LOW');
    });

    it('returns MEDIUM when all inputs are ESTIMATED (no STALE/UNAVAILABLE)', () => {
      const inputs: LandingCostInputStatuses = {
        productPrice: 'ESTIMATED',
        transport: 'ESTIMATED',
        excise: 'ESTIMATED',
        containerDuty: 'ESTIMATED',
        classification: 'ESTIMATED',
      };
      expect(service.computeLandingCostConfidence(inputs)).toBe('MEDIUM');
    });

    it('delegates to computeResultConfidence internally (5 inputs)', () => {
      const inputs: LandingCostInputStatuses = {
        productPrice: 'VERIFIED',
        transport: 'ESTIMATED',
        excise: 'VERIFIED',
        containerDuty: 'VERIFIED',
        classification: 'VERIFIED',
      };
      // 4 VERIFIED + 1 ESTIMATED => MEDIUM
      const direct = service.computeResultConfidence([
        inputs.productPrice,
        inputs.transport,
        inputs.excise,
        inputs.containerDuty,
        inputs.classification,
      ]);
      expect(service.computeLandingCostConfidence(inputs)).toBe(direct);
    });
  });

  // -------------------------------------------------------------------------
  // computeEvidenceFromStatuses — evidence report from a status map
  // -------------------------------------------------------------------------

  describe('computeEvidenceFromStatuses', () => {
    it('produces overall HIGH with VERIFIED-only inputs', () => {
      const report = service.computeEvidenceFromStatuses({
        price: 'VERIFIED',
        transport: 'VERIFIED',
      });

      expect(report.overall).toBe('HIGH');
      expect(report.breakdown).toHaveLength(2);
    });

    it('produces overall MEDIUM when one input is ESTIMATED', () => {
      const report = service.computeEvidenceFromStatuses({
        price: 'VERIFIED',
        transport: 'ESTIMATED',
        excise: 'VERIFIED',
      });

      expect(report.overall).toBe('MEDIUM');
    });

    it('produces overall LOW when input is STALE', () => {
      const report = service.computeEvidenceFromStatuses({
        price: 'STALE',
      });

      expect(report.overall).toBe('LOW');
    });

    it('produces overall LOW when input is UNAVAILABLE', () => {
      const report = service.computeEvidenceFromStatuses({
        classification: 'UNAVAILABLE',
      });

      expect(report.overall).toBe('LOW');
    });

    it('includes every input key in the breakdown', () => {
      const report = service.computeEvidenceFromStatuses({
        productPrice: 'VERIFIED',
        transport: 'ESTIMATED',
        classification: 'STALE',
      });

      expect(report.breakdown).toHaveLength(3);
      const labels = report.breakdown.map((d) => d.detail);
      expect(labels.some((l) => l.includes('[productPrice]'))).toBe(true);
      expect(labels.some((l) => l.includes('[transport]'))).toBe(true);
      expect(labels.some((l) => l.includes('[classification]'))).toBe(true);
    });

    it('breakdown detail explains each status', () => {
      const report = service.computeEvidenceFromStatuses({
        excise: 'UNAVAILABLE',
      });

      expect(report.breakdown[0].status).toBe('UNAVAILABLE');
      expect(report.breakdown[0].detail).toContain('No data is available');
    });

    it('returns LOW for empty inputs map', () => {
      const report = service.computeEvidenceFromStatuses({});

      expect(report.overall).toBe('LOW');
      expect(report.breakdown).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // formatConfidenceDetail — human-readable detail per named input
  // -------------------------------------------------------------------------

  describe('formatConfidenceDetail', () => {
    it('describes VERIFIED price data as verified and current', () => {
      expect(service.formatConfidenceDetail('Price', 'VERIFIED')).toBe(
        'Price data is verified and current',
      );
    });

    it('describes STALE transport as stale with 7-day threshold', () => {
      expect(service.formatConfidenceDetail('Transport', 'STALE')).toBe(
        'Transport estimate is stale (last refreshed over 7 days ago)',
      );
    });

    it('describes ESTIMATED tax rates with deposit status caveat', () => {
      expect(service.formatConfidenceDetail('Tax rates', 'ESTIMATED')).toBe(
        'Tax rules include estimated rates (deposit status unknown)',
      );
    });

    it('covers every status for the Price input', () => {
      expect(service.formatConfidenceDetail('Price', 'ESTIMATED')).toContain(
        'category averages',
      );
      expect(service.formatConfidenceDetail('Price', 'STALE')).toContain('24 hours');
      expect(service.formatConfidenceDetail('Price', 'UNAVAILABLE')).toBe(
        'Price data is not available for this product',
      );
    });

    it('covers every status exhaustively with generic names', () => {
      const statuses: ReliabilityStatus[] = ['VERIFIED', 'ESTIMATED', 'STALE', 'UNAVAILABLE'];
      for (const status of statuses) {
        const detail = service.formatConfidenceDetail('Generic input', status);
        expect(detail).toBeTruthy();
        expect(detail).toContain('Generic input');
      }
    });
  });

  // -------------------------------------------------------------------------
  // computeLandingCostDetail — full named report
  // -------------------------------------------------------------------------

  describe('computeLandingCostDetail', () => {
    function allVerified(): LandingCostInputStatuses {
      return {
        productPrice: 'VERIFIED',
        transport: 'VERIFIED',
        excise: 'VERIFIED',
        containerDuty: 'VERIFIED',
        classification: 'VERIFIED',
      };
    }

    it('produces overall HIGH with all five inputs named in the breakdown', () => {
      const report = service.computeLandingCostDetail(allVerified());

      expect(report.overall).toBe('HIGH');
      expect(report.breakdown).toHaveLength(5);
      expect(report.breakdown.map((d) => d.inputName)).toEqual([
        'Price',
        'Transport',
        'Excise duty',
        'Container duty',
        'Classification',
      ]);
    });

    it('overall matches computeLandingCostConfidence for the same inputs', () => {
      const inputs: LandingCostInputStatuses = {
        ...allVerified(),
        transport: 'ESTIMATED',
        classification: 'STALE',
      };

      const report = service.computeLandingCostDetail(inputs);
      expect(report.overall).toBe(
        service.computeLandingCostConfidence(inputs),
      );
    });

    it('each breakdown item carries the matching status and detail', () => {
      const inputs: LandingCostInputStatuses = {
        productPrice: 'VERIFIED',
        transport: 'STALE',
        excise: 'ESTIMATED',
        containerDuty: 'VERIFIED',
        classification: 'UNAVAILABLE',
      };

      const report = service.computeLandingCostDetail(inputs);
      const transport = report.breakdown[1];
      expect(transport.inputName).toBe('Transport');
      expect(transport.status).toBe('STALE');
      expect(transport.detail).toBe(
        'Transport estimate is stale (last refreshed over 7 days ago)',
      );
    });
  });

  // -------------------------------------------------------------------------
  // getConfidenceForUI — UI-queryable snapshot
  // -------------------------------------------------------------------------

  describe('getConfidenceForUI', () => {
    function allVerified(): LandingCostInputStatuses {
      return {
        productPrice: 'VERIFIED',
        transport: 'VERIFIED',
        excise: 'VERIFIED',
        containerDuty: 'VERIFIED',
        classification: 'VERIFIED',
      };
    }

    it('returns overall HIGH with a positive explanation', () => {
      const snapshot = service.getConfidenceForUI(allVerified());

      expect(snapshot.overall).toBe('HIGH');
      expect(snapshot.explanation).toContain('verified');
      expect(snapshot.inputs).toHaveLength(5);
    });

    it('explains MEDIUM by naming the estimated inputs', () => {
      const inputs: LandingCostInputStatuses = {
        ...allVerified(),
        transport: 'ESTIMATED',
        excise: 'ESTIMATED',
      };

      const snapshot = service.getConfidenceForUI(inputs);
      expect(snapshot.overall).toBe('MEDIUM');
      expect(snapshot.explanation).toContain('2 of 5 inputs are estimated');
      expect(snapshot.explanation).toContain('Transport');
      expect(snapshot.explanation).toContain('Excise duty');
    });

    it('explains LOW by counting stale or unavailable inputs', () => {
      const inputs: LandingCostInputStatuses = {
        ...allVerified(),
        transport: 'STALE',
        containerDuty: 'UNAVAILABLE',
      };

      const snapshot = service.getConfidenceForUI(inputs);
      expect(snapshot.overall).toBe('LOW');
      expect(snapshot.explanation).toContain('2 of 5 inputs are stale or unavailable');
      expect(snapshot.explanation).toContain('caution');
    });

    it('exposes per-input name, status, and detail for direct rendering', () => {
      const inputs: LandingCostInputStatuses = {
        productPrice: 'VERIFIED',
        transport: 'STALE',
        excise: 'VERIFIED',
        containerDuty: 'VERIFIED',
        classification: 'VERIFIED',
      };

      const snapshot = service.getConfidenceForUI(inputs);
      const transport = snapshot.inputs[1];
      expect(transport).toEqual({
        name: 'Transport',
        status: 'STALE',
        detail: 'Transport estimate is stale (last refreshed over 7 days ago)',
      });
    });

    it('keeps overall consistent with computeLandingCostConfidence', () => {
      const inputs: LandingCostInputStatuses = {
        ...allVerified(),
        classification: 'ESTIMATED',
      };

      const snapshot = service.getConfidenceForUI(inputs);
      expect(snapshot.overall).toBe(
        service.computeLandingCostConfidence(inputs),
      );
    });
  });
});