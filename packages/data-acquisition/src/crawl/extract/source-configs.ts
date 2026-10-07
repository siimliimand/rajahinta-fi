/**
 * The four v1 source normalizer configs (task 1.2, change
 * sitemap-crawl-merchants; design D3).
 *
 * Each config is exactly the recon verdict's deviation list — a source
 * whose pages need no special handling carries only its merchant id:
 *
 * - licorea: complete JSON-LD (`gtin13`, price, currency, availability)
 *   — no knobs.
 * - viinarannasta: schema.org microdata with GTIN13 — no knobs; the
 *   microdata reader tier does the work.
 * - drinkonline: JSON-LD with `offers` as an array — handled by the
 *   reader's offer selection, not a knob.
 * - viinikauppa: JSON-LD whose `brand` is the store name (override) and
 *   whose ABV appears only in Finnish description prose (comma-decimal
 *   variants included).
 *
 * @module CrawlSourceConfigs
 */

import type { ExtractorConfig } from './extractor-config';

/**
 * ABV from Finnish description prose: "Alkoholipitoisuus on 4,9 %" /
 * "Alkoholipitoisuus: 5,5 %". The scan is anchored to the
 * Alkoholipitoisuus keyword so an unrelated percentage in the prose
 * ("Säästä 20 %") can never become an ABV, and never crosses a second
 * `%` sign on the way to its number.
 */
export function abvPercentFromFinnishDescription(
  description: string,
): number | null {
  const match =
    /alkoholipitoisuus[^\d%]*(\d+(?:[.,]\d+)?)\s*%/i.exec(description);
  if (match === null) return null;
  const value = Number.parseFloat(match[1].replace(',', '.'));
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

export const LICOREA_EXTRACTOR_CONFIG: ExtractorConfig = {
  merchantId: 'licorea',
};

export const VIINARANNASTA_EXTRACTOR_CONFIG: ExtractorConfig = {
  merchantId: 'viinarannasta',
};

export const DRINKONLINE_EXTRACTOR_CONFIG: ExtractorConfig = {
  merchantId: 'drinkonline',
};

export const VIINIKAUPPA_EXTRACTOR_CONFIG: ExtractorConfig = {
  merchantId: 'viinikauppa',
  storeBrandNames: ['viinikauppa'],
  abvFromDescription: abvPercentFromFinnishDescription,
};
