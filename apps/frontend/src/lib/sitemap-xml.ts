/**
 * Sitemap XML serialization (sitemap-tree-coverage task 2.2, design
 * D6) — the small tested writer behind the hand-rolled index tree:
 * `serializeUrlset` for the tree children (`/sitemaps/pages`,
 * `/sitemaps/editorial`, `/sitemaps/products-N`) and
 * `serializeSitemapindex` for `/sitemap.xml`.
 *
 * Both documents mirror EXACTLY the XML shape Next's sitemap metadata
 * route emitted before the tree swap (the pinned regression shape):
 * the 0.9 namespace (+ xhtml namespace on urlsets for the hreflang
 * alternates), one line per element, alternates as `xhtml:link`
 * elements between `loc` and `changefreq`, and a trailing newline.
 * `lastmod` (task 2.3's truthful product timestamps, D5) sits between
 * `loc` and the alternates — the schema position, omitted entirely
 * when unknown so no timestamp is ever fabricated.
 *
 * Also hosts the two pieces of tree arithmetic every part of the tree
 * must agree on: the 5,000-product chunk size (design D2) and the
 * chunk count derived from the enumerated total — the index (task 2.2)
 * and the products-N children (task 2.3) share them so the advertised
 * child set and the served chunks can never drift apart.
 *
 * @module SitemapXml
 */

import type { MetadataRoute } from 'next';

/** The builder's `MetadataRoute.Sitemap` row, verbatim. */
type NextSitemapEntry = MetadataRoute.Sitemap[number];

/**
 * One urlset entry — the builder's row plus `lastmod`: the truthful
 * product-change timestamp task 2.3 draws from the enumeration
 * endpoint (design D5). (`lastModified`, the metadata-route spelling,
 * is accepted as a fallback so Next-shaped rows render identically.)
 */
export type SitemapUrlEntry = NextSitemapEntry & {
  lastmod?: string | Date;
};

/**
 * Products per chunk (design D2): chunk count grows with the catalog,
 * chunk size never does. The index derives `products-0..N-1` from
 * ceil(total / this); the products-N children (task 2.3) slice the
 * enumerated catalog at the same width.
 */
export const PRODUCT_CHUNK_SIZE = 5_000;

/**
 * Chunk count for an enumerated catalog total (design D2/D4): the
 * index references `products-0 .. products-(count-1)`. A total of 0
 * (or a non-finite total the caller chose to pass) yields 0 — no
 * products children, never a dead reference.
 */
export function productChunkCount(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.ceil(total / PRODUCT_CHUNK_SIZE);
}

/** XML-escape text destined for element or attribute content. */
function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** The declaration + opening tag Next's metadata route emitted. */
const URLSET_OPEN =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">';

/**
 * Serialize one urlset document — the tree children's body. The shape
 * mirrors Next's metadata-route output: `<loc>`, optional `<lastmod>`,
 * the `xhtml:link` alternates, then `<changefreq>`/`<priority>`, each
 * on its own line, document closed with a trailing newline.
 */
export function serializeUrlset(entries: readonly SitemapUrlEntry[]): string {
  const lines: string[] = [URLSET_OPEN];
  for (const entry of entries) {
    lines.push('<url>');
    lines.push(`<loc>${escapeXml(entry.url)}</loc>`);
    if (entry.lastmod !== undefined || entry.lastModified !== undefined) {
      const raw = entry.lastmod ?? entry.lastModified;
      const lastmod = raw instanceof Date ? raw.toISOString() : raw;
      lines.push(`<lastmod>${escapeXml(lastmod ?? '')}</lastmod>`);
    }
    for (const [hreflang, href] of Object.entries(
      entry.alternates?.languages ?? {},
    )) {
      if (href === undefined) continue;
      lines.push(
        `<xhtml:link rel="alternate" hreflang="${escapeXml(hreflang)}" href="${escapeXml(href)}" />`,
      );
    }
    if (entry.changeFrequency !== undefined) {
      lines.push(`<changefreq>${escapeXml(entry.changeFrequency)}</changefreq>`);
    }
    if (entry.priority !== undefined) {
      lines.push(`<priority>${entry.priority}</priority>`);
    }
    lines.push('</url>');
  }
  lines.push('</urlset>');
  return `${lines.join('\n')}\n`;
}

/**
 * Serialize one sitemapindex document — the `/sitemap.xml` body
 * (design D6): the 0.9 namespace, one `<sitemap><loc>` per child, the
 * same declaration and trailing-newline shape.
 */
export function serializeSitemapindex(children: readonly string[]): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const child of children) {
    lines.push('<sitemap>');
    lines.push(`<loc>${escapeXml(child)}</loc>`);
    lines.push('</sitemap>');
  }
  lines.push('</sitemapindex>');
  return `${lines.join('\n')}\n`;
}
