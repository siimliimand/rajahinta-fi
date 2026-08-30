/**
 * D1 FxRateRepository — the Cloudflare-side implementation of the
 * abstract {@link FxRateRepository} contract (task 2.5, change
 * migrate-to-cloudflare), backed by the `fx_rate_datasets` /
 * `fx_rates` tables. Signatures and result shapes match the pg
 * DrizzleFxRateRepository exactly.
 *
 * Enforces the D2 dataset invariants at the storage boundary: append-only
 * versions, rates immutable once published, and a publish transition that
 * exists only as this class's explicit publishDataset call — no code path
 * flips a version effective on its own.
 *
 * ## Atomic dataset append
 *
 * pg created the dataset and its rate rows inside one transaction. The
 * D1 translation is the binding's `batch()` — sequential statements in
 * one implicit transaction. Because batch statements cannot consume a
 * previous statement's RETURNING output, the rate rows resolve the fresh
 * dataset id themselves (`SELECT id FROM fx_rate_datasets WHERE
 * version_label = ?` — unique) inside the same batch.
 *
 * ## pg-shape translation (design D2 — no coercion layer)
 *
 * The abstract contract is typed against the pg schema: `FxRateRow.rate`
 * is the pg numeric(24,12) decimal text, dataset instants are Date
 * objects. The D1 driver returns REAL rates and ISO-8601 TEXT, so this
 * repository performs that translation explicitly at the boundary;
 * `resolveRate`'s numeric result needs no coercion — it is a REAL.
 *
 * @module D1FxRateRepository
 */
import { Injectable } from '@nestjs/common';
import {
  FxRateRepository,
  type FxRateDatasetRecord,
  type FxRateRow,
  type ResolvedFxRate,
} from '../../abstracts';
import { fxRateDatasets, fxRates } from '../../schema';
import type { D1DatabaseLike } from '../../d1/executor';

/** pg column scale: fx_rates.rate numeric(24,12). */
const RATE_SCALE = 12;

/** Raw D1 fx_rate_datasets row. */
interface D1DatasetRow {
  readonly id: number;
  readonly version_label: string;
  readonly source_name: string;
  readonly source_url: string | null;
  readonly reference_date: string;
  readonly status: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly confirmed_by: string | null;
  readonly confirmed_at: string | null;
  readonly created_at: string;
}

/** Raw D1 fx_rates row. */
interface D1RateRow {
  readonly id: number;
  readonly dataset_id: number;
  readonly base_currency: string;
  readonly quote_currency: string;
  readonly rate: number;
  readonly created_at: string;
}

function toContractDataset(row: D1DatasetRow): FxRateDatasetRecord {
  return {
    id: row.id,
    versionLabel: row.version_label,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    referenceDate: row.reference_date,
    status: row.status,
    effectiveFrom: new Date(row.effective_from),
    effectiveTo: row.effective_to === null ? null : new Date(row.effective_to),
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at === null ? null : new Date(row.confirmed_at),
    createdAt: new Date(row.created_at),
  };
}

const DATASET_COLUMNS = `
  id, version_label, source_name, source_url, reference_date, status,
  effective_from, effective_to, confirmed_by, confirmed_at, created_at`;

const RATE_COLUMNS = `
  id, dataset_id, base_currency, quote_currency, rate, created_at`;

const FIND_DATASET_BY_ID_SQL = `
  SELECT ${DATASET_COLUMNS} FROM fx_rate_datasets WHERE id = ?`;

const FIND_DATASET_BY_LABEL_SQL = `
  SELECT ${DATASET_COLUMNS} FROM fx_rate_datasets WHERE version_label = ?`;

const FIND_PENDING_SQL = `
  SELECT ${DATASET_COLUMNS} FROM fx_rate_datasets
   WHERE status = 'PENDING_CONFIRMATION'
   ORDER BY created_at ASC`;

/**
 * Effective-window resolution: effectiveFrom ≤ asOf < effectiveTo
 * (null = open-ended), matching the pg predicate exactly — note the
 * STRICT upper bound here, unlike the tax-rules read.
 */
const FIND_PUBLISHED_EFFECTIVE_SQL = `
  SELECT ${DATASET_COLUMNS} FROM fx_rate_datasets
   WHERE status = 'PUBLISHED'
     AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
   ORDER BY effective_from DESC
   LIMIT 1`;

/** Only a PENDING_CONFIRMATION row can flip — never-auto-publish guard. */
const PUBLISH_SQL = `
  UPDATE fx_rate_datasets
     SET status = 'PUBLISHED', confirmed_by = ?, confirmed_at = ?
   WHERE id = ? AND status = 'PENDING_CONFIRMATION'
   RETURNING ${DATASET_COLUMNS}`;

const FIND_RATES_SQL = `
  SELECT ${RATE_COLUMNS} FROM fx_rates
   WHERE dataset_id = ?
   ORDER BY base_currency ASC, quote_currency ASC`;

const FIND_RATE_SQL = `
  SELECT ${RATE_COLUMNS} FROM fx_rates
   WHERE dataset_id = ? AND base_currency = ? AND quote_currency = ?
   LIMIT 1`;

const INSERT_DATASET_SQL = `
  INSERT INTO fx_rate_datasets (
    version_label, source_name, source_url, reference_date, status,
    effective_from, effective_to, confirmed_by, confirmed_at, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const INSERT_DATASET_WITH_ID_SQL = `
  INSERT INTO fx_rate_datasets (
    id, version_label, source_name, source_url, reference_date, status,
    effective_from, effective_to, confirmed_by, confirmed_at, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Resolves the fresh dataset id inside the same batch transaction. */
const INSERT_RATE_SQL = `
  INSERT INTO fx_rates (dataset_id, base_currency, quote_currency, rate)
  SELECT (SELECT id FROM fx_rate_datasets WHERE version_label = ?), ?, ?, ?`;

@Injectable()
export class D1FxRateRepository extends FxRateRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async createDataset(
    record: typeof fxRateDatasets.$inferInsert,
    rates: Omit<typeof fxRates.$inferInsert, 'datasetId'>[],
  ): Promise<FxRateDatasetRecord> {
    const now = new Date().toISOString();
    const datasetParams = [
      record.versionLabel,
      record.sourceName,
      record.sourceUrl ?? null,
      record.referenceDate,
      // New versions always start unconfirmed — never auto-published.
      record.status ?? 'PENDING_CONFIRMATION',
      record.effectiveFrom.toISOString(),
      record.effectiveTo?.toISOString() ?? null,
      record.confirmedBy ?? null,
      record.confirmedAt?.toISOString() ?? null,
      record.createdAt?.toISOString() ?? now,
    ];
    const datasetInsert =
      record.id === undefined
        ? this.d1.prepare(INSERT_DATASET_SQL).bind(...datasetParams)
        : this.d1
            .prepare(INSERT_DATASET_WITH_ID_SQL)
            .bind(record.id, ...datasetParams);

    // Dataset + rates in one implicit transaction: either both land or
    // neither does (the pg db.transaction shape on D1's batch primitive).
    const statements = [
      datasetInsert,
      ...rates.map((rate) =>
        this.d1
          .prepare(INSERT_RATE_SQL)
          .bind(record.versionLabel, rate.baseCurrency, rate.quoteCurrency, rate.rate),
      ),
    ];
    await this.d1.batch(statements);

    const row = await this.d1
      .prepare(FIND_DATASET_BY_LABEL_SQL)
      .bind(record.versionLabel)
      .first<D1DatasetRow>();
    if (!row) {
      throw new Error('fx_rate_datasets batch insert produced no dataset row');
    }
    return toContractDataset(row);
  }

  /** @inheritdoc */
  async findDatasetById(id: number): Promise<FxRateDatasetRecord | null> {
    const row = await this.d1
      .prepare(FIND_DATASET_BY_ID_SQL)
      .bind(id)
      .first<D1DatasetRow>();
    return row ? toContractDataset(row) : null;
  }

  /** @inheritdoc */
  async findDatasetByVersionLabel(
    versionLabel: string,
  ): Promise<FxRateDatasetRecord | null> {
    const row = await this.d1
      .prepare(FIND_DATASET_BY_LABEL_SQL)
      .bind(versionLabel)
      .first<D1DatasetRow>();
    return row ? toContractDataset(row) : null;
  }

  /** @inheritdoc */
  async findPendingDatasets(): Promise<FxRateDatasetRecord[]> {
    const rows = (
      await this.d1.prepare(FIND_PENDING_SQL).all<D1DatasetRow>()
    ).results;
    return rows.map(toContractDataset);
  }

  /** @inheritdoc */
  async findPublishedDatasetEffectiveOn(
    asOf: Date,
  ): Promise<FxRateDatasetRecord | null> {
    const asOfText = asOf.toISOString();
    const row = await this.d1
      .prepare(FIND_PUBLISHED_EFFECTIVE_SQL)
      .bind(asOfText, asOfText)
      .first<D1DatasetRow>();
    return row ? toContractDataset(row) : null;
  }

  /** @inheritdoc */
  async publishDataset(
    id: number,
    confirmedBy: string,
  ): Promise<FxRateDatasetRecord | null> {
    const row = await this.d1
      .prepare(PUBLISH_SQL)
      .bind(confirmedBy, new Date().toISOString(), id)
      .first<D1DatasetRow>();
    return row ? toContractDataset(row) : null;
  }

  /** @inheritdoc */
  async findRatesForDataset(datasetId: number): Promise<FxRateRow[]> {
    const rows = (
      await this.d1.prepare(FIND_RATES_SQL).bind(datasetId).all<D1RateRow>()
    ).results;
    return rows.map((row) => ({
      id: row.id,
      datasetId: row.dataset_id,
      baseCurrency: row.base_currency,
      quoteCurrency: row.quote_currency,
      // Contract shape: the pg numeric(24,12) decimal text.
      rate: row.rate.toFixed(RATE_SCALE),
      createdAt: new Date(row.created_at),
    }));
  }

  /** @inheritdoc */
  async resolveRate(
    baseCurrency: string,
    quoteCurrency: string,
    asOf: Date,
  ): Promise<ResolvedFxRate | null> {
    const dataset = await this.findPublishedDatasetEffectiveOn(asOf);
    if (!dataset) {
      return null;
    }

    const rate = await this.d1
      .prepare(FIND_RATE_SQL)
      .bind(dataset.id, baseCurrency, quoteCurrency)
      .first<D1RateRow>();
    if (!rate) {
      return null;
    }

    return {
      dataset,
      baseCurrency: rate.base_currency,
      quoteCurrency: rate.quote_currency,
      // D1 returns a REAL — no numeric-string coercion needed here.
      rate: rate.rate,
    };
  }
}
