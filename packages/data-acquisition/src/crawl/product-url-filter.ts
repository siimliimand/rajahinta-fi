/**
 * Product-URL classification for sitemap entries (task 1.1, change
 * sitemap-crawl-merchants; spec "Sitemap contains non-product locs").
 *
 * Each crawl source describes which of its sitemap locs are product
 * detail pages — viinarannasta's urlset also lists `.jpg` product
 * images, the others list CMS routes. The predicate is the per-source
 * config knob; {@link urlPatternPredicate} covers the common shape (a
 * URL pattern) so sources only need a predicate when their rule is not
 * expressible as one.
 *
 * Filtering runs BEFORE the lastmod diff, so the persisted watermark
 * only ever carries product URLs — image and CMS locs never enter it.
 *
 * @module ProductUrlFilter
 */

import type { SitemapEntry } from './sitemap.parse';

export type ProductUrlPredicate = (url: string) => boolean;

/**
 * Turn a URL pattern into a predicate. The `g`/`y` flags are stripped
 * because `RegExp.prototype.test` would otherwise advance `lastIndex`
 * across calls and silently drop every second URL.
 */
export function urlPatternPredicate(pattern: RegExp): ProductUrlPredicate {
  const flags = pattern.flags.replace(/[gy]/g, '');
  const safe = new RegExp(pattern.source, flags);
  return (url) => safe.test(url);
}

/**
 * Keep the entries the source's predicate classifies as product pages,
 * in sitemap order, with duplicate locs collapsed to the first
 * occurrence.
 */
export function filterSitemapEntries(
  entries: readonly SitemapEntry[],
  predicate: ProductUrlPredicate,
): SitemapEntry[] {
  const kept: SitemapEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.loc)) continue;
    if (!predicate(entry.loc)) continue;
    seen.add(entry.loc);
    kept.push(entry);
  }
  return kept;
}
