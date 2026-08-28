/**
 * /fx barrel — public exports for the FX-rate-dataset subdomain.
 *
 * @module FxIndex
 */

// Types
export type {
  FxDatasetStatus,
  FxDatasetVersion,
  FxRateEntry,
  NewFxDataset,
  ResolvedFxDatasetRate,
} from './fx-dataset.types';
export { FX_DATASET_STATUSES } from './fx-dataset.types';

// Pure policy functions
export { isEffectiveOn, resolveEffectiveDataset, resolveRateFromEntries } from './fx-rate-window';

// Port
export type { IFxRateDatasetRepositoryPort } from './ports/fx-rate-dataset-repository.port';
export { FX_RATE_DATASET_REPOSITORY_PORT } from './ports/fx-rate-dataset-repository.port';

// Service + errors
export {
  FxRateDatasetService,
  FxDatasetVersionConflictError,
  FxDatasetNotFoundError,
  FxDatasetInvalidTransitionError,
  InvalidFxDatasetInputError,
} from './fx-dataset.service';

// Module
export { FxModule, type FxModuleOptions, FxConfiguredModule } from './fx.module';
