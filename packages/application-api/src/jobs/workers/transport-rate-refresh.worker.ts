import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import {
  QUEUES,
  TransportRateService,
} from '@rajahinta/data-acquisition';

export interface TransportRateRefreshJobData {
  carrierId: string;
}

@Processor(QUEUES.TRANSPORT_REFRESH)
export class TransportRateRefreshWorker {
  private readonly logger = new Logger(TransportRateRefreshWorker.name);

  constructor(
    private readonly transportRate: TransportRateService,
  ) {}

  @Process({ concurrency: 2 })
  async process(job: Job<TransportRateRefreshJobData>): Promise<void> {
    this.logger.log(
      `Refreshing transport rates for carrier ${job.data.carrierId} (attempt ${job.attemptsMade + 1})`,
    );

    const result = await this.transportRate.refreshCarrierRates(
      job.data.carrierId,
    );

    this.logger.log(
      `Refreshed ${result.ratesUpdated} transport rates for carrier ${job.data.carrierId}`,
    );
  }
}