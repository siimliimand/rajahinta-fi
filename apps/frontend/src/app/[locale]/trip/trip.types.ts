/**
 * Trip feasibility DTOs — POST /api/v1/trip-feasibility.
 *
 * Mirrors the serialized contract of
 * `apps/api-worker/src/routes/trip-feasibility.routes.ts` (task 5.3):
 * the pure tripcalc module's result (eventcalc's value-state discipline —
 * NO_BREAK_EVEN and the cap states are 200 result values, not errors)
 * plus the SEPARATE `ferryOffers` partner block. The ferry block is
 * attached per request in the response envelope only; the calculation
 * body is independent of how many published offers exist (design R8),
 * so the UI renders the results section identically whether the block
 * is empty or populated.
 *
 * Kept in the trip scope (event.types.ts precedent): the page's edits
 * stay inside its declared touch set, and the mirror is re-declared
 * rather than imported from the worker.
 *
 * @module TripTypes
 */

/** Canonical allowance categories — core-domain TRIP_CATEGORY_KEYS. */
export type TripCategoryKey =
  | 'beer'
  | 'wine_still'
  | 'wine_sparkling'
  | 'intermediate_products'
  | 'other_fermented'
  | 'spirits';

/** The MVP vehicle set — core-domain TRIP_VEHICLE_TYPES. */
export type TripVehicleType = 'car' | 'van';

/** Request body — caps enforced client-side and re-validated server-side. */
export interface TripFeasibilityRequest {
  /** ISO `YYYY-MM-DD` calendar date; the MVP form sends today. */
  readonly travelDate: string;
  readonly vehicleType: TripVehicleType;
  /** Travellers sharing the trip's costs, integer 1–9. */
  readonly passengers: number;
  /** Total ticket cost in euro cents, positive integer. */
  readonly ticketCostCents: number;
  /** Total fuel cost in euro cents, positive integer. */
  readonly fuelCostCents: number;
  /** One row per considered category, 1–6, no duplicate categories. */
  readonly prices: readonly {
    readonly category: TripCategoryKey;
    readonly domesticPriceCentsPerLitre: number;
    readonly foreignPriceCentsPerLitre: number;
  }[];
}

/** Why a BREAK_EVEN line carries (or lacks) a capped volume. */
export type TripCapStatus =
  | 'WITHIN_ALLOWANCE'
  | 'CAPPED'
  | 'NO_ALLOWANCE_ROW'
  | 'CAP_NOT_VOLUME';

/** Shared per-line evidence — echoed prices and the derived difference. */
interface TripLineEvidence {
  readonly category: string;
  readonly domesticPriceCentsPerLitre: number;
  readonly foreignPriceCentsPerLitre: number;
  /** `domestic − foreign` in cents per litre; positive means importing saves. */
  readonly priceDifferenceCentsPerLitre: number;
}

/** A category where importing saves: break-even volume + capping. */
export interface TripBreakEvenVolumeLine extends TripLineEvidence {
  readonly status: 'BREAK_EVEN';
  /** Canonical break-even volume, whole litres. */
  readonly breakEvenLitres: number;
  /** Applicable volume cap; `null` under the two no-volume-cap states. */
  readonly capLitres: number | null;
  readonly capStatus: TripCapStatus;
  /** Suggested volume: uncapped figure, the cap, or `null` when no cap applies. */
  readonly cappedBreakEvenLitres: number | null;
}

/** A category where importing does not save (`priceDifference ≤ 0`). */
export interface TripNoBreakEvenLine extends TripLineEvidence {
  readonly status: 'NO_BREAK_EVEN';
}

export type TripBreakEvenLine = TripBreakEvenVolumeLine | TripNoBreakEvenLine;

/** Structural disclaimer shape ({@link DisclaimerPayload} in event.types.ts). */
export interface TripDisclaimerPayload {
  readonly text: string;
  readonly language: 'fi' | 'en';
  readonly version: string;
}

/** The pure module's result — COMPUTED is the only top-level state. */
export interface TripCalcResult {
  readonly status: 'COMPUTED';
  readonly travelDate: string;
  readonly vehicleType: TripVehicleType;
  readonly passengers: number;
  readonly ticketCostCents: number;
  readonly fuelCostCents: number;
  readonly travelCostCents: number;
  readonly travelCostPerTravellerCents: number;
  /** The resolved allowance dataset's versionLabel — R7 provenance. */
  readonly allowanceDatasetVersion: string;
  readonly lines: readonly TripBreakEvenLine[];
  /** Structural indicative-limits disclaimer — rendered as returned. */
  readonly disclaimer: TripDisclaimerPayload;
}

/**
 * One public ferry reference. The redirect path is the ONLY link the
 * API exposes — raw urls never cross the boundary, so the UI renders
 * links through `redirectPath` and nothing else.
 */
export interface TripFerryOfferRef {
  readonly id: number;
  readonly operator: string;
  readonly routeLabel: string;
  readonly redirectPath: string;
}

/** The 200 payload: the calculation result + the separate partner block. */
export type TripFeasibilityResponse = TripCalcResult & {
  readonly ferryOffers: readonly TripFerryOfferRef[];
};

// ---------------------------------------------------------------------------
// Allowance fill (task 8.3, change trust-and-reach-roadmap) — mirrors
// `apps/api-worker/src/routes/trip.routes.ts` (task 8.2), which in turn
// serializes the core-domain AllowanceFillResult (task 8.1). Re-declared,
// not imported, per the trip-scope rule above.
// ---------------------------------------------------------------------------

/** One candidate line the fill may draw from. */
export interface TripFillCandidateInput {
  /** Product master ID (positive integer). */
  readonly productId: number;
  /**
   * Maximum units available for this line — the fill decides how many of
   * them fit the allowance, up to this bound (the module's 1..99 window).
   */
  readonly maxQuantity: number;
}

/** Request body of POST /api/v1/trip/fill. */
export interface TripFillRequest {
  /** ISO `YYYY-MM-DD` calendar date; the page sends today (MVP form). */
  readonly travelDate: string;
  /** Candidate lines, 1–10, no duplicate productIds. */
  readonly items: readonly TripFillCandidateInput[];
}

/** Why a fill line carries the quantity it does. */
export type TripFillLineStatus =
  | 'FILLED'
  | 'CAP_EXHAUSTED'
  | 'NOT_SELECTED'
  | 'NO_ALLOWANCE_ROW';

/** Remaining allowance for one category at a point in the fill. */
export interface TripFillHeadroom {
  readonly category: string;
  readonly capLitres: number | null;
  readonly capUnits: number | null;
  readonly remainingLitres: number | null;
  readonly remainingUnits: number | null;
}

/** One candidate line's outcome, in input order. */
export interface TripFillLine {
  readonly productId: number;
  /** Resolved allowance category key (TripCategoryKey space). */
  readonly category: string;
  /** Merchant of the offer whose price the fill used. */
  readonly merchant: string;
  readonly unitPriceCents: number;
  readonly unitVolumeLitres: number;
  /** Echo of the input's candidate bound. */
  readonly maxQuantity: number;
  /** Units included in the fill (0 when not filled). */
  readonly filledQuantity: number;
  /** `filledQuantity × unitPriceCents`. */
  readonly valueContributionCents: number;
  /** `filledQuantity × unitVolumeLitres`. */
  readonly consumedVolumeLitres: number;
  readonly status: TripFillLineStatus;
  /** Category headroom after this line; null under NO_ALLOWANCE_ROW. */
  readonly headroomAfter: TripFillHeadroom | null;
}

/** Final state of the whole fill. */
export type TripFillStatus = 'FILLED' | 'BOUND_EXHAUSTED' | 'NO_BOUNDABLE_LINE';

/** Final headroom for one category after the fill. */
export interface TripFillCategoryHeadroom {
  readonly category: string;
  readonly capLitres: number | null;
  readonly capUnits: number | null;
  readonly usedLitres: number;
  readonly usedUnits: number;
  readonly remainingLitres: number | null;
  readonly remainingUnits: number | null;
}

/** The fill result — mirrors the basket optimize shape's invariants. */
export interface TripFillResult {
  readonly status: TripFillStatus;
  readonly travelDate: string;
  /** versionLabel of the dataset version the caps were resolved from. */
  readonly allowanceDatasetVersion: string;
  /** Total filled value in euro-cents — the maximized objective. */
  readonly filledValueCents: number;
  readonly filledUnits: number;
  readonly lines: readonly TripFillLine[];
  readonly categoryHeadroom: readonly TripFillCategoryHeadroom[];
  /** Structural indicative-limits disclaimer — rendered as returned. */
  readonly disclaimer: TripDisclaimerPayload;
}

/** The 200 payload: the fill result + the separate partner block. */
export type TripFillResponse = TripFillResult & {
  readonly ferryOffers: readonly TripFerryOfferRef[];
};
