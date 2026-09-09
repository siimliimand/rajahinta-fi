/**
 * Savings-gap types — landed cost versus the Alko domestic reference.
 *
 * The gap is a display-only discovery figure produced by the daily
 * materialization pass (spec savings-discovery). It feeds nothing in the
 * calculator, ranking, or basket optimization: an unavailable result
 * carries an explicit reason instead of a substituted value, and every
 * money/percentage figure is an integer (cents, basis points) — a
 * floating-point value never materializes (design D4).
 *
 * @module SavingsTypes
 */

// ---------------------------------------------------------------------------
// Result status
// ---------------------------------------------------------------------------

/**
 * Status of the savings-gap computation.
 *
 * - `'computed'`:    both the landed total and the Alko reference were
 *                    present and valid — the gap is exact integer math.
 * - `'unavailable'`: no gap exists — an input is missing or invalid. The
 *                    {@link SavingsGapUnavailable.reason} says exactly
 *                    why; no value is silently substituted.
 */
export type SavingsGapStatus = 'computed' | 'unavailable';

// ---------------------------------------------------------------------------
// Unavailable reasons
// ---------------------------------------------------------------------------

/**
 * Why the gap could not be produced. Distinguishes missing data (known
 * unknowns — the snapshot input simply lacks the field) from invalid data
 * (a value was supplied but sits outside the domain the formula accepts).
 */
export type SavingsGapUnavailableReason =
  | 'MISSING_LANDED_TOTAL'
  | 'MISSING_ALKO_REFERENCE'
  | 'INVALID_LANDED_TOTAL'
  | 'INVALID_ALKO_REFERENCE';

// ---------------------------------------------------------------------------
// Input
// -------------------------------------------------------------------

/** One product's inputs to the gap computation, any order of checks. */
export interface SavingsGapInput {
  /** Product identity, echoed so rows are self-describing and sortable. */
  readonly productId: number;
  /** Product display name (the ordering tiebreaker), echoed verbatim. */
  readonly productName: string;
  /**
   * Complete landed cost in euro cents (calculator quantity 1, destination
   * Finland), or `null`/`undefined` when the calculation produced no total.
   */
  readonly landedTotalCents: number | null | undefined;
  /**
   * Alko domestic reference price in euro cents, or `null`/`undefined`
   * when the product carries no qualifying reference offer.
   */
  readonly alkoReferenceCents: number | null | undefined;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/** Successful gap: value present, both figures kept as evidence. */
export interface SavingsGapValue {
  readonly status: 'computed';
  /** Product identity, echoed from the input. */
  readonly productId: number;
  /** Product display name, echoed from the input. */
  readonly productName: string;
  /** Complete landed cost in euro cents. */
  readonly landedTotalCents: number;
  /** Alko domestic reference price in euro cents. */
  readonly alkoReferenceCents: number;
  /**
   * Landed total − reference, in euro cents. Negative means the landed
   * cost sits below the Alko reference.
   */
  readonly gapCents: number;
  /**
   * The gap as an integer ratio of the reference in basis points
   * (1/10000), rounded half away from zero. Same sign as
   * {@link SavingsGapValue.gapCents}.
   */
  readonly gapBasisPoints: number;
}

/** Gap could not be produced: explicitly no value, with a reason. */
export interface SavingsGapUnavailable {
  readonly status: 'unavailable';
  readonly productId: number;
  readonly productName: string;
  readonly landedTotalCents: null;
  readonly alkoReferenceCents: null;
  readonly gapCents: null;
  readonly gapBasisPoints: null;
  readonly reason: SavingsGapUnavailableReason;
}

/**
 * Discriminated result of the savings-gap computation. Discriminate on
 * `status`: `'computed'` carries the gap, `'unavailable'` carries `null`
 * values and the {@link SavingsGapUnavailableReason}.
 */
export type SavingsGapResult = SavingsGapValue | SavingsGapUnavailable;
