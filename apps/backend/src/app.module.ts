import { Module } from '@nestjs/common';
import { CoreDomainModule, PRODUCT_DATA_PORT, CALCULATION_RECORD_PORT } from '@rajahinta/core-domain';
import { DataAcquisitionModule } from '@rajahinta/data-acquisition';
import { DataPlatformModule } from '@rajahinta/data-platform';
import { ApplicationApiModule } from '@rajahinta/application-api';
import { ProductDataAdapter } from './adapters/product-data.adapter';
import { CalculationRecordAdapter } from './adapters/calculation-record.adapter';

@Module({
  imports: [
    CoreDomainModule,
    DataAcquisitionModule,
    DataPlatformModule,
    ApplicationApiModule,
  ],
  providers: [
    // Adapters — wire the domain port tokens to data-platform implementations
    { provide: PRODUCT_DATA_PORT, useClass: ProductDataAdapter },
    { provide: CALCULATION_RECORD_PORT, useClass: CalculationRecordAdapter },
    // Register the adapters themselves so NestJS can resolve their constructor deps
    ProductDataAdapter,
    CalculationRecordAdapter,
  ],
})
export class AppModule {}