/**
 * Unit-price metric types — cents per gram of pure ethanol.
 *
 * The metric is derived at read time from an offer's price and the
 * product's physical inputs. It is a derived comparison figure only:
 * nothing here is ever persisted as a column, and an unavailable
 * result carries an explicit reason instead of a substituted value.
 *
 * @module UnitPriceTypes
 */

import type { ReliabilityStatus } from '../reliability/reliability.types';

// ---------------------------------------------------------------------------
// Result status
// ---------------------------------------------------------------------------

/**
 * Status of the unit-price metric.
 *
 * - `'computed'`:   both physical inputs present and the offer price is
 *                   VERIFIED — the value is exact as far as the inputs go.
 * - `'ESTIMATED'`:  a value is returned, but the offer price is not
 *                   VERIFIED (STALE, ESTIMATED, or UNAVAILABLE) — the
 *                   metric inherits the price's uncertainty.
 * - `'unavailable'`: no numeric value exists — alcohol fraction or
 *                   volume is missing, or an input is invalid. The
 *                   {@link UnitPriceUnavailable.reason} says exactly why;
 *                   no value is silently substituted.
 */
export type UnitPriceStatus = 'computed' | 'ESTIMATED' | 'unavailable';

// ---------------------------------------------------------------------------
// Unavailable reasons
// ---------------------------------------------------------------------------

/**
 * Why the metric could not be produced. Distinguishes missing data
 * (known unknowns — the product record simply lacks the field) from
 * invalid data (a value was supplied but is outside the domain the
 * formula accepts).
 */
export type UnitPriceUnavailableReason =
  | 'MISSING_VOLUME'
  | 'MISSING_ALCOHOL_FRACTION'
  | 'INVALID_VOLUME'
  | 'INVALID_ALCOHOL_FRACTION'
  | 'INVALID_PRICE';

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/** Successful metric: value present, price provenance attached. */
export interface UnitPriceValue {
  readonly status: 'computed' | 'ESTIMATED';
  /** Offer price in euro cents per gram of pure ethanol. */
  readonly centsPerGram: number;
  /**
   * Grams of pure ethanol in one unit — the denominator actually used
   * (`unitVolumeL × alcoholFraction × 789`), kept as evidence so the
   * density conversion is auditable and testable.
   */
  readonly ethanolGrams: number;
  /** Reliability of the offer price the metric was derived from. */
  readonly priceReliability: ReliabilityStatus;
}

/** Metric could not be produced: explicitly no value, with a reason. */
export interface UnitPriceUnavailable {
  readonly status: 'unavailable';
  readonly centsPerGram: null;
  readonly ethanolGrams: null;
  readonly reason: UnitPriceUnavailableReason;
}

/**
 * Discriminated result of the unit-price metric. Discriminate on
 * `status`: `'computed'` and `'ESTIMATED'` carry a value (the latter
 * inherits a non-VERIFIED price), `'unavailable'` carries `null` values
 * and the {@link UnitPriceUnavailableReason}.
 */
export type UnitPriceResult = UnitPriceValue | UnitPriceUnavailable;
