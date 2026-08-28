/**
 * CalculationRecordRetentionService — monthly-partition maintenance and
 * anonymous-record pruning for the calculation-record tables (task 8.1,
 * change technical-assessment-remediation).
 *
 * Owns the partition lifecycle drizzle cannot express: creating future
 * monthly partitions ahead of the writes, pruning anonymous-session
 * rows after the configured window, and dropping whole partitions once
 * they are fully inside the window and hold no authenticated history.
 * The catch-all price-ingestion job is untouched (task 7.3 owns the
 * scheduler redesign).
 *
 * Every step is idempotent — a failed run can simply be retried.
 *
 * @module CalculationRecordRetentionService
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';

/** Retention window for anonymous (session_id IS NULL) calculation rows. */
const RETENTION_DAYS_ENV = 'CALCULATION_RECORD_RETENTION_DAYS';
const DEFAULT_RETENTION_DAYS = 30;
/** Monthly partitions kept ready ahead of the write head. */
const PARTITIONS_AHEAD = 2;

/** Partitioned tables this service maintains, with their time columns. */
const PARTITIONED_TABLES = [
  { table: 'calculation_records', timeColumn: 'calculated_at' },
  { table: 'basket_calculation_records', timeColumn: 'created_at' },
] as const;

export interface RetentionRunResult {
  /** Monthly partitions created (table names). */
  readonly createdPartitions: string[];
  /** Anonymous-session rows deleted per table. */
  readonly prunedAnonymous: Record<string, number>;
  /** Partitions dropped — fully expired and anonymous-only. */
  readonly droppedPartitions: string[];
  /** The anonymous-retention cutoff that was applied. */
  readonly cutoff: Date;
}

/** pg result rows helper — drizzle's execute returns the raw pg result. */
type Rows<T> = { rows: T[] };

@Injectable()
export class CalculationRecordRetentionService {
  private readonly logger = new Logger(CalculationRecordRetentionService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {}

  /**
   * Run one retention sweep: ensure partitions, prune anonymous rows,
   * drop fully-expired anonymous-only partitions.
   */
  async runRetention(overrides?: {
    now?: Date;
    retentionDays?: number;
  }): Promise<RetentionRunResult> {
    const now = overrides?.now ?? new Date();
    const retentionDays =
      overrides?.retentionDays ?? this.configuredRetentionDays();
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);

    const createdPartitions: string[] = [];
    const prunedAnonymous: Record<string, number> = {};
    const droppedPartitions: string[] = [];

    for (const { table, timeColumn } of PARTITIONED_TABLES) {
      createdPartitions.push(
        ...(await this.ensurePartitions(table, timeColumn, now)),
      );
      prunedAnonymous[table] = await this.pruneAnonymousRows(
        table,
        timeColumn,
        cutoff,
      );
      droppedPartitions.push(
        ...(await this.dropExpiredAnonymousPartitions(table, cutoff)),
      );
    }

    this.logger.log(
      `Retention sweep: ${createdPartitions.length} partition(s) created, ` +
        `${Object.values(prunedAnonymous).reduce((a, b) => a + b, 0)} anonymous row(s) pruned, ` +
        `${droppedPartitions.length} partition(s) dropped (cutoff ${cutoff.toISOString()})`,
    );

    return { createdPartitions, prunedAnonymous, droppedPartitions, cutoff };
  }

  /** Configured anonymous-retention window in days (>= 1). */
  private configuredRetentionDays(): number {
    const raw = process.env[RETENTION_DAYS_ENV];
    if (raw === undefined || raw.trim() === '') {
      return DEFAULT_RETENTION_DAYS;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      this.logger.warn(
        `Invalid ${RETENTION_DAYS_ENV}="${raw}" — using default ${DEFAULT_RETENTION_DAYS} days`,
      );
      return DEFAULT_RETENTION_DAYS;
    }
    return parsed;
  }

  /**
   * Create the current-month plus PARTITIONS_AHEAD monthly partitions.
   *
   * If the DEFAULT partition has picked up rows for a target month (job
   * downtime longer than the lead time), those rows are staged out and
   * moved into the new partition — Postgres refuses to attach a
   * partition whose range is occupied in the DEFAULT partition. The
   * whole sequence runs in one DO block so a mid-flight failure cannot
   * strand rows outside both partitions.
   */
  private async ensurePartitions(
    table: string,
    timeColumn: string,
    now: Date,
  ): Promise<string[]> {
    const created: string[] = [];
    for (let offset = 0; offset <= PARTITIONS_AHEAD; offset++) {
      const monthStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1),
      );
      const monthEnd = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1),
      );
      const partitionName = `${table}_${this.monthTag(monthStart)}`;

      const existing = (await this.db.execute(sql.raw(`
        SELECT to_regclass('${partitionName}') IS NOT NULL AS present
      `))) as Rows<{ present: boolean }>;
      if (existing.rows[0]?.present) {
        continue;
      }

      await this.db.execute(sql.raw(`
        DO $do$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM ${table}_default
            WHERE ${timeColumn} >= '${this.iso(monthStart)}'
              AND ${timeColumn} < '${this.iso(monthEnd)}'
          ) THEN
            CREATE TEMP TABLE ${partitionName}_stage
              (LIKE ${table}_default INCLUDING DEFAULTS);
            INSERT INTO ${partitionName}_stage
              SELECT * FROM ${table}_default
              WHERE ${timeColumn} >= '${this.iso(monthStart)}'
                AND ${timeColumn} < '${this.iso(monthEnd)}';
            DELETE FROM ${table}_default
              WHERE ${timeColumn} >= '${this.iso(monthStart)}'
                AND ${timeColumn} < '${this.iso(monthEnd)}';
          END IF;
          EXECUTE format(
            'CREATE TABLE ${partitionName} PARTITION OF ${table} ' ||
            'FOR VALUES FROM (%L) TO (%L)',
            '${this.iso(monthStart)}', '${this.iso(monthEnd)}'
          );
          IF to_regclass('${partitionName}_stage') IS NOT NULL THEN
            EXECUTE 'INSERT INTO ${partitionName} SELECT * FROM ${partitionName}_stage';
            EXECUTE 'DROP TABLE ${partitionName}_stage';
          END IF;
        END
        $do$
      `));

      created.push(partitionName);
    }
    return created;
  }

  /** Delete anonymous-session rows past the cutoff; partition pruning scopes the scan. */
  private async pruneAnonymousRows(
    table: string,
    timeColumn: string,
    cutoff: Date,
  ): Promise<number> {
    const result = (await this.db.execute(sql.raw(`
      WITH deleted AS (
        DELETE FROM ${table}
        WHERE session_id IS NULL AND ${timeColumn} < '${this.iso(cutoff)}'
        RETURNING 1
      )
      SELECT COUNT(*)::text AS count FROM deleted
    `))) as Rows<{ count: string }>;
    return Number.parseInt(result.rows[0]?.count ?? '0', 10);
  }

  /**
   * Drop monthly partitions whose range ended before the cutoff and
   * that contain no authenticated (session_id NOT NULL) rows. The
   * DEFAULT partition is never dropped — it may hold live data.
   */
  private async dropExpiredAnonymousPartitions(
    table: string,
    cutoff: Date,
  ): Promise<string[]> {
    const partitions = (await this.db.execute(sql.raw(`
      SELECT c.relname AS name, pg_get_expr(c.relpartbound, c.oid) AS bound
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = '${table}'::regclass
        AND c.relkind = 'r'
        AND c.relname <> '${table}_default'
    `))) as Rows<{ name: string; bound: string }>;

    const dropped: string[] = [];
    for (const partition of partitions.rows) {
      const match = /FOR VALUES FROM \('([^']+)'\) TO \('([^']+)'\)/.exec(
        partition.bound,
      );
      if (!match) {
        continue;
      }
      const rangeEnd = new Date(match[2]);
      if (rangeEnd >= cutoff) {
        continue;
      }
      const authenticated = (await this.db.execute(sql.raw(`
        SELECT COUNT(*)::text AS count FROM ${partition.name}
        WHERE session_id IS NOT NULL
      `))) as Rows<{ count: string }>;
      if (Number.parseInt(authenticated.rows[0]?.count ?? '0', 10) > 0) {
        continue;
      }
      await this.db.execute(sql.raw(`DROP TABLE ${partition.name}`));
      dropped.push(partition.name);
    }
    return dropped;
  }

  /** YYYY_MM tag for a monthly partition's start month. */
  private monthTag(monthStart: Date): string {
    return monthStart.toISOString().slice(0, 7).replace('-', '_');
  }

  /** ISO instant for SQL literals (UTC, millisecond precision). */
  private iso(value: Date): string {
    return value.toISOString();
  }
}
