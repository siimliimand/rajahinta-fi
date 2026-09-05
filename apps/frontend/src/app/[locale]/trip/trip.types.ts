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
