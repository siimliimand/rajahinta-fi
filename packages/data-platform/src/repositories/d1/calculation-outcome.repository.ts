/**
 * D1 CalculationOutcomeRepository — user-reported actual totals for
 * shown calculations (task 1.3, change trust-and-reach-roadmap), backed
 * by the `calculation_outcomes` table (migration 0015). Implements the
 * abstract contract from abstracts.ts.
 *
 * Duplicate guard: the (calculation_record_id, reporter_account_id)
 * unique index IS the guard — a second report for the same pair
 * violates the index and is surfaced as {@link DuplicateOutcomeError}
 * (the API maps it to 409); the stored outcome is never overwritten.
 * The classification inspects the SQLite constraint-violation message —
 * both the real D1 binding and the node:sqlite test harness surface
 * UNIQUE violations with the same "UNIQUE constraint failed: ..." text.
 *
 * Data-layer only: window/ownership validation lives in the core-domain
 * outcomes module (IOutcomeRecordQueryPort adapter wiring is a later
 * task); this repository persists validated submissions and serves the
 * read side. `calculation_record_id` is intentionally NOT an FK —
 * records prune at 180 days, outcomes at 24 months — so reads by record
 * resolve by convention.
 *
 * Aggregation (spec calculation-outcomes): one aggregate query computes
 * the sample count and the within-margin share, the margin comparison
 * inclusive at core-domain's WITHIN_MARGIN_FRACTION of the estimate.
 * An empty sample yields count 0 and a NULL share — SQL AVG over no
 * rows is NULL, mapped to null, never a fabricated percentage. Period
 * bounds are half-open [from, to) on reportedAt (ISO TEXT instants
 * compare chronologically — the traveller-allowance window precedent).
 *
 * @module D1CalculationOutcomeRepository
 */
import { Injectable } from '@nestjs/common';
import { WITHIN_MARGIN_FRACTION } from '@rajahinta/core-domain';
import type { OutcomeAccuracyStatistic } from '@rajahinta/core-domain';
import type { D1DatabaseLike } from '../../d1/executor';
import {
  CalculationOutcomeRepository,
  DuplicateOutcomeError,
  type CalculationOutcomeCreateInput,
  type CalculationOutcomeRecord,
  type OutcomeReadPeriod,
} from '../../abstracts';

/** Raw D1 calculation_outcomes row. */
interface D1CalculationOutcomeRow {
  readonly id: number;
  readonly calculation_record_id: number;
  readonly reporter_account_id: number;
  readonly estimate_digest: string;
  readonly estimated_total_cents: number;
  readonly reported_total_cents: number;
  readonly reported_at: string;
}

function toContractOutcome(row: D1CalculationOutcomeRow): CalculationOutcomeRecord {
  return {
    id: row.id,
    calculationRecordId: row.calculation_record_id,
    reporterAccountId: row.reporter_account_id,
    estimateDigest: JSON.parse(row.estimate_digest) as unknown,
    estimatedTotalCents: row.estimated_total_cents,
    reportedTotalCents: row.reported_total_cents,
    reportedAt: new Date(row.reported_at),
  };
}

const OUTCOME_COLUMNS = `
  id, calculation_record_id, reporter_account_id, estimate_digest,
  estimated_total_cents, reported_total_cents, reported_at`;

const INSERT_SQL = `
  INSERT INTO calculation_outcomes (
    calculation_record_id, reporter_account_id, estimate_digest,
    estimated_total_cents, reported_total_cents
  ) VALUES (?, ?, ?, ?, ?)
  RETURNING ${OUTCOME_COLUMNS}`;

const FIND_BY_ID_SQL = `
  SELECT ${OUTCOME_COLUMNS} FROM calculation_outcomes WHERE id = ?`;

const FIND_BY_RECORD_SQL = `
  SELECT ${OUTCOME_COLUMNS} FROM calculation_outcomes
   WHERE calculation_record_id = ?
   ORDER BY id ASC`;

const FIND_BY_REPORTER_SQL = `
  SELECT ${OUTCOME_COLUMNS} FROM calculation_outcomes
   WHERE reporter_account_id = ?
   ORDER BY id ASC`;

/**
 * The count/share aggregate over one half-open period. The margin
 * comparison runs in SQL (no row shipping): inclusive deviation ≤
 * estimate × WITHIN_MARGIN_FRACTION counts as within margin. AVG over
 * zero rows is NULL — the honest empty state.
 */
const AGGREGATE_SQL = `
  SELECT
    COUNT(*) AS sample_count,
    AVG(
      CASE
        WHEN ABS(reported_total_cents - estimated_total_cents)
             <= estimated_total_cents * ${WITHIN_MARGIN_FRACTION}
        THEN 1.0 ELSE 0.0
      END
    ) AS within_margin_share
  FROM calculation_outcomes
  WHERE (? IS NULL OR reported_at >= ?)
    AND (? IS NULL OR reported_at < ?)`;

interface D1AggregateRow {
  readonly sample_count: number;
  readonly within_margin_share: number | null;
}

function isUniqueViolationOnOutcomePair(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('UNIQUE constraint failed') &&
    error.message.includes('calculation_outcomes')
  );
}

@Injectable()
export class D1CalculationOutcomeRepository extends CalculationOutcomeRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async create(
    input: CalculationOutcomeCreateInput,
  ): Promise<CalculationOutcomeRecord> {
    try {
      const row = await this.d1
        .prepare(INSERT_SQL)
        .bind(
          input.calculationRecordId,
          input.reporterAccountId,
          JSON.stringify(input.estimateDigest),
          input.estimatedTotalCents,
          input.reportedTotalCents,
        )
        .first<D1CalculationOutcomeRow>();
      if (!row) {
        throw new Error(
          'calculation_outcomes INSERT .. RETURNING returned no row',
        );
      }
      return toContractOutcome(row);
    } catch (error) {
      if (isUniqueViolationOnOutcomePair(error)) {
        throw new DuplicateOutcomeError(
          input.calculationRecordId,
          input.reporterAccountId,
        );
      }
      throw error;
    }
  }

  /** @inheritdoc */
  async findById(id: number): Promise<CalculationOutcomeRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_ID_SQL)
      .bind(id)
      .first<D1CalculationOutcomeRow>();
    return row ? toContractOutcome(row) : null;
  }

  /** @inheritdoc */
  async findByCalculationRecordId(
    calculationRecordId: number,
  ): Promise<CalculationOutcomeRecord[]> {
    const rows = (
      await this.d1
        .prepare(FIND_BY_RECORD_SQL)
        .bind(calculationRecordId)
        .all<D1CalculationOutcomeRow>()
    ).results;
    return rows.map(toContractOutcome);
  }

  /** @inheritdoc */
  async findByReporterAccountId(
    accountId: number,
  ): Promise<CalculationOutcomeRecord[]> {
    const rows = (
      await this.d1
        .prepare(FIND_BY_REPORTER_SQL)
        .bind(accountId)
        .all<D1CalculationOutcomeRow>()
    ).results;
    return rows.map(toContractOutcome);
  }

  /** @inheritdoc */
  async countByPeriod(period: OutcomeReadPeriod): Promise<number> {
    const row = await this.aggregateRow(period);
    return row.sample_count;
  }

  /** @inheritdoc */
  async findAccuracyStatistic(
    period: OutcomeReadPeriod,
    asOf: Date,
  ): Promise<OutcomeAccuracyStatistic> {
    const row = await this.aggregateRow(period);
    return {
      count: row.sample_count,
      // NULL (no outcomes) → null — never a fabricated percentage.
      withinMarginShare: row.within_margin_share,
      asOf,
    };
  }

  /** The single count/share aggregate row over the half-open period. */
  private async aggregateRow(period: OutcomeReadPeriod): Promise<D1AggregateRow> {
    const fromIso = period.from == null ? null : period.from.toISOString();
    const toIso = period.to == null ? null : period.to.toISOString();
    const row = await this.d1
      .prepare(AGGREGATE_SQL)
      .bind(fromIso, fromIso, toIso, toIso)
      .first<D1AggregateRow>();
    if (!row) {
      // COUNT(*) always yields exactly one row, even over an empty table.
      throw new Error('calculation_outcomes aggregate returned no row');
    }
    return row;
  }
}
