import { describe, it, expect } from 'vitest';
import {
  pgNumericToNumber,
  requirePgNumeric,
} from '../pg-numeric';

// ---------------------------------------------------------------------------
// pgNumericToNumber
// ---------------------------------------------------------------------------

describe('pgNumericToNumber', () => {
  it('coerces a fixed-point numeric string', () => {
    expect(pgNumericToNumber('0.530000')).toBe(0.53);
  });

  it('coerces integer and negative values', () => {
    expect(pgNumericToNumber('12')).toBe(12);
    expect(pgNumericToNumber('-4.5')).toBe(-4.5);
  });

  it('coerces scientific notation the driver may emit', () => {
    expect(pgNumericToNumber('1.05e-2')).toBe(0.0105);
  });

  it('passes null through as null', () => {
    expect(pgNumericToNumber(null)).toBeNull();
  });

  it('throws with the column context when the value is not a decimal', () => {
    expect(() => pgNumericToNumber('not-a-number', 'fx_rates.rate')).toThrow(
      /fx_rates\.rate.*"not-a-number"/,
    );
  });

  it('rejects NaN and Infinity representations', () => {
    expect(() => pgNumericToNumber('NaN')).toThrow(TypeError);
    expect(() => pgNumericToNumber('Infinity')).toThrow(TypeError);
  });

  it('defaults the context to a generic label', () => {
    expect(() => pgNumericToNumber('x')).toThrow(/numeric column/);
  });
});

// ---------------------------------------------------------------------------
// requirePgNumeric
// ---------------------------------------------------------------------------

describe('requirePgNumeric', () => {
  it('coerces a present value', () => {
    expect(requirePgNumeric('10.75')).toBe(10.75);
  });

  it('throws when the value is null', () => {
    expect(() => requirePgNumeric(null, 'fx_rates.rate')).toThrow(
      /fx_rates\.rate.*null/,
    );
  });

  it('throws when the value is corrupt', () => {
    expect(() => requirePgNumeric('abc', 'fx_rates.rate')).toThrow(TypeError);
  });
});
