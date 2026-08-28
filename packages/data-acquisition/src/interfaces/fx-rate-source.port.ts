/**
 * FX rate source port (task 1.3, change technical-assessment-remediation;
 * design D2).
 *
 * The contract behind the FX ingestion job's configurable source: fetch
 * the latest reference-rate snapshot from an external source (ECB
 * reference rates by default) as a candidate dataset for the governed
 * review workflow. The default implementation lives in
 * adapters/ecb-rate.source.ts; hosts override the port (or the URL
 * token) to swap sources without touching the job.
 *
 * Sources never publish: their output is a snapshot that the review
 * service turns into a PENDING_CONFIRMATION dataset, and only a human
 * operator confirms publication.
 *
 * @module FxRateSourcePort
 */

import type { FxRateEntry } from '@rajahinta/core-domain';

/**
 * A source's latest reference-rate snapshot — the candidate payload for
 * one dataset version.
 */
export interface FxRateSnapshot {
  /** Short source identifier used to derive the dataset version label (e.g. "ecb"). */
  readonly sourceId: string;
  /** Provenance: source adapter name recorded on the dataset (e.g. "ecb-reference-rates"). */
  readonly sourceName: string;
  /** Provenance: link to the source publication, when the source provides one. */
  readonly sourceUrl: string | null;
  /** Date the source published the rates, ISO-8601 (`YYYY-MM-DD`). */
  readonly referenceDate: string;
  /** EUR-based reference rates (base currency EUR, quote per source). */
  readonly rates: readonly FxRateEntry[];
}

/**
 * Port for FX rate sources. Implementations MUST NOT throw for
 * recoverable failures — errors are reported in the returned array so
 * one bad check never breaks the review loop.
 */
export interface IFxRateSource {
  /** Stable source identifier (feeds into dataset version labels). */
  readonly sourceId: string;

  /**
   * Fetch the latest reference-rate snapshot. Null snapshot means
   * nothing usable was fetched; the reason is in `errors`.
   */
  fetchLatestRates(): Promise<{
    snapshot: FxRateSnapshot | null;
    errors: string[];
  }>;
}

/** Injection token for the FX rate source implementation. */
export const FX_RATE_SOURCE_PORT = 'FX_RATE_SOURCE_PORT';

/** Injection token for the configured FX feed URL. */
export const FX_RATE_SOURCE_URL_TOKEN = 'FX_RATE_SOURCE_URL_TOKEN';

/**
 * Default feed: ECB reference rates via the Frankfurter API (free,
 * ECB-published data). ECB reference rates are EUR-base — every quote
 * currency pairs against EUR, which is exactly the dataset direction
 * D2 assumes. Overridable per environment via the URL token.
 */
export const FX_RATE_SOURCE_URL_DEFAULT = 'https://api.frankfurter.dev/v1/latest';
