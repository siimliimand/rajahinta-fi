/**
 * Reliability types.
 *
 * Defines the status model for data-point reliability across price,
 * transport, and classification domains. Every sourced fact carries a
 * reliability status from the acquisition pipeline through to the
 * landed-cost result surfaced to the user.
 *
 * @module ReliabilityTypes
 */

// ---------------------------------------------------------------------------
// Reliability status
// ---------------------------------------------------------------------------

/**
 * Reliability status for an individual data point.
 *
 * - `VERIFIED`:   Confirmed against an authoritative source (e.g. live
 *                 merchant price page, official carrier rate table).
 * - `ESTIMATED`:  Derived from incomplete or indirect data (e.g.
 *                 category-average price, weight-based shipping rule).
 * - `STALE`:      Data point was verified or estimated in the past but
 *                 has exceeded its domain-specific freshness threshold.
 * - `UNAVAILABLE`: No data exists for this data point.
 */
export type ReliabilityStatus = 'VERIFIED' | 'STALE' | 'UNAVAILABLE' | 'ESTIMATED';

// ---------------------------------------------------------------------------
// Reliability ordering
// ---------------------------------------------------------------------------

/**
 * Priority ordering from most reliable to least reliable.
 *
 * Used by {@link composeReliability} to resolve the strictest (most
 * conservative) status among a set of inputs.
 */
export const RELIABILITY_ORDER: ReliabilityStatus[] = [
  'VERIFIED',
  'ESTIMATED',
  'STALE',
  'UNAVAILABLE',
];

// ---------------------------------------------------------------------------
// Domain identifiers
// ---------------------------------------------------------------------------

/**
 * Domain areas that have distinct staleness thresholds.
 */
export type ReliabilityDomain = 'price' | 'transport' | 'classification';

// ---------------------------------------------------------------------------
// Duration value object
// ---------------------------------------------------------------------------

/**
 * A duration expressed in milliseconds.
 *
 * Lightweight value object; use helper constants for readability:
 * ```ts
 * const threshold: Duration = { milliseconds: 24 * HOUR };
 * ```
 */
export interface Duration {
  readonly milliseconds: number;
}

/** One hour in milliseconds. */
export const HOUR: Duration = { milliseconds: 3_600_000 };

/** One day (24 hours) in milliseconds. */
export const DAY: Duration = { milliseconds: 86_400_000 };

/** One week (7 days) in milliseconds. */
export const WEEK: Duration = { milliseconds: 604_800_000 };

// ---------------------------------------------------------------------------
// Default staleness thresholds
// ---------------------------------------------------------------------------

/**
 * Default staleness thresholds per domain.
 *
 * - **price**:          24 hours — prices change frequently.
 * - **transport**:      7 days   — carrier rates are more stable.
 * - **classification**: 30 days  — regulatory classification rules
 *                         change on legislative cycles.
 */
export const DEFAULT_STALENESS_THRESHOLDS: Record<ReliabilityDomain, Duration> = {
  price: { milliseconds: 24 * HOUR.milliseconds },
  transport: { milliseconds: 7 * DAY.milliseconds },
  classification: { milliseconds: 30 * DAY.milliseconds },
};