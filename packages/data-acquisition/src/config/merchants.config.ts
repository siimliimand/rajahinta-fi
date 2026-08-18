/**
 * Merchant feed configuration.
 *
 * Defines the shape of merchant configuration and exports the initial
 * merchant set.  Each merchant has a feed URL, format, and polling
 * interval.  Adapters for the actual HTTP/API calls live in merchant-
 * specific feature packages.
 *
 * Ingestion of a merchant's data is gated by {@link SourceGovernanceService}
 * — a merchant must have a GRANTED permission status before the pipeline
 * will fetch or persist its data.  New merchants default to PENDING (off)
 * until a compliance review transitions them to GRANTED.
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
}

/**
 * Initial merchant set.
 *
 * Merchants are registered here but NOT auto-queried — permission defaults
 * to PENDING.  A compliance review and a `SourceGovernanceService.registerSource`
 * call with GRANTED status is required to activate ingestion.
 *
 * Merchants with an empty `feedUrl` (Alko pending adapter implementation)
 * are skipped by the pipeline.
 */
export const DEFAULT_MERCHANTS: MerchantConfig[] = [
  {
    merchantId: 'alko',
    name: 'Alko',
    country: 'FI',
    feedUrl: '',
    feedFormat: 'json',
    pollingIntervalMs: 3_600_000, // 1 hour
  },
  {
    merchantId: 'systembolaget',
    name: 'Systembolaget',
    country: 'SE',
    feedUrl: 'https://www.systembolaget.se/api/assortment',
    feedFormat: 'json',
    pollingIntervalMs: 3_600_000,
  },
] as const;

/** Injection token for the merchant config array. */
export const MERCHANT_CONFIG_TOKEN = 'MERCHANT_CONFIG';