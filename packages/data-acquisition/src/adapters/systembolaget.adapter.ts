/**
 * Systembolaget feed adapter.
 *
 * Fetches the Systembolaget product assortment JSON API and maps items
 * to the canonical {@link RawFeedRecord} format consumed by the pipeline.
 *
 * Source categories are normalized at ingestion (task 7.1): the Swedish
 * assortment group ("Öl", "Vin", …) is mapped to the canonical tax-rule
 * category key, so downstream data is gate-valid and tax-meaningful.
 * Items whose category has no mapping are reported as per-item errors —
 * flagged for the correction queue, never silently assigned a fallback.
 *
 * The adapter handles pagination (if present) and reports per-item mapping
 * errors via the returned errors array — it never throws for recoverable
 * failures.
 *
 * @module SystembolagetFeedAdapter
 */

import { mapSourceCategory } from '@rajahinta/core-domain';
import type { IFeedAdapter, RawFeedRecord } from '../interfaces/feed-adapter.interface';

// ---------------------------------------------------------------------------
// Systembolaget API response shapes (partial — only fields we map)
// ---------------------------------------------------------------------------

/**
 * A single product from Systembolaget's JSON assortment endpoint.
 *
 * Reference: https://www.systembolaget.se/api/assortment
 */
interface SystembolagetProduct {
  /** Article number (e.g. "12345"). */
  productId: string;
  /** Bold product name (e.g. "Norrlands Guld Export"). */
  productNameBold: string;
  /** Thin product name — often empty, sometimes sub-brand or variant. */
  productNameThin?: string;
  /** Product group / category (e.g. "Öl", "Vin"). */
  category?: string;
  /** Alcohol by volume as a percentage (e.g. 5.2 for 5.2%). */
  alcoholPercentage?: number;
  /** Bottle volume in millilitres. */
  bottleVolume?: number;
  /** Container description (e.g. "Flaska", "Burk"). */
  bottleText?: string;
  /** Retail price in SEK (including VAT). */
  price?: number;
  /** Packaging type code (e.g. "FL", "BL"). */
  apk?: string;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class SystembolagetFeedAdapter implements IFeedAdapter {
  readonly merchantId = 'systembolaget';

  /**
   * Fetch the latest assortment from Systembolaget's JSON API.
   *
   * Errors are collected per-item and returned alongside successfully mapped
   * records.  Network-level failures are reported as a single error entry.
   */
  async fetch(
    config: { feedUrl: string; feedFormat: 'json' | 'xml' | 'csv' },
  ): Promise<{ records: RawFeedRecord[]; errors: string[] }> {
    const errors: string[] = [];
    const records: RawFeedRecord[] = [];

    try {
      const response = await fetch(config.feedUrl);

      if (!response.ok) {
        errors.push(
          `Systembolaget API returned HTTP ${response.status}: ${response.statusText}`,
        );
        return { records, errors };
      }

      const body: unknown = await response.json();

      // The endpoint returns either a top-level array of products or an
      // object with a "products" property (depending on the API version).
      const products: SystembolagetProduct[] = (
        Array.isArray(body) ? body : (body as Record<string, unknown>)?.products
      ) as SystembolagetProduct[];

      if (!Array.isArray(products)) {
        errors.push(
          'Systembolaget API returned unexpected JSON structure — expected an array or { products: [...] }',
        );
        return { records, errors };
      }

      for (const item of products) {
        try {
          records.push(this.mapToRecord(item));
        } catch (mapErr) {
          errors.push(
            `Failed to map product ${item.productId ?? '(unknown)'}: ${
              mapErr instanceof Error ? mapErr.message : 'Unknown error'
            }`,
          );
        }
      }
    } catch (err) {
      errors.push(
        `Systembolaget fetch failed: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`,
      );
    }

    return { records, errors };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Map a single Systembolaget product to the canonical {@link RawFeedRecord}.
   *
   * @throws when the source category has no canonical mapping — the
   * per-item catch upstream reports it for the correction queue.
   */
  private mapToRecord(item: SystembolagetProduct): RawFeedRecord {
    // SE→canonical normalization at ingestion (task 7.1). The tax-rule
    // category key is what the classification gate validates against and
    // the excise engine keys on — no placeholder, no fallback guess.
    const mapping = mapSourceCategory(item.category ?? '');
    if (mapping === null) {
      throw new Error(
        `Swedish category "${item.category}" has no canonical mapping — ` +
          'flagged for the correction queue',
      );
    }

    return {
      productId: item.productId,
      productName: item.productNameBold,
      manufacturer: item.productNameThin ?? item.productNameBold,
      brand: item.productNameBold,
      category: mapping.taxCategory,
      // API returns percentage (e.g. 5.2) — convert to decimal fraction
      alcoholByVolume:
        item.alcoholPercentage != null ? item.alcoholPercentage / 100 : null,
      volumeMl: item.bottleVolume ?? 0,
      containerType: item.apk ?? item.bottleText ?? 'unknown',
      regulatoryClassification: mapping.taxCategory,
      depositSystem: false,
      ean: null, // Systembolaget JSON API does not expose EAN
      priceCents: item.price != null ? Math.round(item.price * 100) : 0,
      currency: 'SEK',
      availability: 'in_stock',
      sourceUrl: null,
    };
  }
}