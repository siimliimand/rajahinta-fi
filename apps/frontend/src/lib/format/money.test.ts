/**
 * Unit tests for the shared money formatters (change
 * fi-locale-surface-hardening, design D2). The two-convention contract
 * is pinned verbatim: fi renders comma decimals with a suffix symbol
 * (`64,19 €` — the catalog cards' existing correct form, byte-identical
 * because both go through Intl), en renders symbol-first dot decimals
 * (`€64.19` — the calculator components' existing EN convention). Every
 * rendered amount must equal the API figure it presents.
 *
 * @module MoneyFormattersTest
 */

import { describe, expect, it } from 'vitest';
import { formatMoney, formatSignedMoney } from './money';

// fi-FI currency formatting separates the amount and the euro sign with
// a non-breaking space — the exact bytes the catalog cards render today.
const FI_NBSP = '\u00a0';

describe('formatMoney — fi convention (design D2)', () => {
  it('renders comma decimals with the suffix symbol', () => {
    expect(formatMoney(6419, 'fi')).toBe(`64,19${FI_NBSP}€`);
  });

  it('renders zero honestly — a dataset-fact zero is a real figure', () => {
    expect(formatMoney(0, 'fi')).toBe(`0,00${FI_NBSP}€`);
  });

  it('keeps cents exact — the API figure is presented, never re-rounded', () => {
    expect(formatMoney(3150, 'fi')).toBe(`31,50${FI_NBSP}€`);
    expect(formatMoney(5, 'fi')).toBe(`0,05${FI_NBSP}€`);
  });
});

describe('formatMoney — en convention (design D2)', () => {
  it('renders symbol-first dot decimals', () => {
    expect(formatMoney(6419, 'en')).toBe('€64.19');
    expect(formatMoney(3150, 'en')).toBe('€31.50');
    expect(formatMoney(0, 'en')).toBe('€0.00');
  });
});

describe('formatSignedMoney', () => {
  it('keeps the direction visible: positive prefixed, negative minus, zero unsigned', () => {
    expect(formatSignedMoney(850, 'fi')).toBe(`+8,50${FI_NBSP}€`);
    expect(formatSignedMoney(-450, 'fi')).toBe(`-4,50${FI_NBSP}€`);
    expect(formatSignedMoney(0, 'fi')).toBe(`0,00${FI_NBSP}€`);
  });

  it('signs the en form the same way, outside the symbol', () => {
    expect(formatSignedMoney(850, 'en')).toBe('+€8.50');
    expect(formatSignedMoney(-450, 'en')).toBe('-€4.50');
    expect(formatSignedMoney(0, 'en')).toBe('€0.00');
  });
});
