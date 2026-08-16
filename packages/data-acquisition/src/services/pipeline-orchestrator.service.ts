/**
 * Pipeline orchestrator service.
 *
 * Manages the full data-acquisition lifecycle for a single merchant:
 * 1. Fetch product data from a merchant feed/API (via FeedIngestionService)
 * 2. Map raw data to Product Master / Retail Offer records (via DataMappingService)
 * 3. Call the upsert repository to persist records
 * 4. Log ingestion results (records added, updated, failed)
 *
 * The orchestrator is merchant-agnostic — merchant-specific logic is
 * encapsulated in IFeedAdapter implementations registered under
 * FEED_ADAPTERS_TOKEN.
 *
 * @module PipelineOrchestratorService
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { FeedIngestionService } from './feed-ingestion.service';
import { DataMappingService } from './data-mapping.service';
import {
  UPSERT_REPOSITORY_TOKEN,
  type IUpsertRepository,
} from '../interfaces/upsert-port.interface';
import type { MerchantConfig } from '../config/merchants.config';

/** Detailed report for a single pipeline run. */
export interface PipelineRunReport {
  readonly merchantId: string;
  readonly recordsFetched: number;
  readonly recordsAdded: number;
  readonly recordsUpdated: number;
  readonly errors: string[];
  readonly durationMs: number;
}

@Injectable()
export class PipelineOrchestratorService {
  private readonly logger = new Logger(PipelineOrchestratorService.name);

  constructor(
    private readonly feedIngestion: FeedIngestionService,
    private readonly dataMapping: DataMappingService,
    @Inject(UPSERT_REPOSITORY_TOKEN)
    private readonly upsertRepository: IUpsertRepository,
  ) {}

  /**
   * Run the full ingestion pipeline for a single merchant.
   *
   * Skips merchants that are disabled or have an empty feed URL.
   */
  async runForMerchant(config: MerchantConfig): Promise<PipelineRunReport> {
    const start = Date.now();

    if (!config.enabled || !config.feedUrl) {
      this.logger.warn(
        `Skipping merchant "${config.merchantId}": ${!config.enabled ? 'disabled' : 'no feed URL'}`,
      );
      return {
        merchantId: config.merchantId,
        recordsFetched: 0,
        recordsAdded: 0,
        recordsUpdated: 0,
        errors: [],
        durationMs: Date.now() - start,
      };
    }

    // -- Step 1: Fetch -------------------------------------------------------
    const fetchResult = await this.feedIngestion.fetchFromMerchant(
      config.merchantId,
      config.feedUrl,
      config.feedFormat,
    );

    if (fetchResult.errors.length > 0) {
      this.logger.warn(
        `Fetch warnings/errors for "${config.merchantId}": ${fetchResult.errors.join('; ')}`,
      );
    }

    if (fetchResult.records.length === 0) {
      return {
        merchantId: config.merchantId,
        recordsFetched: 0,
        recordsAdded: 0,
        recordsUpdated: 0,
        errors: fetchResult.errors,
        durationMs: Date.now() - start,
      };
    }

    // -- Step 2: Map ---------------------------------------------------------
    const mapped = this.dataMapping.mapBatch(
      fetchResult.records,
      config.merchantId,
    );

    // -- Step 3: Upsert ------------------------------------------------------
    let recordsAdded = 0;
    let recordsUpdated = 0;
    const upsertErrors: string[] = [];

    for (const pair of mapped) {
      try {
        const upsertResult = await this.upsertRepository.upsertProduct(
          pair.product,
        );
        if (upsertResult.created) {
          recordsAdded++;
        } else {
          recordsUpdated++;
        }

        await this.upsertRepository.upsertOffer({
          ...pair.offerInput,
          productId: upsertResult.productId,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unknown upsert error';
        upsertErrors.push(
          `Failed to upsert product "${pair.product.name}": ${message}`,
        );
      }
    }

    // -- Step 4: Log ---------------------------------------------------------
    const durationMs = Date.now() - start;
    const allErrors = [...fetchResult.errors, ...upsertErrors];

    this.logger.log(
      `Pipeline run for "${config.merchantId}": ` +
        `${fetchResult.records.length} fetched, ` +
        `${recordsAdded} added, ${recordsUpdated} updated, ` +
        `${allErrors.length} errors, ${durationMs} ms`,
    );

    return {
      merchantId: config.merchantId,
      recordsFetched: fetchResult.records.length,
      recordsAdded,
      recordsUpdated,
      errors: allErrors,
      durationMs,
    };
  }

  /**
   * Run the pipeline for all enabled merchants.
   */
  async runAll(configs: MerchantConfig[]): Promise<PipelineRunReport[]> {
    const results: PipelineRunReport[] = [];

    for (const config of configs) {
      const report = await this.runForMerchant(config);
      results.push(report);
    }

    return results;
  }
}