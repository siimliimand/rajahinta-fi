/**
 * Pipeline-backed price-ingestion service.
 *
 * Concrete implementation of the legacy {@link PriceIngestionService}
 * abstract class that delegates to {@link PipelineOrchestratorService}
 * for the actual fetch-map-upsert-quality pipeline.
 *
 * Merchant configuration comes from the database-backed merchant
 * registry (task 7.3 / task 7.2 leftover, design D7): the registry row
 * IS the merchant's config. A merchant absent from the registry is not
 * onboarded — the run fails closed with a per-merchant error instead
 * of fabricating a config from thin air. The registry is re-read at
 * run time, so a registry edit takes effect on the next job without a
 * deploy; the sourceUrl on the job data is log context from enqueue
 * time, not an override.
 *
 * @module PipelinePriceIngestionAdapter
 */

import { Injectable, Logger } from '@nestjs/common';
import { MerchantRegistryRepository } from '@rajahinta/data-platform';
import { PriceIngestionService } from '../abstract/price-ingestion.service';
import { PipelineOrchestratorService } from '../services/pipeline-orchestrator.service';
import { merchantConfigFromRegistry } from '../interfaces/merchant-config.interface';

@Injectable()
export class PipelinePriceIngestionAdapter extends PriceIngestionService {
  private readonly logger = new Logger(PipelinePriceIngestionAdapter.name);

  constructor(
    private readonly pipeline: PipelineOrchestratorService,
    private readonly merchantRegistry: MerchantRegistryRepository,
  ) {
    super();
  }

  /**
   * Ingest prices for a merchant by running the full pipeline.
   *
   * Resolves the merchant's configuration from the registry and
   * delegates to {@link PipelineOrchestratorService.runForMerchant}.
   * The governance gate still applies inside the pipeline — registry
   * presence makes a merchant KNOWN, permission comes from governance
   * records (fail-closed).
   */
  async ingestMerchantPrices(
    merchantId: string,
    _sourceUrl: string,
  ): Promise<{ productsIngested: number; errors: string[] }> {
    const row = await this.merchantRegistry.findByMerchantId(merchantId);
    if (row === null) {
      const message =
        `Merchant "${merchantId}" is not in the merchant registry — ` +
          'onboard it (registry row + governance grant) before ingestion (D7)';
      this.logger.error(message);
      return { productsIngested: 0, errors: [message] };
    }

    const derived = merchantConfigFromRegistry(row);
    if ('error' in derived) {
      this.logger.error(derived.error);
      return { productsIngested: 0, errors: [derived.error] };
    }

    const report = await this.pipeline.runForMerchant(derived.config);

    return {
      productsIngested: report.recordsAdded + report.recordsUpdated,
      errors: report.errors,
    };
  }

  /**
   * Schedule a recurring price refresh.
   *
   * Scheduling is managed by the external BullMQ job queue and the
   * {@code JobsSchedulerService} (per-merchant jobs from the registry,
   * task 7.3). This method logs the request and is a no-op.
   */
  scheduleRefresh(_merchantId: string, _cronExpression: string): void {
    this.logger.warn(
      `scheduleRefresh is a no-op; scheduling is managed externally via ` +
        `BullMQ per-merchant jobs driven by the merchant registry. ` +
        `Called for merchant="${_merchantId}" with cron="${_cronExpression}"`,
    );
  }
}
