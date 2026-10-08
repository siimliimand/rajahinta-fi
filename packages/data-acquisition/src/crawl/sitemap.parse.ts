/**
 * Sitemap XML parser (task 1.1, change sitemap-crawl-merchants; design D4).
 *
 * Pure function over the sitemap body — no I/O, deterministic. Runs on the
 * Workers runtime, which has no DOMParser, so the urlset is read with
 * bounded tag matching instead of a full XML tree: only the pieces the
 * crawl consumes (`loc`, `lastmod`) are extracted.
 *
 * Tolerances pinned by the recon facts (2026-10-07):
 * - CDATA-wrapped values (viinarannasta wraps every `loc`).
 * - Namespace prefixes are matched by local name, so `<image:image>` /
 *   `<image:loc>` blocks never confuse the page `loc` — within a `<url>`
 *   block the FIRST `loc` wins, and the sitemap protocol places the page
 *   URL first, ahead of any nested `image:loc`.
 * - `lastmod` appears both as ISO 8601 instants with a timezone offset
 *   (viinarannasta) and bare dates (viinikauppa, licorea); both are kept
 *   verbatim — the diff compares strings, never parses dates.
 * -drinkonline exposes no `lastmod` at all; entries simply carry null.
 *
 * @module SitemapParse
 */

/** One product-URL candidate from a `<url>` block. */
export interface SitemapEntry {
  readonly loc: string;
  /** Verbatim sitemap value; null when the entry carries no `lastmod`. */
  readonly lastmod: string | null;
}

export interface SitemapParseResult {
  readonly entries: readonly SitemapEntry[];
  /** Non-null when the body is not a usable per-product urlset. */
  readonly error: string | null;
}

const URL_BLOCK_PATTERN = /<url\b[^>]*>([\s\S]*?)<\/url\s*>/gi;
const SITEMAP_INDEX_PATTERN = /<sitemapindex[\s>]/i;
const URLSET_PATTERN = /<urlset[\s>]/i;
const CDATA_PATTERN = /^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/;

const XML_NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeXmlEntities(text: string): string {
  return text.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (raw, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
        return String.fromCodePoint(code);
      }
      return raw;
    }
    return XML_NAMED_ENTITIES[body] ?? raw;
  });
}

/**
 * First occurrence of a local-named tag inside a `<url>` block, with any
 * namespace prefix tolerated. CDATA content is taken verbatim (never
 * entity-decoded); plain content is entity-decoded.
 */
function extractTagText(block: string, localName: string): string | null {
  const pattern = new RegExp(
    `<(?:[A-Za-z_][-\\w.-]*:)?${localName}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z_][-\\w.-]*:)?${localName}\\s*>`,
    'i',
  );
  const match = pattern.exec(block);
  if (match === null) return null;

  const cdata = CDATA_PATTERN.exec(match[1]);
  const raw = cdata !== null ? cdata[1] : decodeXmlEntities(match[1]);
  return raw.trim();
}

/**
 * Parse a sitemap body into urlset entries. A `sitemapindex` document, a
 * non-XML body, or any other structural surprise is a collected error —
 * never a throw; the caller reports it and skips the cycle.
 */
export function parseSitemapXml(xml: string): SitemapParseResult {
  if (SITEMAP_INDEX_PATTERN.test(xml)) {
    return {
      entries: [],
      error: 'body is a sitemap index; a per-product urlset is expected',
    };
  }
  if (!URLSET_PATTERN.test(xml)) {
    return { entries: [], error: 'body is not a sitemap urlset document' };
  }

  const entries: SitemapEntry[] = [];
  for (const match of xml.matchAll(URL_BLOCK_PATTERN)) {
    const loc = extractTagText(match[1], 'loc');
    if (loc === null || loc === '') continue;
    const lastmod = extractTagText(match[1], 'lastmod');
    entries.push({ loc, lastmod: lastmod === null || lastmod === '' ? null : lastmod });
  }
  return { entries, error: null };
}
