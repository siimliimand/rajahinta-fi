/**
 * Estimation-weight resolution (task 5.1, design D7 — weight preference).
 *
 * The product master may carry a stored `weight_grams` (merged task 3.1).
 * When present, the carrier-rate lookup uses it (grams → kg, e.g.
 * 530 g → 0.53 kg); otherwise the lookup falls back to the caller's
 * volume-based estimate (the water-density approximation produced at the
 * product-port boundary). The chosen basis travels with the result so the
 * lookup stays traceable to the exact weight that produced it.
 *
 * @module EstimationWeight
 */

/** Which weight produced the carrier-rate lookup. */
export type TransportWeightBasis = 'STORED_PRODUCT_WEIGHT' | 'VOLUME_ESTIMATE';

/** The weight resolved for a carrier-rate lookup, with its explainable basis. */
export interface ResolvedEstimationWeight {
  /** Weight fed to bracket matching, in kg. */
  readonly weightKg: number;
  /** Where `weightKg` came from. */
  readonly basis: TransportWeightBasis;
  /**
   * The product master's stored grams behind `weightKg`; null when the
   * basis is the volume estimate (no stored weight exists).
   */
  readonly storedWeightGrams: number | null;
}

/**
 * Prefer the stored product weight for the carrier-rate lookup; fall back
 * to the caller's volume-based estimate when the product master carries no
 * usable weight. Non-positive grams are invalid for a physical product, so
 * they are treated as absent rather than producing a zero-weight lookup.
 */
export function resolveEstimationWeight(
  storedWeightGrams: number | null | undefined,
  volumeBasedWeightKg: number,
): ResolvedEstimationWeight {
  if (storedWeightGrams != null && storedWeightGrams > 0) {
    return {
      weightKg: storedWeightGrams / 1000,
      basis: 'STORED_PRODUCT_WEIGHT',
      storedWeightGrams,
    };
  }

  return {
    weightKg: volumeBasedWeightKg,
    basis: 'VOLUME_ESTIMATE',
    storedWeightGrams: null,
  };
}
