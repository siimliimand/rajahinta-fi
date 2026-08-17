/**
 * DataPlatform Module — NestJS module that registers all concrete Drizzle
 * repository implementations and exports them under their abstract class
 * injection tokens.
 *
 * Also registers the {@code TaxRuleRepositoryAdapter} under the
 * {@code TAX_RULE_REPOSITORY_PORT} token consumed by core-domain services.
 *
 * ## Usage
 *
 * ```typescript
 * import { DataPlatformModule } from '@rajahinta/data-platform';
 *
 * @Module({ imports: [DataPlatformModule] })
 * export class AppModule {}
 * ```
 *
 * @module DataPlatformModule
 */
import { Module } from '@nestjs/common';
import { TAX_RULE_REPOSITORY_PORT } from '@rajahinta/core-domain';
import { DrizzleModule } from './db/drizzle.module';
import {
  ProductRepository,
  TaxRateRepository,
  TransportOfferRepository,
  CalculationRecordRepository,
  AuditRepository,
} from './abstracts';
import { DrizzleProductRepository } from './repositories/product.repository';
import { DrizzleTaxRateRepository } from './repositories/tax-rate.repository';
import { DrizzleTransportOfferRepository } from './repositories/transport-offer.repository';
import { DrizzleCalculationRecordRepository } from './repositories/calculation-record.repository';
import { TaxRuleRepositoryAdapter } from './repositories/tax-rate.repository';

@Module({
  imports: [DrizzleModule],
  providers: [
    // Concrete repositories registered under their abstract class tokens
    {
      provide: ProductRepository,
      useClass: DrizzleProductRepository,
    },
    {
      provide: TaxRateRepository,
      useClass: DrizzleTaxRateRepository,
    },
    {
      provide: TransportOfferRepository,
      useClass: DrizzleTransportOfferRepository,
    },
    {
      provide: CalculationRecordRepository,
      useClass: DrizzleCalculationRecordRepository,
    },
    {
      provide: AuditRepository,
      useValue: null, // Not yet implemented — placeholder
    },
    // Domain-port adapter for tax rule lookup
    {
      provide: TAX_RULE_REPOSITORY_PORT,
      useClass: TaxRuleRepositoryAdapter,
    },
    // Also register the concrete classes directly (they are @Injectable)
    DrizzleProductRepository,
    DrizzleTaxRateRepository,
    DrizzleTransportOfferRepository,
    DrizzleCalculationRecordRepository,
  ],
  exports: [
    ProductRepository,
    TaxRateRepository,
    TransportOfferRepository,
    CalculationRecordRepository,
    AuditRepository,
  ],
})
export class DataPlatformModule {}