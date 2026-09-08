/**
 * Allowance-fill types — input/output contracts for the optimizer's
 * allowance-fill objective (design D8, task 8.1): maximize filled value
 * subject to the traveller-allowance limit resolved for the travel date.
 *
 * ## Neutrality
 *
 * Mirrors the basket optimizer's neutrality rule: every figure is derived
 * from objective retail prices and published allowance caps — never from
 * commercial signals. Ferry offers are deliberately absent: they are a
 * display-only concern of later tasks and never enter the fill computation.
 *
 * ## Result shape
 *
 * Mirrors the basket optimize response's explainability invariants: every
 * line carries its own value contribution and the category headroom after
 * its consumption, the top level carries the final per-category headroom,
 * and the resolved dataset `versionLabel` names the allowance version the
 * caps came from (every-number-explainable provenance, design D8).
 *
 * ## Honest states
 *
 * A traveller allowance too small for any candidate is a VALUE, not an
 * invented basket: `status: 'BOUND_EXHAUSTED'` with `filledValueCents: 0`.
 * A candidate whose category has no row in the resolved version is
 * excluded (`NO_ALLOWANCE_ROW`), never treated as unbounded — a version
 * resolves as a unit (5.1 discipline, tripcalc precedent). An empty fill
 * caused purely by data gaps is `'NO_BOUNDABLE_LINE'`, distinct from a
 * genuine bound exhaustion.
 *
 * ## Units
 *
 * Money is integer euro cents; volumes are litres (the unit the 5.1
 * `volumeCapLitres` caps are denominated in); quantities are whole units.
 * Volume arithmetic is carried in floating point but every fit decision
 * uses a tolerance and every reported litre figure is rounded to six
 * decimals, so binary drift (0.1 + 0.2) can never surface on a result or
 * flip a fit decision at the curated granularities (caps are whole litres,
 * unit volumes are centilitre-scale decimals).
 *
 * @module AllowanceFillTypes
 */

import type { Disclaimer } from '../calculator/calculator.types';

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

/**
 * Maximum number of candidate lines in a fill request — the basket input
 * cap, reused so one request shape cannot outgrow the other's envelope.
 */
export const MAX_FILL_ITEMS = 10;

/**
 * Maximum candidate quantity per line (units available to fill). The
 * per-line quantity range is the fill search's branching factor; without
 * this cap a request could unbound the search independently of the
 * allowance caps.
 */
export const MAX_FILL_QUANTITY = 99;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Why a fill request was rejected. */
export type AllowanceFillErrorReason =
  | 'INVALID_TRAVEL_DATE'
  | 'TOO_MANY_ITEMS'
  | 'INVALID_QUANTITY'
  | 'PRODUCT_NOT_FOUND'
  | 'NO_OFFERS'
  | 'INVALID_PRODUCT_DATA'
  | 'NO_ALLOWANCE_DATASET'
  | 'INVALID_ALLOWANCE_DATASET'
  | 'SEARCH_BUDGET_EXCEEDED';

/**
 * Structurally invalid fill input or unfillable request: a non-ISO travel
 * date, a line count over {@link MAX_FILL_ITEMS}, a quantity outside
 * `1..MAX_FILL_QUANTITY`, an unknown product, a product without retail
 * offers, product data that cannot bound a fill (non-positive volume,
 * non-integer price), no PUBLISHED allowance dataset covering the travel
 * date, a malformed resolved dataset (blank version label, no limit rows,
 * unknown/duplicate categories, caps that are both null or non-positive),
 * or a search whose explored-node budget was exhausted without proving
 * optimality. Values are never clamped or silently substituted.
 */
export class AllowanceFillError extends Error {
  readonly reason: AllowanceFillErrorReason;

  constructor(reason: AllowanceFillErrorReason, detail: string) {
    super(`allowance fill failed (${reason}): ${detail}`);
    this.name = 'AllowanceFillError';
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** One candidate line the fill may draw from. */
export interface AllowanceFillItem {
  /** Product master ID (positive integer). */
  readonly productId: number;
  /**
   * Maximum units available for this line — the fill decides how many of
   * them fit the allowance, up to this bound. Distinct from the basket's
   * fixed `quantity`: the fill's quantity is a search variable.
   */
  readonly maxQuantity: number;
}

/** Input to the allowance-fill optimization. */
export interface AllowanceFillInput {
  /** Candidate lines (max {@link MAX_FILL_ITEMS}). */
  readonly items: readonly AllowanceFillItem[];
  /**
   * Calendar date of travel, ISO `YYYY-MM-DD`. The allowance version is
   * resolved FROM this date (half-open effective window) by the
   * traveller-allowance port — the fill never sees or guesses versions.
   */
  readonly travelDate: string;
  /** Optional session identifier for audit-trail grouping. */
  readonly sessionId?: string;
}

// ---------------------------------------------------------------------------
// Result — per-line
// ---------------------------------------------------------------------------

/** Why a line carries the fill quantity it does. */
export type AllowanceFillLineStatus =
  /** At least one unit of the line is part of the filled value. */
  | 'FILLED'
  /**
   * The line was boundable but even one unit no longer fits the winning
   * solution's final category headroom.
   */
  | 'CAP_EXHAUSTED'
  /**
   * The line could still fit physically, but the value-maximal solution
   * left it out (its units were worth less than the alternatives that
   * consumed the cap).
   */
  | 'NOT_SELECTED'
  /**
   * The resolved dataset version has no limit row for the line's
   * allowance category — the line is excluded, never filled unbounded
   * (a version resolves as a unit; 5.1 / tripcalc discipline).
   */
  | 'NO_ALLOWANCE_ROW';

/** Remaining allowance for one category at a point in the fill. */
export interface AllowanceFillHeadroom {
  readonly category: string;
  /** Volume cap in litres, or null when the row is quantity-only. */
  readonly capLitres: number | null;
  /** Quantity cap in units, or null when the row is volume-only. */
  readonly capUnits: number | null;
  /** Remaining litres under the volume cap; null when volume is uncapped. */
  readonly remainingLitres: number | null;
  /** Remaining units under the quantity cap; null when units are uncapped. */
  readonly remainingUnits: number | null;
}

/** One candidate line's outcome in the fill result, in input order. */
export interface AllowanceFillLine {
  readonly productId: number;
  /** Resolved allowance category key (the excise engine's normalisation). */
  readonly category: string;
  /** Merchant of the offer whose price the fill used (cheapest, deterministic). */
  readonly merchant: string;
  /** Unit price in euro-cents of the offer used for the value objective. */
  readonly unitPriceCents: number;
  /** Per-unit volume in litres (the cap-consumption figure). */
  readonly unitVolumeLitres: number;
  /** Echo of the input's candidate bound. */
  readonly maxQuantity: number;
  /** Units included in the fill (0 when not filled). */
  readonly filledQuantity: number;
  /** `filledQuantity × unitPriceCents` — the line's contribution. */
  readonly valueContributionCents: number;
  /** `filledQuantity × unitVolumeLitres` — the line's cap consumption. */
  readonly consumedVolumeLitres: number;
  readonly status: AllowanceFillLineStatus;
  /**
   * Category headroom after this line's consumption, walking the lines in
   * input order; null under `NO_ALLOWANCE_ROW` (no cap to state headroom
   * against — never an invented cap).
   */
  readonly headroomAfter: AllowanceFillHeadroom | null;
}

// ---------------------------------------------------------------------------
// Result — top level
// ---------------------------------------------------------------------------

/** Final state of the whole fill. */
export type AllowanceFillStatus =
  /** At least one unit was filled. */
  | 'FILLED'
  /**
   * Boundable candidates exist but the allowance is too small for even
   * one unit of any of them — the explicit, honest empty result.
   */
  | 'BOUND_EXHAUSTED'
  /**
   * No candidate was boundable at all (every line's category is missing
   * from the resolved version) — a data gap, not a bound exhaustion.
   */
  | 'NO_BOUNDABLE_LINE';

/** Final headroom for one category after the fill. */
export interface AllowanceFillCategoryHeadroom {
  readonly category: string;
  readonly capLitres: number | null;
  readonly capUnits: number | null;
  /** Total litres consumed by the fill under this cap. */
  readonly usedLitres: number;
  /** Total units consumed by the fill under this cap. */
  readonly usedUnits: number;
  readonly remainingLitres: number | null;
  readonly remainingUnits: number | null;
}

/** The allowance-fill result — mirrors the basket optimize shape's invariants. */
export interface AllowanceFillResult {
  readonly status: AllowanceFillStatus;
  /** Echo of the input travel date. */
  readonly travelDate: string;
  /**
   * `versionLabel` of the allowance dataset version the caps were resolved
   * from — dataset-version provenance (design D8).
   */
  readonly allowanceDatasetVersion: string;
  /** Total filled value in euro-cents — the maximized objective. */
  readonly filledValueCents: number;
  /** Total units included in the fill. */
  readonly filledUnits: number;
  /** Per-line outcomes in input order. */
  readonly lines: readonly AllowanceFillLine[];
  /** Final per-category headroom, category ascending. */
  readonly categoryHeadroom: readonly AllowanceFillCategoryHeadroom[];
  /** The standing legal disclaimer — structural part of the result. */
  readonly disclaimer: Disclaimer;
  readonly metadata: {
    /** Echo of the input that produced this result. */
    readonly input: {
      readonly items: readonly AllowanceFillItem[];
      readonly travelDate: string;
      readonly sessionId?: string;
    };
    /** ISO 8601 timestamp of the calculation. */
    readonly calculationTimestamp: string;
  };
}
