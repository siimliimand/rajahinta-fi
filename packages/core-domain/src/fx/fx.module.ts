/**
 * FX Module — the FX-rate-dataset domain service plus its repository
 * port token.
 *
 * Hosts that persist FX datasets provide the repository via
 * `FxModule.forRoot({ fxRateDatasetRepository })` (threaded through the
 * composition root), exactly like `TaxModule.forRoot`. The static
 * default binds the port to null because core-domain has no
 * persistence layer of its own.
 *
 * @module FxModule
 */
import { Module, type Provider, type Type } from '@nestjs/common';
import { FxRateDatasetService } from './fx-dataset.service';
import {
  FX_RATE_DATASET_REPOSITORY_PORT,
  type IFxRateDatasetRepositoryPort,
} from './ports/fx-rate-dataset-repository.port';

/** Options accepted by {@link FxModule.forRoot}. */
export interface FxModuleOptions {
  fxRateDatasetRepository?: Type<IFxRateDatasetRepositoryPort>;
}

@Module({
  providers: [
    FxRateDatasetService,
    { provide: FX_RATE_DATASET_REPOSITORY_PORT, useValue: null },
  ],
  exports: [FxRateDatasetService, FX_RATE_DATASET_REPOSITORY_PORT],
})
export class FxModule {}

/** Identity of the CONFIGURED FX module — deliberately undecorated. */
export class FxConfiguredModule {}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace FxModule {
  /**
   * Configure the module with a concrete FX-rate-dataset repository. A
   * fresh module identity is used so the class's static null-port
   * metadata is not merged into the configured instance (same trick as
   * TaxModule.forRoot).
   */
  export function forRoot(options: FxModuleOptions) {
    const providers: Provider[] = [
      FxRateDatasetService,
      options.fxRateDatasetRepository
        ? { provide: FX_RATE_DATASET_REPOSITORY_PORT, useClass: options.fxRateDatasetRepository }
        : { provide: FX_RATE_DATASET_REPOSITORY_PORT, useValue: null },
    ];
    return {
      module: FxConfiguredModule,
      providers,
      exports: [FxRateDatasetService, FX_RATE_DATASET_REPOSITORY_PORT],
    };
  }
}
