/**
 * HTML entity decoding for feed-provided display text.
 *
 * WooCommerce Store API feeds persist product names and brands with
 * encoded entities (`&#038;`, `&#8221;`, `&#215;`, `&amp;`, …). The
 * canonical record must carry the decoded characters, so decoding happens
 * once at ingestion — never at render, where output escaping stays as-is.
 *
 * Single-pass by construction: `String.replace` never rescans its own
 * replacement output, so an already-decoded `&` or the literal text
 * `&amp;amp;` survives byte-identical instead of being decoded twice.
 *
 * @module html-entities
 */

/** Named entities seen in merchant feed display text (HTML is case-sensitive; only the lowercase forms are decoded). */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0',
  copy: '\u00A9',
  reg: '\u00AE',
  trade: '\u2122',
  deg: '\u00B0',
  times: '\u00D7',
  euro: '\u20AC',
  pound: '\u00A3',
  cent: '\u00A2',
  yen: '\u00A5',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201C',
  rdquo: '\u201D',
};

const ENTITY_PATTERN = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g;

/**
 * Numeric code points that may land in persisted display text. Surrogates
 * and control characters are rejected — an unpaired surrogate cannot be
 * encoded and a control character is never legitimate product text, so
 * the raw entity stays (no guessing, correction queue can catch it).
 */
function isDecodableCodePoint(codePoint: number): boolean {
  return (
    Number.isInteger(codePoint) &&
    codePoint >= 0x20 &&
    codePoint !== 0x7f &&
    codePoint <= 0x10ffff &&
    !(codePoint >= 0xd800 && codePoint <= 0xdfff)
  );
}

/**
 * Decode named and numeric HTML entities in feed display text.
 *
 * Unknown named entities and out-of-range/invalid numeric references pass
 * through unchanged — decoding never invents characters the source did
 * not unambiguously name.
 */
export function decodeHtmlEntities(input: string): string {
  return input.replace(
    ENTITY_PATTERN,
    (match, decimal: string | undefined, hex: string | undefined, named: string | undefined) => {
      if (named !== undefined) {
        return NAMED_ENTITIES[named] ?? match;
      }
      const codePoint = decimal !== undefined ? Number(decimal) : parseInt(hex!, 16);
      if (!isDecodableCodePoint(codePoint)) return match;
      return String.fromCodePoint(codePoint);
    },
  );
}
