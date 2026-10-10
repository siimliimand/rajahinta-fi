/**
 * Guarantee-figure functional tests (import-filing-assistant Stage 1,
 * design D3a).
 *
 * High-liability coverage: the guarantee (vakuus) is a figure the user
 * lodges and pays to the Tax Administration before dispatch. It must equal
 * the calculated alcohol excise duty exactly (verified rule,
 * change-notes.md Fact 1), must exclude the beverage-packaging duty (which
 * carries no guarantee), and must degrade to unavailable rather than
 * substitute a plausible number when the excise figure has no applicable
 * rule behind it.
 *
 * Covers:
 *   - Verified rule             guarantee equals the alcohol excise amount
 *   - Container-duty exclusion  packaging duty never enters the figure
 *   - Degraded states           FALLBACK / missing provenance / corrupt
 *                               amounts → unavailable, no substituted value
 *   - Status propagation        ESTIMATED ceiling, UNAVAILABLE on refusal
 *   - Determinism               pure function: same input, same output,
 *                               inputs never mutated
 *
 * @module GuaranteeFigureTest
 */

import { describe, it, expect } from 'vitest';
import { computeGuaranteeFigure } from '../guarantee-figure';
import type {
  DeclarationGuaranteeFigure,
  FilingDutyResult,
} from '../declaration.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A duty result backed by a real (non-fallback) persisted rule. */
function dutyResult(
  overrides?: Partial<FilingDutyResult>,
): FilingDutyResult {
  return {
    amountCents: 360,
    ruleVersionLabel: '2026.1',
    ...overrides,
  };
}

/** Asserts the full unavailable shape — no substituted amount anywhere. */
function expectUnavailable(figure: DeclarationGuaranteeFigure): void {
  expect(figure.available).toBe(false);
  expect(figure.amountCents).toBeNull();
  expect(figure.status).toBe('UNAVAILABLE');
}

// ---------------------------------------------------------------------------
// Verified rule — guarantee equals the alcohol excise duty
// ---------------------------------------------------------------------------

describe('verified rule: guarantee equals the calculated alcohol excise', () => {
  it('returns the alcohol excise amount as the guarantee', () => {
    const figure = computeGuaranteeFigure(
      dutyResult({ amountCents: 360, ruleVersionLabel: '2026.1' }),
      dutyResult({ amountCents: 48 }),
    );

    expect(figure.available).toBe(true);
    expect(figure.amountCents).toBe(360);
  });

  it('matches the excise amount exactly for arbitrary figures', () => {
    const figure = computeGuaranteeFigure(
      dutyResult({ amountCents: 12_345, ruleVersionLabel: '2025.1' }),
      dutyResult({ amountCents: 999 }),
    );

    expect(figure.amountCents).toBe(12_345);
  });

  it('is available when the excise comes from a real persisted rule', () => {
    const figure = computeGuaranteeFigure(
      dutyResult({ amountCents: 1200, ruleVersionLabel: '2024.2' }),
      dutyResult({ amountCents: 100 }),
    );

    expect(figure.available).toBe(true);
    expect(figure.amountCents).toBe(1200);
  });

  it('returns a legitimate zero for an exempt product under a real rule', () => {
    // Exemption rules (rate 0.00) produce a zero excise under an official
    // schedule version — a zero guarantee is the verified rule applied,
    // not a fallback.
    const figure = computeGuaranteeFigure(
      dutyResult({ amountCents: 0, ruleVersionLabel: '2026.1' }),
      dutyResult({ amountCents: 51 }),
    );

    expect(figure.available).toBe(true);
    expect(figure.amountCents).toBe(0);
  });

  it('conforms to the DeclarationGuaranteeFigure contract', () => {
    const figure: DeclarationGuaranteeFigure = computeGuaranteeFigure(
      dutyResult(),
      dutyResult(),
    );

    expect(typeof figure.available).toBe('boolean');
    expect(figure.status === 'ESTIMATED' || figure.status === 'UNAVAILABLE').toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Container-duty exclusion — packaging duty carries no guarantee
// ---------------------------------------------------------------------------

describe('container-duty exclusion', () => {
  it('never sums the container duty into the guarantee', () => {
    const figure = computeGuaranteeFigure(
      dutyResult({ amountCents: 360 }),
      dutyResult({ amountCents: 48 }),
    );

    // 360 + 48 = 408 would be the total excise — the guarantee is the
    // alcohol duty alone.
    expect(figure.amountCents).toBe(360);
    expect(figure.amountCents).not.toBe(408);
  });

  it('ignores even a dominant container-duty amount', () => {
    const figure = computeGuaranteeFigure(
      dutyResult({ amountCents: 100 }),
      dutyResult({ amountCents: 1_000_000 }),
    );

    expect(figure.amountCents).toBe(100);
  });

  it('stays available regardless of the container-duty rule state', () => {
    // The packaging duty has no bearing on the guarantee: fallback or
    // missing provenance there does not degrade the figure.
    const fallbackContainer = computeGuaranteeFigure(
      dutyResult({ amountCents: 360 }),
      dutyResult({ amountCents: 48, ruleVersionLabel: 'FALLBACK' }),
    );
    const unprovenancedContainer = computeGuaranteeFigure(
      dutyResult({ amountCents: 360 }),
      dutyResult({ amountCents: 48, ruleVersionLabel: null }),
    );

    expect(fallbackContainer.available).toBe(true);
    expect(fallbackContainer.amountCents).toBe(360);
    expect(unprovenancedContainer.available).toBe(true);
    expect(unprovenancedContainer.amountCents).toBe(360);
  });
});

// ---------------------------------------------------------------------------
// Degraded states — no plausible fallback
// ---------------------------------------------------------------------------

describe('degraded states: unavailable-rule excise yields an unavailable guarantee', () => {
  it('refuses a fallback-dataset excise figure', () => {
    // The engine applied DEFAULT_RATES because no rule matched. The
    // fallback amount is exactly the plausible number that must NOT leak.
    const figure = computeGuaranteeFigure(
      dutyResult({ amountCents: 425, ruleVersionLabel: 'FALLBACK' }),
      dutyResult({ amountCents: 48 }),
    );

    expectUnavailable(figure);
    expect(figure.amountCents).not.toBe(425);
  });

  it('refuses a fallback excise even when the fallback amount is zero', () => {
    // Zero from a missing rule is not the verified exemption zero.
    const figure = computeGuaranteeFigure(
      dutyResult({ amountCents: 0, ruleVersionLabel: 'FALLBACK' }),
      dutyResult({ amountCents: 0 }),
    );

    expectUnavailable(figure);
  });

  it('refuses an excise figure with no persisted rule provenance', () => {
    const figure = computeGuaranteeFigure(
      dutyResult({ amountCents: 360, ruleVersionLabel: null }),
      dutyResult({ amountCents: 48 }),
    );

    expectUnavailable(figure);
  });

  it('refuses a non-finite excise amount (never echoed forward)', () => {
    const figure = computeGuaranteeFigure(
      dutyResult({ amountCents: Number.NaN }),
      dutyResult({ amountCents: 48 }),
    );

    expectUnavailable(figure);
  });

  it('refuses a negative excise amount', () => {
    const figure = computeGuaranteeFigure(
      dutyResult({ amountCents: -100 }),
      dutyResult({ amountCents: 48 }),
    );

    expectUnavailable(figure);
  });
});

// ---------------------------------------------------------------------------
// Status propagation
// ---------------------------------------------------------------------------

describe('status propagation', () => {
  it('an offered figure carries ESTIMATED from the record-backed excise', () => {
    const figure = computeGuaranteeFigure(
      dutyResult({ amountCents: 360 }),
      dutyResult({ amountCents: 48 }),
    );

    expect(figure.status).toBe('ESTIMATED');
  });

  it('never asserts VERIFIED — the record does not persist verification status', () => {
    const figure = computeGuaranteeFigure(
      dutyResult({ amountCents: 360, ruleVersionLabel: '2026.1' }),
      dutyResult({ amountCents: 48 }),
    );

    expect(figure.status).not.toBe('VERIFIED');
  });

  it('a refused figure carries UNAVAILABLE', () => {
    const figure = computeGuaranteeFigure(
      dutyResult({ amountCents: 425, ruleVersionLabel: 'FALLBACK' }),
      dutyResult({ amountCents: 48 }),
    );

    expect(figure.status).toBe('UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// Determinism and purity
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('returns an equal figure for identical inputs', () => {
    const excise = dutyResult({ amountCents: 512 });
    const container = dutyResult({ amountCents: 31 });

    const first = computeGuaranteeFigure(excise, container);
    const second = computeGuaranteeFigure(excise, container);

    expect(first).toEqual(second);
  });

  it('returns an equal unavailable state for identical degraded inputs', () => {
    const excise = dutyResult({ amountCents: 425, ruleVersionLabel: 'FALLBACK' });
    const container = dutyResult({ amountCents: 31 });

    const first = computeGuaranteeFigure(excise, container);
    const second = computeGuaranteeFigure(excise, container);

    expect(first).toEqual(second);
  });

  it('does not mutate its inputs', () => {
    const excise = dutyResult({ amountCents: 512, ruleVersionLabel: '2026.1' });
    const container = dutyResult({ amountCents: 31, ruleVersionLabel: '2026.1' });
    const exciseSnapshot = { ...excise };
    const containerSnapshot = { ...container };

    computeGuaranteeFigure(excise, container);

    expect(excise).toEqual(exciseSnapshot);
    expect(container).toEqual(containerSnapshot);
  });

  it('produces different figures when the excise amount changes', () => {
    const container = dutyResult({ amountCents: 31 });
    const small = computeGuaranteeFigure(
      dutyResult({ amountCents: 512 }),
      container,
    );
    const large = computeGuaranteeFigure(
      dutyResult({ amountCents: 1024 }),
      container,
    );

    expect(small.amountCents).toBe(512);
    expect(large.amountCents).toBe(1024);
  });
});
