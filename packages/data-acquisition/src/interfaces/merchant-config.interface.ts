/**
 * Merchant source configuration shape (tasks 7.2/7.3, change
 * technical-assessment-remediation; design D7).
 *
 * The static merchants.config.ts file is gone: merchant configuration
 * lives in the database-backed merchant registry
 * (MerchantRegistryRepository, data-platform) and consumers derive this
 * shape from registry rows. {@link merchantConfigFromRegistry} performs
 * that derivation, narrowing the registry's free-text feed format onto
 * the pipeline's union.
 *
 * @module MerchantConfigInterface
 */

import type { MerchantRegistryRecord } from '@rajahinta/data-platform';

/** A merchant feed source as the pipeline consumes it. */
export interface MerchantConfig {
  /** Stable identifier used as the key in IFeedAdapter lookups. */
  readonly merchantId: string;
  /** Human-readable merchant name. */
  readonly name: string;
  /** ISO 3166-1 alpha-2 country code. */
  readonly country: string;
  /** Base URL of the merchant's feed or API endpoint. */
  readonly feedUrl: string;
  /** Expected payload format. */
  readonly feedFormat: 'json' | 'xml' | 'csv';
  /** How often to poll for new data (milliseconds). */
  readonly pollingIntervalMs: number;
}

const FEED_FORMATS = new Set(['json', 'xml', 'csv']);

/**
 * Derive a pipeline {@link MerchantConfig} from a registry row.
 *
 * Returns an error string when the row's feed format is not one the
 * pipeline can parse — an operator typo in the registry must surface,
 * not silently produce a feed fetch with a bogus format.
 */
export function merchantConfigFromRegistry(
  record: MerchantRegistryRecord,
): { config: MerchantConfig } | { error: string } {
  const feedFormat = record.feedFormat.trim().toLowerCase();
  if (!FEED_FORMATS.has(feedFormat)) {
    return {
      error:
        `Merchant "${record.merchantId}" has unsupported feed format ` +
        `"${record.feedFormat}" in the registry — expected json, xml, or csv`,
    };
  }
  return {
    config: {
      merchantId: record.merchantId,
      name: record.name,
      country: record.country,
      feedUrl: record.feedUrl,
      feedFormat: feedFormat as MerchantConfig['feedFormat'],
      pollingIntervalMs: record.pollingIntervalMs,
    },
  };
}
