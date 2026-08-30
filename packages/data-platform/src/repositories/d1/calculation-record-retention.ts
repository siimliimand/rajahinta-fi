/**
 * D1 calculation-record retention (task 2.5, change
 * migrate-to-cloudflare; design D4 as amended by gate review G1).
 *
 * Replaces the pg partition choreography (monthly partitions + DROP
 * PARTITION) with scheduled bounded batch DELETEs over the two
 * calculation-record tables — the amended D4 retention model for D1:
 *
 *   1. Anonymous pruning — rows with no session link (session_id IS
 *      NULL) past the configured window are deleted. The existing
 *      30-day semantics are preserved, including the
 *      CALCULATION_RECORD_RETENTION_DAYS environment name and default.
 *   2. Age cap (gate-review decision 3) — ALL records, session-bearing
 *      included, are deleted past the configured cap. This REPLACES the
 *      pg rule "session-bearing rows are never pruned"; default 180
 *      days per the gate decision. priceHistorySummaries remains the
 *      long-term analytical record.
 *
 * Every delete runs in bounded batches of `batchSize` rows selected by
 * rowid and loops until a batch deletes fewer rows than the batch size —
 * each full batch strictly shrinks the table, so the loop terminates.
 * The rowid-subquery shape is used instead of `DELETE .. LIMIT`, which
 * is not compiled into every SQLite build (D1 included). SQLite/D1 have
 * no partitioning to maintain, so the sweep needs no partition DDL —
 * every step is idempotent and a failed run can simply be retried.
 *
 * @module D1CalculationRecordRetention
 */
import { Injectable } from '@nestjs/common';
import type { D1DatabaseLike } from '../../d1/executor';

/** Retention window for anonymous (session_id IS NULL) calculation rows. */
const RETENTION_DAYS_ENV = 'CALCULATION_RECORD_RETENTION_DAYS';
const DEFAULT_RETENTION_DAYS = 30;

/** Age cap for ALL calculation records (gate-review decision, D4 amended). */
const AGE_CAP_DAYS_ENV = 'CALCULATION_RECORD_AGE_CAP_DAYS';
const DEFAULT_AGE_CAP_DAYS = 180;

/** Default rows deleted per DELETE statement. */
const DEFAULT_BATCH_SIZE = 500;

/** Milliseconds per day. */
const MS_PER_DAY = 86_400_000;

/** Tables swept by retention, with their time columns. */
const RETENTION_TABLES = [
  { table: 'calculation_records', timeColumn: 'calculated_at' },
  { table: 'basket_calculation_records', timeColumn: 'created_at' },
] as const;

export interface D1RetentionRunResult {
  /** Anonymous-session rows deleted per table. */
  readonly prunedAnonymous: Record<string, number>;
  /** Age-capped rows deleted per table (session-bearing included). */
  readonly ageCapped: Record<string, number>;
  /** The anonymous-retention cutoff that was applied. */
  readonly anonymousCutoff: Date;
  /** The age-cap cutoff that was applied. */
  readonly ageCapCutoff: Date;
  /** Rows per DELETE statement (bounded batches). */
  readonly batchSize: number;
}

@Injectable()
export class D1CalculationRecordRetentionService {
  constructor(private readonly d1: D1DatabaseLike) {}

  /**
   * Run one retention sweep: prune anonymous rows past the configured
   * window, then age-cap every record past the configured cap — both as
   * bounded batch DELETEs.
   */
  async runRetention(overrides?: {
    now?: Date;
    retentionDays?: number;
    ageCapDays?: number;
    batchSize?: number;
  }): Promise<D1RetentionRunResult> {
    const now = overrides?.now ?? new Date();
    const retentionDays =
      overrides?.retentionDays ?? this.configuredDays(RETENTION_DAYS_ENV, DEFAULT_RETENTION_DAYS);
    const ageCapDays =
      overrides?.ageCapDays ?? this.configuredDays(AGE_CAP_DAYS_ENV, DEFAULT_AGE_CAP_DAYS);
    const batchSize = overrides?.batchSize ?? DEFAULT_BATCH_SIZE;
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new RangeError(`batchSize must be a positive integer, got ${batchSize}`);
    }

    const anonymousCutoff = new Date(now.getTime() - retentionDays * MS_PER_DAY);
    const ageCapCutoff = new Date(now.getTime() - ageCapDays * MS_PER_DAY);

    const prunedAnonymous: Record<string, number> = {};
    const ageCapped: Record<string, number> = {};

    for (const { table, timeColumn } of RETENTION_TABLES) {
      prunedAnonymous[table] = await this.deleteBatched(
        table,
        timeColumn,
        anonymousCutoff,
        batchSize,
        true,
      );
      ageCapped[table] = await this.deleteBatched(
        table,
        timeColumn,
        ageCapCutoff,
        batchSize,
        false,
      );
    }

    return { prunedAnonymous, ageCapped, anonymousCutoff, ageCapCutoff, batchSize };
  }

  /**
   * Bounded batch DELETE: repeatedly delete up to {@code batchSize} rows
   * matching the window predicate until a batch comes back short. The
   * age-cap pass is the strict superset of the anonymous predicate
   * (every anonymous row past the window is also past the cap), so the
   * second pass sees only what the first left behind.
   */
  private async deleteBatched(
    table: string,
    timeColumn: string,
    cutoff: Date,
    batchSize: number,
    anonymousOnly: boolean,
  ): Promise<number> {
    const scope = anonymousOnly ? 'session_id IS NULL AND ' : '';
    const sql = `
      DELETE FROM ${table}
       WHERE rowid IN (
         SELECT rowid FROM ${table}
          WHERE ${scope}${timeColumn} < ?
          LIMIT ?
       )`;

    let deleted = 0;
    for (;;) {
      const result = await this.d1.prepare(sql).bind(cutoff.toISOString(), batchSize).run();
      const changes = Number(result.meta.changes ?? 0);
      deleted += changes;
      if (changes < batchSize) {
        break;
      }
    }
    return deleted;
  }

  /** Configured window in days (>= 1), mirroring the pg service's env parsing. */
  private configuredDays(envName: string, fallbackDays: number): number {
    const raw = process.env[envName];
    if (raw === undefined || raw.trim() === '') {
      return fallbackDays;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return fallbackDays;
    }
    return parsed;
  }
}
