/**
 * Plausibility sanity rail tests — pure logic (task 2.1,
 * change unit-integrity-and-result-trust).
 *
 * High-liability coverage: the 5× threshold boundary (strictly greater
 * trips, exactly 5× does not), per-component independence, structured
 * figures, and the downgrade-only status cap.
 */

import { describe, it, expect } from 'vitest';
import {
  RETAIL_PLAUSIBILITY_THRESHOLD_MULTIPLE,
  atMostEstimated,
  evaluateLineSanityRail,
} from '../sanity-rail';

describe('RETAIL_PLAUSIBILITY_THRESHOLD_MULTIPLE', () => {
  it('is the documented 5× threshold', () => {
    expect(RETAIL_PLAUSIBILITY_THRESHOLD_MULTIPLE).toBe(5);
  });
});

describe('evaluateLineSanityRail', () => {
  const PLAUSIBLE_LINE = {
    lineRetailPriceCents: 9870,
    lineExciseCents: 5 * 9870 - 1, // one cent under the threshold
    lineContainerDutyCents: 0,
  };

  it('returns no notes for a plausible line', () => {
    expect(evaluateLineSanityRail(PLAUSIBLE_LINE)).toEqual([]);
  });

  it('does not trip at exactly the threshold — strictly greater trips', () => {
    const atThreshold = {
      lineRetailPriceCents: 100,
      lineExciseCents: 5 * 100,
      lineContainerDutyCents: 0,
    };
    expect(evaluateLineSanityRail(atThreshold)).toEqual([]);

    const oneCentOver = { ...atThreshold, lineExciseCents: 5 * 100 + 1 };
    const notes = evaluateLineSanityRail(oneCentOver);
    expect(notes).toHaveLength(1);
    expect(notes[0].code).toBe('LINE_EXCISE_EXCEEDS_RETAIL_PLAUSIBILITY');
  });

  it('trips on the Koskenkorva shape (≈108×) with the actual figures', () => {
    const notes = evaluateLineSanityRail({
      lineRetailPriceCents: 9870,
      lineExciseCents: 1069300,
      lineContainerDutyCents: 0,
    });

    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      code: 'LINE_EXCISE_EXCEEDS_RETAIL_PLAUSIBILITY',
      component: 'alcoholExciseEstimate',
      figures: {
        lineComponentCents: 1069300,
        lineRetailPriceCents: 9870,
        thresholdMultiple: 5,
      },
    });
    // The prose names the actual figures and the threshold.
    expect(notes[0].detail).toContain('1069300');
    expect(notes[0].detail).toContain('9870');
    expect(notes[0].detail).toContain('5');
  });

  it('evaluates container duty independently of excise', () => {
    const notes = evaluateLineSanityRail({
      lineRetailPriceCents: 100,
      lineExciseCents: 0,
      lineContainerDutyCents: 501,
    });

    expect(notes).toHaveLength(1);
    expect(notes[0].code).toBe(
      'LINE_CONTAINER_DUTY_EXCEEDS_RETAIL_PLAUSIBILITY',
    );
    expect(notes[0].component).toBe('containerDutyEstimate');
  });

  it('trips both components in one line, one note each', () => {
    const notes = evaluateLineSanityRail({
      lineRetailPriceCents: 100,
      lineExciseCents: 1000,
      lineContainerDutyCents: 600,
    });

    expect(notes.map((n) => n.code)).toEqual([
      'LINE_EXCISE_EXCEEDS_RETAIL_PLAUSIBILITY',
      'LINE_CONTAINER_DUTY_EXCEEDS_RETAIL_PLAUSIBILITY',
    ]);
  });

  it('trips when the retail price is zero and the duty is positive', () => {
    // Multiplicative comparison — no division, so a zero retail price
    // cannot blow up; a positive duty on free goods is implausible.
    const notes = evaluateLineSanityRail({
      lineRetailPriceCents: 0,
      lineExciseCents: 1,
      lineContainerDutyCents: 0,
    });

    expect(notes).toHaveLength(1);
  });
});

describe('atMostEstimated', () => {
  it('downgrades VERIFIED to ESTIMATED', () => {
    expect(atMostEstimated('VERIFIED')).toBe('ESTIMATED');
  });

  it('keeps ESTIMATED unchanged', () => {
    expect(atMostEstimated('ESTIMATED')).toBe('ESTIMATED');
  });

  it('never upgrades — STALE and UNAVAILABLE stay', () => {
    expect(atMostEstimated('STALE')).toBe('STALE');
    expect(atMostEstimated('UNAVAILABLE')).toBe('UNAVAILABLE');
  });
});
