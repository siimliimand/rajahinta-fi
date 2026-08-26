/**
 * History Module — registers the price-observation recorder and the
 * read-time tax-change attribution service, and declares the ports that
 * consuming layers must provide:
 *
 * - {@link PRICE_OBSERVATION_PORT} — append-only observation persistence
 *   (Drizzle adapter over `price_observations`, wired in a separate task)
 * - {@link PRODUCT_DATA_PORT} — product master lookups (shared token with
 *   the calculator module; both consume the same read model)
 *
 * ## Wiring from the app composition root
 *
 * ```typescript
 * @Module({
 *   imports: [HistoryModule.forRoot({
 *     priceObservationPort: DrizzlePriceObservationAdapter,
 *     productDataPort: ProductDataAdapter,
 *     taxRuleRepository: TaxRuleRepositoryAdapter,
 *     extraProviders: [/* adapter dependencies *\/],
 *   })],
 * })
 * export class AppModule {}
 * ```
 *
 * @module HistoryModule
 */
import { Module, type Provider, type Type } from '@nestjs/common';
import { TaxModule, type TaxModuleOptions } from '../tax/tax.module';
import { NormalizationModule } from '../normalization/normalization.module';
import { TransportEstimationModule } from '../transport/transport-estimation.module';
import { ReliabilityModule } from '../reliability/reliability.module';
import { PriceObservationRecorderService } from './price-observation-recorder.service';
import { TaxChangeAttributionService } from './services/tax-change-attribution.service';
import type { IProductDataPort } from '../calculator/calculator.types';
import { PRODUCT_DATA_PORT } from '../calculator/calculator.types';
import { PRICE_OBSERVATION_PORT, type IPriceObservationPort } from './price-observation.port';

/**
 * Port implementations a composition root may inject via `forRoot`.
 * Omitted ports keep the null default (tests inject via overrideProvider).
 *
 * `extraProviders` registers dependencies the port adapters themselves need
 * inside this module's scope — providers registered only in a host module
 * are not visible here.
 */
export interface HistoryModulePorts extends TaxModuleOptions {
  priceObservationPort?: Type<IPriceObservationPort>;
  productDataPort?: Type<IProductDataPort>;
  extraProviders?: Provider[];
}

@Module({
  imports: [
    TaxModule,
    NormalizationModule,
    TransportEstimationModule,
    ReliabilityModule,
  ],
  providers: [
    PriceObservationRecorderService,
    TaxChangeAttributionService,
    { provide: PRICE_OBSERVATION_PORT, useValue: null },
    { provide: PRODUCT_DATA_PORT, useValue: null },
  ],
  exports: [PriceObservationRecorderService, TaxChangeAttributionService, PRICE_OBSERVATION_PORT, PRODUCT_DATA_PORT],
})
export class HistoryModule {
  /**
   * Configure the module with concrete port implementations.
   *
   * The providers live in THIS module so they are visible to
   * PriceObservationRecorderService (NestJS resolves within the module's
   * own closure). TaxModule.forRoot is used so the tax-rule repository
   * binding reaches the AlcoholExciseService / ContainerDutyService
   * instances this module's recorder consumes — importing the static
   * TaxModule would shadow the port with null.
   *
   * Returns a fresh module identity (not this decorated class): reusing
   * the class would make NestJS also register the class's static
   * null-port metadata alongside the configured instance.
   */
  static forRoot(ports: HistoryModulePorts) {
    const providers: Provider[] = [
      PriceObservationRecorderService,
      TaxChangeAttributionService,
      ...(ports.extraProviders ?? []),
    ];
    providers.push(
      ports.priceObservationPort
        ? { provide: PRICE_OBSERVATION_PORT, useClass: ports.priceObservationPort }
        : { provide: PRICE_OBSERVATION_PORT, useValue: null },
    );
    providers.push(
      ports.productDataPort
        ? { provide: PRODUCT_DATA_PORT, useClass: ports.productDataPort }
        : { provide: PRODUCT_DATA_PORT, useValue: null },
    );

    return {
      module: HistoryConfiguredModule,
      imports: [
        TaxModule.forRoot(ports),
        NormalizationModule,
        TransportEstimationModule,
        ReliabilityModule,
      ],
      providers,
      exports: [PriceObservationRecorderService, TaxChangeAttributionService, PRICE_OBSERVATION_PORT, PRODUCT_DATA_PORT],
    };
  }
}

/**
 * Identity of the CONFIGURED history module returned by
 * {@link HistoryModule.forRoot} — deliberately undecorated.
 */
export class HistoryConfiguredModule {}
