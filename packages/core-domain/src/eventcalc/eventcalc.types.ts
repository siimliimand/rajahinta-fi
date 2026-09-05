/**
 * Event calculator types — inputs and outputs of the norms-based
 * consumption computation and minimal-surplus shopping list
 * (spec: event-calculator, design R5/R6).
 *
 * The module is pure: these types are its OWN contracts, deliberately
 * shaped to be structurally compatible with the D1 norms rows resolved
 * by `ConsumptionNormsRepository.findPublishedEffectiveOn` (task 4.1)
 * so the API layer can map records straight in — without this module
 * importing any database, repository, or I/O code. Only the three
 * fields the arithmetic and provenance need are declared
 * (`drinkType`, `normValuePerGuestPerHour`, `versionLabel`); extra
 * record fields (citation, status, windows) are ignored by structure.
 *
 * @module EventCalcTypes
 */

// ---------------------------------------------------------------------------
// Canonical vocabulary — mirrors the tax-rule category keys and the MVP
// simple mode's closed profile set (task 4.1 repository/seed values).
// Declared here, not imported: purity forbids a data-platform import.
// ---------------------------------------------------------------------------

/**
 * Drink types — the canonical tax-rule category keys, so the event
 * calculator's per-type lines feed the landed-cost/tax engines without
 * a translation layer. Value set mirrors
 * `CONSUMPTION_NORM_DRINK_TYPES` in the data-platform repository.
 */
export const EVENT_CALC_DRINK_TYPES = [
  'beer',
  'wine_still',
  'wine_sparkling',
  'intermediate_products',
  'other_fermented',
  'spirits',
] as const;

export type EventDrinkType = (typeof EVENT_CALC_DRINK_TYPES)[number];

/** Event profiles — the MVP simple mode's closed set. */
export const EVENT_CALC_EVENT_PROFILES = [
  'casual_gathering',
  'dinner_party',
  'celebration',
] as const;

export type EventProfile = (typeof EVENT_CALC_EVENT_PROFILES)[number];

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * One resolved consumption norm — the narrow row shape the calculator
 * accepts. `drinkType` is typed `string` on purpose: norms arrive from
 * persistence as untyped varchar columns, and an unknown value is a
 * runtime data problem reported via {@link InconsistentNormsError},
 * not something the type system can see past a repository boundary.
 */
export interface EventNormRow {
  readonly drinkType: string;
  /** Litres of finished beverage per guest per hour (see granularity rule in eventcalc.ts). */
  readonly normValuePerGuestPerHour: number;
  /** Norms version identifier this row belongs to — named by the result as provenance. */
  readonly versionLabel: string;
}

/** Event calculator input — event facts plus the ALREADY-RESOLVED norms. */
export interface EventCalcInput {
  /**
   * Calendar date of the event, ISO `YYYY-MM-DD`. Shape-validated only:
   * resolving the PUBLISHED norms effective on this date (half-open
   * window) is the caller's concern (task 4.3 / repository).
   */
  readonly eventDate: string;
  readonly eventProfile: EventProfile;
  /** Guest count (integer ≥ 0). */
  readonly guests: number;
  /** Event duration in WHOLE hours (integer ≥ 0 — see exactness rule in eventcalc.ts). */
  readonly durationHours: number;
  /**
   * PUBLISHED norms effective on `eventDate`, one row per drink type —
   * the repository's `findPublishedEffectiveOn` output mapped in.
   */
  readonly norms: readonly EventNormRow[];
}

// ---------------------------------------------------------------------------
// Intermediate step output (task 4.5's V2 sourcing extends from here)
// ---------------------------------------------------------------------------

/** Per-drink-type expected consumption, before retail rounding. */
export interface EventConsumptionLine {
  readonly drinkType: EventDrinkType;
  /** Exact need in millilitres — the canonical integer (see exactness rule). */
  readonly needMl: number;
  /** `needMl / 1000` — derived display value; `needMl` is canonical. */
  readonly needLitres: number;
  /** Norms version the line was computed from. */
  readonly versionLabel: string;
}

// ---------------------------------------------------------------------------
// Shopping list
// ---------------------------------------------------------------------------

/** One retail unit size with its presentation description. */
export interface PlannedUnit {
  /** Exact container size in millilitres (integer). */
  readonly sizeMl: number;
  /** `sizeMl / 1000` — derived display value. */
  readonly sizeLitres: number;
  /** Human-readable retail unit, e.g. `"0.5 l can"`. */
  readonly description: string;
  /** How many containers of this size to buy (integer ≥ 1). */
  readonly quantity: number;
}

/** One shopping-list line — need, suggested purchase, resulting surplus. */
export interface ShoppingListLine {
  readonly drinkType: EventDrinkType;
  /** Exact need in millilitres — the canonical integer. */
  readonly needMl: number;
  /** `needMl / 1000` — derived display value. */
  readonly needLitres: number;
  /**
   * Suggested purchase as per-size container quantities, ordered by
   * size DESCENDING (largest container first). Empty exactly when
   * `needMl` is 0 — buying nothing is then the exact minimal-surplus
   * plan.
   */
  readonly plannedUnits: readonly PlannedUnit[];
  /** Total container count across {@link plannedUnits}. */
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

// ---------------------------------------------------------------------------
// Result — a discriminated union so expected operational states are
// values, not exceptions (unitprice 'unavailable' precedent)
// ---------------------------------------------------------------------------

/** Why a result carries no shopping list. */
export type EventCalcStatus = 'COMPUTED' | 'NO_PUBLISHED_NORMS';

/**
 * A computed shopping list. `normsVersion` names the norms version every
 * line was computed from — every output names the dataset it used
 * (design R5). Lines are ordered by drinkType ascending, matching the
 * repository's resolution ordering and independent of input row order.
 */
export interface EventShoppingList {
  readonly status: 'COMPUTED';
  readonly eventDate: string;
  readonly eventProfile: EventProfile;
  readonly guests: number;
  readonly durationHours: number;
  /** The shared `versionLabel` of the resolved norms — R5 provenance. */
  readonly normsVersion: string;
  readonly lines: readonly ShoppingListLine[];
}

/**
 * Explicit empty-result state when no PUBLISHED norms exist for the
 * profile and date — an expected operational state (nothing published
 * yet), reported as a value rather than thrown (documented decision).
 */
export interface NoPublishedNormsResult {
  readonly status: 'NO_PUBLISHED_NORMS';
  readonly eventDate: string;
  readonly eventProfile: EventProfile;
  readonly guests: number;
  readonly durationHours: number;
}

export type EventCalcResult = EventShoppingList | NoPublishedNormsResult;

// ---------------------------------------------------------------------------
// Errors — caller-contract violations only. Expected data states (no
// published norms) are result values above, never these.
// ---------------------------------------------------------------------------

/**
 * Structurally invalid event input: negative/fractional/non-finite
 * guests or duration, a duration that is not a whole number of hours,
 * a non-ISO event date, or a request whose exact-integer product would
 * exceed the safe-integer range. A validating API layer (task 4.3)
 * should prevent these from ever reaching the module.
 */
export class InvalidEventInputError extends Error {
  constructor(detail: string) {
    super(`invalid event calculator input: ${detail}`);
    this.name = 'InvalidEventInputError';
  }
}

/** Why a norms row was rejected as inconsistent. */
export type InconsistentNormsReason =
  /** The same drinkType appears in more than one row. */
  | 'DUPLICATE_DRINK_TYPE'
  /** drinkType is not in the canonical tax-category key set. */
  | 'UNKNOWN_DRINK_TYPE'
  /** eventProfile is not in the MVP simple mode's closed set. */
  | 'UNKNOWN_EVENT_PROFILE'
  /** normValuePerGuestPerHour is not a finite, positive, whole-millilitre value. */
  | 'INVALID_NORM_VALUE'
  /** versionLabel is missing or blank. */
  | 'MISSING_VERSION_LABEL';

/**
 * A norms row (or profile) failed consistency validation. Values are
 * never silently clamped, rounded, or ignored — an inconsistent
 * reference dataset must be visible, not absorbed.
 */
export class InconsistentNormsError extends Error {
  readonly reason: InconsistentNormsReason;

  constructor(reason: InconsistentNormsReason, detail: string) {
    super(`inconsistent consumption norms (${reason}): ${detail}`);
    this.name = 'InconsistentNormsError';
    this.reason = reason;
  }
}

/**
 * The resolved norms rows span more than one `versionLabel`. The
 * repository's per-date resolution (newest effectiveFrom per drink
 * type) guarantees one coherent version; a mixed set means the caller
 * broke that invariant, so the request is rejected outright — no
 * version is silently preferred (documented decision).
 */
export class MixedNormVersionsError extends Error {
  constructor(labels: readonly string[]) {
    super(
      `resolved consumption norms span multiple versions — ` +
        `expected one, got: ${[...new Set(labels)].join(', ')}`,
    );
    this.name = 'MixedNormVersionsError';
  }
}
