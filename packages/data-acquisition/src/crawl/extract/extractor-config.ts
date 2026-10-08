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

import type { LmdwPageState } from './lmdw-state.reader';

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
  /**
   * Embedded state-JSON reader (whisky.fr `__NEXT_DATA__`, change
   * onboard-lmdw-crawl-merchant, design D2). When set, the page state —
   * not the name heuristics — is the attested source for ABV, volume,
   * and the m3 category labels; absent or guard-rejected fields ride
   * the keyed-uncertainty ESTIMATED path with a correction error, never
   * a name-parse guess.
   */
  readonly pageStateReader?: (html: string) => LmdwPageState | null;
  /**
   * GS1 check-digit gate on an accepted-form GTIN (whisky.fr, design
   * D4): the probe measured 220/220 valid, so a form-valid value that
   * fails the check digit is attestation drift — the record stays
   * EAN-less with a correction error naming it.
   */
  readonly gtinCheckDigit?: boolean;
}
