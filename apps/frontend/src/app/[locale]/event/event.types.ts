/**
 * Event calculator DTOs — POST /api/v1/event-calc.
 *
 * Mirrors the serialized contract of `apps/api-worker/src/routes/event-calc.routes.ts`
 * (task 4.3): a discriminated union where NO_PUBLISHED_NORMS is an explicit
 * result value (200), not an error, and every result carries the structural
 * norms-are-estimates disclaimer.
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

/** Request body — caps enforced client-side and re-validated server-side. */
export interface EventCalcRequest {
  /** Guests, integer 1–500. */
  readonly guests: number;
  /** Event duration in whole hours, integer 1–72. */
  readonly durationHours: number;
  readonly eventProfile: EventProfile;
  /** ISO `YYYY-MM-DD` calendar date; the simple mode sends today. */
  readonly eventDate: string;
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
