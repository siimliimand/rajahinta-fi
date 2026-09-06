/**
 * Pure Alko benchmark — the calculated offer against the domestic
 * reference price.
 *
 * Every function here is deterministic and side-effect free: the
 * benchmark is derived at read time from the offer the calculation used
 * and the product's Alko reference rows, and NEVER feeds back into
 * totals, breakdowns, or ranking (spec drop-sweden-eur-only-alko-benchmark,
 * design D6). Failure policy follows the unit-price metric: invalid
 * input degrades to an explicit `unavailable` result instead of
 * throwing, so a malformed reference row can never abort the
 * calculation it decorates — and no value is ever silently substituted.
 *
 * @module AlkoBenchmark
 */

import type {
  AlkoBenchmark,
  AlkoBenchmarkInput,
  AlkoBenchmarkUnavailableReason,
  AlkoReferenceOffer,
} from './benchmark.types';

// ---------------------------------------------------------------------------
// Percentage convention
// ---------------------------------------------------------------------------

/**
 * Decimal places of `differencePercent`. One decimal is the display
 * precision the result line presents; the rounding rule (half away from
 * zero, applied to the magnitude so negative differences round
 * symmetrically) is pinned by exact numeric vectors in the module tests.
 */
export const ALKO_BENCHMARK_PERCENT_DECIMALS = 1;

/** Round to {@link ALKO_BENCHMARK_PERCENT_DECIMALS} decimals, half away from zero. */
function roundPercent(value: number): number {
  const factor = 10 ** ALKO_BENCHMARK_PERCENT_DECIMALS;
  return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
}

// ---------------------------------------------------------------------------
// Reference selection
// ---------------------------------------------------------------------------

/**
 * Whether `candidate` supersedes `incumbent` as the reference row.
 *
 * Selection rule (deterministic, order-independent): the most recent
 * `observedAt` wins; ties break on the higher offer id, because
 * re-observations append new retail-offer rows, so the higher id is the
 * later insert. A strict comparison keeps the first row on a full
 * (observedAt, id) tie, making the result a pure function of the input
 * array.
 */
function supersedes(candidate: AlkoReferenceOffer, incumbent: AlkoReferenceOffer): boolean {
  const candidateTime = candidate.observedAt.getTime();
  const incumbentTime = incumbent.observedAt.getTime();
  if (candidateTime !== incumbentTime) {
    return candidateTime > incumbentTime;
  }
  return candidate.id > incumbent.id;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Integer cents, zero allowed — a free offer is structurally valid input. */
function isValidPriceCents(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

/** A reference must be priced above zero: its price divides the percent. */
function isValidReferenceOffer(offer: AlkoReferenceOffer): boolean {
  return (
    Number.isInteger(offer.id) &&
    Number.isFinite(offer.priceCents) &&
    Number.isInteger(offer.priceCents) &&
    offer.priceCents > 0 &&
    offer.observedAt instanceof Date &&
    !Number.isNaN(offer.observedAt.getTime())
  );
}

// ---------------------------------------------------------------------------
// Metric
// ---------------------------------------------------------------------------

/**
 * Benchmark the calculated offer against the product's Alko reference.
 *
 * ```
 * differenceCents    = calculatedPriceCents − referencePriceCents
 * differencePercent  = round(differenceCents / referencePriceCents × 100)
 * ```
 *
 * Positive differences mean the calculated offer costs more than buying
 * domestically at Alko. Pure — no I/O, no clock, no persistence.
 *
 * Validation policy (single reported reason, checked in this order):
 *
 * 1. `calculatedPriceCents` must be a finite integer ≥ 0 → else
 *    `INVALID_CALCULATED_PRICE`.
 * 2. `alkoOffers` empty → `NO_REFERENCE_OFFER` — the normal absence
 *    state (no Alko row for the product), never an error.
 * 3. Every reference row must carry an integer id, a finite integer
 *    price > 0, and a valid `observedAt` Date → else
 *    `INVALID_REFERENCE_OFFER`. The whole input fails closed: one
 *    corrupt row suppresses the benchmark rather than letting it
 *    silently rest on the remaining rows. A zero-priced reference is
 *    invalid (the percent would divide by zero) while a zero calculated
 *    price is valid input.
 *
 * The unavailable result carries `null` values and the reason; callers
 * render nothing for it — the field is absent, not a placeholder.
 *
 * @param input The calculated offer price and the product's Alko reference offers.
 */
export function computeAlkoBenchmark(input: AlkoBenchmarkInput): AlkoBenchmark {
  if (!isValidPriceCents(input.calculatedPriceCents)) {
    return unavailable('INVALID_CALCULATED_PRICE');
  }
  if (input.alkoOffers.length === 0) {
    return unavailable('NO_REFERENCE_OFFER');
  }
  if (!input.alkoOffers.every(isValidReferenceOffer)) {
    return unavailable('INVALID_REFERENCE_OFFER');
  }

  const reference = input.alkoOffers.reduce((newest, offer) =>
    supersedes(offer, newest) ? offer : newest,
  );

  const differenceCents = input.calculatedPriceCents - reference.priceCents;
  const differencePercent = roundPercent(
    (differenceCents / reference.priceCents) * 100,
  );

  return {
    status: 'available',
    referencePriceCents: reference.priceCents,
    differenceCents,
    differencePercent,
    reliabilityStatus: reference.reliabilityStatus,
    observedAt: reference.observedAt,
  };
}

/** Build the explicit no-value result. Never substitute a number. */
function unavailable(reason: AlkoBenchmarkUnavailableReason): AlkoBenchmark {
  return {
    status: 'unavailable',
    reason,
    referencePriceCents: null,
    differenceCents: null,
    differencePercent: null,
    reliabilityStatus: null,
    observedAt: null,
  };
}
