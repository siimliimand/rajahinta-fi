/**
 * Alko benchmark types — display-only domestic reference comparison.
 *
 * The benchmark compares the retail offer the landed-cost calculation
 * used against the product's Alko reference offers (merchant `'alko'`,
 * EAN-linked by the domestic reference feed). It is a derived display
 * figure only: it never enters the landed-cost total, the itemized
 * breakdown, or any ranking input (spec drop-sweden-eur-only-alko-benchmark,
 * landed-cost-calculator "Domestic reference benchmark is display-only").
 *
 * Absence of an Alko reference is a normal state, not an error: the
 * unavailable variant carries an explicit reason and `null` values —
 * a value is never silently substituted (same contract shape as the
 * unit-price metric).
 *
 * @module AlkoBenchmarkTypes
 */

import type { ReliabilityStatus } from '../reliability/reliability.types';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * One Alko reference observation for the product.
 *
 * A product may have several rows: the domestic feed re-observes over
 * time and retail offers are append-only history, so callers pass every
 * Alko row they resolved and the benchmark selects one deterministically.
 */
export interface AlkoReferenceOffer {
  /** Retail-offer id — re-observations append, so higher id = later insert. */
  readonly id: number;
  /** Alko shelf price in EUR cents — the canonical money unit. */
  readonly priceCents: number;
  /** Reliability of this reference observation. */
  readonly reliabilityStatus: ReliabilityStatus;
  /** When Alko's price was observed. */
  readonly observedAt: Date;
}

/**
 * Inputs of the benchmark. `calculatedPriceCents` is the retail price of
 * the offer the calculation used; `alkoOffers` are the product's Alko
 * reference rows in any order.
 */
export interface AlkoBenchmarkInput {
  /** Price in EUR cents of the offer the landed-cost calculation used. */
  readonly calculatedPriceCents: number;
  /** The product's Alko reference offers (zero or more, any order). */
  readonly alkoOffers: readonly AlkoReferenceOffer[];
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/**
 * Why no benchmark value exists. Distinguishes normal absence (the
 * product simply has no Alko reference row) from invalid input (a value
 * was supplied but is outside the contract — fail-closed: no benchmark
 * rather than one computed from corrupt data).
 */
export type AlkoBenchmarkUnavailableReason =
  | 'NO_REFERENCE_OFFER'
  | 'INVALID_CALCULATED_PRICE'
  | 'INVALID_REFERENCE_OFFER';

/**
 * Benchmark computed: the selected reference with the difference against
 * the calculated offer.
 *
 * Sign convention: `differenceCents` and `differencePercent` are
 * positive when the calculated offer costs MORE than the Alko reference
 * and negative when it costs less. `differencePercent` is relative to
 * the reference price, rounded to
 * {@link ALKO_BENCHMARK_PERCENT_DECIMALS} decimals, half away from zero.
 */
export interface AlkoBenchmarkAvailable {
  readonly status: 'available';
  /** Selected Alko reference price in EUR cents. */
  readonly referencePriceCents: number;
  /** `calculatedPriceCents − referencePriceCents` in EUR cents. */
  readonly differenceCents: number;
  /** `differenceCents` as percent of `referencePriceCents`, rounded. */
  readonly differencePercent: number;
  /** Reliability of the selected reference observation. */
  readonly reliabilityStatus: ReliabilityStatus;
  /** Observation timestamp of the selected reference row. */
  readonly observedAt: Date;
}

/**
 * No benchmark exists: explicit `null` values with the reason. Absence
 * is the render-nothing state — never a placeholder or a guess.
 */
export interface AlkoBenchmarkUnavailable {
  readonly status: 'unavailable';
  readonly reason: AlkoBenchmarkUnavailableReason;
  readonly referencePriceCents: null;
  readonly differenceCents: null;
  readonly differencePercent: null;
  readonly reliabilityStatus: null;
  readonly observedAt: null;
}

/**
 * Discriminated result of the Alko benchmark. Discriminate on `status`:
 * `'available'` carries the comparison values, `'unavailable'` carries
 * `null` values and the {@link AlkoBenchmarkUnavailableReason}.
 */
export type AlkoBenchmark = AlkoBenchmarkAvailable | AlkoBenchmarkUnavailable;
