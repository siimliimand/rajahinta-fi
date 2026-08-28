/**
 * FX dataset review service (task 1.3, change
 * technical-assessment-remediation; design D2).
 *
 * The FX counterpart of the tax-dataset-review workflow: a recurring
 * check fetches the latest reference-rate snapshot from a configurable
 * source (ECB reference rates default) and, when the source's
 * reference date has not been ingested yet, creates a
 * PENDING_CONFIRMATION dataset version — the confirmation task the
 * operator acts on. NOTHING here auto-publishes: the only
 * PENDING_CONFIRMATION → PUBLISHED transition in the system is
 * FxRateDatasetService.confirmPublication by a human operator.
 *
 * Idempotency: dataset identity is the deterministic version label
 * `<sourceId>-<referenceDate>` (append-only). A check that finds the
 * label already present (pending OR published) reports nothing new,
 * so re-running the job after a crash or a schedule overlap never
 * duplicates the review queue.
 *
 * @module FxDatasetReviewService
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { FxRateDatasetService } from '@rajahinta/core-domain';
import {
  FX_RATE_SOURCE_PORT,
  type FxRateSnapshot,
  type IFxRateSource,
} from '../interfaces/fx-rate-source.port';

/** Result of one recurring FX dataset check (mirrors the tax-review shape). */
export interface FxDatasetReviewResult {
  /** ISO-8601 timestamp of the check. */
  readonly checkedAt: string;
  /** Datasets created in PENDING_CONFIRMATION state by this check (0 or 1). */
  readonly datasetsFound: number;
  /** True when an operator confirmation task now exists. */
  readonly requiresConfirmation: boolean;
  /** Version labels of the datasets created (or already pending from this source). */
  readonly detectedVersions: readonly string[];
  /** Source/parse errors — the check never throws for recoverable failures. */
  readonly errors: readonly string[];
}

@Injectable()
export class FxDatasetReviewService {
  private readonly logger = new Logger(FxDatasetReviewService.name);

  constructor(
    @Inject(FX_RATE_SOURCE_PORT)
    private readonly rateSource: IFxRateSource,
    private readonly fxDatasets: FxRateDatasetService,
  ) {}

  /**
   * Check the configured source for newly available reference rates.
   *
   * A new reference date becomes a PENDING_CONFIRMATION dataset — the
   * confirmation task surfaced to the operator via the pending-dataset
   * review queue (FxRateDatasetService.listPendingDatasets). An
   * already-known reference date is a no-op. Never publishes.
   */
  async checkForNewRates(): Promise<FxDatasetReviewResult> {
    const checkedAt = new Date().toISOString();

    const { snapshot, errors } = await this.rateSource.fetchLatestRates();
    if (snapshot === null) {
      if (errors.length > 0) {
        this.logger.warn(
          `FX rate source reported ${errors.length} error(s): ${errors.join('; ')}`,
        );
      }
      return {
        checkedAt,
        datasetsFound: 0,
        requiresConfirmation: false,
        detectedVersions: [],
        errors,
      };
    }

    const versionLabel = this.versionLabelFor(snapshot);
    const existing = await this.fxDatasets.getDatasetByVersion(versionLabel);
    if (existing !== null) {
      // Known reference date — pending confirmation or already
      // published. Either way this check has nothing new to surface.
      return {
        checkedAt,
        datasetsFound: 0,
        requiresConfirmation: existing.status === 'PENDING_CONFIRMATION',
        detectedVersions: [versionLabel],
        errors,
      };
    }

    try {
      const dataset = await this.fxDatasets.createPendingDataset({
        versionLabel,
        sourceName: snapshot.sourceName,
        sourceUrl: snapshot.sourceUrl ?? undefined,
        referenceDate: snapshot.referenceDate,
        // The ECB reference rate for a date is effective from that
        // date, open-ended until a confirmed successor takes over
        // (most-recent effectiveFrom wins during any overlap).
        effectiveFrom: new Date(`${snapshot.referenceDate}T00:00:00.000Z`),
        effectiveTo: null,
        rates: snapshot.rates,
      });

      this.logger.warn(
        `FX dataset ${versionLabel} created in PENDING_CONFIRMATION — ` +
          'manual operator confirmation required before it becomes effective',
      );

      return {
        checkedAt,
        datasetsFound: 1,
        requiresConfirmation: true,
        detectedVersions: [dataset.versionLabel],
        errors,
      };
    } catch (err) {
      if (isFxDatasetVersionConflict(err)) {
        // A concurrent check inserted the same version first — the
        // append-only label guard made the race a no-op for us.
        this.logger.log(
          `FX dataset ${versionLabel} already created by a concurrent check — nothing to do`,
        );
        return {
          checkedAt,
          datasetsFound: 0,
          requiresConfirmation: true,
          detectedVersions: [versionLabel],
          errors,
        };
      }
      throw err;
    }
  }

  /** Deterministic dataset identity for a snapshot — drives idempotency. */
  private versionLabelFor(snapshot: FxRateSnapshot): string {
    return `${snapshot.sourceId}-${snapshot.referenceDate}`;
  }
}

/**
 * Version-conflict discrimination by error name: the core-domain error
 * classes are exported from the fx barrel but not re-exported at the
 * package root, and name matching is additionally resilient to the
 * duplicate-module-instance problem instanceof has across workspace
 * builds.
 */
function isFxDatasetVersionConflict(err: unknown): boolean {
  return err instanceof Error && err.name === 'FxDatasetVersionConflictError';
}
