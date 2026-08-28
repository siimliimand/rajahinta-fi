/**
 * Drizzle FxRateRepository — concrete implementation of the abstract
 * FxRateRepository class backed by the fx_rate_datasets / fx_rates tables.
 *
 * Enforces the D2 dataset invariants at the storage boundary:
 * append-only versions, rates immutable once published, and a publish
 * transition that exists only as this class's explicit publishDataset
 * call — no code path flips a version effective on its own.
 *
 * @module DrizzleFxRateRepository
 */
import { Injectable, Inject } from '@nestjs/common';
import { and, asc, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';
import { requirePgNumeric } from '../db/pg-numeric';
import {
  FxRateRepository,
  type FxRateDatasetRecord,
  type FxRateRow,
  type ResolvedFxRate,
} from '../abstracts';
import { fxRateDatasets, fxRates } from '../schema';

@Injectable()
export class DrizzleFxRateRepository extends FxRateRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {
    super();
  }

  /** @inheritdoc */
  async createDataset(
    record: typeof fxRateDatasets.$inferInsert,
    rates: Omit<typeof fxRates.$inferInsert, 'datasetId'>[],
  ): Promise<FxRateDatasetRecord> {
    return this.db.transaction(async (tx) => {
      const [dataset] = await tx
        .insert(fxRateDatasets)
        .values({ ...record, status: record.status ?? 'PENDING_CONFIRMATION' })
        .returning();

      if (rates.length > 0) {
        await tx
          .insert(fxRates)
          .values(rates.map((rate) => ({ ...rate, datasetId: dataset.id })));
      }
      return dataset;
    });
  }

  /** @inheritdoc */
  async findDatasetById(
    id: number,
  ): Promise<FxRateDatasetRecord | null> {
    const [row] = await this.db
      .select()
      .from(fxRateDatasets)
      .where(eq(fxRateDatasets.id, id))
      .limit(1);
    return row ?? null;
  }

  /** @inheritdoc */
  async findDatasetByVersionLabel(
    versionLabel: string,
  ): Promise<FxRateDatasetRecord | null> {
    const [row] = await this.db
      .select()
      .from(fxRateDatasets)
      .where(eq(fxRateDatasets.versionLabel, versionLabel))
      .limit(1);
    return row ?? null;
  }

  /** @inheritdoc */
  async findPendingDatasets(): Promise<FxRateDatasetRecord[]> {
    return this.db
      .select()
      .from(fxRateDatasets)
      .where(eq(fxRateDatasets.status, 'PENDING_CONFIRMATION'))
      .orderBy(asc(fxRateDatasets.createdAt));
  }

  /** @inheritdoc */
  async findPublishedDatasetEffectiveOn(
    asOf: Date,
  ): Promise<FxRateDatasetRecord | null> {
    const [row] = await this.db
      .select()
      .from(fxRateDatasets)
      .where(
        and(
          eq(fxRateDatasets.status, 'PUBLISHED'),
          this.effectiveOn(asOf),
        ),
      )
      // Multiple published windows can cover a date only transiently;
      // the most recent effectiveFrom is the authoritative one.
      .orderBy(desc(fxRateDatasets.effectiveFrom))
      .limit(1);
    return row ?? null;
  }

  /** @inheritdoc */
  async publishDataset(
    id: number,
    confirmedBy: string,
  ): Promise<FxRateDatasetRecord | null> {
    const [row] = await this.db
      .update(fxRateDatasets)
      .set({
        status: 'PUBLISHED',
        confirmedBy,
        confirmedAt: new Date(),
      })
      .where(
        and(
          eq(fxRateDatasets.id, id),
          eq(fxRateDatasets.status, 'PENDING_CONFIRMATION'),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** @inheritdoc */
  async findRatesForDataset(datasetId: number): Promise<FxRateRow[]> {
    return this.db
      .select()
      .from(fxRates)
      .where(eq(fxRates.datasetId, datasetId))
      .orderBy(asc(fxRates.baseCurrency), asc(fxRates.quoteCurrency));
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

    const [rate] = await this.db
      .select()
      .from(fxRates)
      .where(
        and(
          eq(fxRates.datasetId, dataset.id),
          eq(fxRates.baseCurrency, baseCurrency),
          eq(fxRates.quoteCurrency, quoteCurrency),
        ),
      )
      .limit(1);

    if (!rate) {
      return null;
    }

    return {
      dataset,
      baseCurrency: rate.baseCurrency,
      quoteCurrency: rate.quoteCurrency,
      // Repository-boundary coercion (task 3.5) — consumers get a number.
      rate: requirePgNumeric(rate.rate, 'fx_rates.rate'),
    };
  }

  /**
   * Effective-window predicate shared by resolution reads:
   * effectiveFrom ≤ asOf < effectiveTo (null = open-ended), matching
   * the tax-rules convention.
   */
  private effectiveOn(asOf: Date) {
    return and(
      lte(fxRateDatasets.effectiveFrom, asOf),
      or(isNull(fxRateDatasets.effectiveTo), gt(fxRateDatasets.effectiveTo, asOf)),
    )!;
  }
}
