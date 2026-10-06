/**
 * Pure empirical-margin calibration — the display-only p80 relative-
 * error hedge over user-reported calculation outcomes (design D3).
 *
 * No I/O: reports, the ladder query, and the as-of instant all enter
 * as plain values. The same input always yields the same margin; the
 * empty/under-floor state is an explicit `null`, never a fabricated
 * number.
 *
 * @module MarginCalibration
 */

import type {
  EmpiricalMargin,
  MarginCellDimension,
  MarginLadderQuery,
  OutcomeMarginReport,
} from './margin-calibration.types';
import {
  categoryCarrierCellKey,
  GLOBAL_CELL_KEY,
  MARGIN_QUANTILE_P,
  MARGIN_SAMPLE_FLOOR,
} from './margin-calibration.types';
import { InvalidOutcomeInputError } from './outcomes.types';

// ---------------------------------------------------------------------------
// Relative error
// ---------------------------------------------------------------------------

/**
 * The per-report deviation the margin calibrates over:
 * `|reported − estimated| / estimated`, a fraction.
 *
 * The estimate must be positive — the relative error of a zero
 * estimate is undefined, and a silent `Infinity` would poison the
 * quantile. Non-finite or negative totals throw
 * `INVALID_MARGIN_INPUT` (same fail-loud contract as
 * {@link isWithinMargin}): stored data that degenerate is a bug to
 * surface, not a report to skip quietly.
 */
export function relativeErrorFraction(
  reportedTotalCents: number,
  estimatedTotalCents: number,
): number {
  if (
    !Number.isFinite(reportedTotalCents) ||
    !Number.isFinite(estimatedTotalCents) ||
    reportedTotalCents < 0
  ) {
    throw new InvalidOutcomeInputError(
      'INVALID_MARGIN_INPUT',
      `margin calibration needs finite non-negative totals, got reported=${String(reportedTotalCents)}, estimated=${String(estimatedTotalCents)}`,
    );
  }
  if (estimatedTotalCents <= 0) {
    throw new InvalidOutcomeInputError(
      'INVALID_MARGIN_INPUT',
      `relative error is undefined for a non-positive estimate, got estimated=${String(estimatedTotalCents)}`,
    );
  }
  return Math.abs(reportedTotalCents - estimatedTotalCents) / estimatedTotalCents;
}

// ---------------------------------------------------------------------------
// Quantile
// ---------------------------------------------------------------------------

/**
 * Nearest-rank p80 over already-computed relative errors — the
 * empirical margin's quantile.
 *
 * Nearest-rank (rank = ⌈p·n⌉, 1-based) is chosen over interpolation
 * deliberately: the result is an observed sample value, so the
 * inclusive boundary is exact by construction — a report whose
 * relative error equals the quantile is within the hedge, and at
 * least ⌈p·n⌉ samples (≥ 80%) are. Input order is irrelevant; the
 * errors are sorted internally, so permutations are quantile-equal.
 *
 * `0.8` is not binary-exact, so at multiples of five the product
 * p·n can carry float dust (e.g. `0.8·75 → 60.000…003`); values
 * within 1e-9 of an integer are snapped before ceiling so the rank is
 * the exact ceil of the rational p·n. An empty sample has no quantile
 * and throws rather than fabricating one — callers meet the
 * {@link MARGIN_SAMPLE_FLOOR} floor first.
 */
export function quantileOfRelativeErrors(errors: readonly number[]): number {
  if (errors.length === 0) {
    throw new InvalidOutcomeInputError(
      'INVALID_MARGIN_INPUT',
      'no empirical quantile exists for an empty sample',
    );
  }
  for (const error of errors) {
    if (!Number.isFinite(error) || error < 0) {
      throw new InvalidOutcomeInputError(
        'INVALID_MARGIN_INPUT',
        `relative errors must be finite and non-negative, got ${String(error)}`,
      );
    }
  }

  const product = MARGIN_QUANTILE_P * errors.length;
  const snapped =
    Math.abs(product - Math.round(product)) < 1e-9 ? Math.round(product) : product;
  const rank = Math.min(errors.length, Math.max(1, Math.ceil(snapped)));

  return [...errors].sort((a, b) => a - b)[rank - 1];
}

// ---------------------------------------------------------------------------
// Per-cell calibration
// ---------------------------------------------------------------------------

/**
 * Calibrate one ladder cell from the full report corpus: the reports
 * attributed to the cell (join-honestly — a report with an
 * unresolvable category or carrier reaches only the cells its known
 * values name) yield their relative errors and, at or above the
 * {@link MARGIN_SAMPLE_FLOOR}, the nearest-rank p80.
 *
 * Below the floor the cell has no honest margin and the result is
 * `null` — no fabrication (design D3). `asOf` is passed through
 * unchanged. A cell that needs a category or carrier cannot be asked
 * without one: that is a caller bug and throws, not an empty cell.
 */
export function computeCellMargin(
  reports: readonly OutcomeMarginReport[],
  dimension: MarginCellDimension,
  category: string | null,
  carrier: string | null,
  asOf: Date,
): EmpiricalMargin | null {
  // Resolving the key up front doubles as the caller-bug guard: a cell
  // that needs a category or carrier cannot be asked without one, and
  // the failure must surface even when the corpus is below the floor.
  const key =
    dimension === 'global'
      ? GLOBAL_CELL_KEY
      : dimension === 'category_carrier'
        ? categoryCarrierCellKey(
            requireCellValue(
              category,
              'a category_carrier cell needs both a category and a carrier',
            ),
            requireCellValue(
              carrier,
              'a category_carrier cell needs both a category and a carrier',
            ),
          )
        : requireCellValue(category, 'a category cell needs a category');

  const attributed = reports.filter((report) => {
    if (dimension === 'global') return true;
    if (report.category === null || report.category !== category) return false;
    if (dimension === 'category_carrier') {
      return report.carrier !== null && report.carrier === carrier;
    }
    return true;
  });

  if (attributed.length < MARGIN_SAMPLE_FLOOR) {
    return null;
  }

  const quantile = quantileOfRelativeErrors(
    attributed.map((report) =>
      relativeErrorFraction(report.reportedTotalCents, report.estimatedTotalCents),
    ),
  );

  return {
    quantile,
    sampleCount: attributed.length,
    cell: { dimension, key },
    asOf,
  };
}

/** Narrow a required cell value, throwing the caller-bug reason when absent. */
function requireCellValue(value: string | null, detail: string): string {
  if (value === null) {
    throw new InvalidOutcomeInputError('INVALID_MARGIN_INPUT', detail);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Ladder resolution
// ---------------------------------------------------------------------------

/**
 * The rungs of one query's ladder path, deepest first — the calibration
 * descriptors (the category/carrier the cell math attributes over) and
 * the resulting cell identities share this one geometry, so both
 * resolvers below walk the same path.
 */
interface LadderRung {
  readonly dimension: MarginCellDimension;
  readonly category: string | null;
  readonly carrier: string | null;
  /** The rung's cell identity (see {@link MarginCell}). */
  readonly key: string;
}

function ladderPath(query: MarginLadderQuery): LadderRung[] {
  const path: LadderRung[] = [];
  if (query.category !== null && query.carrier !== null) {
    path.push({
      dimension: 'category_carrier',
      category: query.category,
      carrier: query.carrier,
      key: categoryCarrierCellKey(query.category, query.carrier),
    });
  }
  if (query.category !== null) {
    path.push({
      dimension: 'category',
      category: query.category,
      carrier: null,
      key: query.category,
    });
  }
  path.push({
    dimension: 'global',
    category: null,
    carrier: null,
    key: GLOBAL_CELL_KEY,
  });
  return path;
}

/**
 * Resolve the empirical margin for a result through the cell ladder:
 * `category×carrier` → `category` → `global` — the deepest rung with
 * a sample count at or above the {@link MARGIN_SAMPLE_FLOOR} wins the
 * cell attribution; below the floor everywhere the margin is `null`
 * (design D3).
 *
 * The winning quantile is clamped to the minimum over every rung on
 * the ladder path that meets the floor. This upholds the tested
 * monotonicity invariant — a deeper cell never yields a wider margin
 * than its qualifying parent — which the raw quantile alone cannot
 * guarantee: the p80 of a subset can exceed the parent's p80 when the
 * subset over-represents the error tail (e.g. parent errors mostly at
 * 1% with three outliers, deep cell keeping the outliers plus just
 * enough 1%s to pass the floor). The hedge may only shrink as the
 * ladder narrows; sample count and cell still describe the winning
 * (deepest) rung.
 *
 * Rungs needing an unknown query value are simply unreachable. Pure —
 * the clock stays an injected `asOf` parameter; display-only (design
 * D4): the result never enters totals, rankings, or computed outputs.
 */
export function resolveEmpiricalMargin(
  reports: readonly OutcomeMarginReport[],
  query: MarginLadderQuery,
  asOf: Date,
): EmpiricalMargin | null {
  // Calibrate the path's rungs from the report corpus, then resolve
  // through the same cell resolution a persisted ladder reads through
  // ({@link resolveEmpiricalMarginFromCells}) — deepest-wins and the
  // clamp have exactly one source of truth.
  const cells: EmpiricalMargin[] = [];
  for (const rung of ladderPath(query)) {
    const margin = computeCellMargin(
      reports,
      rung.dimension,
      rung.category,
      rung.carrier,
      asOf,
    );
    if (margin !== null) cells.push(margin);
  }
  return resolveEmpiricalMarginFromCells(cells, query);
}

/**
 * Resolve a margin from an ALREADY-CALIBRATED ladder — the persisted
 * `outcome_margins` snapshot (task 2.2's read-time composition; the
 * calibrating resolver {@link resolveEmpiricalMargin} delegates here
 * too, so deepest-wins and the monotonicity clamp live in exactly one
 * place). The snapshot contains only cells that met the floor at write
 * time, so the deepest snapshot cell on the query's path IS the deepest
 * floored rung; the clamp still applies across the surviving path
 * rungs. No cell on the path (an empty snapshot, or every path rung
 * under the floor at the last write) is `null` — never a fabricated
 * margin. Pure and display-only (design D4).
 */
export function resolveEmpiricalMarginFromCells(
  cells: readonly EmpiricalMargin[],
  query: MarginLadderQuery,
): EmpiricalMargin | null {
  let winner: EmpiricalMargin | null = null;
  let clampedQuantile = Number.POSITIVE_INFINITY;
  for (const { dimension, key } of ladderPath(query)) {
    const cell = cells.find(
      (candidate) =>
        candidate.cell.dimension === dimension && candidate.cell.key === key,
    );
    if (cell === undefined) continue;
    if (winner === null) {
      winner = cell;
    }
    clampedQuantile = Math.min(clampedQuantile, cell.quantile);
  }

  if (winner === null) {
    return null;
  }
  return { ...winner, quantile: clampedQuantile };
}
