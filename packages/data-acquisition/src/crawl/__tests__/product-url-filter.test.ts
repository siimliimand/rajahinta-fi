/**
 * Product-URL filter tests (task 1.1, change sitemap-crawl-merchants).
 *
 * Pins the spec scenario "Sitemap contains non-product locs": only
 * product detail URLs survive — viinarannasta's .jpg image locs and
 * CMS/controller routes drop out, duplicates collapse to the first
 * occurrence, and sitemap order is preserved.
 *
 * @module ProductUrlFilterTest
 */
import { describe, it, expect } from 'vitest';
import { filterSitemapEntries, urlPatternPredicate } from '../product-url-filter';
import type { SitemapEntry } from '../sitemap.parse';

function entry(loc: string, lastmod: string | null = null): SitemapEntry {
  return { loc, lastmod };
}

const VIINARANNASTA_PATTERN = urlPatternPredicate(
  /^https:\/\/viinarannasta\.eu\/fi\/[^/]+\/\d+-[^/]+\.html$/i,
);

describe('urlPatternPredicate', () => {
  it('spec: product URLs match, image files and CMS routes do not', () => {
    expect(VIINARANNASTA_PATTERN('https://viinarannasta.eu/fi/viskit/1718-jameson.html')).toBe(
      true,
    );
    expect(
      VIINARANNASTA_PATTERN('https://viinarannasta.eu/img/1718-jameson.jpg'),
    ).toBe(false);
    expect(VIINARANNASTA_PATTERN('https://viinarannasta.eu/fi/oy-alkuvaihe.html')).toBe(
      false,
    );
    expect(VIINARANNASTA_PATTERN('https://viinarannasta.eu/fi/viskit/1718-jameson.jpg')).toBe(
      false,
    );
  });

  it('a global pattern does not silently drop every second URL (lastIndex hazard)', () => {
    // Matches how an operator would naturally write the config regex.
    const globalPattern = urlPatternPredicate(
      /\/catalog\/[^/]+/gi,
    );
    expect(globalPattern('https://www.viinikauppa.com/catalog/a')).toBe(true);
    expect(globalPattern('https://www.viinikauppa.com/catalog/b')).toBe(true);
    expect(globalPattern('https://www.viinikauppa.com/catalog/c')).toBe(true);
  });
});

describe('filterSitemapEntries', () => {
  it('keeps only product pages, in sitemap order, deduplicated', () => {
    const entries = [
      entry('https://viinarannasta.eu/fi/viskit/1718-jameson.html'),
      entry('https://viinarannasta.eu/img/1718-jameson.jpg'),
      entry('https://viinarannasta.eu/fi/oluet/200-kanava.html', '2026-09-30'),
      entry('https://viinarannasta.eu/fi/viskit/1718-jameson.html'),
      entry('https://viinarannasta.eu/fi/yhteys.html'),
    ];

    const kept = filterSitemapEntries(entries, VIINARANNASTA_PATTERN);

    expect(kept.map((e) => e.loc)).toEqual([
      'https://viinarannasta.eu/fi/viskit/1718-jameson.html',
      'https://viinarannasta.eu/fi/oluet/200-kanava.html',
    ]);
    expect(kept[0].lastmod).toBeNull();
    expect(kept[1].lastmod).toBe('2026-09-30');
  });

  it('a predicate-based source config filters without a pattern', () => {
    const kept = filterSitemapEntries(
      [entry('https://www.drinkonline.eu/vodka/a/'), entry('https://www.drinkonline.eu/cart')],
      (url) => url.endsWith('/'),
    );
    expect(kept.map((e) => e.loc)).toEqual(['https://www.drinkonline.eu/vodka/a/']);
  });
});
