/**
 * Traveller Allowance Port — abstraction for reading the allowance limit
 * dataset effective on a travel date.
 *
 * Core Domain owns this port so the optimizer's allowance-fill objective
 * depends on an abstraction, not on a specific repository implementation
 * (core-domain must not import from data-platform). The concrete adapter
 * lives in the composition root (task 8.2) and maps
 * `TravellerAllowancesRepository.findPublishedEffectiveOn` behind this
 * contract at bootstrap time.
 *
 * The resolved shape is {@link TripResolvedAllowances} — the narrow
 * allowance projection already committed by the trip feasibility module
 * (tripcalc): the dataset `versionLabel` for provenance plus per-category
 * `volumeCapLitres` / `quantityCap` rows. It is structurally compatible
 * with the 5.1 repository record, so the adapter maps the repository
 * result straight in.
 *
 * ## Resolution contract
 *
 * The implementation resolves the PUBLISHED dataset whose half-open
 * effective window covers the travel date (`effectiveFrom ≤ travelDate <
 * effectiveTo`, null `effectiveTo` open-ended; newest `effectiveFrom`
 * wins on transient overlap) and returns it as a unit: its `versionLabel`
 * plus the limit rows whose own windows cover the date. Null when no
 * published version covers the date — the fill engine refuses to run
 * unbounded rather than inventing caps (the caller receives
 * `AllowanceFillError('NO_ALLOWANCE_DATASET')`, never an uncapped result).
 *
 * @module TravellerAllowancePort
 */

import type { TripResolvedAllowances } from '../../tripcalc/tripcalc.types';

/** Injection token for the traveller allowance port. */
export const TRAVELLER_ALLOWANCE_PORT = 'TRAVELLER_ALLOWANCE_PORT';

/** Re-exported so port consumers need no tripcalc import. */
export type {
  TripResolvedAllowances,
  TripAllowanceLimitRow,
} from '../../tripcalc/tripcalc.types';

/**
 * Repository contract for date-resolved traveller allowances.
 *
 * Consumers inject this interface via {@link TRAVELLER_ALLOWANCE_PORT}.
 */
export interface ITravellerAllowancePort {
  /**
   * Resolve the PUBLISHED allowance dataset effective on the travel date
   * (half-open window, newest effectiveFrom wins) with its limit rows,
   * or null when no published version covers the date.
   *
   * @param travelDate ISO `YYYY-MM-DD` calendar date (shape validated by
   *                   the caller before this port is reached).
   */
  resolveForTravelDate(travelDate: string): Promise<TripResolvedAllowances | null>;
}
