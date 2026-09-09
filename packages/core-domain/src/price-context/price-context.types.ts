/**
 * Price-context types — trailing-window statistics over a product's daily
 * price-history buckets.
 *
 * The context is a display-only figure for the product page's factual
 * comparison line (spec price-context): where the current best price sits
 * versus the window median. It is derived at read time from buckets the
 * aggregation already materialized, feeds nothing in the calculator,
 * ranking, or basket optimization, and never renders a percentage over
 * thin data — below the minimum-bucket gate the result is explicitly
 * unavailable with reason `INSUFFICIENT_HISTORY` (design D5). Every
 * figure is an integer (cents, basis points); a floating-point value
 * never materializes (design D4).
 *
 * @module PriceContextTypes
 */

// ---------------------------------------------------------------------------
// Unavailable reason
// ---------------------------------------------------------------------------

/** Why the context could not be produced. */
export type PriceContextUnavailableReason = 'INSUFFICIENT_HISTORY';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** One product's inputs to the window computation. */
export interface PriceContextInput {
  /**
   * The product-wide daily bucket totals (merchant-null rows) inside the
   * trailing window, in euro cents, in any order — the module sorts.
   */
  readonly bucketsCents: readonly number[];
  /**
   * The product's current best price in euro cents — the lowest current
   * offer price, the same selection rule the product page uses, so the
   * context line can never contradict the price panel next to it.
   */
  readonly currentBestCents: number;
  /**
   * As-of date the window was evaluated on (ISO `YYYY-MM-DD`). An input —
   * this module never reads a clock — echoed onto the result so every
   * payload is explainable on its own (design D5).
   */
  readonly asOf: string;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/** Successful context: value present, window shape attached. */
export interface PriceContextValue {
  readonly status: 'computed';
  /** Window median, in euro cents (integer convention — see the module). */
  readonly medianCents: number;
  /** Lowest daily bucket in the window, euro cents. */
  readonly minCents: number;
  /** Highest daily bucket in the window, euro cents. */
  readonly maxCents: number;
  /**
   * Current best price − window median, in euro cents. Positive means the
   * current best price sits above the window median.
   */
  readonly deltaVsMedianCents: number;
  /**
   * The delta as an integer ratio of the median in basis points (1/10000),
   * rounded half away from zero. Same sign as
   * {@link PriceContextValue.deltaVsMedianCents}.
   */
  readonly deltaVsMedianBasisPoints: number;
  /** Window length in days — the constant, echoed for explainability. */
  readonly windowDays: number;
  /** How many daily buckets the window actually contained. */
  readonly bucketCount: number;
  /** As-of date, echoed from the input. */
  readonly asOf: string;
}

/** Context could not be produced: explicitly no value, with a reason. */
export interface PriceContextUnavailable {
  readonly status: 'unavailable';
  readonly medianCents: null;
  readonly minCents: null;
  readonly maxCents: null;
  readonly deltaVsMedianCents: null;
  readonly deltaVsMedianBasisPoints: null;
  readonly reason: PriceContextUnavailableReason;
  /** Window length in days — travels even on the unavailable branch. */
  readonly windowDays: number;
  /** How many daily buckets the window actually contained. */
  readonly bucketCount: number;
  /** As-of date, echoed from the input. */
  readonly asOf: string;
}

/**
 * Discriminated result of the price-context window computation.
 * Discriminate on `status`: `'computed'` carries the window figures,
 * `'unavailable'` carries `null` values and
 * {@link PriceContextUnavailableReason}. Both branches carry the window
 * length, bucket count, and as-of date — the every-number-is-explainable
 * invariant (design D5).
 */
export type PriceContextResult = PriceContextValue | PriceContextUnavailable;

// ---------------------------------------------------------------------------
// Input validation error
// ---------------------------------------------------------------------------

/**
 * Thrown when the bucket series or the current price violates the value
 * domain (non-integer, non-positive, or non-finite cents). Unlike data
 * absence — which degrades to `INSUFFICIENT_HISTORY` — a structurally
 * invalid figure is a caller bug, so it fails loudly instead of shaping
 * itself into a display state.
 */
export class InvalidPriceContextInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPriceContextInputError';
  }
}
