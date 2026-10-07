/**
 * D1 OutcomeMarginRepository — persistence for the empirical-margin
 * ladder (task 1.2, change hedge-dedup-confidence-meter, design D3,
 * spec: calculation-outcomes delta "Persisted empirical margins").
 *
 * Written by exactly one caller — the outcome-margins step of the
 * aggregation tick (src/cron/outcome-margins.ts in apps/api-worker) —
 * and read by the public margins endpoint. Every margin is RECOMPUTED
 * from the stored calculation_outcomes; nothing here ever invents a
 * value:
 *
 * - The attribution read LEFT-joins each outcome through its
 *   calculation record to the product category and the transport
 *   offer's carrier. A null means "does not resolve" (record pruned —
 *   records prune before outcomes — or no transport offer), and the
 *   report then counts only toward the ladder cells its known values
 *   name — join-honest attribution, never fabricated (the same
 *   convention as the read-time accuracy breakdowns, which INNER-join
 *   because they must not stretch cells; the ladder's global cell wants
 *   every report, so the join is outer and the null is meaningful).
 * - The pure cell computation lives in core-domain
 *   (`computeOutcomeMarginCells` in margin-calibration.ts) — the ladder
 *   math (nearest-rank p80, MARGIN_SAMPLE_FLOOR, composite key) has
 *   exactly one source of truth, and this module is persistence only:
 *   the caller (the api-worker's aggregation-tick step) enumerates and
 *   calibrates, then hands the calibrated cells to
 *   {@link D1OutcomeMarginRepository.persistMargins}. Below-floor cells
 *   are skipped by the calibration; an empty corpus persists no rows.
 * - Persistence is delete-then-insert per run in ONE batch: a cell the
 *   corpus no longer calibrates disappears with its reports, and the
 *   composite (dimension, cell_key) primary key keeps a re-run from
 *   ever duplicating a cell.
 *
 * ## DISPLAY-ONLY
 *
 * Everything this module persists surfaces only as the display-only
 * empiricalMargin field (design D4, the alkoBenchmark precedent):
 * no total, ranking, or computed output may read it.
 *
 * @module D1OutcomeMarginRepository
 */
import { Injectable } from '@nestjs/common';
import type { EmpiricalMargin, MarginCellDimension, OutcomeMarginReport } from '@rajahinta/core-domain';
import type { D1DatabaseLike } from '../../d1/executor';

/** One persisted margin row — the outcome_margins table's contract face. */
export interface OutcomeMarginRow {
  /** Ladder rung: 'category_carrier' | 'category' | 'global'. */
  readonly dimension: MarginCellDimension;
  /** Cell key — 'global', a category, or a `category|carrier` composite. */
  readonly cellKey: string;
  /** Relative-error p80 of the cell, a fraction of the estimate. */
  readonly quantile: number;
  /** Outcome reports behind the quantile (≥ the calibration floor). */
  readonly sampleCount: number;
  /** Run instant the margin was computed for. */
  readonly asOf: Date;
}

/**
 * The outcome corpus with its join-honest attribution keys. Raw
 * left-joined faces (SQL column shapes), mapped onto the core-domain
 * {@link OutcomeMarginReport} the calibration consumes.
 */
interface OutcomeAttributionRow {
  readonly reported_total_cents: number;
  readonly estimated_total_cents: number;
  readonly category: string | null;
  readonly carrier: string | null;
}

/**
 * The attribution read over every stored outcome. LEFT joins all the
 * way: an outcome whose record, product, or transport offer no longer
 * resolves still counts toward the global cell (the margin hedge
 * describes the whole corpus), while its unknown keys stay null so the
 * deeper rungs simply cannot attribute it. `ORDER BY o.id` keeps the
 * read deterministic (permutation-equal math either way — the quantile
 * sorts internally — but a stable feed makes runs byte-comparable).
 */
const OUTCOME_MARGIN_REPORTS_SQL = `
  SELECT o.reported_total_cents AS reported_total_cents,
         o.estimated_total_cents AS estimated_total_cents,
         pm.category AS category,
         tor.carrier AS carrier
    FROM calculation_outcomes o
    LEFT JOIN calculation_records cr ON cr.id = o.calculation_record_id
    LEFT JOIN product_master pm ON pm.id = cr.product_master_id
    LEFT JOIN transport_offers tor ON tor.id = cr.transport_offer_id
   ORDER BY o.id ASC`;

/** Insert shape for one calibrated cell (delete-then-insert batch). */
const INSERT_MARGIN_SQL = `
  INSERT INTO outcome_margins (dimension, cell_key, quantile, sample_count, as_of)
  VALUES (?, ?, ?, ?, ?)`;

/** A cell's margin is derived state — the whole ladder rewrites per run. */
const DELETE_ALL_MARGINS_SQL = `DELETE FROM outcome_margins`;

/**
 * One persisted row → the core-domain {@link EmpiricalMargin} the
 * ladder consumers resolve through — the read layers' single mapping
 * (the margins endpoint and the task-2.2 read-time composition both
 * call this, so no reader re-parses a row ad hoc).
 */
export function marginRowToEmpiricalMargin(
  row: OutcomeMarginRow,
): EmpiricalMargin {
  return {
    quantile: row.quantile,
    sampleCount: row.sampleCount,
    cell: { dimension: row.dimension, key: row.cellKey },
    asOf: row.asOf,
  };
}

@Injectable()
export class D1OutcomeMarginRepository {
  constructor(private readonly d1: D1DatabaseLike) {}

  /**
   * Every stored outcome with its attribution keys (module docblock) —
   * the calibration corpus. Empty exactly when no outcomes are stored.
   */
  async readOutcomeMarginReports(): Promise<OutcomeMarginReport[]> {
    const rows = (
      await this.d1.prepare(OUTCOME_MARGIN_REPORTS_SQL).all<OutcomeAttributionRow>()
    ).results;
    return rows.map((row) => ({
      reportedTotalCents: row.reported_total_cents,
      estimatedTotalCents: row.estimated_total_cents,
      category: row.category,
      carrier: row.carrier,
    }));
  }

  /**
   * Replace the whole persisted ladder with `margins` — delete-then-
   * insert in ONE batch, so a kill mid-run leaves either the previous
   * ladder or the new one, never a mix, and an empty `margins` array
   * leaves an empty table (the honest degrade; the DELETE still runs,
   * clearing margins whose corpus vanished). Returns the row count
   * written.
   */
  async persistMargins(margins: readonly EmpiricalMargin[]): Promise<number> {
    const statements = [this.d1.prepare(DELETE_ALL_MARGINS_SQL)];
    for (const margin of margins) {
      statements.push(
        this.d1
          .prepare(INSERT_MARGIN_SQL)
          .bind(
            margin.cell.dimension,
            margin.cell.key,
            margin.quantile,
            margin.sampleCount,
            margin.asOf.toISOString(),
          ),
      );
    }
    await this.d1.batch(statements);
    return margins.length;
  }

  /**
   * The persisted ladder, ladder order (deepest rung first, keys
   * ascending — the core-domain computeOutcomeMarginCells write order) —
   * the margins endpoint's read.
   */
  async findMargins(): Promise<OutcomeMarginRow[]> {
    const rows = (
      await this.d1
        .prepare(
          `SELECT dimension, cell_key, quantile, sample_count, as_of
             FROM outcome_margins
            ORDER BY CASE dimension
                       WHEN 'category_carrier' THEN 0
                       WHEN 'category' THEN 1
                       ELSE 2
                     END ASC, cell_key ASC`,
        )
        .all<{
          dimension: MarginCellDimension;
          cell_key: string;
          quantile: number;
          sample_count: number;
          as_of: string;
        }>()
    ).results;
    return rows.map((row) => ({
      dimension: row.dimension,
      cellKey: row.cell_key,
      quantile: row.quantile,
      sampleCount: row.sample_count,
      asOf: new Date(row.as_of),
    }));
  }
}
