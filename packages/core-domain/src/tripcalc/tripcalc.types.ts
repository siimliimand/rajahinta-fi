/**
 * Trip feasibility calculator types — travel cost per traveller,
 * break-even volumes, and allowance capping (spec:
 * trip-feasibility-calculator, design R7, task 5.2).
 *
 * The module is pure: these contracts accept ALREADY-RESOLVED data. The
 * allowance dataset is passed in by the caller (task 5.3's API route)
 * from `TravellerAllowancesRepository.findPublishedEffectiveOn` — the
 * module resolves nothing itself and never imports data-platform, a
 * repository, NestJS, or any I/O type (the eventcalc norms-in and
 * whatif rule-data-in precedents).
 *
 * ALLOWANCE INPUT SHAPE (documented decision): {@link TripResolvedAllowances}
 * mirrors the committed 5.1 record contract
 * (`TravellerAllowanceDatasetWithLimits` + `TravellerAllowanceLimitRecord`)
 * with only the fields the capping needs — `dataset.versionLabel` plus
 * per-limit `category` / `volumeCapLitres` / `quantityCap`. The shape is
 * structurally compatible with the full repository record, so the caller
 * maps the resolved dataset straight in; extra record fields (citations,
 * status, windows) are ignored by structure.
 *
 * UNITS (documented decision): all money is integer euro cents; all
 * prices are integer cents PER LITRE; all volumes are whole litres.
 * The break-even volume therefore divides cents by cents/litre and
 * yields litres, which is the unit the 5.1 dataset caps (`volumeCapLitres`)
 * are denominated in — no unit translation exists anywhere in the module.
 * A dataset row whose cap is quantity-only (`quantityCap` without
 * `volumeCapLitres`) cannot bound a litre figure without inventing a
 * container size, so such a row yields the explicit
 * `CAP_NOT_VOLUME` state — never a converted guess (data minimization:
 * no invented numbers, same discipline as a missing category row).
 *
 * ROUNDING (documented decision, the single statement of the rule):
 * half-up, computed exactly in integer arithmetic (remainder
 * comparison — see `roundHalfUpDiv` in tripcalc.ts), at two places:
 *
 * 1. `travelCostPerTravellerCents = halfUp((ticketCostCents + fuelCostCents) / passengers)`
 *    — integer cents, as the task contract mandates.
 * 2. `breakEvenLitres = halfUp(travelCostPerTravellerCents / priceDifferenceCentsPerLitre)`
 *    — whole litres. Whole litres are the mandated granularity because
 *    the EU indicative limits the caps come from are stated in whole
 *    litres (10/20/60/90/110 l in the curated 5.1 seed) and the capped
 *    figure must be comparable to them without fractional slack.
 *
 * CAP-BOUNDARY SEMANTICS (documented decision): the cap is an inclusive
 * maximum. The canonical break-even figure — the rounded whole-litre
 * volume the result states — is compared against the cap: equal to the
 * cap is WITHIN_ALLOWANCE, strictly above is CAPPED (spec: "WHEN the
 * break-even volume exceeds the applicable allowance" — the comparison
 * is on the stated volume). `cappedBreakEvenLitres` is the suggested
 * volume: the uncapped figure when within, the cap when exceeded, and
 * `null` under the two explicit no-cap states.
 *
 * @module TripCalcTypes
 */

import type { Disclaimer } from '../calculator/calculator.types';

// ---------------------------------------------------------------------------
// Canonical vocabulary — mirrors the committed 5.1 allowance categories and
// the tax-rule category keys. Declared here, not imported: purity forbids a
// data-platform import (eventcalc precedent).
// ---------------------------------------------------------------------------

/**
 * Allowance categories — the canonical tax-rule category keys, identical
 * to `TRAVELLER_ALLOWANCE_CATEGORIES` in the 5.1 repository and
 * `EVENT_CALC_DRINK_TYPES` in the event calculator.
 */
export const TRIP_CATEGORY_KEYS = [
  'beer',
  'wine_still',
  'wine_sparkling',
  'intermediate_products',
  'other_fermented',
  'spirits',
] as const;

export type TripCategoryKey = (typeof TRIP_CATEGORY_KEYS)[number];

/**
 * Vehicle types — the MVP's closed set for the trip feasibility
 * calculator. Extended only here in one place; task 5.3's zod layer
 * validates request payloads against the same set, while the module
 * re-validates defensively (callable from untyped JS).
 */
export const TRIP_VEHICLE_TYPES = ['car', 'van'] as const;

export type TripVehicleType = (typeof TRIP_VEHICLE_TYPES)[number];

// ---------------------------------------------------------------------------
// Inputs — allowance data is resolved by the caller, never queried here
// ---------------------------------------------------------------------------

/**
 * One category's caps inside the resolved allowance version — the narrow
 * projection of `TravellerAllowanceLimitRecord`. `category` is typed
 * `string` on purpose: caps arrive from persistence as untyped varchar
 * columns, and an unknown value is a runtime data problem reported via
 * {@link InvalidTripInputError}, not something the type system can see
 * past a repository boundary.
 */
export interface TripAllowanceLimitRow {
  readonly category: string;
  /** Volume cap in litres of finished beverage — null when quantity-only. */
  readonly volumeCapLitres: number | null;
  /** Quantity cap in units — null when volume-only. */
  readonly quantityCap: number | null;
}

/**
 * The ALREADY-RESOLVED allowance dataset the caller (task 5.3) obtained
 * for the travel date — structurally the 5.1
 * `TravellerAllowanceDatasetWithLimits` record. The `versionLabel` is
 * named on the result as provenance (spec: the result SHALL name the
 * dataset version).
 */
export interface TripResolvedAllowances {
  readonly dataset: {
    readonly versionLabel: string;
  };
  readonly limits: readonly TripAllowanceLimitRow[];
}

/** One requested category with its observed per-litre prices, in cents. */
export interface TripCategoryPriceInput {
  readonly category: string;
  /**
   * Domestic reference price in cents per litre (e.g. the Alko-side
   * reference). Integer cents — the module never accepts sub-cent
   * prices; the caller derives per-litre cents from unit prices.
   */
  readonly domesticPriceCentsPerLitre: number;
  /** Foreign retail price in cents per litre. */
  readonly foreignPriceCentsPerLitre: number;
}

/** Trip calculator input — travel facts, per-category prices, and the resolved allowances. */
export interface TripCalcInput {
  /**
   * Calendar date of travel, ISO `YYYY-MM-DD`. Shape-validated only:
   * resolving the PUBLISHED allowance dataset effective on this date
   * (half-open window) is the caller's concern (task 5.3 / repository).
   */
  readonly travelDate: string;
  readonly vehicleType: TripVehicleType;
  /** Travellers sharing the trip's costs (integer ≥ 1). */
  readonly passengers: number;
  /** Total ticket cost in integer euro cents (≥ 0). */
  readonly ticketCostCents: number;
  /** Total fuel cost in integer euro cents (≥ 0). */
  readonly fuelCostCents: number;
  /**
   * The categories under consideration with their per-litre prices, one
   * row per category — no duplicates, at least one row.
   */
  readonly prices: readonly TripCategoryPriceInput[];
  /** The resolved allowance dataset for `travelDate` (see module docs). */
  readonly allowances: TripResolvedAllowances;
}

// ---------------------------------------------------------------------------
// Result lines — a discriminated union so the no-break-even state is a
// value, not an exception (spec: report that no break-even exists instead
// of dividing by zero or returning a negative volume; eventcalc
// NO_PUBLISHED_NORMS value-state precedent)
// ---------------------------------------------------------------------------

/** Why a line carries no capped volume under the `BREAK_EVEN` state. */
export type TripCapStatus =
  /** A volume cap exists and the stated break-even volume is ≤ the cap. */
  | 'WITHIN_ALLOWANCE'
  /** A volume cap exists and the stated break-even volume exceeds it. */
  | 'CAPPED'
  /**
   * The resolved dataset version has no limit row for the category —
   * a version is resolved as a unit (5.1), so there is no cap to apply.
   * The uncapped break-even figure still stands; `cappedBreakEvenLitres`
   * is `null`. Never an invented cap (5.1 deliberately seeds no
   * `other_fermented` row — this state is how that gap surfaces).
   */
  | 'NO_ALLOWANCE_ROW'
  /**
   * The category has a limit row but it is quantity-only
   * (`volumeCapLitres` null): a unit cap cannot bound a litre volume
   * without inventing a container size, so no capping happens and
   * `cappedBreakEvenLitres` is `null`.
   */
  | 'CAP_NOT_VOLUME';

/** Common per-line evidence — the echoed prices and the derived difference. */
interface TripLineEvidence {
  readonly category: string;
  readonly domesticPriceCentsPerLitre: number;
  readonly foreignPriceCentsPerLitre: number;
  /** `domestic − foreign` in cents per litre; positive means importing saves. */
  readonly priceDifferenceCentsPerLitre: number;
}

/**
 * A category where importing saves money: the stated break-even volume
 * plus the allowance capping applied to it. Every figure is a whole
 * litre or integer cents — see the rounding rule in the module docs.
 */
export interface TripBreakEvenVolumeLine extends TripLineEvidence {
  readonly status: 'BREAK_EVEN';
  /**
   * The canonical break-even volume: whole litres, half-up rounded from
   * `travelCostPerTravellerCents / priceDifferenceCentsPerLitre`.
   */
  readonly breakEvenLitres: number;
  /**
   * The applicable volume cap in litres, echoed from the resolved
   * dataset; `null` under `NO_ALLOWANCE_ROW` and `CAP_NOT_VOLUME`.
   */
  readonly capLitres: number | null;
  readonly capStatus: TripCapStatus;
  /**
   * The suggested (capped) volume: the uncapped figure when within the
   * allowance, the cap when exceeded, `null` when no volume cap applies.
   */
  readonly cappedBreakEvenLitres: number | null;
}

/**
 * A category where importing does NOT save money: the foreign price is
 * not below the domestic reference (`priceDifferenceCentsPerLitre ≤ 0`).
 * An expected, explicitly reported state — no volume fields exist at
 * all, so no zero division or negative volume can be represented.
 */
export interface TripNoBreakEvenLine extends TripLineEvidence {
  readonly status: 'NO_BREAK_EVEN';
}

/** One result line: a capped break-even volume or an explicit no-break-even state. */
export type TripBreakEvenLine = TripBreakEvenVolumeLine | TripNoBreakEvenLine;

// ---------------------------------------------------------------------------
// Result — status field for result-shape parity with eventcalc; COMPUTED
// is currently the only top-level state (no-break-even is per line)
// ---------------------------------------------------------------------------

export type TripCalcStatus = 'COMPUTED';

/**
 * The trip feasibility result. Echoes every input figure (traceability),
 * names the allowance dataset version the caps came from (design R7),
 * and carries the structural indicative-limits disclaimer (spec: the
 * disclaimer is part of the result object, not a UI-only string).
 * Lines are ordered by category ascending, independent of input order.
 */
export interface TripCalcResult {
  readonly status: TripCalcStatus;
  readonly travelDate: string;
  readonly vehicleType: TripVehicleType;
  readonly passengers: number;
  readonly ticketCostCents: number;
  readonly fuelCostCents: number;
  /** `ticketCostCents + fuelCostCents` — the travel-cost derivation, step 1. */
  readonly travelCostCents: number;
  /**
   * Half-up `travelCostCents ÷ passengers` in integer cents — step 2 of
   * the derivation the result states.
   */
  readonly travelCostPerTravellerCents: number;
  /** The `versionLabel` of the resolved allowance dataset — R7 provenance. */
  readonly allowanceDatasetVersion: string;
  readonly lines: readonly TripBreakEvenLine[];
  /** Structural indicative-limits disclaimer — travels with every rendering or share. */
  readonly disclaimer: Disclaimer;
}

// ---------------------------------------------------------------------------
// Errors — caller-contract violations only. Expected data states (a
// non-positive price difference, a missing category row) are result
// values above, never these.
// ---------------------------------------------------------------------------

/** Why a trip calculator input was rejected. */
export type TripInputErrorReason =
  | 'INVALID_TRAVEL_DATE'
  | 'UNKNOWN_VEHICLE_TYPE'
  | 'INVALID_PASSENGERS'
  | 'INVALID_TICKET_COST'
  | 'INVALID_FUEL_COST'
  | 'TRAVEL_COST_OVERFLOW'
  | 'INVALID_ALLOWANCE_VERSION'
  | 'EMPTY_ALLOWANCE_LIMITS'
  | 'UNKNOWN_ALLOWANCE_CATEGORY'
  | 'DUPLICATE_ALLOWANCE_CATEGORY'
  | 'INVALID_ALLOWANCE_CAPS'
  | 'EMPTY_CATEGORY_LIST'
  | 'UNKNOWN_CATEGORY'
  | 'DUPLICATE_CATEGORY'
  | 'INVALID_PRICE';

/**
 * Structurally invalid trip input: a non-ISO travel date, an unknown
 * vehicle type, non-integer/negative costs, a passenger count below 1,
 * a malformed allowance dataset (blank version, no limit rows, unknown
 * or duplicate categories, caps that are negative/non-numeric/both
 * null), or a malformed price list. A validating API layer (task 5.3's
 * zod bounds) should prevent these from ever reaching the module; values
 * are never clamped or silently substituted.
 */
export class InvalidTripInputError extends Error {
  readonly reason: TripInputErrorReason;

  constructor(reason: TripInputErrorReason, detail: string) {
    super(`invalid trip calculator input (${reason}): ${detail}`);
    this.name = 'InvalidTripInputError';
    this.reason = reason;
  }
}
