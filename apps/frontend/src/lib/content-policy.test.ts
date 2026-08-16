import { describe, expect, it } from 'vitest';
import { checkContent, isCompliant, FORBIDDEN_ADJECTIVES } from './content-policy';

describe('content-policy', () => {
  describe('FORBIDDEN_ADJECTIVES', () => {
    it('contains expected words', () => {
      expect(FORBIDDEN_ADJECTIVES.has('best')).toBe(true);
      expect(FORBIDDEN_ADJECTIVES.has('amazing')).toBe(true);
      expect(FORBIDDEN_ADJECTIVES.has('premium')).toBe(true);
      expect(FORBIDDEN_ADJECTIVES.has('exclusive')).toBe(true);
      expect(FORBIDDEN_ADJECTIVES.has('cheapest')).toBe(true);
    });

    it('is a ReadonlyMap (immutable at runtime)', () => {
      expect(FORBIDDEN_ADJECTIVES).toBeInstanceOf(Map);
    });
  });

  describe('checkContent', () => {
    it('returns empty array for compliant text', () => {
      expect(checkContent('This product has 4.7% ABV and costs €12.50')).toEqual([]);
    });

    it('returns empty for empty string', () => {
      expect(checkContent('')).toEqual([]);
    });

    it('detects single forbidden word', () => {
      const violations = checkContent('This is the best beer in Finland');
      expect(violations).toHaveLength(1);
      expect(violations[0].word).toBe('best');
    });

    it('detects multiple violations', () => {
      const violations = checkContent('The amazing superior premium beer');
      expect(violations.length).toBeGreaterThanOrEqual(3);
      const words = violations.map((v) => v.word);
      expect(words).toContain('amazing');
      expect(words).toContain('superior');
      expect(words).toContain('premium');
    });

    it('is case-insensitive', () => {
      expect(checkContent('This is BEST')).toHaveLength(1);
      expect(checkContent('AMAZING value')).toHaveLength(1);
      expect(checkContent('Premium quality')).toHaveLength(1);
    });

    it('matches word boundaries (not substrings)', () => {
      // "best" inside "beste" should not match
      expect(checkContent('Die beste Bier')).toEqual([]);
    });

    it('matches multi-word phrases', () => {
      const violations = checkContent('Top bargain at the store');
      expect(violations.some((v) => v.word === 'top bargain')).toBe(true);
    });

    it('includes surrounding context', () => {
      const violations = checkContent('Buy this best beer today');
      expect(violations[0].context).toContain('[best]');
    });

    it('includes suggestion when available', () => {
      const violations = checkContent('The cheapest option');
      expect(violations[0].suggestion).toBe(
        'use "lowest landed cost" or "lowest price"',
      );
    });

    it('suggestion is undefined when not set', () => {
      const violations = checkContent('This is amazing');
      expect(violations[0].suggestion).toBeUndefined();
    });

    it('handles text with no violations gracefully', () => {
      expect(
        checkContent(
          'Classification: Distance Selling. Tax: €1.50/litre excise.',
        ),
      ).toEqual([]);
    });
  });

  describe('isCompliant', () => {
    it('returns true for compliant text', () => {
      expect(isCompliant('Product price: €12.50, ABV: 4.7%')).toBe(true);
    });

    it('returns false for non-compliant text', () => {
      expect(isCompliant('The best beer ever')).toBe(false);
    });
  });
});
