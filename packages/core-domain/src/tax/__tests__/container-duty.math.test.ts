/**
 * Tests for container-duty pure calculation functions.
 */
import { describe, it, expect } from 'vitest';
import {
  calcContainerDuty,
  calculateContainerDuty,
  isStandardPackaging,
  normalisePackaging,
  DEFAULT_CONTAINER_DUTY_RATE,
} from '../services/container-duty.math';

// ---------------------------------------------------------------------------
// calcContainerDuty
// ---------------------------------------------------------------------------

describe('calcContainerDuty', () => {
  it('returns 0 for 0 volume', () => {
    expect(calcContainerDuty(DEFAULT_CONTAINER_DUTY_RATE, 0)).toBe(0);
  });

  it('calculates 1L at €0.51 → 51 cents', () => {
    expect(calcContainerDuty(0.51, 1.0)).toBe(51);
  });

  it('calculates 0.33L at €0.51 → 17 cents', () => {
    // 0.51 * 0.33 = 0.1683 → round → 17
    expect(calcContainerDuty(0.51, 0.33)).toBe(17);
  });

  it('throws on negative volume', () => {
    expect(() => calcContainerDuty(0.51, -1)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// calculateContainerDuty (top-level dispatch)
// ---------------------------------------------------------------------------

describe('calculateContainerDuty', () => {
  it('returns dutyCents and rateApplied', () => {
    const result = calculateContainerDuty(0.51, 0.75);
    expect(result.dutyCents).toBe(38); // 0.51 * 0.75 = 0.3825 → round → 38
    expect(result.rateApplied).toBe(0.51);
  });
});

// ---------------------------------------------------------------------------
// isStandardPackaging / normalisePackaging
// ---------------------------------------------------------------------------

describe('isStandardPackaging', () => {
  it('recognises glass', () => expect(isStandardPackaging('glass')).toBe(true));
  it('recognises plastic', () => expect(isStandardPackaging('plastic')).toBe(true));
  it('recognises metal', () => expect(isStandardPackaging('metal')).toBe(true));
  it('recognises can', () => expect(isStandardPackaging('can')).toBe(true));
  it('recognises carton', () => expect(isStandardPackaging('carton')).toBe(true));
  it('rejects keg', () => expect(isStandardPackaging('keg')).toBe(false));
  it('rejects bulk', () => expect(isStandardPackaging('bulk')).toBe(false));
  it('is case-insensitive', () => expect(isStandardPackaging('GLASS')).toBe(true));
});

describe('normalisePackaging', () => {
  it('lowercases and trims', () => expect(normalisePackaging('  KEG ')).toBe('keg'));
});