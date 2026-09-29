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
 * Breakdowns (design D5): the statistic also splits read-time by
 * product category (outcome → calculation_records → product_master)
 * or transport carrier (calculation_records → transport_offers).
 * Splits are pure reads — no materialization, no schema change — and
 * display-only: no breakdown value may feed the calculator, ranking,
 * or any basket input. INNER joins mean an outcome whose record or
 * offer no longer resolves (records prune before outcomes) is not
 * attributed to any cell, so cell counts need not sum to the global
 * count; the unfiltered statistic stays untouched by any join.
 *
 * @module D1CalculationOutcomeRepository
 */
import { Injectable } from '@nestjs/common';
import { WITHIN_MARGIN_FRACTION } from '@rajahinta/core-domain';
import type {
  OutcomeAccuracyBreakdown,
  OutcomeAccuracyBreakdownCell,
  OutcomeAccuracySplitDimension,
  OutcomeAccuracyStatistic,
} from '@rajahinta/core-domain';
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

/** Optional narrowing of the accuracy statistic to one split dimension. */
export interface OutcomeAccuracySplitFilter {
  /**
   * Narrows to outcomes whose calculation record's product carries this
   * canonical category (join outcome → record → product_master). Value
   * validation against the canonical set is the caller's contract (the
   * route 400s unknown values); the filter treats it as opaque.
   */
  readonly category?: string;
  /**
   * Narrows to outcomes whose calculation record's transport offer
   * ships with this carrier (join record → transport_offers). Records
   * without a transport offer cannot match a carrier filter.
   */
  readonly carrier?: string;
}

/**
 * Margin-share aggregate over `calculation_outcomes o` — the same
 * inclusive comparison as {@link AGGREGATE_SQL}, aliased for the
 * breakdown joins.
 */
const MARGIN_SHARE_FRAGMENT = `
    AVG(
      CASE
        WHEN ABS(o.reported_total_cents - o.estimated_total_cents)
             <= o.estimated_total_cents * ${WITHIN_MARGIN_FRACTION}
        THEN 1.0 ELSE 0.0
      END
    )`;

const FILTERED_PERIOD_WHERE = `
  WHERE (? IS NULL OR o.reported_at >= ?)
    AND (? IS NULL OR o.reported_at < ?)`;

/**
 * Per-value cells for one breakdown dimension: a GROUP BY over the
 * same joins the filtered statistic uses. GROUP BY yields a row only
 * for values with ≥ 1 outcome — an absent value is the honest empty
 * state (no cell), never a fabricated 0%.
 */
const BREAKDOWN_SQL: Record<OutcomeAccuracySplitDimension, string> = {
  category: `
  SELECT
    pm.category AS cell_key,
    COUNT(*) AS sample_count,
    ${MARGIN_SHARE_FRAGMENT} AS within_margin_share
  FROM calculation_outcomes o
  JOIN calculation_records cr ON cr.id = o.calculation_record_id
  JOIN product_master pm ON pm.id = cr.product_master_id${FILTERED_PERIOD_WHERE}
  GROUP BY pm.category
  ORDER BY pm.category ASC`,
  carrier: `
  SELECT
    tor.carrier AS cell_key,
    COUNT(*) AS sample_count,
    ${MARGIN_SHARE_FRAGMENT} AS within_margin_share
  FROM calculation_outcomes o
  JOIN calculation_records cr ON cr.id = o.calculation_record_id
  JOIN transport_offers tor ON tor.id = cr.transport_offer_id${FILTERED_PERIOD_WHERE}
  GROUP BY tor.carrier
  ORDER BY tor.carrier ASC`,
};

interface D1BreakdownRow {
  readonly cell_key: string;
  readonly sample_count: number;
  readonly within_margin_share: number | null;
}

/**
 * Assemble the filtered single-row aggregate for a split filter. The
 * calculation_records join happens at most once even when both
 * dimensions are filtered — joining it twice on the same convention
 * key would multiply rows and corrupt the count. Filter values are
 * bound parameters; only fixed fragments are concatenated.
 */
function filteredAggregateSql(split: OutcomeAccuracySplitFilter): {
  sql: string;
  filterParams: string[];
} {
  const lines: string[] = [];
  const predicates: string[] = [];
  const filterParams: string[] = [];
  if (split.category != null || split.carrier != null) {
    lines.push('FROM calculation_outcomes o');
    lines.push('JOIN calculation_records cr ON cr.id = o.calculation_record_id');
  }
  if (split.category != null) {
    lines.push('JOIN product_master pm ON pm.id = cr.product_master_id');
    predicates.push('pm.category = ?');
    filterParams.push(split.category);
  }
  if (split.carrier != null) {
    lines.push('JOIN transport_offers tor ON tor.id = cr.transport_offer_id');
    predicates.push('tor.carrier = ?');
    filterParams.push(split.carrier);
  }
  const sql = `
  SELECT
    COUNT(*) AS sample_count,
    ${MARGIN_SHARE_FRAGMENT} AS within_margin_share
  ${lines.join('\n  ')}${FILTERED_PERIOD_WHERE}${predicates.length > 0 ? `\n    AND ${predicates.join('\n    AND ')}` : ''}`;
  return { sql, filterParams };
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

  /**
   * The public accuracy statistic over the period, optionally narrowed
   * by a split filter (design D5). Without a filter (or with an empty
   * one) this is the unfiltered global statistic — byte-identical
   * shape and semantics, computed by the untouched single-row
   * aggregate. With a filter, the same count/share honesty rules apply
   * to the narrowed set: zero matching outcomes yield count 0 and a
   * null share, never a fabricated percentage. Kept on the concrete
   * class's extended signature only (the abstract two-arg contract
   * stays as-is) so existing call sites compile unchanged.
   *
   * @inheritdoc
   */
  async findAccuracyStatistic(
    period: OutcomeReadPeriod,
    asOf: Date,
    split?: OutcomeAccuracySplitFilter,
  ): Promise<OutcomeAccuracyStatistic> {
    const filtered =
      split != null && (split.category != null || split.carrier != null);
    const row = filtered
      ? await this.filteredAggregateRow(period, split)
      : await this.aggregateRow(period);
    return {
      count: row.sample_count,
      // NULL (no outcomes) → null — never a fabricated percentage.
      withinMarginShare: row.within_margin_share,
      asOf,
    };
  }

  /**
   * The read-time accuracy breakdown for one dimension (design D5):
   * one cell per dimension value with outcomes in the period, each
   * carrying its own count and within-margin share under the same
   * honesty rules as {@link findAccuracyStatistic}. Outcomes whose
   * calculation record (or its product / transport offer) no longer
   * resolves are not attributed to any cell — cell counts need not sum
   * to the global statistic's count. Concrete-only method: the
   * abstract contract's surface is unchanged.
   */
  async findAccuracyBreakdown(
    period: OutcomeReadPeriod,
    asOf: Date,
    dimension: OutcomeAccuracySplitDimension,
  ): Promise<OutcomeAccuracyBreakdown> {
    const fromIso = period.from == null ? null : period.from.toISOString();
    const toIso = period.to == null ? null : period.to.toISOString();
    const rows = (
      await this.d1
        .prepare(BREAKDOWN_SQL[dimension])
        .bind(fromIso, fromIso, toIso, toIso)
        .all<D1BreakdownRow>()
    ).results;
    const cells: OutcomeAccuracyBreakdownCell[] = rows.map((row) => ({
      key: row.cell_key,
      count: row.sample_count,
      // Same NULL→null mapping as the global path: AVG is null exactly
      // when the count is 0 (GROUP BY never yields a 0-row group).
      withinMarginShare: row.within_margin_share,
    }));
    return { dimension, cells, asOf };
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

  /** The count/share aggregate row narrowed by a non-empty split filter. */
  private async filteredAggregateRow(
    period: OutcomeReadPeriod,
    split: OutcomeAccuracySplitFilter,
  ): Promise<D1AggregateRow> {
    const fromIso = period.from == null ? null : period.from.toISOString();
    const toIso = period.to == null ? null : period.to.toISOString();
    const { sql, filterParams } = filteredAggregateSql(split);
    const row = await this.d1
      .prepare(sql)
      .bind(fromIso, fromIso, toIso, toIso, ...filterParams)
      .first<D1AggregateRow>();
    if (!row) {
      throw new Error('calculation_outcomes filtered aggregate returned no row');
    }
    return row;
  }
}
