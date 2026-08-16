/**
 * Feed ingestion service.
 *
 * Handles reading from permitted merchant feeds/APIs by delegating to
 * merchant-specific {@link IFeedAdapter} implementations.  The pipeline
 * orchestrator calls this service to obtain raw records, then passes them
 * to the data-mapping service for normalisation.
 *
 * Adapters are registered via the {@link FEED_ADAPTERS_TOKEN} multi-provider.
 * If no adapter exists for a requested merchant the service returns an empty
 * result with a descriptive error.
 *
 * @module FeedIngestionService
 */

import { Inject, Injectable } from '@nestjs/common';
import type { IFeedAdapter } from '../interfaces/feed-adapter.interface';
import { FEED_ADAPTERS_TOKEN } from '../interfaces/feed-adapter.interface';
import type { IngestionResult } from '../interfaces/data-source.interface';

@Injectable()
export class FeedIngestionService {
  constructor(
    @Inject(FEED_ADAPTERS_TOKEN)
    private readonly adapters: Map<string, IFeedAdapter>,
  ) {}

  /**
   * Fetch product data from a merchant's feed via its registered adapter.
   *
   * @param merchantId  Stable merchant identifier.
   * @param feedUrl     The feed or API endpoint URL.
   * @param feedFormat  Expected payload format.
   * @returns           Normalised records plus any per-record errors.
   */
  async fetchFromMerchant(
    merchantId: string,
    feedUrl: string,
    feedFormat: 'json' | 'xml' | 'csv',
  ): Promise<IngestionResult & { records: import('../interfaces/feed-adapter.interface').RawFeedRecord[] }> {
    const adapter = this.adapters.get(merchantId);

    if (!adapter) {
      return {
        productsIngested: 0,
        errors: [`No feed adapter registered for merchant "${merchantId}"`],
        records: [],
      };
    }

    try {
      const result = await adapter.fetch({ feedUrl, feedFormat });
      return {
        productsIngested: result.records.length,
        errors: result.errors,
        records: result.records,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown fetch error';
      return {
        productsIngested: 0,
        errors: [`Feed adapter "${merchantId}" threw: ${message}`],
        records: [],
      };
    }
  }
}