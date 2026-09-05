/**
 * Packing module types — inputs and outputs of the deterministic
 * box-suggestion engine (spec: packing-optimization).
 *
 * The module is pure: these types are its OWN contracts, deliberately
 * shaped to be structurally compatible with the curated D1 tables from
 * task 3.1 (`product_dimensions`, `carrier_box_types`) so a repository
 * layer can map rows straight in — without this module importing any
 * database, repository, or I/O code. Provenance columns (`source`,
 * `observedAt`, `reliabilityStatus`) are intentionally absent: packing
 * math does not read them.
 *
 * @module PackingTypes
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * Packaging material of one packed unit — mirrors the
 * `product_dimensions.material` CHECK set. `'CAN'` is the metal side of
 * the glass+metal mixing warning; `'GLASS'` the glass side.
 */
export type PackingMaterial = 'GLASS' | 'CAN' | 'PLASTIC' | 'OTHER';

/**
 * One basket line item with its known physical dimensions.
 *
 * Dimensions are optional: a product without a `product_dimensions` row
 * has `null` for all three physical fields and is excluded from packing
 * with reason `'MISSING_DIMENSIONS'` (never estimated silently — spec:
 * missing-dimensions-degrade-explicitly). When dimensions are present
 * they must be the complete trio in millimetres/grams; a partially
 * populated line is treated as missing data.
 *
 * `material` may be `null` independently: such units pack normally but
 * count towards neither side of the mixing warning (an unknown material
 * is neither glass nor metal — nothing is substituted for it).
 */
export interface PackingItem {
  /** Stable product identifier (product_master.id). */
  readonly productId: number;
  /** How many physical units this line represents (integer ≥ 1). */
  readonly quantity: number;
  /** Measured packed-unit weight in grams, or `null` when unknown. */
  readonly weightG: number | null;
  /** Measured packed-unit height in millimetres, or `null` when unknown. */
  readonly heightMm: number | null;
  /** Measured packed-unit diameter in millimetres, or `null` when unknown. */
  readonly diameterMm: number | null;
  /** Packaging material, or `null` when unclassified. */
  readonly material: PackingMaterial | null;
}

/**
 * One carrier box type — the packing engine's only source of box shapes
 * and weight limits. Structurally the `carrier_box_types` row without
 * provenance columns, so a `CarrierBoxTypeRecord[]` from the repository
 * maps in unchanged.
 *
 * Internal dimensions are the USABLE space in millimetres; `maxWeightG`
 * the carrier's permitted shipment weight for the box in grams.
 */
export interface CarrierBoxType {
  /** Box catalogue identifier (carrier_box_types.id) — cited verbatim in the suggestion output. */
  readonly id: number;
  /** Carrier identifier (e.g. "postnord", "dhl"). */
  readonly carrier: string;
  /** Carrier's published box name (e.g. "PostNord Box M"). */
  readonly name: string;
  readonly internalHeightMm: number;
  readonly internalWidthMm: number;
  readonly internalDepthMm: number;
  readonly maxWeightG: number;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/**
 * Overall suggestion status.
 *
 * - `'COMPUTED'`:  every basket line was packed; nothing was dropped.
 * - `'ESTIMATED'`: at least one line was excluded (unknown or invalid
 *                  dimensions, invalid quantity, or nothing fits) — the
 *                  suggestion covers only the packable subset and is
 *                  explicitly incomplete.
 */
export type PackingStatus = 'COMPUTED' | 'ESTIMATED';

/** Why a basket line was excluded from the packing suggestion. */
export type PackingExclusionReason =
  /** One or more of weightG/heightMm/diameterMm is `null`/`undefined`. */
  | 'MISSING_DIMENSIONS'
  /** A dimension was supplied but is not a finite number > 0. */
  | 'INVALID_DIMENSIONS'
  /** Quantity is not an integer ≥ 1. */
  | 'INVALID_QUANTITY'
  /** The unit fits no available box type, even alone. */
  | 'NO_FITTING_BOX';

/** One excluded basket line, named exactly as the spec requires. */
export interface ExcludedPackingItem {
  readonly productId: number;
  /** The line's quantity as given — for `INVALID_QUANTITY` this is the raw rejected value (may be 0, negative, or fractional). */
  readonly quantity: number;
  readonly reason: PackingExclusionReason;
}

/** Per-product unit grouping inside one packed box, ordered by productId ascending. */
export interface PackedBoxGroup {
  readonly productId: number;
  /** How many units of the product are packed in this box. */
  readonly units: number;
}

/** One suggested box: its identity, contents, weight, and fill rate. */
export interface PackedBox {
  /** Box catalogue identifier — carried through from {@link CarrierBoxType.id}. */
  readonly boxTypeId: number;
  readonly carrier: string;
  readonly boxName: string;
  /** Contents grouped by product, productId ascending. */
  readonly items: readonly PackedBoxGroup[];
  /** Summed packed-unit weight in grams (exact integer arithmetic on the inputs). */
  readonly totalWeightG: number;
  /**
   * Estimated fullness: summed cylindrical unit volume divided by the
   * box's internal volume. A volumetric estimate only — see the module
   * documentation for the no-arrangement assumption.
   */
  readonly fillRate: number;
}

/**
 * Which mixing threshold fired. Fixed declaration order in the payload:
 * `'UNIT_COUNT'` before `'COMBINED_WEIGHT'`.
 */
export type MixingTrigger = 'UNIT_COUNT' | 'COMBINED_WEIGHT';

/**
 * Glass+metal mixing warning payload. Cites the observed figures — unit
 * counts and weights per material plus their combination — and every
 * threshold that fired. Computed over PACKED units only: excluded lines
 * are not part of the shipment and do not count.
 */
export interface MixingWarning {
  /** Packed glass units. */
  readonly glassUnits: number;
  /** Packed metal can units. */
  readonly canUnits: number;
  /** Summed packed glass weight in grams. */
  readonly glassWeightG: number;
  /** Summed packed can weight in grams. */
  readonly canWeightG: number;
  /** glassWeightG + canWeightG — the figure compared against the weight threshold. */
  readonly combinedWeightG: number;
  /** Every threshold that fired (non-empty when the warning exists). */
  readonly triggeredBy: readonly MixingTrigger[];
}

/**
 * The complete packing suggestion. Deterministic: identical inputs
 * produce an identical value — box selection, grouping, fill rates,
 * exclusions, and warning alike.
 */
export interface PackingSuggestion {
  readonly status: PackingStatus;
  /** Suggested boxes in the order the algorithm opened them. */
  readonly boxes: readonly PackedBox[];
  /** Basket lines that could not be packed, in basket input order. */
  readonly excludedItems: readonly ExcludedPackingItem[];
  /** Mixing warning, or `null` when packed contents stay within thresholds. */
  readonly mixingWarning: MixingWarning | null;
}
