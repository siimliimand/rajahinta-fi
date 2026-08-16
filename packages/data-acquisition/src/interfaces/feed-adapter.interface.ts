/**
 * Feed adapter port — the contract between the pipeline and merchant-specific
 * data sources.
 *
 * Each merchant (Alko, Systembolaget, …) must provide an implementation of
 * this interface registered under its `merchantId`.  The feed-ingestion
 * service looks up adapters by merchant ID so the pipeline remains
 * merchant-agnostic.
 *
 * @module FeedAdapter
 */

import type { IngestionResult } from './data-source.interface';

/**
 * A single item returned by a merchant's feed or API, in a canonical shape
 * that the data-mapping service can consume.  Adapters are responsible for
 * normalising the merchant-specific payload into this type.
 */
export interface RawFeedRecord {
  /** Merchant's internal product identifier (e.g. SKU). */
  readonly productId: string;
  readonly productName: string;
  readonly manufacturer: string;
  readonly brand: string;
  readonly category: string;
  /** Alcohol by volume as a decimal fraction (e.g. 0.047 for 4.7 %). */
  readonly alcoholByVolume: number | null;
  /** Package volume in millilitres. */
  readonly volumeMl: number;
  readonly containerType: string;
  readonly regulatoryClassification: string;
  readonly depositSystem: boolean;
  readonly ean: string | null;
  /** Retail price in the smallest currency unit (cents). */
  readonly priceCents: number;
  readonly currency: string;
  readonly availability: string;
  /** Direct URL to the product page. */
  readonly sourceUrl: string | null;
}

/**
 * Port that every merchant-specific feed adapter must implement.
 *
 * Adapters are registered under their `merchantId` in the DI container
 * via the `FEED_ADAPTERS` multi-provider token.  This keeps the pipeline
 * testable — mock adapters can be injected without real HTTP calls.
 */
export interface IFeedAdapter {
  /** Stable merchant identifier matching {@link MerchantConfig.merchantId}. */
  readonly merchantId: string;

  /**
   * Fetch the latest product feed from the merchant and return normalised
   * records.
   *
   * Implementations should handle authentication, pagination, and format
   * parsing internally.  Errors are reported via the returned
   * {@link IngestionResult.errors} array — the adapter MUST NOT throw for
   * recoverable failures.
   */
  fetch(config: {
    feedUrl: string;
    feedFormat: 'json' | 'xml' | 'csv';
  }): Promise<{ records: RawFeedRecord[]; errors: string[] }>;
}

/** Injection token for the multi-provider map of feed adapters. */
export const FEED_ADAPTERS_TOKEN = 'FEED_ADAPTERS';