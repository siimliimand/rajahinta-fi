import { Module } from '@nestjs/common';
import { DataAcquisitionModule } from '@rajahinta/data-acquisition';
import { DataPlatformModule } from '@rajahinta/data-platform';
import { ApplicationApiModule } from '@rajahinta/application-api';
import { ProductDataAdapter } from './adapters/product-data.adapter';
import { CalculationRecordAdapter } from './adapters/calculation-record.adapter';

/**
 * Composition root. The calculator port adapters (product data lookup,
 * calculation record persistence) are injected via ApplicationApiModule
 *.forRoot so they reach LandedCostCalculatorService inside its module
 * scope — providers registered only here would not be visible across
 * the NestJS import graph.
 */
@Module({
  imports: [
    DataAcquisitionModule,
    DataPlatformModule,
    ApplicationApiModule.forRoot({
      productDataPort: ProductDataAdapter,
      calculationRecordPort: CalculationRecordAdapter,
    }),
  ],
})
export class AppModule {}