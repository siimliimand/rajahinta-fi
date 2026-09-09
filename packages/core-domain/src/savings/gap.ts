/**
 * Pure savings-gap computation — landed total vs the Alko reference.
 *
 * Every function here is deterministic and side-effect free: the gap is
 * derived from figures the caller already holds (the materialization pass
 * computes the landed cost; the reference comes from the product's Alko
 * offer) and is NEVER persisted or read here (spec savings-discovery).
 * Validation policy lives in the domain, not the caller, so every
 * consumer materializes gaps against the same definition.
 *
 * @module SavingsGap
 */

import type {
  SavingsGapInput,
  SavingsGapResult,
  SavingsGapUnavailableReason,
  SavingsGapValue,
} from './savings.types';

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

/**
 * Gap between one product's complete landed cost and its Alko domestic
 * reference, in integer cents and integer basis points.
 *
 * ```
 * gapCents       = landedTotalCents − alkoReferenceCents
 * gapBasisPoints = round(gapCents / alkoReferenceCents × 10000)
 * ```
 *
 * Pure — no I/O, no clock; as-of and timestamps are the caller's concern.
 *
 * Validation policy (single reported reason, checked in this order):
 *
 * 1. `landedTotalCents` is `null`/`undefined` → `MISSING_LANDED_TOTAL`;
 *    then `alkoReferenceCents` is `null`/`undefined` →
 *    `MISSING_ALKO_REFERENCE` (known unknowns are reported before
 *    value-level faults).
 * 2. The landed total must be an integer ≥ 0 → else
 *    `INVALID_LANDED_TOTAL`. The reference is the denominator of the
 *    basis-point ratio, so it must be an integer > 0 → else
 *    `INVALID_ALKO_REFERENCE`.
 *
 * Invalid inputs yield an explicit `unavailable` result rather than a
 * throw: the pass evaluates every qualifying product, where one malformed
 * record must degrade that product only — never abort the run, and never
 * fall back to a silently substituted value.
 *
 * @param input See {@link SavingsGapInput}.
 */
export function computeSavingsGap(input: SavingsGapInput): SavingsGapResult {
  if (input.landedTotalCents === null || input.landedTotalCents === undefined) {
    return unavailable(input, 'MISSING_LANDED_TOTAL');
  }
  if (input.alkoReferenceCents === null || input.alkoReferenceCents === undefined) {
    return unavailable(input, 'MISSING_ALKO_REFERENCE');
  }
  if (!Number.isInteger(input.landedTotalCents) || input.landedTotalCents < 0) {
    return unavailable(input, 'INVALID_LANDED_TOTAL');
  }
  if (!Number.isInteger(input.alkoReferenceCents) || input.alkoReferenceCents <= 0) {
    return unavailable(input, 'INVALID_ALKO_REFERENCE');
  }

  const gapCents = input.landedTotalCents - input.alkoReferenceCents;

  return {
    status: 'computed',
    productId: input.productId,
    productName: input.productName,
    landedTotalCents: input.landedTotalCents,
    alkoReferenceCents: input.alkoReferenceCents,
    gapCents,
    gapBasisPoints: basisPointsOf(gapCents, input.alkoReferenceCents),
  };
}

// ---------------------------------------------------------------------------
// Basis points
// ---------------------------------------------------------------------------

/**
 * Integer ratio → basis points, rounded half away from zero.
 *
 * Exact BigInt arithmetic — a floating-point value never materializes on
 * the way to the returned integer (design D4: floats never touch money or
 * percentages, so a gap of −1/3 renders as −3333 bps, symmetric with
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

/** Build the explicit no-value result. Never substitute a number. */
function unavailable(
  input: SavingsGapInput,
  reason: SavingsGapUnavailableReason,
): SavingsGapResult {
  return {
    status: 'unavailable',
    productId: input.productId,
    productName: input.productName,
    landedTotalCents: null,
    alkoReferenceCents: null,
    gapCents: null,
    gapBasisPoints: null,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/** Narrow a result to its value branch — the listing omits the rest. */
export function isSavingsGapValue(
  result: SavingsGapResult,
): result is SavingsGapValue {
  return result.status === 'computed';
}
