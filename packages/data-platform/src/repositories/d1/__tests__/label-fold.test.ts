/**
 * Label-fold unit suite (task 1.1, change label-scan-product-lookup) —
 * pure functions, no D1 fixture: these tests pin the folded search-token
 * vocabulary the scan funnel queries `product_master_fts` with (design
 * D3). The spike cases are contract, not examples: production catalog
 * rows store ASCII forms (`Zoladkowa`), and unicode61 will not fold for
 * them — every mapping below is a retrieval path that exists only if
 * the fold produces exactly these bytes.
 *
 * @module LabelFoldTest
 */
import { describe, it, expect } from 'vitest';
import { foldToken, foldToSearchTokens } from '../label-fold';

describe('foldToSearchTokens — spike cases', () => {
  it('folds the Polish label phrase to its ASCII catalog tokens', () => {
    expect(foldToSearchTokens('Żołądkowa de Luxe')).toEqual([
      'zoladkowa',
      'de',
      'luxe',
    ]);
  });

  it('leaves already-ASCII tokens unchanged (Yeni Raki — the design D4 sibling case)', () => {
    expect(foldToSearchTokens('Yeni Raki')).toEqual(['yeni', 'raki']);
  });

  it('folds Finnish ä/ö (and Swedish å) in label words', () => {
    expect(foldToSearchTokens('Öltermanni Härmä')).toEqual([
      'oltermanni',
      'harma',
    ]);
    expect(foldToSearchTokens('Skål')).toEqual(['skal']);
  });

  it('folds the full Latin-1 + Latin Extended-A contract set per token', () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ['ą', 'a'],
      ['ć', 'c'],
      ['ż', 'z'],
      ['š', 's'],
      ['ž', 'z'],
      ['ö', 'o'],
      ['ä', 'a'],
      ['å', 'a'],
      ['õ', 'o'],
      ['ü', 'u'],
      ['ė', 'e'],
      ['į', 'i'],
      ['ų', 'u'],
      ['ł', 'l'],
      ['ń', 'n'],
      ['é', 'e'],
    ];
    for (const [source, expected] of pairs) {
      expect(foldToken(source), `foldToken(${JSON.stringify(source)})`).toBe(
        expected,
      );
    }
  });

  it('folds NFD-decomposed OCR output as one word, not fragments at each mark', () => {
    // Some OCR pipelines emit decomposed text; a split that treats a
    // combining mark as a separator would shred the word before folding.
    const decomposed = 'żołądkowa'.normalize('NFD');
    expect(decomposed).not.toBe('żołądkowa'); // the input really is NFD
    expect(foldToSearchTokens(decomposed)).toEqual(['zoladkowa']);
    expect(foldToken('z\u0307')).toBe('z'); // decomposed ż alone
  });

  it('folds the singletons NFD cannot decompose (the explicit-map reason)', () => {
    // The proof the map is load-bearing: NFD alone leaves ł untouched.
    expect('ł'.normalize('NFD').replace(/\p{M}/gu, '')).toBe('ł');
    expect(foldToken('ł')).toBe('l');
    expect(foldToken('ø')).toBe('o');
    expect(foldToken('đ')).toBe('d');
    expect(foldToken('ð')).toBe('d');
    expect(foldToken('þ')).toBe('th');
    expect(foldToken('æ')).toBe('ae');
    expect(foldToken('œ')).toBe('oe');
    expect(foldToken('ß')).toBe('ss');
    expect(foldToken('ı')).toBe('i');
  });
});

describe('foldToSearchTokens — tokenization discipline', () => {
  it('drops punctuation-only tokens entirely', () => {
    expect(foldToSearchTokens('*** --- !!! «»')).toEqual([]);
  });

  it('returns [] for empty and whitespace-only input', () => {
    expect(foldToSearchTokens('')).toEqual([]);
    expect(foldToSearchTokens('   \t\n  ')).toEqual([]);
  });

  it('folds mixed-case input to one lowercase form', () => {
    expect(foldToSearchTokens('ŻOŁĄDKOWA De LuXe')).toEqual([
      'zoladkowa',
      'de',
      'luxe',
    ]);
  });

  it('preserves numbers as tokens, splitting on punctuation like unicode61 does', () => {
    expect(foldToSearchTokens('Gran Mirador 7 Brandy')).toEqual([
      'gran',
      'mirador',
      '7',
      'brandy',
    ]);
    // 0.7L / 37,5% split on the decimal/comma separators exactly as the
    // unicode61 tokenizer indexed the same text on the catalog side.
    expect(foldToSearchTokens('37,5% 0.7L')).toEqual(['37', '5', '0', '7l']);
  });

  it('strips label punctuation around and inside words', () => {
    expect(foldToSearchTokens('"Żołądkowa" (de-Luxe), 0.5L')).toEqual([
      'zoladkowa',
      'de',
      'luxe',
      '0',
      '5l',
    ]);
  });

  it('is idempotent — the folded form re-folds to itself', () => {
    const once = foldToSearchTokens('Żołądkowa de Luxe 37,5%').join(' ');
    expect(foldToSearchTokens(once)).toEqual(foldToSearchTokens(once));
  });
});

describe('foldToken — single-token contract', () => {
  it('passes ASCII letters and digits through unchanged', () => {
    expect(foldToken('vodka')).toBe('vodka');
    expect(foldToken('LUXE')).toBe('luxe');
    expect(foldToken('37')).toBe('37');
  });

  it('strips internal punctuation without splitting (the caller owns word splits)', () => {
    expect(foldToken('37,5')).toBe('375');
  });

  it('folds a punctuation-only token to the empty string (compose-then-filter form)', () => {
    expect(foldToken('***')).toBe('');
  });
});
