/**
 * Trip feasibility calculator — travel cost per traveller, break-even
 * volumes, and allowance capping (spec: trip-feasibility-calculator,
 * design R7, task 5.2).
 *
 * Pure functions only: no I/O, no clock, no randomness, no framework
 * imports. The allowance dataset is an INPUT — the caller (task 5.3's
 * API route) resolves the PUBLISHED version effective on the travel
 * date via the data-platform repository and maps it in; this module
 * must never import from data-platform (eventcalc norms-in precedent).
 *
 * TRAVEL-COST DERIVATION (documented decision, stated on the result):
 * `travelCostCents = ticketCostCents + fuelCostCents`, then
 * `travelCostPerTravellerCents = halfUp(travelCostCents / passengers)`.
 * All money is integer euro cents; the half-up division is exact
 * integer arithmetic (remainder comparison, never a float ceil/round),
 * so the figure cannot float-drift. Passengers must be ≥ 1 — a trip
 * with zero travellers is not a meaningful division, and unlike the
 * event calculator's zero-guest case there is no valid zero result to
 * state.
 *
 * BREAK-EVEN (documented decision): per requested category the module
 * derives `priceDifferenceCentsPerLitre = domestic − foreign` and, when
 * positive, `breakEvenLitres = halfUp(travelCostPerTravellerCents /
 * priceDifferenceCentsPerLitre)` — whole litres, the unit the EU
 * indicative caps are denominated in. A non-positive difference means
 * importing cannot amortize the travel at any volume: the line is the
 * explicit `'NO_BREAK_EVEN'` result state carrying no volume fields at
 * all — not an error, not zero, not negative, not Infinity (spec:
 * report that no break-even exists instead of dividing by zero or
 * returning a negative volume; eventcalc NO_PUBLISHED_NORMS
 * value-state precedent).
 *
 * ALLOWANCE CAPPING (documented decision): each break-even line is
 * capped by its category's row in the ALREADY-RESOLVED dataset named on
 * the result. The cap is an inclusive maximum, and the comparison uses
 * the canonical stated figure — the rounded whole-litre break-even
 * volume (spec: "WHEN the break-even volume exceeds the applicable
 * allowance"): equal to the cap is WITHIN_ALLOWANCE, strictly above is
 * CAPPED with `cappedBreakEvenLitres` at the cap while the uncapped
 * figure stays visible beside it. Two states carry NO cap at all rather
 * than an invented number: `NO_ALLOWANCE_ROW` (the resolved version has
 * no row for the category — a version resolves as a unit per 5.1, and
 * the curated seed deliberately omits `other_fermented`, so this state
 * is reachable with real data) and `CAP_NOT_VOLUME` (the row's cap is
 * quantity-only; a unit cap cannot bound a litre volume without
 * inventing a container size).
 *
 * VALIDATION PRECEDENCE (documented, deterministic): travel facts first
 * (date shape, vehicle type, passengers, ticket and fuel costs, cost
 * sum), then the allowance dataset (version label, non-empty limits,
 * per-limit category/duplicates/caps), then the price rows (non-empty,
 * per-row category/duplicates/prices). The first violation wins and
 * throws {@link InvalidTripInputError}; values are never clamped or
 * ignored. Money and price figures must be safe integers — the
 * exactness contract that keeps every derivation pure integer arithmetic
 * (eventcalc discipline). An empty allowance limit list is rejected
 * rather than reported as a state: unlike eventcalc's empty norms
 * (normal before curation), a PUBLISHED allowance version without limit
 * rows is unrepresentable — the 5.1 publish gate refuses it — so an
 * empty list here can only be a caller-contract violation.
 *
 * @module TripCalc
 */

import {
  InvalidTripInputError,
  TRIP_CATEGORY_KEYS,
  TRIP_VEHICLE_TYPES,
} from './tripcalc.types';
import type {
  TripBreakEvenLine,
  TripCalcInput,
  TripCalcResult,
  TripCapStatus,
  TripCategoryPriceInput,
  TripResolvedAllowances,
} from './tripcalc.types';
import { TRIP_DISCLAIMER_EN } from './tripcalc.disclaimer';

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Compute the travel cost per traveller and the per-category
 * break-even volumes, capped by the already-resolved allowance
 * dataset. Deterministic: same input, same result; every figure on the
 * result traces to an echoed input, the derived difference, or the
 * named allowance version.
 *
 * Validation precedence (documented, deterministic): travel facts, then
 * the allowance dataset, then the price rows — first violation wins.
 */
export function calculateTripBreakEven(input: TripCalcInput): TripCalcResult {
  validateTravelFacts(input);
  validateAllowances(input.allowances);
  const capByCategory = indexCapsByCategory(input.allowances.limits);
  const prices = validatePrices(input.prices);

  const travelCostCents = addCents(input.ticketCostCents, input.fuelCostCents);
  const travelCostPerTravellerCents = roundHalfUpDiv(travelCostCents, input.passengers);

  const lines = prices
    .slice()
    .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0))
    .map((price) =>
      computeLine(price, travelCostPerTravellerCents, capByCategory),
    );

  return {
    status: 'COMPUTED',
    travelDate: input.travelDate,
    vehicleType: input.vehicleType,
    passengers: input.passengers,
    ticketCostCents: input.ticketCostCents,
    fuelCostCents: input.fuelCostCents,
    travelCostCents,
    travelCostPerTravellerCents,
    allowanceDatasetVersion: input.allowances.dataset.versionLabel,
    lines,
    disclaimer: TRIP_DISCLAIMER_EN,
  };
}

// ---------------------------------------------------------------------------
// Travel-fact validation
// ---------------------------------------------------------------------------

function validateTravelFacts(input: TripCalcInput): void {
  // Shape-only check: the half-open effective-window resolution against
  // this date is the caller's concern (repository, task 5.1/5.3).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.travelDate)) {
    throw new InvalidTripInputError(
      'INVALID_TRAVEL_DATE',
      `travelDate "${input.travelDate}" is not an ISO YYYY-MM-DD calendar date`,
    );
  }
  // The type system narrows vehicleType, but the module is callable
  // from untyped JS — re-validate the closed set (defense in depth,
  // eventcalc's validateEventFacts precedent).
  if (!(TRIP_VEHICLE_TYPES as readonly string[]).includes(input.vehicleType)) {
    throw new InvalidTripInputError(
      'UNKNOWN_VEHICLE_TYPE',
      `"${String(input.vehicleType)}" is not one of: ${TRIP_VEHICLE_TYPES.join(', ')}`,
    );
  }
  if (!Number.isSafeInteger(input.passengers) || input.passengers < 1) {
    throw new InvalidTripInputError(
      'INVALID_PASSENGERS',
      `passengers must be a whole number of at least 1, got ${String(input.passengers)}`,
    );
  }
  if (!Number.isSafeInteger(input.ticketCostCents) || input.ticketCostCents < 0) {
    throw new InvalidTripInputError(
      'INVALID_TICKET_COST',
      `ticketCostCents must be a non-negative integer, got ${String(input.ticketCostCents)}`,
    );
  }
  if (!Number.isSafeInteger(input.fuelCostCents) || input.fuelCostCents < 0) {
    throw new InvalidTripInputError(
      'INVALID_FUEL_COST',
      `fuelCostCents must be a non-negative integer, got ${String(input.fuelCostCents)}`,
    );
  }
}

/** Exact integer addition with an overflow guard — cents never float. */
function addCents(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    throw new InvalidTripInputError(
      'TRAVEL_COST_OVERFLOW',
      `ticket + fuel (${String(a)} + ${String(b)} cents) exceeds the safe-integer range`,
    );
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Allowance-dataset validation
// ---------------------------------------------------------------------------

function validateAllowances(allowances: TripResolvedAllowances): void {
  if (
    typeof allowances.dataset.versionLabel !== 'string' ||
    allowances.dataset.versionLabel.trim() === ''
  ) {
    throw new InvalidTripInputError(
      'INVALID_ALLOWANCE_VERSION',
      'allowances.dataset.versionLabel is missing or blank — a capped result must name its dataset version',
    );
  }
  if (!Array.isArray(allowances.limits) || allowances.limits.length === 0) {
    // Deliberately an error, not a result state: a PUBLISHED allowance
    // version without limit rows is refused by the 5.1 publish gate, so
    // an empty list can only be a caller-contract violation (module docs).
    throw new InvalidTripInputError(
      'EMPTY_ALLOWANCE_LIMITS',
      'the resolved allowance dataset carries no limit rows',
    );
  }
}

/** Category → limit row, after per-row consistency validation. */
function indexCapsByCategory(
  limits: TripResolvedAllowances['limits'],
): Map<string, TripResolvedAllowances['limits'][number]> {
  const byCategory = new Map<string, TripResolvedAllowances['limits'][number]>();
  for (const limit of limits) {
    if (!(TRIP_CATEGORY_KEYS as readonly string[]).includes(limit.category)) {
      throw new InvalidTripInputError(
        'UNKNOWN_ALLOWANCE_CATEGORY',
        `allowance limit category "${String(limit.category)}" is not one of: ${TRIP_CATEGORY_KEYS.join(', ')}`,
      );
    }
    if (byCategory.has(limit.category)) {
      throw new InvalidTripInputError(
        'DUPLICATE_ALLOWANCE_CATEGORY',
        `allowance category "${limit.category}" appears in more than one resolved limit row`,
      );
    }
    if (limit.volumeCapLitres === null && limit.quantityCap === null) {
      throw new InvalidTripInputError(
        'INVALID_ALLOWANCE_CAPS',
        `allowance limit for "${limit.category}" carries neither a volume nor a quantity cap — a row that caps nothing is a curation error`,
      );
    }
    if (limit.volumeCapLitres !== null && (!Number.isFinite(limit.volumeCapLitres) || limit.volumeCapLitres <= 0)) {
      throw new InvalidTripInputError(
        'INVALID_ALLOWANCE_CAPS',
        `allowance volumeCapLitres for "${limit.category}" must be a positive finite number, got ${String(limit.volumeCapLitres)}`,
      );
    }
    if (limit.quantityCap !== null && (!Number.isSafeInteger(limit.quantityCap) || limit.quantityCap <= 0)) {
      throw new InvalidTripInputError(
        'INVALID_ALLOWANCE_CAPS',
        `allowance quantityCap for "${limit.category}" must be a positive whole number, got ${String(limit.quantityCap)}`,
      );
    }
    byCategory.set(limit.category, limit);
  }
  return byCategory;
}

// ---------------------------------------------------------------------------
// Price-row validation
// ---------------------------------------------------------------------------

function validatePrices(prices: readonly TripCategoryPriceInput[]): readonly TripCategoryPriceInput[] {
  if (!Array.isArray(prices) || prices.length === 0) {
    throw new InvalidTripInputError(
      'EMPTY_CATEGORY_LIST',
      'a trip calculation needs at least one category with prices',
    );
  }
  const seen = new Set<string>();
  for (const price of prices) {
    if (!(TRIP_CATEGORY_KEYS as readonly string[]).includes(price.category)) {
      throw new InvalidTripInputError(
        'UNKNOWN_CATEGORY',
        `"${String(price.category)}" is not one of: ${TRIP_CATEGORY_KEYS.join(', ')}`,
      );
    }
    if (seen.has(price.category)) {
      throw new InvalidTripInputError(
        'DUPLICATE_CATEGORY',
        `category "${price.category}" appears more than once in the price rows`,
      );
    }
    seen.add(price.category);
    if (!Number.isSafeInteger(price.domesticPriceCentsPerLitre) || price.domesticPriceCentsPerLitre < 0) {
      throw new InvalidTripInputError(
        'INVALID_PRICE',
        `domesticPriceCentsPerLitre for "${price.category}" must be a non-negative integer, got ${String(price.domesticPriceCentsPerLitre)}`,
      );
    }
    if (!Number.isSafeInteger(price.foreignPriceCentsPerLitre) || price.foreignPriceCentsPerLitre < 0) {
      throw new InvalidTripInputError(
        'INVALID_PRICE',
        `foreignPriceCentsPerLitre for "${price.category}" must be a non-negative integer, got ${String(price.foreignPriceCentsPerLitre)}`,
      );
    }
  }
  return prices;
}

// ---------------------------------------------------------------------------
// Line computation
// ---------------------------------------------------------------------------

function computeLine(
  price: TripCategoryPriceInput,
  travelCostPerTravellerCents: number,
  capByCategory: ReadonlyMap<string, TripResolvedAllowances['limits'][number]>,
): TripBreakEvenLine {
  const priceDifferenceCentsPerLitre =
    price.domesticPriceCentsPerLitre - price.foreignPriceCentsPerLitre;

  if (priceDifferenceCentsPerLitre <= 0) {
    // Foreign not below domestic: no break-even at any volume. Explicit
    // value state — no volume fields exist to misuse (module docs).
    return {
      status: 'NO_BREAK_EVEN',
      category: price.category,
      domesticPriceCentsPerLitre: price.domesticPriceCentsPerLitre,
      foreignPriceCentsPerLitre: price.foreignPriceCentsPerLitre,
      priceDifferenceCentsPerLitre,
    };
  }

  const breakEvenLitres = roundHalfUpDiv(
    travelCostPerTravellerCents,
    priceDifferenceCentsPerLitre,
  );

  // One cap lookup per line; the two no-cap states leave capLitres and
  // cappedBreakEvenLitres null rather than inventing a figure (module docs).
  const limit = capByCategory.get(price.category);
  let capStatus: TripCapStatus;
  let capLitres: number | null;
  let cappedBreakEvenLitres: number | null;
  if (!limit) {
    capStatus = 'NO_ALLOWANCE_ROW';
    capLitres = null;
    cappedBreakEvenLitres = null;
  } else if (limit.volumeCapLitres === null) {
    capStatus = 'CAP_NOT_VOLUME';
    capLitres = null;
    cappedBreakEvenLitres = null;
  } else if (breakEvenLitres > limit.volumeCapLitres) {
    // Strictly above the inclusive maximum: cap the suggested volume,
    // keep the uncapped figure visible beside it (spec scenario).
    capStatus = 'CAPPED';
    capLitres = limit.volumeCapLitres;
    cappedBreakEvenLitres = limit.volumeCapLitres;
  } else {
    capStatus = 'WITHIN_ALLOWANCE';
    capLitres = limit.volumeCapLitres;
    cappedBreakEvenLitres = breakEvenLitres;
  }

  return {
    status: 'BREAK_EVEN',
    category: price.category,
    domesticPriceCentsPerLitre: price.domesticPriceCentsPerLitre,
    foreignPriceCentsPerLitre: price.foreignPriceCentsPerLitre,
    priceDifferenceCentsPerLitre,
    breakEvenLitres,
    capLitres,
    capStatus,
    cappedBreakEvenLitres,
  };
}

// ---------------------------------------------------------------------------
// Exact half-up division — the single rounding rule (module docs)
// ---------------------------------------------------------------------------

/**
 * `halfUp(numerator / denominator)` for non-negative safe integers,
 * computed exactly in integer arithmetic: quotient by truncating
 * division, then round up iff twice the remainder reaches the
 * denominator. No float ceil/round anywhere — a `.5` boundary
 * (e.g. 3750 c ÷ 300 c/l = 12.5 l → 13 l) is decided by the exact
 * remainder comparison, so the result cannot float-drift.
 */
function roundHalfUpDiv(numerator: number, denominator: number): number {
  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator - quotient * denominator;
  return remainder * 2 >= denominator ? quotient + 1 : quotient;
}
