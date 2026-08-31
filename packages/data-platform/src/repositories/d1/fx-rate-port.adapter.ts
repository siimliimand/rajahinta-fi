/**
 * D1FxRateDatasetRepositoryAdapter — binds the D1 FX-rate repository to
 * the core-domain {@link IFxRateDatasetRepositoryPort} contract (task
 * 2.5, change migrate-to-cloudflare). Follows the TaxRuleRepositoryAdapter
 * precedent AND the pg FxRateDatasetRepositoryAdapter: the adapter lives
 * in data-platform, is registered under the domain port token in
 * DataPlatformModule, and maps persisted rows onto the domain types.
 *
 * The adapter adds no policy: lifecycle and resolution rules stay in
 * FxRateDatasetService (core-domain), persistence invariants in
 * D1FxRateRepository. In particular nothing here publishes — the
 * publishDataset delegation exists solely so the domain service's
 * manual-confirmation step reaches storage.
 *
 * @module D1FxRateDatasetRepositoryAdapter
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
import type { FxRateDatasetRecord, FxRateRow } from '../../abstracts';
import { D1FxRateRepository } from './fx-rate.repository';

@Injectable()
export class D1FxRateDatasetRepositoryAdapter implements IFxRateDatasetRepositoryPort {
  constructor(private readonly repo: D1FxRateRepository) {}

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
      rate: fxRateTextToNumber(row.rate),
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

/**
 * Contract rate text → number, with the same strictness the pg
 * requirePgNumeric coercion applied at this boundary (corrupt stored
 * values fail loudly instead of silently converting) — without porting
 * the pg coercion module itself (design D2).
 */
function fxRateTextToNumber(rate: FxRateRow['rate']): number {
  const parsed = Number(rate);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`Cannot parse fx_rates.rate as decimal: "${rate}"`);
  }
  return parsed;
}

// Re-export for composition roots that register the adapter under the
// domain token (DataPlatformModule does; export kept for parity with
// D1TaxRuleRepositoryAdapter).
export { FX_RATE_DATASET_REPOSITORY_PORT };
