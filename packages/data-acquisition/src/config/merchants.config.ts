/**
 * Merchant feed configuration.
 *
 * Defines the shape of merchant configuration and exports the initial
 * merchant set.  Each merchant has a feed URL, format, and polling
 * interval.  Adapters for the actual HTTP/API calls live in merchant-
 * specific features — this module provides only the configuration that
 * the pipeline orchestrator and feed ingestion service consume.
 *
 * Merchants with `enabled: false` are registered but not polled until
 * their adapter is implemented and the flag is flipped.
 *
 * @module MerchantConfig
 */

/** Single merchant feed configuration. */
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
  /** When false the orchestrator skips this merchant. */
  readonly enabled: boolean;
}

/**
 * Initial merchant set.
 *
 * Real feed URLs are empty strings until the corresponding merchant
 * adapter is built.  The pipeline will skip merchants with `enabled:
 * false` or empty `feedUrl`.
 */
export const DEFAULT_MERCHANTS: MerchantConfig[] = [
  {
    merchantId: 'alko',
    name: 'Alko',
    country: 'FI',
    feedUrl: '',
    feedFormat: 'json',
    pollingIntervalMs: 3_600_000, // 1 hour
    enabled: false,
  },
  {
    merchantId: 'systembolaget',
    name: 'Systembolaget',
    country: 'SE',
    feedUrl: '',
    feedFormat: 'json',
    pollingIntervalMs: 3_600_000,
    enabled: false,
  },
] as const;

/** Injection token for the merchant config array. */
export const MERCHANT_CONFIG_TOKEN = 'MERCHANT_CONFIG';