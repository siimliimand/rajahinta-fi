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
});