/**
 * ContentLintService tests.
 *
 * High-liability logic coverage:
 *   - Every banned pattern in Finnish, English, Swedish
 *   - Word-boundary safety for single-word patterns
 *   - Multi-word phrase matching
 *   - Empty / edge-case input
 *   - Neutral vocabulary (no false positives)
 *   - Mixed-language and cross-field violations
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ContentLintService } from '../content/content-lint.service';

describe('ContentLintService', () => {
  let service: ContentLintService;

  beforeAll(() => {
    service = new ContentLintService();
  });

  // ---------------------------------------------------------------------------
  // Finnish banned patterns
  // ---------------------------------------------------------------------------

  describe('Finnish banned patterns', () => {
    it('detects "paras" in name', () => {
      const result = service.lintProductContent('Paras olut', '');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toMatchObject({
        pattern: 'paras',
        field: 'name',
        language: 'fi',
        matchedText: 'Paras',
      });
    });

    it('detects "paras" in description', () => {
      const result = service.lintProductContent('', 'Tämä on paras tuote');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toMatchObject({
        pattern: 'paras',
        field: 'description',
        language: 'fi',
      });
    });

    it('detects "edullisin"', () => {
      const result = service.lintProductContent('edullisin vaihtoehto', '');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].pattern).toBe('edullisin');
    });

    it('detects "laadukas"', () => {
      const result = service.lintProductContent('laadukas viini', '');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].pattern).toBe('laadukas');
    });

    it('detects "ensiluokkainen"', () => {
      const result = service.lintProductContent('ensiluokkainen juoma', '');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].pattern).toBe('ensiluokkainen');
    });

    it('detects "ainutlaatuinen"', () => {
      const result = service.lintProductContent('ainutlaatuinen maku', '');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].pattern).toBe('ainutlaatuinen');
    });

    it('detects "täydellinen"', () => {
      const result = service.lintProductContent('täydellinen valinta', '');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].pattern).toBe('täydellinen');
    });

    it('detects "haitaton"', () => {
      const result = service.lintProductContent('haitaton juoma', '');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].pattern).toBe('haitaton');
    });

    it('detects "turvallisin"', () => {
      const result = service.lintProductContent('turvallisin valinta', '');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].pattern).toBe('turvallisin');
    });

    it('does NOT match partial-word substring of Finnish compound', () => {
      // "paras" should not match inside a word like "epäsuosittu" — word
      // boundary \b prevents it.
      const result = service.lintProductContent('epäsuosittu tuote', '');
      expect(result.violations).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // English banned patterns
  // ---------------------------------------------------------------------------

  describe('English banned patterns', () => {
    it('detects "best" in name', () => {
      const result = service.lintProductContent('Best Beer', '');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toMatchObject({
        pattern: 'best',
        field: 'name',
        language: 'en',
        matchedText: 'Best',
      });
    });

    it('detects "best" in description', () => {
      const result = service.lintProductContent('', 'the best choice');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toMatchObject({
        pattern: 'best',
        field: 'description',
        language: 'en',
      });
    });

    it('detects "cheapest"', () => {
      const result = service.lintProductContent('cheapest wine', '');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].pattern).toBe('cheapest');
    });

    it('detects "highest quality" as a phrase', () => {
      const result = service.lintProductContent('highest quality vodka', '');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].pattern).toBe('highest quality');
    });

    it('detects "premium"', () => {
      const result = service.lintProductContent('premium gin', '');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].pattern).toBe('premium');
    });

    it('detects "exclusive"', () => {
      const result = service.lintProductContent('exclusive edition', '');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].pattern).toBe('exclusive');
    });

    it('detects "perfect"', () => {
      const result = service.lintProductContent('perfect pairing', '');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].pattern).toBe('perfect');
    });

    it('detects "guaranteed"', () => {
      const result = service.lintProductContent('guaranteed fresh', '');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].pattern).toBe('guaranteed');
    });

    it('is case-insensitive for English patterns', () => {
      const result = service.lintProductContent('BEST CheApEsT PREMIUM', '');
      expect(result.violations).toHaveLength(3);
      expect(result.violations.map((v) => v.pattern)).toEqual(
        expect.arrayContaining(['best', 'cheapest', 'premium']),
      );
    });

    it('does NOT match "best" inside "unbestimmter" (German)', () => {
      const result = service.lintProductContent('unbestimmter artikel', '');
      expect(result.violations).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Swedish banned patterns
  // ---------------------------------------------------------------------------

  describe('Swedish banned patterns', () => {
    it('detects "bästa" in name', () => {
      const result = service.lintProductContent('Bästa ölen', '');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toMatchObject({
        pattern: 'bästa',
        field: 'name',
        language: 'sv',
        matchedText: 'Bästa',
      });
    });

    it('detects "bästa" in description', () => {
      const result = service.lintProductContent('', 'detta är bästa valet');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toMatchObject({
        pattern: 'bästa',
        field: 'description',
        language: 'sv',
      });
    });

    it('detects "billigast"', () => {
      const result = service.lintProductContent('billigast öl', '');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].pattern).toBe('billigast');
    });

    it('detects "högsta kvalitet" as a phrase', () => {
      const result = service.lintProductContent('högsta kvalitet vin', '');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].pattern).toBe('högsta kvalitet');
    });

    it('detects "exklusiv"', () => {
      const result = service.lintProductContent('exklusiv dryck', '');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].pattern).toBe('exklusiv');
    });

    it('detects "perfekt"', () => {
      const result = service.lintProductContent('perfekt smak', '');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].pattern).toBe('perfekt');
    });

    it('is case-insensitive for Swedish patterns', () => {
      const result = service.lintProductContent('BÄSTA PERFEKT', '');
      expect(result.violations).toHaveLength(2);
      expect(result.violations.map((v) => v.pattern)).toEqual(
        expect.arrayContaining(['bästa', 'perfekt']),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Multi-word phrase patterns
  // ---------------------------------------------------------------------------

  describe('Multi-word phrase matching', () => {
    it('matches "highest quality" as literal substring across spaces', () => {
      const result = service.lintProductContent('the Highest Quality beer', '');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].pattern).toBe('highest quality');
      expect(result.violations[0].matchedText).toBe('Highest Quality');
    });

    it('matches "högsta kvalitet" as literal substring', () => {
      const result = service.lintProductContent('Högsta Kvalitet vodka', '');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].pattern).toBe('högsta kvalitet');
    });

    it('does not match partial of phrase', () => {
      // "highest" alone should match as single-word pattern, but "highest
      // qualitea" should NOT match the phrase "highest quality"
      const result = service.lintProductContent('highest qualitea', '');
      // "highest" has a word-boundary match → 1 violation for EN "highest quality"
      // Wait: "highest quality" is a phrase entry with isPhrase=true. "highest"
      // is NOT a separate single-word entry. So "highest" alone should not match
      // the phrase, and there is no single-word entry for just "highest".
      // Therefore this should be 0 violations.
      expect(result.violations).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('Edge cases', () => {
    it('returns empty violations for empty strings', () => {
      const result = service.lintProductContent('', '');
      expect(result.violations).toEqual([]);
    });

    it('returns empty violations for empty name with clean description', () => {
      const result = service.lintProductContent('', 'tavallinen olut 4.5%');
      expect(result.violations).toEqual([]);
    });

    it('returns empty violations for clean name with empty description', () => {
      const result = service.lintProductContent('Olut 0.33l', '');
      expect(result.violations).toEqual([]);
    });

    it('handles whitespace-only strings with no false positives', () => {
      const result = service.lintProductContent('   ', '  \t  ');
      expect(result.violations).toEqual([]);
    });

    it('handles special characters without crashing', () => {
      const result = service.lintProductContent(
        '!!! *** [test] (100%)',
        'price: $9.99 ± 0.50',
      );
      expect(result.violations).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Neutral vocabulary — no false positives
  // ---------------------------------------------------------------------------

  describe('Neutral vocabulary passes without violations', () => {
    it('passes a generic product name', () => {
      const result = service.lintProductContent(
        'Karhu III olut 0.33l tölkki',
        'Panimo: Sinebrychoff',
      );
      expect(result.violations).toEqual([]);
    });

    it('passes a description with facts only', () => {
      const result = service.lintProductContent(
        'Lapin Kulta',
        'Alkoholipitoisuus 4.5%. Valmistusmaa: Suomi. Pullokoko: 0.5l.',
      );
      expect(result.violations).toEqual([]);
    });

    it('passes a Swedish factual description', () => {
      const result = service.lintProductContent(
        'Mariestads',
        'Alkoholhalt 5.3%. Ursprung: Sverige. Volym: 33cl.',
      );
      expect(result.violations).toEqual([]);
    });

    it('passes English factual text without promotional language', () => {
      const result = service.lintProductContent(
        'Heineken',
        'Alcohol by volume: 5.0%. Origin: Netherlands. Package: 24x330ml.',
      );
      expect(result.violations).toEqual([]);
    });

    it('does not flag compound words that contain a banned substring', () => {
      // "paras" should not match "parasoli" (umbrella)
      const result = service.lintProductContent('parasoli', '');
      expect(result.violations).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Mixed-language and cross-field violations
  // ---------------------------------------------------------------------------

  describe('Mixed-language and cross-field violations', () => {
    it('detects violations from multiple languages in a single field', () => {
      const result = service.lintProductContent('Premium bästa olut', '');
      expect(result.violations).toHaveLength(2);
      expect(result.violations.map((v) => v.language)).toEqual(
        expect.arrayContaining(['en', 'sv']),
      );
    });

    it('detects multiple violations in name from same language', () => {
      const result = service.lintProductContent('Best premium choice', '');
      expect(result.violations).toHaveLength(2);
      expect(result.violations.every((v) => v.field === 'name')).toBe(true);
    });

    it('detects violations across both name and description', () => {
      const result = service.lintProductContent('Premium olut', 'paras laatu');
      expect(result.violations).toHaveLength(2);
      const fields = result.violations.map((v) => v.field).sort();
      expect(fields).toEqual(['description', 'name']);
    });

    it('detects all three languages in the same product', () => {
      const result = service.lintProductContent(
        'Premium olut',
        'bästa valinta — paras laatu',
      );
      expect(result.violations).toHaveLength(3);
      const languages = result.violations.map((v) => v.language);
      expect(languages).toEqual(expect.arrayContaining(['fi', 'en', 'sv']));
    });
  });
});