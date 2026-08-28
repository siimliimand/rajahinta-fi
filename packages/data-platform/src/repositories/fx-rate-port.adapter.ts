/**
 * FxRateDatasetRepositoryAdapter — binds the Drizzle FX-rate repository
 * to the core-domain IFxRateDatasetRepositoryPort contract (task 1.3,
 * change technical-assessment-remediation; design D2).
 *
 * Follows the TaxRuleRepositoryAdapter precedent: the adapter lives in
 * data-platform, is registered under the domain port token in
 * DataPlatformModule, and maps persisted rows onto the domain types —
 * pg numeric strings become numbers here, at the repository boundary
 * (task 3.5 coercion convention).
 *
 * The adapter adds no policy: lifecycle and resolution rules stay in
 * FxRateDatasetService (core-domain), persistence invariants in
 * DrizzleFxRateRepository. In particular nothing here publishes — the
 * publishDataset delegation exists solely so the domain service's
 * manual-confirmation step reaches storage.
 *
 * @module FxRateDatasetRepositoryAdapter
 */
import { Injectable } from '@nestjs/common';
import {
  FX_RATE_DATASET_REPOSITORY_PORT,
  type IFxRateDatasetRepositoryPort,
} from '@rajahinta/core-domain';
import {
  FX_DATASET_STATUSES,
  type FxDatasetStatus,
  type FxDatasetVersion,
  type FxRateEntry,
  type NewFxDataset,
} from '@rajahinta/core-domain';
import { requirePgNumeric } from '../db/pg-numeric';
import type { FxRateDatasetRecord } from '../abstracts';
import { DrizzleFxRateRepository } from './fx-rate.repository';

@Injectable()
export class FxRateDatasetRepositoryAdapter implements IFxRateDatasetRepositoryPort {
  constructor(private readonly repo: DrizzleFxRateRepository) {}

  /** @inheritdoc */
  async createDataset(input: NewFxDataset): Promise<FxDatasetVersion> {
    const record = await this.repo.createDataset(
      {
        versionLabel: input.versionLabel,
        sourceName: input.sourceName,
        sourceUrl: input.sourceUrl ?? null,
        referenceDate: input.referenceDate,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        // Status is forced by the repository contract regardless of any
        // value set here — datasets never arrive effective (design D2).
        status: 'PENDING_CONFIRMATION',
      },
      input.rates.map((rate) => ({
        baseCurrency: rate.baseCurrency,
        quoteCurrency: rate.quoteCurrency,
        rate: String(rate.rate),
      })),
    );
    return this.toVersion(record);
  }

  /** @inheritdoc */
  async findDatasetByVersionLabel(versionLabel: string): Promise<FxDatasetVersion | null> {
    const record = await this.repo.findDatasetByVersionLabel(versionLabel);
    return record === null ? null : this.toVersion(record);
  }

  /** @inheritdoc */
  async findDatasetById(id: number): Promise<FxDatasetVersion | null> {
    const record = await this.repo.findDatasetById(id);
    return record === null ? null : this.toVersion(record);
  }

  /** @inheritdoc */
  async findPendingDatasets(): Promise<FxDatasetVersion[]> {
    const records = await this.repo.findPendingDatasets();
    return records.map((record) => this.toVersion(record));
  }

  /** @inheritdoc */
  async findPublishedDatasetEffectiveOn(asOf: Date): Promise<FxDatasetVersion | null> {
    const record = await this.repo.findPublishedDatasetEffectiveOn(asOf);
    return record === null ? null : this.toVersion(record);
  }

  /** @inheritdoc */
  async publishDataset(id: number, confirmedBy: string): Promise<FxDatasetVersion | null> {
    const record = await this.repo.publishDataset(id, confirmedBy);
    return record === null ? null : this.toVersion(record);
  }

  /** @inheritdoc */
  async findRatesForDataset(datasetId: number): Promise<FxRateEntry[]> {
    const rows = await this.repo.findRatesForDataset(datasetId);
    return rows.map((row) => ({
      baseCurrency: row.baseCurrency,
      quoteCurrency: row.quoteCurrency,
      rate: requirePgNumeric(row.rate, 'fx_rates.rate'),
    }));
  }

  /** Persisted row → domain version (identity mapping, numeric-free). */
  private toVersion(record: FxRateDatasetRecord): FxDatasetVersion {
    return {
      id: record.id,
      versionLabel: record.versionLabel,
      sourceName: record.sourceName,
      sourceUrl: record.sourceUrl,
      referenceDate: record.referenceDate,
      status: toDomainStatus(record.status),
      effectiveFrom: record.effectiveFrom,
      effectiveTo: record.effectiveTo,
      confirmedBy: record.confirmedBy,
      confirmedAt: record.confirmedAt,
      createdAt: record.createdAt,
    };
  }
}

/** Narrow the varchar column onto the domain lifecycle union. */
function toDomainStatus(value: string): FxDatasetStatus {
  if (!(FX_DATASET_STATUSES as readonly string[]).includes(value)) {
    throw new Error(
      `fx_rate_datasets.status "${value}" is not a known FX dataset lifecycle state`,
    );
  }
  return value as FxDatasetStatus;
}

// Re-export for composition roots that register the adapter under the
// domain token (DataPlatformModule does; export kept for parity with
// TaxRuleRepositoryAdapter).
export { FX_RATE_DATASET_REPOSITORY_PORT };
