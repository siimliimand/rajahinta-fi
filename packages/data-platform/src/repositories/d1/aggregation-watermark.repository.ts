/**
 * D1 AggregationWatermarkRepository — the Cloudflare-side implementation
 * of the abstract {@link AggregationWatermarkRepository} contract (task
 * 2.3, change migrate-to-cloudflare), backed by the D1
 * `aggregation_watermarks` table. Signatures match the pg
 * DrizzleAggregationWatermarkRepository exactly: the contract moves
 * `Date` objects and the repository owns the ISO-8601 TEXT conversion
 * (design D2 timestamp rule) — the same translation the pg driver did
 * implicitly for timestamp columns.
 *
 * Written by the time-series aggregation worker (write-then-advance):
 * read before each incremental scan, saved only after every summary write
 * of the scan succeeded. On Cloudflare the same watermark pattern applies
 * to the R2 observation log (design D4, amended) — see
 * src/d1/observation-log.ts for the object-level scan.
 *
 * @module D1AggregationWatermarkRepository
 */
import { Injectable } from '@nestjs/common';
import { AggregationWatermarkRepository } from '../../abstracts';
import type { D1DatabaseLike } from '../../d1/executor';

const FIND_SQL = `
  SELECT watermark FROM aggregation_watermarks WHERE job_name = ?`;

const UPSERT_SQL = `
  INSERT INTO aggregation_watermarks (job_name, watermark, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT (job_name) DO UPDATE SET
    watermark = excluded.watermark,
    updated_at = excluded.updated_at`;

@Injectable()
export class D1AggregationWatermarkRepository extends AggregationWatermarkRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /**
   * Current watermark for a job, or null when the job has never completed
   * a scan (callers start from the epoch on first run).
   */
  async find(jobName: string): Promise<Date | null> {
    const row = await this.d1
      .prepare(FIND_SQL)
      .bind(jobName)
      .first<{ watermark: string }>();
    return row ? new Date(row.watermark) : null;
  }

  /**
   * Persist the watermark for a job (insert or overwrite by job name —
   * the job_name UNIQUE constraint is a plain single-column key, so the
   * native ON CONFLICT upsert is sound here). Callers must only ever
   * advance the value — never regress it.
   */
  async save(jobName: string, watermark: Date): Promise<void> {
    await this.d1
      .prepare(UPSERT_SQL)
      .bind(jobName, watermark.toISOString(), new Date().toISOString())
      .run();
  }
}
