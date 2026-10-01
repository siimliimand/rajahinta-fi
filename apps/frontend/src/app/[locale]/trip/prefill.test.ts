/**
 * parseTripPrefillParams tests (task 2.2, change
 * finnish-first-client-experience).
 *
 * Pins the `?product=&quantity=` handshake validation:
 *   1. A valid positive-integer product is required for ANY prefill —
 *      absent, blank, or malformed product values yield null, and the
 *      page behaves exactly as before the handshake existed.
 *   2. The quantity applies only when it is a whole number within the
 *      fill form's own window (1–99); absent and out-of-window values
 *      fall back to the form's default bound of 1 — no cap is invented.
 *
 * @module TripPrefillTest
 */
import { describe, expect, it } from 'vitest';
import { parseTripPrefillParams } from './trip.client';

describe('parseTripPrefillParams', () => {
  it('parses a valid product and quantity', () => {
    expect(parseTripPrefillParams('42', '3')).toEqual({
      productId: 42,
      quantity: 3,
    });
  });

  it('falls back to quantity 1 when the quantity is absent', () => {
    expect(parseTripPrefillParams('42', null)).toEqual({
      productId: 42,
      quantity: 1,
    });
    expect(parseTripPrefillParams('42', '')).toEqual({
      productId: 42,
      quantity: 1,
    });
  });

  it('falls back to quantity 1 when the quantity is outside the fill window', () => {
    // 0 and negatives are never valid bounds; above 99 exceeds the
    // form's own cap — both degrade to the default bound, never clamp.
    expect(parseTripPrefillParams('42', '0')?.quantity).toBe(1);
    expect(parseTripPrefillParams('42', '-3')?.quantity).toBe(1);
    expect(parseTripPrefillParams('42', '100')?.quantity).toBe(1);
    expect(parseTripPrefillParams('42', 'abc')?.quantity).toBe(1);
    expect(parseTripPrefillParams('42', '2.5')?.quantity).toBe(1);
  });

  it('prefills nothing when the product is absent or malformed', () => {
    expect(parseTripPrefillParams(null, '3')).toBeNull();
    expect(parseTripPrefillParams('', '3')).toBeNull();
    expect(parseTripPrefillParams('abc', '3')).toBeNull();
    expect(parseTripPrefillParams('0', '3')).toBeNull();
    expect(parseTripPrefillParams('-5', '3')).toBeNull();
    expect(parseTripPrefillParams('4 2', '3')).toBeNull();
  });

  it('ignores surrounding whitespace in both values', () => {
    expect(parseTripPrefillParams(' 42 ', ' 3 ')).toEqual({
      productId: 42,
      quantity: 3,
    });
  });
});
