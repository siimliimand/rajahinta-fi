import { Module } from '@nestjs/common';
import { DataAcquisitionModule } from '@rajahinta/data-acquisition';
import { DataPlatformModule } from '@rajahinta/data-platform';
import { ApplicationApiModule } from '@rajahinta/application-api';
import { ProductDataAdapter } from './adapters/product-data.adapter';
import { CalculationRecordAdapter } from './adapters/calculation-record.adapter';
import { HistoryRecordingModule } from './history-recording.module';

/**
 * Composition root. The calculator port adapters (product data lookup,
 * calculation record persistence) are injected via ApplicationApiModule
 * *.forRoot so they reach LandedCostCalculatorService inside its module
 * scope — providers registered only here would not be visible across the
 * NestJS import graph.
 *
 * HistoryRecordingModule registers the price-observation port adapter
 * (PRICE_OBSERVATION_PORT → DrizzlePriceObservationRepository) and binds the
 * ingestion pipeline's OFFER_CHANGE_HOOK_TOKEN to the recorder — background
 * path only, one observation per changed offer.
 */
@Module({
  imports: [
    DataAcquisitionModule,
    DataPlatformModule,
    HistoryRecordingModule,
    ApplicationApiModule.forRoot({
      productDataPort: ProductDataAdapter,
      calculationRecordPort: CalculationRecordAdapter,
    }),
  ],
})
export class AppModule {}