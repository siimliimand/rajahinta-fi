/**
 * Per-source extraction knobs (task 1.2, change sitemap-crawl-merchants;
 * design D3).
 *
 * The reader tiering is shared; only these knobs differ per merchant —
 * the same thin-subclass shape the WooCommerce walk established. Every
 * knob exists because a specific source's recon verdict demanded it;
 * nothing is configured "for later".
 *
 * @module ExtractorConfig
 */

export interface ExtractorConfig {
  /** Merchant id — the error-label prefix for per-row corrections. */
  readonly merchantId: string;
  /**
   * Store-brand trap: a feed `brand` matching one of these names (case-
   * insensitive) is the STORE, not the product brand, and is cleared
   * rather than ingested (viinikauppa reports brand "Viinikauppa").
   */
  readonly storeBrandNames?: readonly string[];
  /**
   * Description-prose ABV fallback, used only when the product name
   * carries no percentage (viinikauppa's Finnish
   * "Alkoholipitoisuus on 4,7 %" prose). The description itself is
   * never ingested.
   */
  readonly abvFromDescription?: (description: string) => number | null;
}
