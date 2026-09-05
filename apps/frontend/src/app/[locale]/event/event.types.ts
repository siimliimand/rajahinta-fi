/**
 * Event calculator DTOs — POST /api/v1/event-calc.
 *
 * Mirrors the serialized contract of `apps/api-worker/src/routes/event-calc.routes.ts`
 * (tasks 4.3 + 4.5): a discriminated union where NO_PUBLISHED_NORMS is an explicit
 * result value (200), not an error, and every result carries the structural
 * norms-are-estimates disclaimer. The optional `sourcing` request section switches
 * the computed response over to shopping list + V2 sourcing `plan` (buy here vs
 * bring from a candidate country) and, when opted in and flag-gated on, a
 * `packing` section. Requests without `sourcing` keep the byte-compatible MVP shape.
 *
 * Kept in the event scope rather than `@/lib/types` so task 4.4's edits stay
 * inside its declared touch set; 4.5 (V2 sourcing) extends from here.
 *
 * @module EventTypes
 */

/** The MVP simple mode's closed profile set (core-domain EventProfile). */
export type EventProfile =
  | 'casual_gathering'
  | 'dinner_party'
  | 'celebration';

/** Canonical drink-type keys (core-domain EVENT_CALC_DRINK_TYPES). */
export type EventDrinkType =
  | 'beer'
  | 'wine_still'
  | 'wine_sparkling'
  | 'intermediate_products'
  | 'other_fermented'
  | 'spirits';

/** Candidate sourcing countries — the fixed comparison set minus the domestic store. */
export type SourcingCountry = 'EE' | 'LV' | 'LT' | 'SE' | 'DE';

/** Retail container the line will be bought in — duty packaging + packing material. */
export type SourcingContainer = 'can' | 'glass' | 'plastic' | 'other';

/** One priced drink-type line of the V2 sourcing request. */
export interface SourcingLineRequest {
  readonly drinkType: EventDrinkType;
  /** Typical ABV (%) of the drinks the line will be bought in. */
  readonly abvPercent: number;
  readonly container: SourcingContainer;
  /** User-supplied domestic retail basis, cents per litre. */
  readonly domesticPricePerLitreCents: number;
  /** Optional foreign retail bases, one per candidate country. */
  readonly foreign?: readonly {
    readonly country: SourcingCountry;
    readonly pricePerLitreCents: number;
  }[];
}

/** V2 sourcing request section — presence switches the response to plan mode. */
export interface SourcingRequest {
  /** Optional budget for the priced plan total, euro-cents. */
  readonly budgetCents?: number;
  /** Opt into packing recommendations over the foreign-sourced haul. */
  readonly packing?: boolean;
  readonly lines: readonly SourcingLineRequest[];
}

/** Request body — caps enforced client-side and re-validated server-side. */
export interface EventCalcRequest {
  /** Guests, integer 1–500. */
  readonly guests: number;
  /** Event duration in whole hours, integer 1–72. */
  readonly durationHours: number;
  readonly eventProfile: EventProfile;
  /** ISO `YYYY-MM-DD` calendar date; the simple mode sends today. */
  readonly eventDate: string;
  /** V2 cross-border sourcing — absent on MVP simple-mode requests. */
  readonly sourcing?: SourcingRequest;
}

/** One retail unit size with its backend-authored description. */
export interface PlannedUnit {
  /** Exact container size in millilitres (integer). */
  readonly sizeMl: number;
  /** `sizeMl / 1000` — derived display value. */
  readonly sizeLitres: number;
  /** Human-readable retail unit, e.g. `"0.5 l can"` (backend data). */
  readonly description: string;
  /** How many containers of this size to buy (integer ≥ 1). */
  readonly quantity: number;
}

/** One shopping-list line — need, suggested purchase, resulting surplus. */
export interface ShoppingListLine {
  readonly drinkType: string;
  /** Exact need in millilitres — the canonical integer. */
  readonly needMl: number;
  /** `needMl / 1000` — derived display value. */
  readonly needLitres: number;
  /** Per-size container quantities, ordered largest container first. */
  readonly plannedUnits: readonly PlannedUnit[];
  /** Total container count across `plannedUnits`. */
  readonly totalUnits: number;
  /** Exact purchased volume: Σ quantity × sizeMl (integer ml). */
  readonly purchasedMl: number;
  /** Exact surplus: `purchasedMl − needMl` (integer ml, ≥ 0). */
  readonly surplusMl: number;
  /** `surplusMl / 1000` — derived display value. */
  readonly surplusLitres: number;
  /** Norms version the line was computed from. */
  readonly versionLabel: string;
}

/** Shared echo of the event facts, present on every result state. */
interface EventCalcResultBase {
  readonly eventDate: string;
  readonly eventProfile: EventProfile;
  readonly guests: number;
  readonly durationHours: number;
}

/** A computed shopping list; every line names the norms version it used. */
export interface EventShoppingListResult extends EventCalcResultBase {
  readonly status: 'COMPUTED';
  /** The shared versionLabel of the resolved norms — provenance. */
  readonly normsVersion: string;
  readonly lines: readonly ShoppingListLine[];
  /** V2 sourcing plan — present exactly when the request carried `sourcing`. */
  readonly plan?: EventSourcingPlan;
  /** Packing section — present when opted in AND the packing flag is on. */
  readonly packing?: EventPackingSection;
}

// ---------------------------------------------------------------------------
// V2 sourcing plan + packing (task 4.5) — serialized shapes of the pure
// module and the packing module, as the route emits them
// ---------------------------------------------------------------------------

/** Per-component reliability statuses of one plan line. */
export interface SourcingLineStatuses {
  readonly retail: 'VERIFIED' | 'ESTIMATED' | 'STALE' | 'UNAVAILABLE';
  readonly excise: 'VERIFIED' | 'ESTIMATED' | 'STALE' | 'UNAVAILABLE';
  readonly containerDuty: 'VERIFIED' | 'ESTIMATED' | 'STALE' | 'UNAVAILABLE';
  readonly transport: 'VERIFIED' | 'ESTIMATED' | 'STALE' | 'UNAVAILABLE';
}

/** One plan line: the winning source with its full figure provenance. */
export interface SourcingPlanLine {
  readonly drinkType: EventDrinkType;
  readonly sourceCountry: string;
  readonly sourceKind: 'DOMESTIC' | 'FOREIGN';
  readonly totalCents: number;
  readonly components: {
    readonly retailCents: number;
    readonly exciseCents: number;
    readonly containerDutyCents: number;
    readonly transportCents: number;
  };
  readonly statuses: SourcingLineStatuses;
  readonly confidenceOverall: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly datasetVersions: readonly string[];
  readonly domesticTotalCents: number;
  readonly savingsVsDomesticCents: number;
}

/** Explicit budget state — present exactly when a budget was requested. */
export interface BudgetCheck {
  readonly limitCents: number;
  readonly totalCents: number;
  readonly met: boolean;
  readonly overrunCents: number;
}

/** The complete sourcing plan (priced lines drinkType-ascending). */
export interface EventSourcingPlan {
  readonly lines: readonly SourcingPlanLine[];
  /** Plan lines with no price basis — explicitly unpriced, never dropped. */
  readonly unpricedDrinkTypes: readonly EventDrinkType[];
  readonly totalCents: number;
  readonly budget: BudgetCheck | null;
}

/** One excluded packing line, keyed to the plan via the synthetic productId. */
export interface EventPackingExclusion {
  readonly productId: number;
  readonly quantity: number;
  readonly reason: string;
}

/** The packing module's suggestion over the foreign haul. */
export interface EventPackingSuggestion {
  readonly status: 'COMPUTED' | 'ESTIMATED';
  readonly boxes: readonly {
    readonly boxTypeId: number;
    readonly carrier: string;
    readonly boxName: string;
    readonly items: readonly { readonly productId: number; readonly units: number }[];
    readonly totalWeightG: number;
    readonly fillRate: number;
  }[];
  readonly excludedItems: readonly EventPackingExclusion[];
  readonly mixingWarning: {
    readonly glassUnits: number;
    readonly canUnits: number;
    readonly glassWeightG: number;
    readonly canWeightG: number;
    readonly combinedWeightG: number;
    readonly triggeredBy: readonly string[];
  } | null;
}

/** Packing section: suggestion + the synthetic productId ↔ drink-type echo. */
export interface EventPackingSection {
  readonly suggestion: EventPackingSuggestion;
  readonly lines: readonly { readonly productId: number; readonly drinkType: string }[];
}

/** No PUBLISHED norms for the profile and date — a value, not an error. */
export interface NoPublishedNormsResult extends EventCalcResultBase {
  readonly status: 'NO_PUBLISHED_NORMS';
}

/** Every response carries the structural disclaimer alongside the result. */
interface DisclaimerField {
  readonly disclaimer: DisclaimerPayload;
}

/**
 * The 200 response: the discriminated module result plus the structural
 * disclaimer, which is rendered as returned — never substituted with a
 * UI-only string. Narrow on `status`: COMPUTED carries the shopping list,
 * NO_PUBLISHED_NORMS is an explicit empty state, not an error.
 */
export type EventCalcResponse = DisclaimerField &
  (EventShoppingListResult | NoPublishedNormsResult);

/**
 * Structural disclaimer shape ({ text, language, version }) — structurally
 * identical to `Disclaimer` in `@/lib/types`, re-declared to keep this
 * scope self-contained.
 */
export interface DisclaimerPayload {
  readonly text: string;
  readonly language: 'fi' | 'en';
  readonly version: string;
}
