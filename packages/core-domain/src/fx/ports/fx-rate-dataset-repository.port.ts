/**
 * Port interface for FX-rate-dataset persistence.
 *
 * Core Domain owns this port so {@link FxRateDatasetService} depends on an
 * abstraction, not on the data-platform repository — the same pattern as
 * {@link ITaxRuleRepositoryPort}. The concrete adapter lives in the
 * composition root (DataPlatform) and wires {@code DrizzleFxRateRepository}
 * into this contract at bootstrap time via `FxModule.forRoot`.
 *
 * The port is deliberately storage-shaped: effective-window pair selection
 * and rate inversion are domain policy implemented in
 * `fx-rate-window.ts`, never here.
 *
 * @module FxRateDatasetRepositoryPort
 */

import type { FxDatasetVersion, FxRateEntry, NewFxDataset } from '../fx-dataset.types';

/** Injection token for the FX-rate-dataset repository port. */
export const FX_RATE_DATASET_REPOSITORY_PORT = 'FX_RATE_DATASET_REPOSITORY_PORT';

/**
 * Repository contract the FX dataset domain service needs.
 *
 * Consumers inject this interface. An adapter in the composition root maps
 * the concrete repository to this port.
 */
export interface IFxRateDatasetRepositoryPort {
  /**
   * Insert a new dataset version with its rates.
   *
   * Implementations create it in PENDING_CONFIRMATION status regardless of
   * any status on the input — append-only, never effective on arrival.
   */
  createDataset(input: NewFxDataset): Promise<FxDatasetVersion>;

  /** Dataset version by its unique version label, null when absent. */
  findDatasetByVersionLabel(versionLabel: string): Promise<FxDatasetVersion | null>;

  /** Dataset version by id, null when absent. */
  findDatasetById(id: number): Promise<FxDatasetVersion | null>;

  /** Versions still awaiting operator confirmation (the review queue). */
  findPendingDatasets(): Promise<FxDatasetVersion[]>;

  /**
   * The PUBLISHED dataset whose effective window covers `asOf` (most
   * recent effectiveFrom wins when windows overlap transiently).
   * Null when no published dataset covers the date.
   */
  findPublishedDatasetEffectiveOn(asOf: Date): Promise<FxDatasetVersion | null>;

  /**
   * The PENDING_CONFIRMATION → PUBLISHED transition, recording who
   * confirmed it. Returns null when the dataset does not exist or is
   * already published. This is the ONLY publish path — nothing may call
   * it implicitly.
   */
  publishDataset(id: number, confirmedBy: string): Promise<FxDatasetVersion | null>;

  /** Rates of a dataset version. Empty for an unknown id. */
  findRatesForDataset(datasetId: number): Promise<FxRateEntry[]>;
}
