import { describe, it, expect } from 'vitest';
import {
  validateEffectiveRanges,
  type EffectiveRangeInput,
} from '../tax-rate.repository';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function d(iso: string): Date {
  return new Date(iso);
}

function rule(from: string, to: string | null): EffectiveRangeInput {
  return { effectiveFrom: d(from), effectiveTo: to ? d(to) : null };
}

// ---------------------------------------------------------------------------
// validateEffectiveRanges — pure date-interval validation
// ---------------------------------------------------------------------------

describe('validateEffectiveRanges', () => {
  describe('edge cases (0 or 1 rule)', () => {
    it('returns empty for empty array', () => {
      expect(validateEffectiveRanges([])).toEqual([]);
    });

    it('returns empty for single rule', () => {
      expect(validateEffectiveRanges([rule('2026-01-01', '2026-12-31')])).toEqual([]);
    });

    it('returns empty for single open-ended rule', () => {
      expect(validateEffectiveRanges([rule('2026-01-01', null)])).toEqual([]);
    });
  });

  describe('valid non-overlapping, gapless ranges', () => {
    it('adjacent ranges — no gap, no overlap', () => {
      // 2026 intra-year split: 1.1.–31.3. then 1.4.–31.12.
      const errors = validateEffectiveRanges([
        rule('2026-01-01', '2026-03-31'),
        rule('2026-04-01', '2026-12-31'),
      ]);
      expect(errors).toEqual([]);
    });

    it('multiple sequential ranges with no gaps', () => {
      const errors = validateEffectiveRanges([
        rule('2024-01-01', '2024-12-31'),
        rule('2025-01-01', '2025-12-31'),
        rule('2026-01-01', '2026-12-31'),
      ]);
      expect(errors).toEqual([]);
    });

    it('single open-ended followed by nothing is valid', () => {
      expect(validateEffectiveRanges([rule('2024-01-01', null)])).toEqual([]);
    });

    it('open-ended rule alone is valid', () => {
      expect(validateEffectiveRanges([rule('2024-01-01', null)])).toEqual([]);
    });

    it('final rule open-ended after closed prior ranges', () => {
      expect(validateEffectiveRanges([
        rule('2024-01-01', '2024-12-31'),
        rule('2025-01-01', null),
      ])).toEqual([]);
    });

    it('adjacent ranges with single-day intervals', () => {
      const errors = validateEffectiveRanges([
        rule('2024-01-01', '2024-01-01'),
        rule('2024-01-02', '2024-01-02'),
      ]);
      expect(errors).toEqual([]);
    });
  });

  describe('overlap detection', () => {
    it('detects overlap when next starts before prev ends', () => {
      const errors = validateEffectiveRanges([
        rule('2026-01-01', '2026-06-30'),
        rule('2026-06-01', '2026-12-31'),
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Overlap');
    });

    it('detects overlap when next starts on prev end date', () => {
      // Same-day boundary would be overlap (vs adjacent which is +1 day)
      const errors = validateEffectiveRanges([
        rule('2026-01-01', '2026-03-31'),
        rule('2026-03-31', '2026-12-31'),
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Overlap');
    });

    it('detects overlap when next is completely inside prev', () => {
      const errors = validateEffectiveRanges([
        rule('2026-01-01', '2026-12-31'),
        rule('2026-06-01', '2026-09-30'),
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Overlap');
    });

    it('detects overlap with three rules where two overlap', () => {
      const errors = validateEffectiveRanges([
        rule('2024-01-01', '2024-12-31'),
        rule('2025-01-01', '2025-06-30'),
        rule('2025-06-01', '2025-12-31'),
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Overlap');
    });
  });

  describe('gap detection', () => {
    it('detects gap of several days', () => {
      const errors = validateEffectiveRanges([
        rule('2026-01-01', '2026-03-31'),
        rule('2026-04-05', '2026-12-31'),
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Gap');
      expect(errors[0]).toContain('2026-04-01'); // expected start
    });

    it('detects gap of one day (not adjacent)', () => {
      const errors = validateEffectiveRanges([
        rule('2026-01-01', '2026-03-31'),
        rule('2026-04-02', '2026-12-31'),
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Gap');
    });

    it('detects gap spanning months', () => {
      const errors = validateEffectiveRanges([
        rule('2024-01-01', '2024-06-30'),
        rule('2024-09-01', '2024-12-31'),
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Gap');
    });
  });

  describe('open-ended rule conflicts', () => {
    it('multiple open-ended rules flagged as overlap', () => {
      const errors = validateEffectiveRanges([
        rule('2024-01-01', null),
        rule('2025-01-01', null),
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Multiple open-ended rules');
    });

    it('open-ended followed by closed rule flagged as overlap', () => {
      const errors = validateEffectiveRanges([
        rule('2024-01-01', null),
        rule('2025-01-01', '2025-12-31'),
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Overlap');
      expect(errors[0]).toContain('open-ended');
    });
  });

  describe('multiple issues reported', () => {
    it('reports both gap and overlap when present', () => {
      const errors = validateEffectiveRanges([
        rule('2024-01-01', '2024-06-30'),
        // gap: 2024-07-01 to 2024-09-14 uncovered
        rule('2024-09-15', '2024-12-31'),
        // overlap: starts before prev ends
        rule('2024-12-01', '2025-06-30'),
      ]);
      expect(errors).toHaveLength(2);
      const descriptions = errors.join(' ');
      expect(descriptions).toContain('Gap');
      expect(descriptions).toContain('Overlap');
    });
  });

  describe('boundary: expiry-date equality (D5)', () => {
    it('adjacent ranges with month-end boundaries are valid', () => {
      // 31.1. → 1.2.  (January 31 days)
      const errors = validateEffectiveRanges([
        rule('2026-01-01', '2026-01-31'),
        rule('2026-02-01', '2026-12-31'),
      ]);
      expect(errors).toEqual([]);
    });

    it('Adjacent ranges with leap-year Feb boundary', () => {
      // 28.2.2025 → 1.3.2025 (non-leap year)
      const errors = validateEffectiveRanges([
        rule('2025-01-01', '2025-02-28'),
        rule('2025-03-01', '2025-12-31'),
      ]);
      expect(errors).toEqual([]);
    });

    it('Adjacent ranges crossing leap-year Feb 29', () => {
      // 28.2.2024 → 29.2.2024 → 1.3.2024
      const errors = validateEffectiveRanges([
        rule('2024-01-01', '2024-02-28'),
        rule('2024-02-29', '2024-12-31'),
      ]);
      expect(errors).toEqual([]);
    });
  });

  describe('rules not sorted by input order', () => {
    it('handles out-of-order input', () => {
      const errors = validateEffectiveRanges([
        rule('2025-01-01', '2025-12-31'),
        rule('2024-01-01', '2024-12-31'),
      ]);
      expect(errors).toEqual([]); // sorted internally
    });
  });
});