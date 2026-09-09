import { describe, it, expect } from 'vitest';
import { resolveEstimationWeight } from '../estimation-weight';

describe('resolveEstimationWeight', () => {
  it('prefers the stored product weight, converting grams to kg', () => {
    const resolved = resolveEstimationWeight(530, 0.75);

    expect(resolved.weightKg).toBe(0.53);
    expect(resolved.basis).toBe('STORED_PRODUCT_WEIGHT');
    expect(resolved.storedWeightGrams).toBe(530);
  });

  it('falls back to the volume-based estimate when no weight is stored (null)', () => {
    const resolved = resolveEstimationWeight(null, 0.75);

    expect(resolved.weightKg).toBe(0.75);
    expect(resolved.basis).toBe('VOLUME_ESTIMATE');
    expect(resolved.storedWeightGrams).toBeNull();
  });

  it('treats an omitted weight as absent (optional parameter)', () => {
    const resolved = resolveEstimationWeight(undefined, 1.5);

    expect(resolved.weightKg).toBe(1.5);
    expect(resolved.basis).toBe('VOLUME_ESTIMATE');
    expect(resolved.storedWeightGrams).toBeNull();
  });

  it('falls back on non-positive stored grams — invalid for a physical product', () => {
    const zero = resolveEstimationWeight(0, 0.75);
    expect(zero.basis).toBe('VOLUME_ESTIMATE');
    expect(zero.weightKg).toBe(0.75);

    const negative = resolveEstimationWeight(-100, 0.75);
    expect(negative.basis).toBe('VOLUME_ESTIMATE');
    expect(negative.weightKg).toBe(0.75);
  });

  it('converts fractional grams exactly', () => {
    const resolved = resolveEstimationWeight(1525, 2);

    expect(resolved.weightKg).toBe(1.525);
    expect(resolved.basis).toBe('STORED_PRODUCT_WEIGHT');
    expect(resolved.storedWeightGrams).toBe(1525);
  });
});
