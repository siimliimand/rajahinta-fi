import { Injectable } from '@nestjs/common';

/**
 * Ingests product/price data from external merchant sources.
 * Runs as a queued BullMQ job to stay off the request path.
 *
 * @deprecated Use {@link import('../services/pipeline-orchestrator.service').PipelineOrchestratorService} instead.
 */
@Injectable()
export abstract class PriceIngestionService {
  abstract ingestMerchantPrices(
    merchantId: string,
    sourceUrl: string,
  ): Promise<{ productsIngested: number; errors: string[] }>;

  abstract scheduleRefresh(merchantId: string, cronExpression: string): void;
}