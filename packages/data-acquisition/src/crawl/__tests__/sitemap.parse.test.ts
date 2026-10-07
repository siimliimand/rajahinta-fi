/**
 * Sitemap XML parser tests (task 1.1, change sitemap-crawl-merchants).
 *
 * Pins the tolerances the four live sitemaps demand (recon 2026-10-07):
 * CDATA-wrapped locs, namespace-prefixed image blocks, both lastmod
 * spellings (offset instant and bare date), and the honest-error path
 * for an index document or a non-sitemap body.
 *
 * @module SitemapParseTest
 */
import { describe, it, expect } from 'vitest';
import { parseSitemapXml } from '../sitemap.parse';

describe('parseSitemapXml — urlset entries', () => {
  it('spec: CDATA-wrapped locs (viinarannasta) parse clean', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc><![CDATA[https://viinarannasta.eu/fi/viskit/1718-jameson.html]]></loc>
    <lastmod><![CDATA[2025-08-13T09:45:49+03:00]]></lastmod>
  </url>
</urlset>`;

    const { entries, error } = parseSitemapXml(xml);

    expect(error).toBeNull();
    expect(entries).toEqual([
      {
        loc: 'https://viinarannasta.eu/fi/viskit/1718-jameson.html',
        lastmod: '2025-08-13T09:45:49+03:00',
      },
    ]);
  });

  it('plain locs keep both lastmod spellings verbatim; missing lastmod is null (drinkonline)', () => {
    const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.viinikauppa.com/catalog/sandels</loc><lastmod>2026-09-30</lastmod></url>
  <url><loc>https://www.licorea.com/gin-en-p-77.html</loc><lastmod>2026-09-30</lastmod></url>
  <url><loc>https://www.drinkonline.eu/vodka/koskenkorva/</loc></url>
</urlset>`;

    const { entries, error } = parseSitemapXml(xml);

    expect(error).toBeNull();
    expect(entries).toEqual([
      { loc: 'https://www.viinikauppa.com/catalog/sandels', lastmod: '2026-09-30' },
      { loc: 'https://www.licorea.com/gin-en-p-77.html', lastmod: '2026-09-30' },
      { loc: 'https://www.drinkonline.eu/vodka/koskenkorva/', lastmod: null },
    ]);
  });

  it('spec: image-namespace blocks never confuse the page loc — first loc wins', () => {
    const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
    xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>https://www.viinikauppa.com/catalog/sandels</loc>
    <image:image>
      <image:loc>https://www.viinikauppa.com/kuvat/sandels.jpg</image:loc>
      <image:title>Sandels</image:title>
    </image:image>
    <lastmod>2026-09-30</lastmod>
  </url>
</urlset>`;

    const { entries, error } = parseSitemapXml(xml);

    expect(error).toBeNull();
    expect(entries).toEqual([
      {
        loc: 'https://www.viinikauppa.com/catalog/sandels',
        lastmod: '2026-09-30',
      },
    ]);
  });

  it('XML entities in plain locs decode; CDATA content never double-decodes', () => {
    const xml = `<urlset>
  <url><loc>https://www.licorea.com/a&#38;b-en-p-1.html?x=1&amp;y=2</loc></url>
  <url><loc><![CDATA[https://www.licorea.com/raw&amp;raw-en-p-2.html]]></loc></url>
</urlset>`;

    const { entries } = parseSitemapXml(xml);

    expect(entries[0].loc).toBe('https://www.licorea.com/a&b-en-p-1.html?x=1&y=2');
    expect(entries[1].loc).toBe('https://www.licorea.com/raw&amp;raw-en-p-2.html');
  });

  it('empty-but-valid urlset parses to zero entries without error', () => {
    const { entries, error } = parseSitemapXml(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
    );
    expect(error).toBeNull();
    expect(entries).toEqual([]);
  });
});

describe('parseSitemapXml — honest errors, never throws', () => {
  it('spec: a sitemap index is an error, not zero silently-crawled products', () => {
    const xml = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/products-1.xml</loc></sitemap>
</sitemapindex>`;

    const { entries, error } = parseSitemapXml(xml);

    expect(entries).toEqual([]);
    expect(error).toContain('sitemap index');
  });

  it('a non-urlset body (HTML error page, WAF interstitial) is an error', () => {
    const { entries, error } = parseSitemapXml(
      '<html><body>Just a moment...</body></html>',
    );
    expect(entries).toEqual([]);
    expect(error).toContain('not a sitemap urlset');
  });

  it('url blocks without a loc are skipped, not fatal', () => {
    const xml = `<urlset>
  <url><lastmod>2026-09-30</lastmod></url>
  <url><loc>https://www.licorea.com/gin-en-p-77.html</loc></url>
</urlset>`;

    const { entries, error } = parseSitemapXml(xml);

    expect(error).toBeNull();
    expect(entries).toEqual([
      { loc: 'https://www.licorea.com/gin-en-p-77.html', lastmod: null },
    ]);
  });
});
