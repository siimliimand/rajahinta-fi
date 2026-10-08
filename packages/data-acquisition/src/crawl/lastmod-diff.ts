/**
 * Per-merchant sitemap lastmod diff (task 1.1, change
 * sitemap-crawl-merchants; design D4).
 *
 * Pure function: (previous watermark, current sitemap entries, source
 * config) → the URLs this cycle must crawl plus the watermark the cycle
 * persists afterwards. First run (empty previous) is a full set; a
 * source without usable `lastmod` (drinkonline) is configured
 * full-refresh and always gets the full set.
 *
 * `lastmod` values are compared as verbatim strings — the sitemap
 * carries both offset ISO instants and bare dates, and no scheduling
 * decision ever depends on interpreting them as instants. An entry
 * whose `lastmod` disappeared between cycles is treated as changed
 * (null differs from any value); a URL dropped from the sitemap simply
 * leaves the next watermark, it is never crawled again.
 *
 * @module LastmodDiff
 */

import type { SitemapEntry } from './sitemap.parse';

/**
 * The persisted per-merchant comparison state (design D4): loc → the
 * `lastmod` string last seen, null when the entry had none. Persistence
 * itself is the storage port's problem (task 3.1 wires D1).
 */
export type SitemapWatermark = ReadonlyMap<string, string | null>;

export interface SitemapDiffConfig {
  /** Full-refresh source (no `lastmod`) — every cycle is a full set. */
  readonly fullRefresh: boolean;
}

export interface SitemapDiffResult {
  readonly urlsToCrawl: readonly string[];
  readonly nextWatermark: SitemapWatermark;
}

export function diffSitemapEntries(
  previous: SitemapWatermark,
  entries: readonly SitemapEntry[],
  config: SitemapDiffConfig,
): SitemapDiffResult {
  const urlsToCrawl: string[] = [];
  const nextWatermark = new Map<string, string | null>();
  const seen = new Set<string>();

  for (const { loc, lastmod } of entries) {
    if (seen.has(loc)) continue;
    seen.add(loc);
    nextWatermark.set(loc, lastmod);

    // An empty previous map is the first crawl: `previous.get` misses
    // every URL, so the full set falls out of the same changed/new rule
    // — no special-case branch to drift from the spec's wording.
    if (!config.fullRefresh && previous.get(loc) === lastmod) continue;
    urlsToCrawl.push(loc);
  }

  return { urlsToCrawl, nextWatermark };
}
