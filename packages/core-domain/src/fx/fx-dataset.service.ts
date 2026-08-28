/**
 * FxRateDatasetService — domain service over versioned FX-rate datasets.
 *
 * Owns the dataset lifecycle rules of design D2 (change
 * technical-assessment-remediation): ingestion creates a
 * PENDING_CONFIRMATION version, a version becomes effective only through
 * the explicit {@link confirmPublication} call performed by a human
 * operator, and no method here publishes anything on its own. Rate
 * resolution follows the observation date — the version effective on
 * that date, never the newest one — using the pure policy functions in
 * `fx-rate-window.ts`.
 *
 * Persistence goes through {@link IFxRateDatasetRepositoryPort}; the
 * service itself has no storage dependency and is unit-tested with an
 * in-memory port.
 *
 * @module FxRateDatasetService
 */

import { Injectable, Inject } from '@nestjs/common';
import type {
  FxDatasetVersion,
  FxRateEntry,
  NewFxDataset,
  ResolvedFxDatasetRate,
} from './fx-dataset.types';
import { resolveRateFromEntries } from './fx-rate-window';
import {
  FX_RATE_DATASET_REPOSITORY_PORT,
  type IFxRateDatasetRepositoryPort,
} from './ports/fx-rate-dataset-repository.port';

// ---------------------------------------------------------------------------
// Errors — distinguishable so the review workflow (task 1.3) can route
// operator feedback precisely.
// ---------------------------------------------------------------------------

/** A dataset version label already exists — versions are append-only. */
export class FxDatasetVersionConflictError extends Error {
  constructor(versionLabel: string) {
    super(`FX dataset version "${versionLabel}" already exists — datasets are append-only`);
    this.name = 'FxDatasetVersionConflictError';
  }
}

/** The referenced dataset version does not exist. */
export class FxDatasetNotFoundError extends Error {
  constructor(datasetId: number) {
    super(`FX dataset ${datasetId} not found`);
    this.name = 'FxDatasetNotFoundError';
  }
}

/** The dataset is not in a state the requested transition allows. */
export class FxDatasetInvalidTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FxDatasetInvalidTransitionError';
  }
}

/** A new dataset violates the dataset invariants. */
export class InvalidFxDatasetInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFxDatasetInputError';
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class FxRateDatasetService {
  constructor(
    @Inject(FX_RATE_DATASET_REPOSITORY_PORT)
    private readonly repo: IFxRateDatasetRepositoryPort,
  ) {}

  // -------------------------------------------------------------------------
  // Version lifecycle
  // -------------------------------------------------------------------------

  /**
   * Create a new dataset version in PENDING_CONFIRMATION status.
   *
   * This is the ONLY creation path and it never publishes: the resulting
   * version becomes effective exclusively through
   * {@link confirmPublication} by a human operator. Rejects duplicate
   * version labels (append-only identity), empty or malformed payloads,
   * and ambiguous currency pairs.
   */
  async createPendingDataset(input: NewFxDataset): Promise<FxDatasetVersion> {
    const versionLabel = input.versionLabel.trim();
    if (versionLabel === '') {
      throw new InvalidFxDatasetInputError('versionLabel must not be empty');
    }
    if (input.sourceName.trim() === '') {
      throw new InvalidFxDatasetInputError('sourceName must not be empty');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.referenceDate)) {
      throw new InvalidFxDatasetInputError(
        `referenceDate "${input.referenceDate}" must be an ISO-8601 date (YYYY-MM-DD)`,
      );
    }
    if (input.effectiveTo !== undefined && input.effectiveTo !== null) {
      if (input.effectiveTo.getTime() <= input.effectiveFrom.getTime()) {
        throw new InvalidFxDatasetInputError(
          'effectiveTo must be strictly after effectiveFrom',
        );
      }
    }
    this.validateRates(input.rates);

    const existing = await this.repo.findDatasetByVersionLabel(versionLabel);
    if (existing !== null) {
      throw new FxDatasetVersionConflictError(versionLabel);
    }

    return this.repo.createDataset({
      ...input,
      versionLabel,
      sourceName: input.sourceName.trim(),
    });
  }

  /**
   * Publish a dataset version — the explicit manual-confirmation step.
   *
   * The only PENDING_CONFIRMATION → PUBLISHED transition in the system.
   * `confirmedBy` is mandatory: an unattributed confirmation is not a
   * confirmation. No other service method calls the repository's publish.
   */
  async confirmPublication(
    datasetId: number,
    confirmedBy: string,
  ): Promise<FxDatasetVersion> {
    const operator = confirmedBy.trim();
    if (operator === '') {
      throw new FxDatasetInvalidTransitionError(
        'confirmPublication requires a non-empty confirmedBy operator',
      );
    }

    const published = await this.repo.publishDataset(datasetId, operator);
    if (published === null) {
      // Distinguish the two failure modes for the operator workflow.
      const dataset = await this.repo.findDatasetById(datasetId);
      if (dataset === null) throw new FxDatasetNotFoundError(datasetId);
      throw new FxDatasetInvalidTransitionError(
        `FX dataset ${datasetId} (${dataset.versionLabel}) is ${dataset.status}; ` +
          'only a PENDING_CONFIRMATION dataset can be published',
      );
    }
    return published;
  }

  /** Versions awaiting operator confirmation (the review queue). */
  async listPendingDatasets(): Promise<FxDatasetVersion[]> {
    return this.repo.findPendingDatasets();
  }

  /** A dataset version by label, null when absent. */
  async getDatasetByVersion(versionLabel: string): Promise<FxDatasetVersion | null> {
    return this.repo.findDatasetByVersionLabel(versionLabel);
  }

  // -------------------------------------------------------------------------
  // Rate resolution
  // -------------------------------------------------------------------------

  /**
   * Resolve the conversion rate for a pair as of an observation date.
   *
   * Uses the PUBLISHED dataset effective on `asOf` — not the newest
   * dataset — so a past-dated offer converts at the rate that was in
   * force when it was observed. Returns null when no published dataset
   * covers the date or the pair is absent; callers must reject the
   * conversion, never fall back to 1:1.
   */
  async resolveRate(
    baseCurrency: string,
    quoteCurrency: string,
    asOf: Date,
  ): Promise<ResolvedFxDatasetRate | null> {
    const dataset = await this.repo.findPublishedDatasetEffectiveOn(asOf);
    if (dataset === null) return null;

    const entries = await this.repo.findRatesForDataset(dataset.id);
    return resolveRateFromEntries(entries, dataset, baseCurrency, quoteCurrency);
  }

  // -------------------------------------------------------------------------
  // Validation helpers
  // -------------------------------------------------------------------------

  private validateRates(rates: readonly FxRateEntry[]): void {
    if (rates.length === 0) {
      throw new InvalidFxDatasetInputError('a dataset must carry at least one rate');
    }
    const seen = new Set<string>();
    for (const rate of rates) {
      const base = rate.baseCurrency.trim().toUpperCase();
      const quote = rate.quoteCurrency.trim().toUpperCase();
      if (base.length !== 3 || quote.length !== 3) {
        throw new InvalidFxDatasetInputError(
          `currency pair ${rate.baseCurrency}/${rate.quoteCurrency} is not ISO-4217 alpha-3`,
        );
      }
      if (base === quote) {
        throw new InvalidFxDatasetInputError(`self-pair ${base}/${quote} is meaningless`);
      }
      if (!Number.isFinite(rate.rate) || rate.rate <= 0) {
        throw new InvalidFxDatasetInputError(
          `rate for ${base}/${quote} must be a positive number, got ${rate.rate}`,
        );
      }
      // Both directions of a pair cannot coexist in one version: direct
      // resolution would always win and the redundant row would silently
      // disagree after any rounding.
      for (const key of [`${base}/${quote}`, `${quote}/${base}`]) {
        if (seen.has(key)) {
          throw new InvalidFxDatasetInputError(
            `duplicate currency pair ${key} — one row per pair per version`,
          );
        }
      }
      seen.add(`${base}/${quote}`);
    }
  }
}
