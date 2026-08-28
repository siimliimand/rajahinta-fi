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
 * Currency conversion happens here, at ingestion (task 1.4, design
 * D2): SEK prices are converted to EUR cents through the FX rate
 * effective on the observation date (the fetch instant — the feed is a
 * live snapshot), the original SEK amount stays on the record for
 * display, and the FX dataset version is recorded as provenance. An
 * offer with no effective SEK/EUR rate is rejected per-item with a
 * recorded reason — the same errors surface as unmappable categories —
 * never stored as a foreign amount pretending to be EUR.
 *
 * The adapter handles pagination (if present) and reports per-item mapping
 * errors via the returned errors array — it never throws for recoverable
 * failures.
 *
 * @module SystembolagetFeedAdapter
 */

import { Injectable, Optional } from '@nestjs/common';
import {
  FxRateDatasetService,
  mapSourceCategory,
  type ResolvedFxDatasetRate,
} from '@rajahinta/core-domain';
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

/** The Systembolaget list currency — the pair every conversion resolves. */
const SOURCE_CURRENCY = 'SEK';

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

@Injectable()
export class SystembolagetFeedAdapter implements IFeedAdapter {
  readonly merchantId = 'systembolaget';

  constructor(
    /**
     * FX domain service used for the SEK→EUR conversion at ingestion.
     * Optional only so the class can be constructed bare in tests that
     * pin non-currency behaviour — with no service every priced offer
     * is rejected as unconvertible (fail-closed, design D2). The
     * module registration provides the real service.
     */
    @Optional()
    private readonly fx?: FxRateDatasetService,
  ) {}

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

      // One rate per fetch: the observation date is the fetch instant
      // (live snapshot), so every offer in the batch converts at the
      // same rate and shares one dataset-version provenance.
      const observedAt = new Date();
      const rate = await this.resolveSekEurRate(observedAt, errors);

      for (const item of products) {
        try {
          records.push(this.mapToRecord(item, rate, observedAt));
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

  /** Resolve the SEK→EUR rate effective on the observation date (or null). */
  private async resolveSekEurRate(
    observedAt: Date,
    errors: string[],
  ): Promise<ResolvedFxDatasetRate | null> {
    if (this.fx === undefined) {
      errors.push(
        'No FX rate dataset service available — SEK offers cannot be converted',
      );
      return null;
    }
    try {
      return await this.fx.resolveRate(SOURCE_CURRENCY, 'EUR', observedAt);
    } catch (err) {
      errors.push(
        `FX rate resolution failed: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`,
      );
      return null;
    }
  }

  /**
   * Map a single Systembolaget product to the canonical {@link RawFeedRecord}.
   *
   * @throws when the source category has no canonical mapping or the
   * SEK price has no effective conversion — the per-item catch upstream
   * reports it for the correction queue / rejection record.
   */
  private mapToRecord(
    item: SystembolagetProduct,
    rate: ResolvedFxDatasetRate | null,
    observedAt: Date,
  ): RawFeedRecord {
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

    // Conversion at ingestion (task 1.4, design D2). The original SEK
    // amount stays on the record for display; the stored amount is EUR
    // cents produced by a recorded conversion, or the offer is rejected.
    const originalPriceCents =
      item.price != null ? Math.round(item.price * 100) : 0;
    if (item.price != null && rate === null) {
      throw new Error(
        `SEK price ${item.price} has no effective ${SOURCE_CURRENCY}/EUR rate on ` +
          `${observedAt.toISOString().slice(0, 10)} — offer rejected ` +
          '(unconvertible currency, design D2)',
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
      priceCents:
        item.price != null
          ? Math.round(item.price * rate!.rate * 100)
          : 0,
      currency: 'EUR',
      originalPriceCents,
      originalCurrency: SOURCE_CURRENCY,
      ...(item.price != null ? { fxDatasetVersion: rate!.dataset.versionLabel } : {}),
      availability: 'in_stock',
      sourceUrl: null,
    };
  }
}