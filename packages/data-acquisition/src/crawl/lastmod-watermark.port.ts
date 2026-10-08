/**
 * Watermark storage port for the sitemap crawl cycle (task 1.1, change
 * sitemap-crawl-merchants; design D4).
 *
 * The cycle needs last cycle's `loc → lastmod` map per merchant and
 * persists this cycle's map when the walk finishes. Persistence lives
 * behind this port so the cycle stays testable and D1 wiring (task 3.1,
 * `aggregation_watermarks` rows) stays outside the crawl package — same
 * port discipline as the upsert and offer-change ports.
 *
 * @module LastmodWatermarkPort
 */

import type { SitemapWatermark } from './lastmod-diff';

export interface ILastmodWatermarkStore {
  /**
   * The watermark persisted by the merchant's previous completed cycle,
   * or null when the merchant has never crawled (first crawl = full
   * refresh).
   */
  load(merchantId: string): Promise<SitemapWatermark | null>;

  /**
   * Persist the cycle's next watermark. Called once per cycle, after
   * the walk — a failed save is a collected cycle error, never a throw.
   */
  save(merchantId: string, watermark: SitemapWatermark): Promise<void>;
}
