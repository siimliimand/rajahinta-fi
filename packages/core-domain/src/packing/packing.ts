/**
 * Deterministic packing suggestion — first-fit-decreasing over carrier
 * box types (spec: packing-optimization, design R4).
 *
 * Pure functions only: no I/O, no clock, no randomness, no imports
 * beyond this module's own types and thresholds. The same inputs always
 * produce the identical suggestion — box selection, grouping, fill
 * rates, exclusions, and warning.
 *
 * Algorithm (first-fit-decreasing, FFD):
 *
 * 1. Basket lines are validated and expanded into physical units.
 *    Lines that cannot be packed are excluded whole — with the reason —
 *     never estimated (spec: missing-dimensions-degrade-explicitly).
 * 2. Units are sorted by DECREASING height, then DECREASING diameter;
 *    ties break by productId ascending, then basket expansion order —
 *    a total order, so the sort is fully deterministic.
 * 3. Each unit is placed into the FIRST already-open box that accepts
 *    it (open boxes in creation order); if none accepts it, a new box
 *    is opened with the SMALLEST sufficient box type for that unit.
 * 4. Box types are iterated smallest internal volume first (carrier,
 *    then name, then id as tiebreaks) — the same order the task 3.1
 *    repository lists them. The sort is applied here regardless of
 *    input order, so callers cannot perturb the choice by passing an
 *    unordered catalogue.
 *
 * ORIENTATION RULE (deliberate, documented simplification): beverage
 * units are upright cylinders. A unit fits a box when
 *
 *     heightMm   ≤ internalHeightMm
 *     diameterMm ≤ min(internalWidthMm, internalDepthMm)
 *
 * No rotation and no geometric arrangement are considered. Weight is
 * the second constraint: a box's summed unit weight never exceeds
 * `maxWeightG`. Consequence: the per-unit fit test ignores neighbouring
 * units, so `fillRate` — summed cylindrical unit volume over box
 * internal volume — is a volumetric ESTIMATE of fullness, not a proof
 * of geometric arrangement. It is reported unrounded and uncapped;
 * presentation concerns live elsewhere.
 *
 * Status is `'ESTIMATED'` whenever any line was excluded; `'COMPUTED'`
 * only when the suggestion covers the whole basket.
 *
 * @module Packing
 */

import type {
  CarrierBoxType,
  ExcludedPackingItem,
  MixingTrigger,
  MixingWarning,
  PackedBox,
  PackingExclusionReason,
  PackingItem,
  PackingMaterial,
  PackingSuggestion,
  PackingStatus,
} from './packing.types';
import {
  MIXED_MATERIAL_MAX_COMBINED_WEIGHT_G,
  MIXED_MATERIAL_MAX_UNITS,
} from './thresholds';

// ---------------------------------------------------------------------------
// Internal shapes
// ---------------------------------------------------------------------------

/** One physical unit — a basket line expanded by its quantity. */
interface PackingUnit {
  readonly productId: number;
  /** Basket-wide expansion index — the final sort tiebreak. */
  readonly ordinal: number;
  readonly weightG: number;
  readonly heightMm: number;
  readonly diameterMm: number;
  readonly material: PackingMaterial | null;
}

/** A box under construction: its type plus the units placed so far. */
interface OpenBox {
  readonly type: CarrierBoxType;
  readonly units: PackingUnit[];
  /** Running summed weight in grams. */
  weightG: number;
  /** Running summed cylindrical unit volume in mm³ (placement order). */
  itemVolumeMm3: number;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Suggest carrier boxes for a basket — the module's single entry point.
 *
 * @param items    Basket lines; order in the array is irrelevant to the
 *                 result except as the documented final tiebreak for
 *                 units that share height, diameter, and productId.
 * @param boxTypes Available box catalogue in any order; iterated
 *                 smallest internal volume first regardless.
 */
export function suggestPacking(
  items: readonly PackingItem[],
  boxTypes: readonly CarrierBoxType[],
): PackingSuggestion {
  // Smallest-first catalogue: R4's box-selection order, enforced here.
  const sortedBoxTypes = [...boxTypes].sort(compareBoxTypes);
  const excluded: ExcludedPackingItem[] = [];
  const units: PackingUnit[] = [];

  // Line validation and expansion. Every exclusion is a whole line:
  // units of one line are identical, so a line either packs or not.
  let ordinal = 0;
  for (const item of items) {
    const outcome = processLine(item, ordinal, sortedBoxTypes);
    if ('reason' in outcome) {
      excluded.push({ productId: item.productId, quantity: item.quantity, reason: outcome.reason });
    } else {
      units.push(...outcome.units);
      ordinal += outcome.units.length;
    }
  }

  // FFD: tallest first, then widest, then stable identifiers.
  units.sort(compareUnitsDecreasing);

  const openBoxes: OpenBox[] = [];
  for (const unit of units) {
    const openBox = openBoxes.find((box) => acceptsUnit(box, unit));
    if (openBox !== undefined) {
      place(openBox, unit);
      continue;
    }
    const boxType = sortedBoxTypes.find((type) => sufficientFor(type, unit.weightG, unit.heightMm, unit.diameterMm));
    // processLine guarantees a sufficient type exists for every unit.
    const opened: OpenBox = {
      type: boxType as CarrierBoxType,
      units: [],
      weightG: 0,
      itemVolumeMm3: 0,
    };
    place(opened, unit);
    openBoxes.push(opened);
  }

  const boxes = openBoxes.map(toPackedBox);

  return {
    status: packingStatus(excluded),
    boxes,
    excludedItems: excluded,
    mixingWarning: mixingWarning(openBoxes),
  };
}

// ---------------------------------------------------------------------------
// Line validation
// ---------------------------------------------------------------------------

/**
 * Validate one basket line and expand it into physical units, or report
 * why the whole line cannot be packed.
 *
 * Checks are ordered missing-data first (a known unknown is reported as
 * such, not as a bad value), mirroring the unit-price module's policy.
 * Units of one line are identical, so a line either packs entirely or
 * is excluded entirely — in particular, a unit that fits no box type
 * alone can never first-fit into an open box built from the same
 * catalogue, so the NO_FITTING_BOX decision is exact at line level.
 */
function processLine(
  item: PackingItem,
  firstOrdinal: number,
  sortedBoxTypes: readonly CarrierBoxType[],
): { readonly reason: PackingExclusionReason } | { readonly units: readonly PackingUnit[] } {
  const { quantity, weightG, heightMm, diameterMm } = item;
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { reason: 'INVALID_QUANTITY' };
  }
  if (
    weightG === null ||
    weightG === undefined ||
    heightMm === null ||
    heightMm === undefined ||
    diameterMm === null ||
    diameterMm === undefined
  ) {
    return { reason: 'MISSING_DIMENSIONS' };
  }
  if (!isPositiveFinite(weightG) || !isPositiveFinite(heightMm) || !isPositiveFinite(diameterMm)) {
    return { reason: 'INVALID_DIMENSIONS' };
  }
  const fitsSomewhere = sortedBoxTypes.some((type) =>
    sufficientFor(type, weightG, heightMm, diameterMm),
  );
  if (!fitsSomewhere) {
    return { reason: 'NO_FITTING_BOX' };
  }
  const units = Array.from({ length: quantity }, (_, i) => ({
    productId: item.productId,
    ordinal: firstOrdinal + i,
    weightG,
    heightMm,
    diameterMm,
    material: item.material,
  }));
  return { units };
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** `status` is ESTIMATED the moment any line is excluded — the suggestion is then incomplete. */
function packingStatus(excluded: readonly ExcludedPackingItem[]): PackingStatus {
  return excluded.length > 0 ? 'ESTIMATED' : 'COMPUTED';
}

// ---------------------------------------------------------------------------
// FFD mechanics
// ---------------------------------------------------------------------------

/**
 * Decreasing height, then decreasing diameter (spec wording: "sorted by
 * decreasing height then diameter"). Ties break by productId ascending,
 * then basket expansion order — a total order, so the same input array
 * always sorts identically.
 */
function compareUnitsDecreasing(a: PackingUnit, b: PackingUnit): number {
  if (a.heightMm !== b.heightMm) return b.heightMm - a.heightMm;
  if (a.diameterMm !== b.diameterMm) return b.diameterMm - a.diameterMm;
  if (a.productId !== b.productId) return a.productId - b.productId;
  return a.ordinal - b.ordinal;
}

/**
 * Box-catalogue order: smallest internal volume first, then carrier,
 * then name, then id — the exact ordering the task 3.1 repository
 * guarantees (`ORDER BY internal volume ASC, carrier ASC, name ASC`).
 * The id tiebreak keeps the pure function total even for an
 * unconstrained catalogue.
 */
function compareBoxTypes(a: CarrierBoxType, b: CarrierBoxType): number {
  const volumeA = boxVolumeMm3(a);
  const volumeB = boxVolumeMm3(b);
  if (volumeA !== volumeB) return volumeA - volumeB;
  if (a.carrier !== b.carrier) return a.carrier < b.carrier ? -1 : 1;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id - b.id;
}

function boxVolumeMm3(box: CarrierBoxType): number {
  return box.internalHeightMm * box.internalWidthMm * box.internalDepthMm;
}

/** Orientation rule: upright cylinder into the rectangular box (see module docs). */
function fitsGeometry(
  type: CarrierBoxType,
  heightMm: number,
  diameterMm: number,
): boolean {
  return (
    heightMm <= type.internalHeightMm &&
    diameterMm <= Math.min(type.internalWidthMm, type.internalDepthMm)
  );
}

/** Geometry fit plus the box's weight ceiling for the unit alone. */
function sufficientFor(
  type: CarrierBoxType,
  weightG: number,
  heightMm: number,
  diameterMm: number,
): boolean {
  return fitsGeometry(type, heightMm, diameterMm) && weightG <= type.maxWeightG;
}

/** Geometry check against what the open box already carries. */
function acceptsUnit(openBox: OpenBox, unit: PackingUnit): boolean {
  return (
    fitsGeometry(openBox.type, unit.heightMm, unit.diameterMm) &&
    openBox.weightG + unit.weightG <= openBox.type.maxWeightG
  );
}

function place(openBox: OpenBox, unit: PackingUnit): void {
  openBox.units.push(unit);
  openBox.weightG += unit.weightG;
  openBox.itemVolumeMm3 += unitVolumeMm3(unit);
}

/** Cylinder volume of one unit in mm³. */
function unitVolumeMm3(unit: PackingUnit): number {
  return Math.PI * (unit.diameterMm / 2) ** 2 * unit.heightMm;
}

// ---------------------------------------------------------------------------
// Output assembly
// ---------------------------------------------------------------------------

function toPackedBox(openBox: OpenBox): PackedBox {
  const counts = new Map<number, number>();
  for (const unit of openBox.units) {
    counts.set(unit.productId, (counts.get(unit.productId) ?? 0) + 1);
  }
  const items = [...counts.entries()]
    .map(([productId, units]) => ({ productId, units }))
    .sort((a, b) => a.productId - b.productId);

  return {
    boxTypeId: openBox.type.id,
    carrier: openBox.type.carrier,
    boxName: openBox.type.name,
    items,
    totalWeightG: openBox.weightG,
    fillRate: openBox.itemVolumeMm3 / boxVolumeMm3(openBox.type),
  };
}

// ---------------------------------------------------------------------------
// Mixing warning
// ---------------------------------------------------------------------------

/**
 * Glass+metal mixing warning over PACKED units, or `null`.
 *
 * Fires only when both materials are actually present together and at
 * least one threshold is STRICTLY exceeded (`>` — exactly at a
 * threshold is within the safe band, see thresholds.ts). `triggeredBy`
 * lists every fired threshold in fixed declaration order.
 */
function mixingWarning(openBoxes: readonly OpenBox[]): MixingWarning | null {
  let glassUnits = 0;
  let canUnits = 0;
  let glassWeightG = 0;
  let canWeightG = 0;
  for (const box of openBoxes) {
    for (const unit of box.units) {
      if (unit.material === 'GLASS') {
        glassUnits += 1;
        glassWeightG += unit.weightG;
      } else if (unit.material === 'CAN') {
        canUnits += 1;
        canWeightG += unit.weightG;
      }
    }
  }

  // No mixing, no warning — a single-material shipment is not the
  // glass+metal hazard the warning exists for, at any size.
  if (glassUnits === 0 || canUnits === 0) {
    return null;
  }

  const combinedWeightG = glassWeightG + canWeightG;
  const triggeredBy: MixingTrigger[] = [];
  if (glassUnits + canUnits > MIXED_MATERIAL_MAX_UNITS) {
    triggeredBy.push('UNIT_COUNT');
  }
  if (combinedWeightG > MIXED_MATERIAL_MAX_COMBINED_WEIGHT_G) {
    triggeredBy.push('COMBINED_WEIGHT');
  }
  if (triggeredBy.length === 0) {
    return null;
  }

  return { glassUnits, canUnits, glassWeightG, canWeightG, combinedWeightG, triggeredBy };
}
