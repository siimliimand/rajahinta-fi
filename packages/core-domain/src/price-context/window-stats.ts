/**
 * Pure price-context computation — window statistics over a product's
 * daily price-history buckets.
 *
 * Every function here is deterministic and side-effect free: the window
 * is derived from buckets the aggregation cron already materialized and
 * from a current price the caller selected with the product page's own
 * lowest-current-offer rule (spec price-context). No I/O, no clock — the
 * as-of date is an input.
 *
 * @module PriceContextWindow
 */

import type {
  PriceContextInput,
  PriceContextResult,
  PriceContextUnavailableReason,
  PriceContextValue,
} from './price-context.types';
import { InvalidPriceContextInputError } from './price-context.types';

// ---------------------------------------------------------------------------
// Window constants
// ---------------------------------------------------------------------------

/**
 * Length of the trailing window the context is computed over, in days.
 * The constant travels in every result (`windowDays`) so each payload
 * explains the window it was computed over (design D5).
 */
export const PRICE_CONTEXT_WINDOW_DAYS = 90;

/**
 * Minimum number of daily buckets the window must contain before any
 * figure — above all any percentage — is produced. Below the gate the
 * result is `unavailable` with reason `INSUFFICIENT_HISTORY` (design D5):
 * no contextual percentage is ever rendered over thin data.
 */
export const PRICE_CONTEXT_MIN_BUCKETS = 14;

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

/**
 * Trailing-window price context: median/min/max of the daily buckets and
 * the current best price's delta versus the median, in integer cents and
 * integer basis points.
 *
 * ```
 * medianCents            = integer median of the window's buckets
 * deltaVsMedianCents     = currentBestCents − medianCents
 * deltaVsMedianBasisPoints = round(deltaCents / medianCents × 10000)
 * ```
 *
 * Median convention for an even bucket count (design D4 forbids a
 * floating-point median): the mean of the two middle buckets, rounded
 * down to a whole cent — `⌊(a + b) / 2⌋`. Exact in integer arithmetic
 * (division of a safe integer by two is exactly representable), fully
 * deterministic, and the sub-cent residue is display-irrelevant since the
 * raw bucket cents remain available. Odd counts take the middle bucket
 * unchanged.
 *
 * Validation policy:
 *
 * 1. Fewer buckets than {@link PRICE_CONTEXT_MIN_BUCKETS} → `unavailable`
 *    with `INSUFFICIENT_HISTORY`. The gate is checked first: the honest
 *    answer for a thin window is "not enough history yet", regardless of
 *    what the few buckets happen to contain.
 * 2. Every bucket and the current best price must be an integer > 0.
 *    A bucket row exists only where observations exist, so a zero- or
 *    negative-cent bucket is corrupt data, and the median is the
 *    denominator of the basis-point ratio — a fractional or non-finite
 *    value anywhere is a caller bug, reported by throwing
 *    {@link InvalidPriceContextInputError} rather than shaped into a
 *    display state.
 *
 * @param input See {@link PriceContextInput}.
 */
export function computePriceContextWindow(input: PriceContextInput): PriceContextResult {
  const bucketCount = input.bucketsCents.length;

  if (bucketCount < PRICE_CONTEXT_MIN_BUCKETS) {
    return unavailable(input, bucketCount, 'INSUFFICIENT_HISTORY');
  }

  assertValidCents(input.currentBestCents, 'currentBestCents');
  for (const bucketCents of input.bucketsCents) {
    assertValidCents(bucketCents, 'bucketsCents');
  }
  if (input.asOf.length === 0) {
    throw new InvalidPriceContextInputError('asOf must be a non-empty ISO date string');
  }

  const ordered = [...input.bucketsCents].sort((a, b) => a - b);
  const medianCents = orderedMedian(ordered);
  const minCents = ordered[0];
  const maxCents = ordered[bucketCount - 1];
  const deltaVsMedianCents = input.currentBestCents - medianCents;

  return {
    status: 'computed',
    medianCents,
    minCents,
    maxCents,
    deltaVsMedianCents,
    deltaVsMedianBasisPoints: basisPointsOf(deltaVsMedianCents, medianCents),
    windowDays: PRICE_CONTEXT_WINDOW_DAYS,
    bucketCount,
    asOf: input.asOf,
  };
}

// ---------------------------------------------------------------------------
// Window statistics
// ---------------------------------------------------------------------------

/**
 * Integer median of an ascending, non-empty series. Odd counts take the
 * middle bucket; even counts take `⌊(lower + upper) / 2⌋` — exact integer
 * arithmetic, never a float (design D4; convention documented on
 * {@link computePriceContextWindow}).
 */
function orderedMedian(ascending: readonly number[]): number {
  const middle = Math.floor(ascending.length / 2);
  if (ascending.length % 2 === 1) {
    return ascending[middle];
  }
  return Math.floor((ascending[middle - 1] + ascending[middle]) / 2);
}

// ---------------------------------------------------------------------------
// Basis points
// ---------------------------------------------------------------------------

/**
 * Integer ratio → basis points, rounded half away from zero.
 *
 * Exact BigInt arithmetic — a floating-point value never materializes on
 * the way to the returned integer (design D4: floats never touch money or
 * percentages, so a delta of −1/3 renders as −3333 bps, symmetric with
 * +1/3 → +3333). Callers must validate both arguments as integers; BigInt
 * construction throws on a fractional input, which this function treats
 * as a caller contract violation rather than a data state.
 */
function basisPointsOf(numeratorCents: number, denominatorCents: number): number {
  const dividend = BigInt(numeratorCents) * 10_000n;
  const divisor = BigInt(denominatorCents);
  const sign = dividend < 0n ? -1n : 1n;
  const magnitude = dividend < 0n ? -dividend : dividend;
  const quotient = magnitude / divisor;
  const rounded = (magnitude % divisor) * 2n >= divisor ? quotient + 1n : quotient;
  return Number(sign * rounded);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Reject any cents figure outside the domain: integer > 0. */
function assertValidCents(cents: number, field: string): void {
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new InvalidPriceContextInputError(
      `${field} must be an integer > 0, got ${String(cents)}`,
    );
  }
}

/** Build the explicit no-value result. Never substitute a number. */
function unavailable(
  input: PriceContextInput,
  bucketCount: number,
  reason: PriceContextUnavailableReason,
): PriceContextResult {
  return {
    status: 'unavailable',
    medianCents: null,
    minCents: null,
    maxCents: null,
    deltaVsMedianCents: null,
    deltaVsMedianBasisPoints: null,
    reason,
    windowDays: PRICE_CONTEXT_WINDOW_DAYS,
    bucketCount,
    asOf: input.asOf,
  };
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/** Narrow a result to its value branch — the UI renders only the rest. */
export function isPriceContextValue(
  result: PriceContextResult,
): result is PriceContextValue {
  return result.status === 'computed';
}
