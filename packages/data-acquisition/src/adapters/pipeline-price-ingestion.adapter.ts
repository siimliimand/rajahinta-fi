/**
 * Pipeline-backed price-ingestion service.
 *
 * Concrete implementation of the legacy {@link PriceIngestionService}
 * abstract class that delegates to {@link PipelineOrchestratorService}
 * for the actual fetch-map-upsert-quality pipeline.
 *
 * The merchant config is looked up from the registered merchant set;
 * if none is found a minimal config is built from the provided URL
 * so the pipeline can still execute the governance gate and ingestion.
 *
 * @module PipelinePriceIngestionAdapter
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { PriceIngestionService } from '../abstract/price-ingestion.service';
import { PipelineOrchestratorService } from '../services/pipeline-orchestrator.service';
import { MERCHANT_CONFIG_TOKEN } from '../config/merchants.config';
import type { MerchantConfig } from '../config/merchants.config';

@Injectable()
export class PipelinePriceIngestionAdapter extends PriceIngestionService {
  private readonly logger = new Logger(PipelinePriceIngestionAdapter.name);

  constructor(
    private readonly pipeline: PipelineOrchestratorService,
    @Inject(MERCHANT_CONFIG_TOKEN)
    private readonly merchantConfigs: MerchantConfig[],
  ) {
    super();
  }

  /**
   * Ingest prices for a merchant by running the full pipeline.
   *
   * Looks up the merchant config by ID and delegates to
   * {@link PipelineOrchestratorService.runForMerchant}.  If the merchant
   * is not in the configured set, a minimal config is constructed so the
   * pipeline can still execute (the governance gate will reject unknown
   * merchants unless a governance record exists).
   */
  async ingestMerchantPrices(
    merchantId: string,
    sourceUrl: string,
  ): Promise<{ productsIngested: number; errors: string[] }> {
    const config = this.findConfig(merchantId, sourceUrl);
    const report = await this.pipeline.runForMerchant(config);

    return {
      productsIngested: report.recordsAdded + report.recordsUpdated,
      errors: report.errors,
    };
  }

  /**
   * Schedule a recurring price refresh.
   *
   * Phase 1: scheduling is managed by the external BullMQ job queue
   * and the {@link JobsSchedulerService}.  This method logs the request
   * and is a no-op — the worker framework drives the schedule.
   */
  scheduleRefresh(_merchantId: string, _cronExpression: string): void {
    this.logger.warn(
      `scheduleRefresh is a no-op in Phase 1; ` +
        `scheduling is managed externally via BullMQ. ` +
        `Called for merchant="${_merchantId}" with cron="${_cronExpression}"`,
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Find the merchant config for the given ID, or build a minimal one
   * from the provided source URL.
   */
  private findConfig(merchantId: string, sourceUrl: string): MerchantConfig {
    const existing = this.merchantConfigs.find(
      (c) => c.merchantId === merchantId,
    );
    if (existing) {
      return { ...existing, feedUrl: sourceUrl || existing.feedUrl };
    }
    return {
      merchantId,
      name: merchantId,
      country: 'FI',
      feedUrl: sourceUrl,
      feedFormat: 'json',
      pollingIntervalMs: 3_600_000,
    };
  }
}