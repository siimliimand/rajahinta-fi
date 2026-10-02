/**
 * Tests for the decisive pack-notation parsers.
 *
 * `parsePackUnitVolumeLitres` pins are regression coverage for the
 * ingestion normalizer (task 1.1); the `parsePackUnits` pins are the
 * task-6.1 amendment contract: the count side the €/g metric divides a
 * pack's price by (units derived from the name at read time, never
 * persisted). Both are pure — no DB, no mocks.
 *
 * @module PackNotationTests
 */
import { describe, it, expect } from 'vitest';
import {
  parsePackUnitVolumeLitres,
  parsePackUnits,
} from '../pack-notation';

describe('parsePackUnitVolumeLitres (regression pins, task 1.1)', () => {
  it('the live 2900 name normalizes the pack total to per-unit litres', () => {
    expect(parsePackUnitVolumeLitres('Karhu Olut 5.3% 24×33 l')).toBe(0.33);
  });

  it('non-pack names stay null', () => {
    expect(parsePackUnitVolumeLitres('Jameson Caskmates 40% 0,7 l')).toBeNull();
    expect(parsePackUnitVolumeLitres('Karhu 4,6 tölkki')).toBeNull();
  });
});

describe('parsePackUnits — N×V form (count before the separator)', () => {
  it('reads the leading integer with a unit token', () => {
    expect(parsePackUnits('24×33 l')).toBe(24);
    expect(parsePackUnits('Karhu Olut 5.3% 24×33 l')).toBe(24);
  });

  it('reads the leading integer without a unit token (units need no volume)', () => {
    expect(parsePackUnits('24×33')).toBe(24);
    expect(parsePackUnits('8 x 0,5')).toBe(8);
  });

  it('reads ascii and unicode separators, comma decimals, any case', () => {
    expect(parsePackUnits('24 x 0,33 l')).toBe(24);
    expect(parsePackUnits('12 X 50 cl')).toBe(12);
  });

  it('a single-unit notation reads 1', () => {
    expect(parsePackUnits('1×0,33 l')).toBe(1);
  });
});

describe('parsePackUnits — V×N form (count after the separator)', () => {
  it('reads the trailing integer behind an explicit volume token', () => {
    expect(parsePackUnits('33CL x 24')).toBe(24);
    expect(parsePackUnits('33 cl x 24')).toBe(24);
    expect(parsePackUnits('0,33 l × 24')).toBe(24);
    expect(parsePackUnits('330ml x 12')).toBe(12);
  });

  it('without a volume marker the canonical count-first reading stands', () => {
    // A bare pair follows the N×V positional convention — the count is
    // whichever number comes first; magnitudes are never compared to
    // guess which side is which.
    expect(parsePackUnits('33 x 24')).toBe(33);
  });

  it('a comma-decimal fragment before the separator is an ABV, not a count', () => {
    // "4,6 x 24" states an ABV and a bare count — the fraction must
    // not read as six units.
    expect(parsePackUnits('Karhu 4,6 x 24')).toBeNull();
    expect(parsePackUnits('Viina 40,5-pack')).toBeNull();
  });
});

describe('parsePackUnits — N-pack textual form', () => {
  it('reads the count from the pack word', () => {
    expect(parsePackUnits('8-pack tölkki')).toBe(8);
    expect(parsePackUnits('Karhu III 24-Pack')).toBe(24);
    expect(parsePackUnits('6 pack pullo')).toBe(6);
  });
});

describe('parsePackUnits — honesty (null over guessing)', () => {
  it('no notation at all → null', () => {
    expect(parsePackUnits('Karhu III')).toBeNull();
    expect(parsePackUnits('Karhu 4,6 tölkki')).toBeNull();
    expect(parsePackUnits('0. 7 l')).toBeNull();
  });

  it('a count fragment of 0 is not a pack size', () => {
    expect(parsePackUnits('0 x 33cl')).toBeNull();
    expect(parsePackUnits('0×33')).toBeNull();
  });

  it('conflicting counts in one name are ambiguous → null', () => {
    expect(parsePackUnits('24×33 l 8-pack')).toBeNull();
    expect(parsePackUnits('24×33 cl x 2')).toBeNull();
  });

  it('repeated consistent readings agree on one count', () => {
    expect(parsePackUnits('24×33 l (24 x 0,33 l)')).toBe(24);
  });

  it('percent-style numbers never read as counts', () => {
    expect(parsePackUnits('Karhu Olut 5.3% 0,33 l')).toBeNull();
    expect(parsePackUnits('Viina 40% 0.5 l')).toBeNull();
  });
});
