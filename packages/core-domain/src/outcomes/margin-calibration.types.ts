/**
 * Empirical-margin calibration types — the display-only hedge derived
 * from user-reported calculation outcomes (design D3).
 *
 * The margin is the empirical p80 quantile of relative error
 * `|reported − estimated| / estimated` over stored outcome reports,
 * resolved through a cell ladder: `category×carrier` → `category` →
 * `global`. It never enters totals, rankings, or any computed output
 * (design D4) — every consumer renders it read-only next to its basis
 * (sample count, as-of).
 *
 * @module MarginCalibrationTypes
 */

// ---------------------------------------------------------------------------
// Ladder geometry
// ---------------------------------------------------------------------------

/**
 * The ladder rung a margin belongs to, deepest first. There is no
 * carrier-only rung: a result with an unknown category cannot be
 * narrowed below the global cell.
 */
export type MarginCellDimension = 'category_carrier' | 'category' | 'global';

/** Key of the global rung — the ladder's single dimension-free cell. */
export const GLOBAL_CELL_KEY = 'global';

/** Identifies one calibrated cell within the ladder. */
export interface MarginCell {
  /** Which rung of the ladder this cell sits on. */
  readonly dimension: MarginCellDimension;
  /**
   * The cell's key: `'global'`, a category, or a
   * `category|carrier` composite (see
   * {@link categoryCarrierCellKey}).
   */
  readonly key: string;
}

/**
 * Deterministic composite key of a `category×carrier` cell. Canonical
 * categories and carriers are slug values, so the `|` separator is
 * unambiguous. Exported so the persistence and read layers derive the
 * same key as the calibration itself — the format has exactly one
 * source of truth.
 */
export function categoryCarrierCellKey(category: string, carrier: string): string {
  return `${category}|${carrier}`;
}

// ---------------------------------------------------------------------------
// Calibration inputs
// ---------------------------------------------------------------------------

/**
 * Minimum sample count for a ladder rung to yield a margin
 * (design D3: `N ≥ 10`). A rung below the floor has no honest
 * quantile — the resolver reports null for it, never a number.
 */
export const MARGIN_SAMPLE_FLOOR = 10;

/**
 * The quantile probability of the empirical margin: the p in p80.
 * Pinned by test, like {@link WITHIN_MARGIN_FRACTION}.
 */
export const MARGIN_QUANTILE_P = 0.8;

/**
 * A stored outcome report enriched with the attribution values the
 * ladder needs, resolved through its calculation record (same join
 * semantics as {@link OutcomeAccuracySplitRow}): a null value means
 * the record or transport offer no longer resolves, and the report
 * then counts only toward the global cell — attribution is
 * join-honest, never fabricated.
 *
 * Totals are whole euro cents; the estimate must be positive for the
 * relative error to exist.
 */
export interface OutcomeMarginReport {
  /** The user-reported actual total, euro cents. */
  readonly reportedTotalCents: number;
  /** The estimate the user calculated against, euro cents. */
  readonly estimatedTotalCents: number;
  /** Canonical product category, or null when unresolvable. */
  readonly category: string | null;
  /** Carrier of the record's transport offer, or null. */
  readonly carrier: string | null;
}

/**
 * The result-side attribution a ladder lookup starts from: the
 * category and carrier of the result being hedged. Either may be null
 * (unknown category, no selected offer) — the ladder then simply
 * cannot enter rungs that need the missing value.
 */
export interface MarginLadderQuery {
  readonly category: string | null;
  readonly carrier: string | null;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/**
 * One calibrated margin — the honest hedge for a single cell.
 *
 * `quantile` is an observed relative error from the cell's own sample
 * (nearest-rank p80, inclusive boundary: a deviation exactly this
 * large is within the hedge). `sampleCount` and `asOf` are the basis
 * and must be displayed beside the margin wherever it renders.
 */
export interface EmpiricalMargin {
  /** Relative-error p80 of the cell, a fraction (e.g. `0.052`). */
  readonly quantile: number;
  /** Sample count behind the quantile, always ≥ {@link MARGIN_SAMPLE_FLOOR}. */
  readonly sampleCount: number;
  /** The cell this margin was calibrated for. */
  readonly cell: MarginCell;
  /** As-of instant the margin was computed for (passed through). */
  readonly asOf: Date;
}
