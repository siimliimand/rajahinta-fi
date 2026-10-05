/**
 * Unit tests for the product-attribute formatters (change
 * unit-integrity-and-result-trust, task 4.1). The spec's scenarios are
 * pinned verbatim: 0.38 → "38 %", the 0.145 float artifact → "14.5 %",
 * 0.5 l → "50 cl".
 *
 * @module ProductAttributeFormattersTest
 */

import { describe, expect, it } from 'vitest';
import { formatAbv, formatAttributeRow, formatVolume } from './product-attributes';

// ---------------------------------------------------------------------------
// formatAbv
// ---------------------------------------------------------------------------

describe('formatAbv', () => {
  it('converts a stored fraction to a whole percentage with the "38 %" spacing', () => {
    expect(formatAbv(0.38)).toBe('38 %');
  });

  it('kills the float artifact: 0.145 × 100 = 14.499999999999998 renders "14.5 %"', () => {
    expect(formatAbv(0.145)).toBe('14.5 %');
  });

  it('renders one decimal when the fraction needs it', () => {
    expect(formatAbv(0.047)).toBe('4.7 %');
    expect(formatAbv(0.055)).toBe('5.5 %');
  });

  it('rounds to at most one decimal', () => {
    // 0.0445 × 100 = 4.45 → "4.5 %" (toFixed round-half), never "4.45 %".
    expect(formatAbv(0.0445)).toBe('4.5 %');
  });

  it('renders zero honestly — alcohol-free is a real value, not absence', () => {
    expect(formatAbv(0)).toBe('0 %');
  });

  it('is null-safe: null renders nothing, the caller decides', () => {
    expect(formatAbv(null)).toBeNull();
  });

  it('treats non-finite values as absent', () => {
    expect(formatAbv(Number.NaN)).toBeNull();
    expect(formatAbv(Infinity)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatVolume
// ---------------------------------------------------------------------------

describe('formatVolume', () => {
  it('renders sub-litre values in centilitres', () => {
    expect(formatVolume(0.5)).toBe('50 cl');
    expect(formatVolume(0.15)).toBe('15 cl');
    expect(formatVolume(0.04)).toBe('4 cl');
    expect(formatVolume(0.75)).toBe('75 cl');
  });

  it('renders one litre and above in litres', () => {
    expect(formatVolume(1)).toBe('1 l');
    expect(formatVolume(3)).toBe('3 l');
    expect(formatVolume(2.5)).toBe('2.5 l');
  });

  it('accepts the canonical litre text the API ships', () => {
    expect(formatVolume('0.5')).toBe('50 cl');
    expect(formatVolume('3')).toBe('3 l');
    expect(formatVolume('0.15')).toBe('15 cl');
  });

  it('still parses legacy suffixed text ("0.5 l")', () => {
    expect(formatVolume('0.5 l')).toBe('50 cl');
  });

  it('caps at two decimals and trims trailing zeros', () => {
    expect(formatVolume(1.234)).toBe('1.23 l');
    expect(formatVolume(0.333)).toBe('33.3 cl');
  });

  it('kills the raw-database artifact shape ("0.3300" never renders bare)', () => {
    expect(formatVolume('0.3300')).toBe('33 cl');
  });

  it('is null-safe: null and empty render nothing', () => {
    expect(formatVolume(null)).toBeNull();
    expect(formatVolume('')).toBeNull();
  });

  it('treats unparseable or non-positive values as absent, never "0 l"', () => {
    expect(formatVolume('n/a')).toBeNull();
    // Legacy comma-decimal text parses as 0 — corrupt, render nothing.
    expect(formatVolume('0,7 l')).toBeNull();
    expect(formatVolume(0)).toBeNull();
    expect(formatVolume(-0.5)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatAttributeRow
// ---------------------------------------------------------------------------

describe('formatAttributeRow', () => {
  it('joins the present parts with the " · " separator', () => {
    expect(formatAttributeRow('Anchor', 'viinit', '75 cl', '12.5 %')).toBe(
      'Anchor · viinit · 75 cl · 12.5 %',
    );
  });

  it('renders a brandless product without a leading separator', () => {
    // The proposal's dangling "· spirits ·" bug: brand is '' on the wire
    // when the feed name yields none, and the row must start with the
    // category, never the separator.
    expect(formatAttributeRow('', 'spirituosat', '50 cl', '4.7 %')).toBe(
      'spirituosat · 50 cl · 4.7 %',
    );
    expect(formatAttributeRow(null, 'viinit', '75 cl', '12.5 %')).toBe(
      'viinit · 75 cl · 12.5 %',
    );
  });

  it('treats a whitespace-only brand as absent', () => {
    expect(formatAttributeRow('  ', 'oluet', '33 cl')).toBe('oluet · 33 cl');
  });

  it('closes the gap when a middle part is absent — never a doubled separator', () => {
    expect(formatAttributeRow('Anchor', null, '75 cl', '12.5 %')).toBe(
      'Anchor · 75 cl · 12.5 %',
    );
  });

  it('renders a lone part bare, with no separator around it', () => {
    expect(formatAttributeRow('Anchor')).toBe('Anchor');
    expect(formatAttributeRow(null, null, '75 cl', null)).toBe('75 cl');
  });

  it('accepts undefined parts alongside null (optional props at call sites)', () => {
    expect(formatAttributeRow(undefined, 'viinit', undefined, '12.5 %')).toBe(
      'viinit · 12.5 %',
    );
  });

  it('is null when every part is absent — the caller decides render-nothing', () => {
    expect(formatAttributeRow(null, '', undefined, '  ')).toBeNull();
    expect(formatAttributeRow()).toBeNull();
  });
});
