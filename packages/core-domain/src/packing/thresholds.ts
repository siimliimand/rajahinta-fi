/**
 * Glass+metal mixing-warning thresholds (spec: packing-optimization).
 *
 * Policy constants, deliberately exported and pinned by test: they are
 * the breakage-risk line between "mixed shipment is fine" and "warn the
 * user", and changing them silently changes every warning. Operators
 * tune them here — nowhere else.
 *
 * Semantics (documented here once, enforced in packing.ts):
 *
 * - A warning requires actual MIXING: at least one packed GLASS unit AND
 *   at least one packed CAN unit. A basket of only glass or only cans
 *   never warns, whatever its size.
 * - Each threshold triggers on STRICT EXCEEDANCE (`>`): a figure exactly
 *   AT the threshold is still within the safe band and does not warn.
 *   This reading follows the spec wording "beyond defined thresholds" /
 *   "exceeding a configured threshold".
 * - Figures are computed over packed units only; excluded lines are not
 *   part of the shipment.
 *
 * @module PackingThresholds
 */

/**
 * Maximum mixed glass+can unit count per shipment before the mixing
 * warning fires. 12 = one mixed dozen: the point where glass and metal
 * rattling together stops being a couple of bottles in a corner and
 * becomes a case-level hazard.
 */
export const MIXED_MATERIAL_MAX_UNITS = 12;

/**
 * Maximum combined glass+can weight in grams per shipment before the
 * mixing warning fires. 10 kg = the PostNord Box L / DHL Paket M weight
 * ceiling: beyond it, heavy glass and heavy cans share a carrier weight
 * class where shifting load crushes the lighter side.
 */
export const MIXED_MATERIAL_MAX_COMBINED_WEIGHT_G = 10_000;
