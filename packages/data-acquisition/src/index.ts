import { Module, Injectable } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';

// ---------------------------------------------------------------------------
// Queue names — background jobs off the request path
// ---------------------------------------------------------------------------

export const QUEUES = {
  PRICE_INGESTION: 'price-ingestion',
  TRANSPORT_REFRESH: 'transport-refresh',
  TAX_DATASET_REVIEW: 'tax-dataset-review',
  TIME_SERIES_AGGREGATION: 'time-series-aggregation',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// ---------------------------------------------------------------------------
// Abstract service contracts — concrete implementations registered in features
// ---------------------------------------------------------------------------

/**
 * Ingests product/price data from external merchant sources.
 * Runs as a queued BullMQ job to stay off the request path.
 */
@Injectable()
export abstract class PriceIngestionService {
  abstract ingestMerchantPrices(
    merchantId: string,
    sourceUrl: string,
  ): Promise<{ productsIngested: number; errors: string[] }>;

  abstract scheduleRefresh(merchantId: string, cronExpression: string): void;
}

/**
 * Refreshes carrier transport rates periodically.
 */
@Injectable()
export abstract class TransportRateService {
  abstract refreshCarrierRates(
    carrierId: string,
  ): Promise<{ ratesUpdated: number }>;

  abstract schedulePeriodicRefresh(intervalMs: number): void;
}

/**
 * Checks for newly published official tax rate changes.
 * Rates are never auto-published — discoveries create a task for
 * manual/legal confirmation before any new dataset version goes live.
 */
@Injectable()
export abstract class TaxDatasetReviewService {
  abstract checkForNewPublishedRates(): Promise<{
    datasetsFound: number;
    requiresConfirmation: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Module boundary — pure interfaces for cross-layer contracts
// ---------------------------------------------------------------------------

export type {
  IDataSourceRegistry,
  IPriceDataSource,
  ITransportRateDataSource,
  ITaxRateDataSource,
  IngestionResult,
  RateRefreshResult,
  PublishedRatesCheckResult,
} from './interfaces/data-source.interface';

// ---------------------------------------------------------------------------
// NestJS module — registers Bull queues, exports service tokens
// ---------------------------------------------------------------------------

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUES.PRICE_INGESTION },
      { name: QUEUES.TRANSPORT_REFRESH },
      { name: QUEUES.TAX_DATASET_REVIEW },
      { name: QUEUES.TIME_SERIES_AGGREGATION },
    ),
  ],
  exports: [
    BullModule,
    PriceIngestionService,
    TransportRateService,
    TaxDatasetReviewService,
  ],
})
export class DataAcquisitionModule {}