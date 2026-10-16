/**
 * Unit tests for the sitemap XML serializer (sitemap-tree-coverage
 * task 2.2, design D6): both documents mirror EXACTLY the XML shape
 * Next's sitemap metadata route emitted before the tree swap — the
 * pinned regression shape the crawlers already know — plus the
 * escaping, optional-field, and lastmod behavior, and the D2 chunk
 * arithmetic the index and the products-N children share.
 *
 * @module SitemapXmlTest
 */

import { describe, expect, it } from 'vitest';
import {
  PRODUCT_CHUNK_SIZE,
  productChunkCount,
  serializeSitemapindex,
  serializeUrlset,
} from './sitemap-xml';

describe('serializeUrlset', () => {
  it('mirrors the metadata-route byte shape: loc, alternates, changefreq, priority', () => {
    // Pinned against the pre-swap build output
    // (.next/server/app/sitemap.xml.body): declaration, 0.9 + xhtml
    // namespaces, one line per element, trailing newline.
    const xml = serializeUrlset([
      {
        url: 'https://rajahinta.fi/laskuri',
        changeFrequency: 'weekly',
        priority: 0.7,
        alternates: {
          languages: {
            'x-default': 'https://rajahinta.fi/laskuri',
            fi: 'https://rajahinta.fi/laskuri',
            en: 'https://rajahinta.fi/en/calculator',
          },
        },
      },
      {
        url: 'https://rajahinta.fi/en/calculator',
        changeFrequency: 'weekly',
        priority: 0.7,
        alternates: {
          languages: {
            'x-default': 'https://rajahinta.fi/laskuri',
            fi: 'https://rajahinta.fi/laskuri',
            en: 'https://rajahinta.fi/en/calculator',
          },
        },
      },
    ]);

    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
        '<url>\n' +
        '<loc>https://rajahinta.fi/laskuri</loc>\n' +
        '<xhtml:link rel="alternate" hreflang="x-default" href="https://rajahinta.fi/laskuri" />\n' +
        '<xhtml:link rel="alternate" hreflang="fi" href="https://rajahinta.fi/laskuri" />\n' +
        '<xhtml:link rel="alternate" hreflang="en" href="https://rajahinta.fi/en/calculator" />\n' +
        '<changefreq>weekly</changefreq>\n' +
        '<priority>0.7</priority>\n' +
        '</url>\n' +
        '<url>\n' +
        '<loc>https://rajahinta.fi/en/calculator</loc>\n' +
        '<xhtml:link rel="alternate" hreflang="x-default" href="https://rajahinta.fi/laskuri" />\n' +
        '<xhtml:link rel="alternate" hreflang="fi" href="https://rajahinta.fi/laskuri" />\n' +
        '<xhtml:link rel="alternate" hreflang="en" href="https://rajahinta.fi/en/calculator" />\n' +
        '<changefreq>weekly</changefreq>\n' +
        '<priority>0.7</priority>\n' +
        '</url>\n' +
        '</urlset>\n',
    );
  });

  it('emits priority 1 without a decimal and preserves query-string URLs', () => {
    const xml = serializeUrlset([
      {
        url: 'https://rajahinta.fi/tuotteet?category=wine_still',
        changeFrequency: 'weekly',
        priority: 1,
      },
    ]);
    expect(xml).toContain('<loc>https://rajahinta.fi/tuotteet?category=wine_still</loc>');
    expect(xml).toContain('<priority>1</priority>');
    expect(xml).toContain('<changefreq>weekly</changefreq>');
  });

  it('escapes XML-significant characters in locs and hrefs', () => {
    const xml = serializeUrlset([
      {
        url: 'https://rajahinta.fi/listat/a&b<c>?x=1&y=2',
        alternates: { languages: { en: 'https://rajahinta.fi/en/lists/a&b<c>?x=1&y=2' } },
      },
    ]);
    expect(xml).toContain(
      '<loc>https://rajahinta.fi/listat/a&amp;b&lt;c&gt;?x=1&amp;y=2</loc>',
    );
    expect(xml).toContain('href="https://rajahinta.fi/en/lists/a&amp;b&lt;c&gt;?x=1&amp;y=2"');
    expect(xml).not.toContain('<loc>https://rajahinta.fi/listat/a&b');
  });

  it('writes lastmod between loc and the alternates (string or Date), schema position', () => {
    const xml = serializeUrlset([
      {
        url: 'https://rajahinta.fi/tuotteet/1487',
        lastmod: '2026-10-01T12:00:00.000Z',
        alternates: { languages: { fi: 'https://rajahinta.fi/tuotteet/1487' } },
      },
      {
        url: 'https://rajahinta.fi/tuotteet/1488',
        lastmod: new Date('2026-10-02T09:30:00.000Z'),
      },
    ]);
    expect(xml).toContain(
      '<loc>https://rajahinta.fi/tuotteet/1487</loc>\n<lastmod>2026-10-01T12:00:00.000Z</lastmod>\n<xhtml:link',
    );
    expect(xml).toContain(
      '<loc>https://rajahinta.fi/tuotteet/1488</loc>\n<lastmod>2026-10-02T09:30:00.000Z</lastmod>',
    );
  });

  it('omits absent optional fields entirely — never an empty or default element', () => {
    const xml = serializeUrlset([{ url: 'https://rajahinta.fi/en' }]);
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
        '<url>\n' +
        '<loc>https://rajahinta.fi/en</loc>\n' +
        '</url>\n' +
        '</urlset>\n',
    );
  });

  it('an empty entry list is a well-formed empty urlset (degradation shape)', () => {
    expect(serializeUrlset([])).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
        '</urlset>\n',
    );
  });
});

describe('serializeSitemapindex', () => {
  it('wraps each child loc in a sitemap element under the 0.9 namespace', () => {
    const xml = serializeSitemapindex([
      'https://rajahinta.fi/sitemaps/pages',
      'https://rajahinta.fi/sitemaps/products-0',
    ]);
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        '<sitemap>\n' +
        '<loc>https://rajahinta.fi/sitemaps/pages</loc>\n' +
        '</sitemap>\n' +
        '<sitemap>\n' +
        '<loc>https://rajahinta.fi/sitemaps/products-0</loc>\n' +
        '</sitemap>\n' +
        '</sitemapindex>\n',
    );
  });

  it('escapes child URLs and tolerates an empty child set', () => {
    expect(serializeSitemapindex(['https://rajahinta.fi/sitemaps/a&b'])).toContain(
      '<loc>https://rajahinta.fi/sitemaps/a&amp;b</loc>',
    );
    expect(serializeSitemapindex([])).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        '</sitemapindex>\n',
    );
  });
});

describe('productChunkCount (design D2 chunk arithmetic)', () => {
  it('slices at the 5,000 chunk size, growing only on the boundary', () => {
    expect(PRODUCT_CHUNK_SIZE).toBe(5_000);
    expect(productChunkCount(0)).toBe(0);
    expect(productChunkCount(1)).toBe(1);
    expect(productChunkCount(5_000)).toBe(1);
    expect(productChunkCount(5_001)).toBe(2);
    expect(productChunkCount(20_839)).toBe(5);
    expect(productChunkCount(100_000)).toBe(20);
  });

  it('treats non-finite totals as zero chunks (no children referenced)', () => {
    expect(productChunkCount(Number.NaN)).toBe(0);
    expect(productChunkCount(Number.POSITIVE_INFINITY)).toBe(0);
    expect(productChunkCount(-1)).toBe(0);
  });
});
