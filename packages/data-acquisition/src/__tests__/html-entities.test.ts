/**
 * decodeHtmlEntities tests.
 *
 * Pins the entity-decoding contract used by DataMappingService (task 1.2,
 * change unit-integrity-and-result-trust): WooCommerce feed display text
 * decodes once at ingestion, plain text and already-decoded text pass
 * through byte-identical (no double-decode corruption).
 *
 * @module decodeHtmlEntitiesTests
 */
import { describe, it, expect } from 'vitest';
import { decodeHtmlEntities } from '../services/html-entities';

describe('decodeHtmlEntities — observed live-catalog cases', () => {
  it('decodes the numeric ampersand the feed emits (&#038;)', () => {
    expect(decodeHtmlEntities('Gin &#038; Tonic')).toBe('Gin & Tonic');
  });

  it('decodes the named ampersand (&amp;)', () => {
    expect(decodeHtmlEntities('Gin &amp; Tonic')).toBe('Gin & Tonic');
  });

  it('decodes the typographic right double quote (&#8221;)', () => {
    expect(decodeHtmlEntities('Koskenkorva &#8221;Sisu&#8221;')).toBe('Koskenkorva \u201DSisu\u201D');
  });

  it('decodes the multiplication sign (&#215;)', () => {
    expect(decodeHtmlEntities('Long Drink &#215; 24')).toBe('Long Drink \u00D7 24');
  });

  it('decodes the named quote, apostrophe and nbsp forms', () => {
    expect(decodeHtmlEntities('&quot;')).toBe('"');
    expect(decodeHtmlEntities('&#39;')).toBe("'");
    expect(decodeHtmlEntities('Brand&nbsp;X')).toBe('Brand\u00A0X');
  });

  it('decodes hex numeric references (&#x26; / &#X26;)', () => {
    expect(decodeHtmlEntities('&#x26;')).toBe('&');
    expect(decodeHtmlEntities('&#X26;')).toBe('&');
  });

  it('decodes zero-padded numeric references (&#000038;)', () => {
    expect(decodeHtmlEntities('&#000038;')).toBe('&');
  });

  it('decodes multiple entities in one string', () => {
    expect(decodeHtmlEntities('&#8221;A&#038;B&amp;C&#8221;')).toBe('\u201DA&B&C\u201D');
  });
});

describe('decodeHtmlEntities — no double-decode, no guessing', () => {
  it('passes a bare & through byte-identical', () => {
    expect(decodeHtmlEntities('Fish & Chips')).toBe('Fish & Chips');
  });

  it('passes plain text through byte-identical', () => {
    expect(decodeHtmlEntities('Lapin Kulta IVA 4,7% 0,33 l')).toBe('Lapin Kulta IVA 4,7% 0,33 l');
  });

  it('decodes exactly one pass — &amp;amp; becomes &amp;, never &', () => {
    expect(decodeHtmlEntities('&amp;amp;')).toBe('&amp;');
  });

  it('leaves an unknown named entity unchanged rather than guessing', () => {
    expect(decodeHtmlEntities('Weihenstephaner &auml;')).toBe('Weihenstephaner &auml;');
  });

  it('leaves an entity-shaped token without a known name unchanged', () => {
    expect(decodeHtmlEntities('&notanentity;')).toBe('&notanentity;');
  });

  it('leaves invalid numeric references unchanged — no RangeError, no control characters', () => {
    expect(decodeHtmlEntities('&#1114112;')).toBe('&#1114112;'); // > U+10FFFF
    expect(decodeHtmlEntities('&#0;')).toBe('&#0;'); // NUL
    expect(decodeHtmlEntities('&#1;')).toBe('&#1;'); // control
    expect(decodeHtmlEntities('&#55296;')).toBe('&#55296;'); // surrogate half (decimal)
    expect(decodeHtmlEntities('&#xD800;')).toBe('&#xD800;'); // surrogate half (hex)
  });

  it('maps an empty string to an empty string', () => {
    expect(decodeHtmlEntities('')).toBe('');
  });
});
