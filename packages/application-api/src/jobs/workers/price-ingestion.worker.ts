import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import {
  QUEUES,
  PriceIngestionService,
} from '@rajahinta/data-acquisition';

export interface PriceIngestionJobData {
  merchantId: string;
  sourceUrl: string;
}

@Processor(QUEUES.PRICE_INGESTION)
export class PriceIngestionWorker {
  private readonly logger = new Logger(PriceIngestionWorker.name);

  constructor(
    private readonly priceIngestion: PriceIngestionService,
  ) {}

  @Process({ concurrency: 3 })
  async process(job: Job<PriceIngestionJobData>): Promise<void> {
    this.logger.log(
      `Ingesting prices for merchant ${job.data.merchantId} from ${job.data.sourceUrl} (attempt ${job.attemptsMade + 1})`,
    );

    const result = await this.priceIngestion.ingestMerchantPrices(
      job.data.merchantId,
      job.data.sourceUrl,
    );

    this.logger.log(
      `Ingested ${result.productsIngested} products for merchant ${job.data.merchantId}`,
    );

    if (result.errors.length > 0) {
      this.logger.warn(
        `Ingestion completed with ${result.errors.length} errors for merchant ${job.data.merchantId}`,
      );
    }
  }
}