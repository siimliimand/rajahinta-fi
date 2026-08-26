/**
 * Drizzle AggregationWatermarkRepository — concrete implementation of the
 * abstract AggregationWatermarkRepository class backed by the
 * aggregation_watermarks table.
 *
 * Written by the time-series aggregation worker (change
 * 2026-08-26-phase2-historical-price-intelligence, task 3.1): the
 * watermark is read before each incremental scan and saved only after
 * every summary write of the scan succeeded, so a failed run re-scans the
 * same range on retry and the idempotent upserts converge.
 *
 * @module DrizzleAggregationWatermarkRepository
 */
import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';
import { AggregationWatermarkRepository } from '../abstracts';
import { aggregationWatermarks } from '../schema';

@Injectable()
export class DrizzleAggregationWatermarkRepository extends AggregationWatermarkRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {
    super();
  }

  /** @inheritdoc */
  async find(jobName: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ watermark: aggregationWatermarks.watermark })
      .from(aggregationWatermarks)
      .where(eq(aggregationWatermarks.jobName, jobName))
      .limit(1);
    return row?.watermark ?? null;
  }

  /** @inheritdoc */
  async save(jobName: string, watermark: Date): Promise<void> {
    await this.db
      .insert(aggregationWatermarks)
      .values({ jobName, watermark, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: aggregationWatermarks.jobName,
        set: { watermark, updatedAt: new Date() },
      });
  }
}
