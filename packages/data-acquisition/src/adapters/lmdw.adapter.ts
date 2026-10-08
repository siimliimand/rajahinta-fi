/**
 * La Maison du Whisky (www.whisky.fr) sitemap-crawl feed adapter
 * (task 3.1, change onboard-lmdw-crawl-merchant).
 *
 * A thin subclass of the shared crawl composition
 * (`sitemap-crawl.adapter.ts`) — the probe's decision (design D1,
 * notes 1.1): PURE SITEMAP, the identical shape of the four live crawl
 * merchants; no GraphQL-seeded variant. The registry feedUrl is the FR
 * store urlset (`sitemap_whimag.xml`, `feedFormat: 'xml'`), and its
 * 19,727/19,728 lastmod coverage makes every cycle incremental
 * (`fullRefresh: false`).
 *
 * Product locs are the single-segment `/<url_key>.html` shape. The
 * measured ~1.6 % non-product locs that pass the predicate (CMS routes
 * with the same shape) ride the guarded extraction path — no
 * volume/strength extract → keyed-uncertainty ESTIMATED + correction,
 * never guessed.
 *
 * The page normalizer is the per-source config
 * (`LMDW_EXTRACTOR_CONFIG`): the `__NEXT_DATA__` state JSON carries
 * volume/strength/m3-category (design D2), and JSON-LD `gtin13` is
 * accepted only page-attested AND check-digit valid (design D4).
 *
 * @module LmdwFeedAdapter
 */

import type { SitemapCrawlWiring } from './sitemap-crawl.adapter';
import { SitemapCrawlFeedAdapter } from './sitemap-crawl.adapter';
import { LMDW_EXTRACTOR_CONFIG } from '../crawl/extract/source-configs';
import { urlPatternPredicate } from '../crawl/product-url-filter';

export const LMDW_PRODUCT_URL_PATTERN =
  /^https:\/\/www\.whisky\.fr\/[^/]+\.html$/;

export class LmdwFeedAdapter extends SitemapCrawlFeedAdapter {
  readonly merchantId = 'lmdw';

  constructor(wiring: SitemapCrawlWiring = {}) {
    super({
      extractorConfig: LMDW_EXTRACTOR_CONFIG,
      productUrlPredicate: urlPatternPredicate(LMDW_PRODUCT_URL_PATTERN),
      fullRefresh: false,
      ...wiring,
    });
  }
}
