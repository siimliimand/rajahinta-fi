/**
 * Event calculator V2 cross-border sourcing types (task 4.5, design R6).
 *
 * The module is pure: these are its OWN contracts, shaped so the API
 * route can map the landed-cost engines' outputs straight in — per
 * source the route resolves, via `LandedCostCalculatorService`-composed
 * engines (`AlcoholExciseService`, `ContainerDutyService`,
 * `ConfidenceFrameworkService`), the same figures
 * `ComputedItemCostsResult` carries: retail basis, excise, container
 * duty, transport, per-component reliability statuses, dataset versions,
 * and overall confidence. This module never imports NestJS, services,
 * or repositories — see the module discipline in eventcalc.types.ts.
 *
 * COUNTRY ORDER (determinism contract, spec "Deterministic plan
 * ordering"): {@link SOURCING_COUNTRY_ORDER} is the DOCUMENTED FIXED
 * sequence that breaks total-cost ties. It is a declared constant, never
 * map iteration order, never request order — two requests whose
 * candidates arrive in different orders must produce identical plans.
 * `'FI'` (the domestic store) sits FIRST: a foreign source that merely
 * ties the domestic total never wins, because travelling is effort even
 * when it is not more expensive.
 *
 * BUDGET (documented semantics — never silent truncation): the budget
 * NEVER changes the assignment. Each line is independent and already
 * assigned to its cheapest source, so dropping or swapping lines could
 * only raise the total or hide need. When the requested budget is
 * exceeded, the complete plan is returned with an explicit
 * {@link BudgetCheck} block (`met: false`, exact overrun) — the
 * degradation is a value the UI must render, not a truncated list.
 *
 * @module EventSourcingTypes
 */

import type { EventDrinkType, EventShoppingList } from './eventcalc.types';

// ---------------------------------------------------------------------------
// Canonical country order — the documented tie-break sequence
// ---------------------------------------------------------------------------

/**
 * Sourcing countries in their FIXED comparison order: the domestic store
 * first, then the cross-border candidates the platform targets (design:
 * "what is worth buying in Estonia or Latvia versus ordering from
 * Germany"). Every sourcing country code — domestic or candidate — must
 * be a member; anything else is a caller-contract violation
 * ({@link SourcingInputErrorReason.UNKNOWN_COUNTRY}), because a tie-break
 * over an open-ended country set could not be deterministic.
 */
export const SOURCING_COUNTRY_ORDER = ['FI', 'EE', 'LV', 'LT', 'SE', 'DE'] as const;

export type SourcingCountry = (typeof SOURCING_COUNTRY_ORDER)[number];

/** Position of a country in the fixed tie-break sequence (lower wins ties). */
export function sourcingCountryRank(country: string): number {
  const index = (SOURCING_COUNTRY_ORDER as readonly string[]).indexOf(country);
  // Validation guarantees membership before any ranking happens.
  return index;
}

// ---------------------------------------------------------------------------
// Inputs — per-source resolved cost figures (mapped from the engines)
// ---------------------------------------------------------------------------

/**
 * One source's resolved landed-cost figures for ONE drink-type line, in
 * euro-cents — exactly the components the landed-cost engines produce
 * (`ComputedItemCostsResult` + the transport line the caller adds, the
 * single-item calculator's assembly order). Every figure must be a
 * non-negative safe integer; component totals are summed by this module
 * into the option total, so the plan's arithmetic stays traceable
 * component by component (guardrail: every number is explainable).
 *
 * Reliability statuses use the platform's canonical
 * `ReliabilityStatus` vocabulary; `confidenceOverall` the confidence
 * framework's `ConfidenceLevel` — both type-only imports from
 * core-domain siblings (optimizer precedent), so purity is preserved.
 */
export interface SourcingCostOption {
  /** ISO country of the store — member of {@link SOURCING_COUNTRY_ORDER}. */
  readonly country: string;
  /** Retail basis for the WHOLE line volume at this source (cents). */
  readonly retailCents: number;
  /** Excise on the imported volume (cents; 0 for the domestic store — its retail price is tax-inclusive). */
  readonly exciseCents: number;
  /** Container duty (cents; 0 for the domestic store — deposit is in the shelf price). */
  readonly containerDutyCents: number;
  /** Transport to Finland (cents; 0 while unresolvable — see the route's documented transport decision). */
  readonly transportCents: number;
  /** Per-component reliability statuses, echoed onto the plan line verbatim. */
  readonly statuses: {
    readonly retail: 'VERIFIED' | 'ESTIMATED' | 'STALE' | 'UNAVAILABLE';
    readonly excise: 'VERIFIED' | 'ESTIMATED' | 'STALE' | 'UNAVAILABLE';
    readonly containerDuty: 'VERIFIED' | 'ESTIMATED' | 'STALE' | 'UNAVAILABLE';
    readonly transport: 'VERIFIED' | 'ESTIMATED' | 'STALE' | 'UNAVAILABLE';
  };
  /** Confidence framework verdict over this option's components. */
  readonly confidenceOverall: 'HIGH' | 'MEDIUM' | 'LOW';
  /**
    * Dataset versions that produced this option's figures (excise/duty
    * tax dataset versions, FX where applicable) — echoed onto the plan
    * line so every total names its datasets (guardrail).
    */
  readonly datasetVersions: readonly string[];
}

/** Options per priced drink-type line, resolved by the caller (API route). */
export type SourcingOptionsByDrinkType = ReadonlyMap<
  EventDrinkType,
  readonly SourcingCostOption[]
>;

/** V2 sourcing input: the MVP shopping list plus per-line resolved options. */
export interface EventSourcingInput {
  /** The COMPUTED shopping list the plan prices — the module never recomputes consumption. */
  readonly plan: EventShoppingList;
  /**
   * Per priced drink type, one option per source, each containing
   * EXACTLY one `'FI'` (domestic) entry with distinct countries. Lines
   * of `plan` without an entry are reported as explicitly UNPRICED
   * ({@link EventSourcingPlan.unpricedDrinkTypes}) — a user-supplied
   * price basis can only compare the lines it actually prices.
   */
  readonly options: SourcingOptionsByDrinkType;
  /** Optional budget for the priced plan total, in euro-cents (positive integer). */
  readonly budgetCents?: number;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/** Why a line's plan assignment is what it is — provenance, not decoration. */
export type SourcingSourceKind = 'DOMESTIC' | 'FOREIGN';

/** One plan line: the winning source with its full figure provenance. */
export interface SourcingPlanLine {
  readonly drinkType: EventDrinkType;
  /** Winning source's country (`'FI'` when domestic). */
  readonly sourceCountry: string;
  readonly sourceKind: SourcingSourceKind;
  /** Winning option's total: retail + excise + container duty + transport (cents). */
  readonly totalCents: number;
  /** Winning option's components — the exact inputs that produced {@link totalCents}. */
  readonly components: {
    readonly retailCents: number;
    readonly exciseCents: number;
    readonly containerDutyCents: number;
    readonly transportCents: number;
  };
  /** Winning option's per-component reliability statuses, verbatim. */
  readonly statuses: SourcingCostOption['statuses'];
  readonly confidenceOverall: SourcingCostOption['confidenceOverall'];
  /** Dataset versions behind the winning option's figures (guardrail: every number names its datasets). */
  readonly datasetVersions: readonly string[];
  /** The domestic option's total — the comparison the plan made visible (spec: figures shown). */
  readonly domesticTotalCents: number;
  /** `domesticTotalCents − totalCents` — positive when sourcing abroad saves money. */
  readonly savingsVsDomesticCents: number;
}

/** Explicit budget state — present exactly when a budget was requested. */
export interface BudgetCheck {
  readonly limitCents: number;
  /** Priced plan total compared against the limit. */
  readonly totalCents: number;
  /** False ⇒ the plan degraded explicitly: complete, flagged, never truncated. */
  readonly met: boolean;
  /** `max(0, totalCents − limitCents)` — 0 when met. */
  readonly overrunCents: number;
}

/**
 * The complete sourcing plan. Lines keep the shopping list's drinkType
 * ascending order (backward-compatible rendering next to the MVP list);
 * within a line the ASSIGNMENT tie-break is total, then
 * {@link SOURCING_COUNTRY_ORDER}.
 */
export interface EventSourcingPlan {
  /** Priced lines only, drinkType ascending — the same order as the shopping list. */
  readonly lines: readonly SourcingPlanLine[];
  /** Plan lines with no options — explicitly unpriced, never silently dropped. */
  readonly unpricedDrinkTypes: readonly EventDrinkType[];
  /** Σ priced line totals (cents); unpriced lines contribute nothing. */
  readonly totalCents: number;
  /** Present exactly when `budgetCents` was requested. */
  readonly budget: BudgetCheck | null;
}

// ---------------------------------------------------------------------------
// Errors — caller-contract violations only (API validation should make
// these unreachable; the module is callable with any shape)
// ---------------------------------------------------------------------------

/** Why a sourcing input was rejected. */
export type SourcingInputErrorReason =
  | 'UNKNOWN_COUNTRY'
  | 'DUPLICATE_COUNTRY_OPTION'
  | 'MISSING_DOMESTIC_OPTION'
  | 'UNPRICED_LINE'
  | 'LINE_NOT_IN_PLAN'
  | 'INVALID_COST_FIGURE'
  | 'INVALID_BUDGET';

/**
 * Structurally invalid sourcing input. Values are never clamped,
 * defaulted, or silently reordered into validity — the assignment's
 * determinism depends on the inputs being exactly what they claim.
 */
export class SourcingInputError extends Error {
  readonly reason: SourcingInputErrorReason;

  constructor(reason: SourcingInputErrorReason, detail: string) {
    super(`invalid event sourcing input (${reason}): ${detail}`);
    this.name = 'SourcingInputError';
    this.reason = reason;
  }
}
