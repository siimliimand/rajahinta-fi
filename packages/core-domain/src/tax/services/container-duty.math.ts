/**
 * Pure calculation functions for Finnish beverage-container duty.
 *
 * Container duty (veropanos / pantillinen vero) is a flat tax on beverage
 * containers.  The general rate is €0.51 per litre of container volume,
 * applied to standard container types (glass, plastic, metal, carton).
 *
 * Non-standard containers (keg, bulk, other) are flagged as ESTIMATED.
 *
 * @module ContainerDutyMath
 */

// ---------------------------------------------------------------------------
// Formula reference constants
// ---------------------------------------------------------------------------

/** Flat rate per litre of container volume. */
export const FORMULA_FLAT_PER_LITRE = 'FLAT_PER_LITRE';

// ---------------------------------------------------------------------------
// Default rate
// ---------------------------------------------------------------------------

/** General container duty rate: €0.51 / litre. */
export const DEFAULT_CONTAINER_DUTY_RATE = 0.51;

// ---------------------------------------------------------------------------
// Standard container types (exact match → VERIFIED)
// ---------------------------------------------------------------------------

const STANDARD_CONTAINERS = new Set([
  'glass',
  'plastic',
  'metal',
  'aluminium',
  'can',
  'carton',
  'tetra',
]);

// ---------------------------------------------------------------------------
// Packaging normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise a raw packaging string.
 */
export function normalisePackaging(raw: string): string {
  return raw.toLowerCase().trim();
}

/**
 * True if the packaging type is a standard container for which
 * the published rate is authoritative.
 */
export function isStandardPackaging(packaging: string): boolean {
  return STANDARD_CONTAINERS.has(normalisePackaging(packaging));
}

// ---------------------------------------------------------------------------
// Pure calculation
// ---------------------------------------------------------------------------

/**
 * Calculate container duty at the given per-litre rate.
 *
 * @param ratePerLitre  Rate in € per litre.
 * @param volumeLitres  Container volume in litres.
 * @returns Duty amount in euro-cents.
 */
export function calcContainerDuty(
  ratePerLitre: number,
  volumeLitres: number,
): number {
  if (volumeLitres < 0) {
    throw new RangeError(`volumeLitres must not be negative, got ${volumeLitres}`);
  }
  return Math.round(ratePerLitre * volumeLitres * 100);
}

// ---------------------------------------------------------------------------
// Top-level dispatch
// ---------------------------------------------------------------------------

/**
 * Pure calculation dispatch for container duty.
 *
 * @returns `[dutyCents, rateApplied]`.
 */
export function calculateContainerDuty(
  ratePerLitre: number,
  volumeLitres: number,
): { dutyCents: number; rateApplied: number } {
  const dutyCents = calcContainerDuty(ratePerLitre, volumeLitres);
  return { dutyCents, rateApplied: ratePerLitre };
}