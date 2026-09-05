/**
 * Threshold unit-conversion tests (task 2.4, change
 * product-roadmap-phases-1-4).
 *
 * The conversion is the liability boundary between the euro-denominated
 * UI and the integer-cents API contract: every accepted string must map
 * to an integer cent amount within the API's 1..1,000,000 bound, and
 * every rejected string must be rejected (no silent rounding).
 *
 * @module thresholdTest
 */

import { describe, expect, it } from 'vitest';
import { eurosToCents, formatCents } from './threshold';

describe('eurosToCents', () => {
  it('converts whole euros', () => {
    expect(eurosToCents('12')).toBe(1200);
    expect(eurosToCents('10000')).toBe(1_000_000);
  });

  it('accepts the Finnish comma decimal separator', () => {
    expect(eurosToCents('12,50')).toBe(1250);
    expect(eurosToCents('0,01')).toBe(1);
  });

  it('accepts one-decimal amounts without rounding errors', () => {
    expect(eurosToCents('12.5')).toBe(1250);
    expect(eurosToCents('0.1')).toBe(10);
  });

  it('rejects more than two decimals instead of silently rounding', () => {
    expect(eurosToCents('12.555')).toBeNull();
    expect(eurosToCents('0,001')).toBeNull();
  });

  it('rejects non-numeric and malformed input', () => {
    expect(eurosToCents('')).toBeNull();
    expect(eurosToCents('abc')).toBeNull();
    expect(eurosToCents('-5')).toBeNull();
    expect(eurosToCents('.5')).toBeNull();
    expect(eurosToCents('12.')).toBeNull();
    expect(eurosToCents('1e3')).toBeNull();
    expect(eurosToCents('1 000')).toBeNull();
  });

  it('rejects zero — the API requires thresholdCents >= 1', () => {
    expect(eurosToCents('0')).toBeNull();
    expect(eurosToCents('0,00')).toBeNull();
  });

  it('rejects amounts above the €10,000 API bound', () => {
    expect(eurosToCents('10000.01')).toBeNull();
    expect(eurosToCents('99999')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(eurosToCents(' 12,50 ')).toBe(1250);
  });
});

describe('formatCents', () => {
  it('renders the site-wide two-decimal euro convention', () => {
    expect(formatCents(1250)).toBe('12.50');
    expect(formatCents(1)).toBe('0.01');
    expect(formatCents(1_000_000)).toBe('10000.00');
  });
});
