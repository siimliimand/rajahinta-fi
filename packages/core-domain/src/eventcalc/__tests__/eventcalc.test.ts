/**
 * Tests for the event calculator (task 4.2, spec event-calculator,
 * design R5/R6).
 *
 * Exact numeric expectations are computed by hand. Norm fixtures
 * mirror the shape of the curated seed
 * (packages/data-platform/src/seed/consumption-norms.seed.ts) — values
 * transcribed from its derivation (standard drinks/guest/hour ×
 * 15.2 ml ÷ %ABV, rounded to centilitres) — but are INLINE for purity:
 * the module must not import data-platform, and neither may its tests.
 *
 * Boundary conventions (documented, pinned by tests):
 * - zero guests / zero duration is valid and yields an all-zero
 *   COMPUTED list (buying nothing is the exact minimal-surplus plan);
 * - negative, fractional, or non-finite guests/duration and
 *   fractional-hour durations throw InvalidEventInputError (whole
 *   hours keep the need product an exact integer);
 * - empty norms is the explicit NO_PUBLISHED_NORMS result state;
 * - mixed versionLabels throw MixedNormVersionsError (no version is
 *   silently preferred).
 *
 * @module EventCalcTests
 */
import { describe, it, expect } from 'vitest';
import {
  calculateEventShoppingList,
  computeConsumption,
  toShoppingList,
} from '../eventcalc';
import {
  EVENT_CALC_DRINK_TYPES,
  EVENT_CALC_EVENT_PROFILES,
  InconsistentNormsError,
  InvalidEventInputError,
  MixedNormVersionsError,
} from '../eventcalc.types';
import { RETAIL_UNITS_BY_DRINK_TYPE } from '../retail-units';
import type { EventCalcInput, EventNormRow } from '../eventcalc.types';

// ---------------------------------------------------------------------------
// Fixtures — norms transcribed from the curated seed's derivation
// ---------------------------------------------------------------------------

/** The seed's curated version label (transcribed — not imported). */
const V1 = 'standard-drink-fi-2026.1';
/** A later version label, for mixed-version rejection tests. */
const V2 = 'standard-drink-fi-2026.2';

/** casual_gathering: 6 types, values per the seed's centilitre rounding. */
const CASUAL_NORMS: readonly EventNormRow[] = [
  { drinkType: 'beer', normValuePerGuestPerHour: 0.32, versionLabel: V1 },
  { drinkType: 'wine_still', normValuePerGuestPerHour: 0.06, versionLabel: V1 },
  { drinkType: 'wine_sparkling', normValuePerGuestPerHour: 0.03, versionLabel: V1 },
  { drinkType: 'intermediate_products', normValuePerGuestPerHour: 0.01, versionLabel: V1 },
  { drinkType: 'other_fermented', normValuePerGuestPerHour: 0.21, versionLabel: V1 },
  { drinkType: 'spirits', normValuePerGuestPerHour: 0.01, versionLabel: V1 },
];

/** dinner_party subset (wine-led) — values per the seed's derivation. */
const DINNER_NORMS: readonly EventNormRow[] = [
  { drinkType: 'wine_still', normValuePerGuestPerHour: 0.13, versionLabel: V1 },
  { drinkType: 'beer', normValuePerGuestPerHour: 0.16, versionLabel: V1 },
  { drinkType: 'intermediate_products', normValuePerGuestPerHour: 0.02, versionLabel: V1 },
];

/** Canonical casual-gathering event: 10 guests, 4 hours, 2026-06-12. */
function casualInput(overrides: Partial<EventCalcInput> = {}): EventCalcInput {
  return {
    eventDate: '2026-06-12',
    eventProfile: 'casual_gathering',
    guests: 10,
    durationHours: 4,
    norms: CASUAL_NORMS,
    ...overrides,
  };
}

/** Run the calculator, returning a thrown error (fails the test on no-throw). */
function errorOf(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected the function to throw, but it returned');
}

// ---------------------------------------------------------------------------
// Consumption computation — exactness
// ---------------------------------------------------------------------------

describe('computeConsumption — exact arithmetic', () => {
  it('beer 0.32 l/g/h × 10 guests × 4 h = exactly 12 800 ml (12.8 l)', () => {
    const lines = computeConsumption([CASUAL_NORMS[0]], 10, 4);
    expect(lines).toEqual([
      {
        drinkType: 'beer',
        needMl: 12_800,
        needLitres: 12.8,
        versionLabel: V1,
      },
    ]);
  });

  it('fractional norms stay exact: 0.21 l × 3 guests × 5 h = 3 150 ml', () => {
    const lines = computeConsumption(
      [{ drinkType: 'other_fermented', normValuePerGuestPerHour: 0.21, versionLabel: V1 }],
      3,
      5,
    );
    expect(lines[0].needMl).toBe(3_150);
    expect(lines[0].needLitres).toBe(3.15);
  });

  it('tiny norms stay exact: 0.03 l × 4 guests × 1 h = 120 ml', () => {
    const lines = computeConsumption(
      [{ drinkType: 'wine_sparkling', normValuePerGuestPerHour: 0.03, versionLabel: V1 }],
      4,
      1,
    );
    expect(lines[0].needMl).toBe(120);
    expect(lines[0].needLitres).toBe(0.12);
  });

  it('orders lines by drinkType ascending regardless of input row order', () => {
    const shuffled = [...CASUAL_NORMS].reverse();
    const lines = computeConsumption(shuffled, 10, 4);
    expect(lines.map((l) => l.drinkType)).toEqual([
      'beer',
      'intermediate_products',
      'other_fermented',
      'spirits',
      'wine_sparkling',
      'wine_still',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Minimal-surplus shopping list
// ---------------------------------------------------------------------------

describe('toShoppingList — minimal-surplus rounding', () => {
  it('exact multiple prefers the fewest containers: 3 000 ml still wine → 1 × 3.0 l bag-in-box, surplus 0', () => {
    // casual wine_still 0.06 l × 25 guests × 2 h = 3 000 ml exactly.
    const lines = toShoppingList(
      computeConsumption([CASUAL_NORMS[1]], 25, 2),
    );
    expect(lines[0].needMl).toBe(3_000);
    expect(lines[0].plannedUnits).toEqual([
      { sizeMl: 3000, sizeLitres: 3, description: '3.0 l bag-in-box', quantity: 1 },
    ]);
    expect(lines[0].totalUnits).toBe(1);
    expect(lines[0].purchasedMl).toBe(3_000);
    expect(lines[0].surplusMl).toBe(0);
    expect(lines[0].surplusLitres).toBe(0);
  });

  it('just over a multiple shows the surplus: 120 ml spirits → 1 × 0.5 l, surplus 380 ml', () => {
    // casual spirits 0.01 l × 4 guests × 3 h = 120 ml; smallest spirit
    // bottle is 500 ml, so the 380 ml surplus is visible, not hidden.
    const lines = toShoppingList(
      computeConsumption([CASUAL_NORMS[5]], 4, 3),
    );
    expect(lines[0].needMl).toBe(120);
    expect(lines[0].plannedUnits).toEqual([
      { sizeMl: 500, sizeLitres: 0.5, description: '0.5 l bottle', quantity: 1 },
    ]);
    expect(lines[0].totalUnits).toBe(1);
    expect(lines[0].purchasedMl).toBe(500);
    expect(lines[0].surplusMl).toBe(380);
    expect(lines[0].surplusLitres).toBe(0.38);
  });

  it('mixes two sizes for zero surplus: 12 800 ml beer → 19 × 0.5 l + 10 × 0.33 l', () => {
    // 19 × 500 + 10 × 330 = 12 800 ml exactly — the unique zero-surplus
    // plan for {330, 500} at this need (50a + 33b = 1280 ⇒ b ≡ 10 mod 50).
    const lines = toShoppingList(
      computeConsumption([CASUAL_NORMS[0]], 10, 4),
    );
    expect(lines[0].needMl).toBe(12_800);
    // Size descending: largest container first.
    expect(lines[0].plannedUnits).toEqual([
      { sizeMl: 500, sizeLitres: 0.5, description: '0.5 l can', quantity: 19 },
      { sizeMl: 330, sizeLitres: 0.33, description: '0.33 l can', quantity: 10 },
    ]);
    expect(lines[0].totalUnits).toBe(29);
    expect(lines[0].purchasedMl).toBe(12_800);
    expect(lines[0].surplusMl).toBe(0);
  });

  it('container-count tiebreak: 1 500 ml sparkling → 1 × 1.5 l magnum over 2 × 0.75 l (both surplus 0)', () => {
    // casual wine_sparkling 0.03 l × 50 guests × 1 h = 1 500 ml.
    const lines = toShoppingList(
      computeConsumption([CASUAL_NORMS[2]], 50, 1),
    );
    expect(lines[0].surplusMl).toBe(0);
    expect(lines[0].plannedUnits).toEqual([
      { sizeMl: 1500, sizeLitres: 1.5, description: '1.5 l magnum', quantity: 1 },
    ]);
  });

  it('unit-size tiebreak: 1 500 ml intermediate → 2 × 0.75 l over 1.0 l + 0.5 l (same surplus, same count, smaller largest unit)', () => {
    // dinner intermediate 0.02 l × 25 guests × 3 h = 1 500 ml. Both
    // {2 × 750} and {1 × 1000 + 1 × 500} are surplus-0, 2-container
    // plans; the documented tiebreak prefers the plan whose largest
    // unit is smaller (750 < 1000).
    const lines = toShoppingList(
      computeConsumption([DINNER_NORMS[2]], 25, 3),
    );
    expect(lines[0].needMl).toBe(1_500);
    expect(lines[0].surplusMl).toBe(0);
    expect(lines[0].plannedUnits).toEqual([
      { sizeMl: 750, sizeLitres: 0.75, description: '0.75 l bottle', quantity: 2 },
    ]);
  });

  it('every line carries the norms version (R5 provenance)', () => {
    const result = calculateEventShoppingList(casualInput());
    if (result.status !== 'COMPUTED') throw new Error('expected COMPUTED');
    expect(result.normsVersion).toBe(V1);
    for (const line of result.lines) {
      expect(line.versionLabel).toBe(V1);
    }
  });
});

// ---------------------------------------------------------------------------
// Boundaries — zero guests / zero duration
// ---------------------------------------------------------------------------

describe('zero guests / zero duration — valid, all-zero COMPUTED list', () => {
  it('zero guests: need 0, buys nothing, surplus 0, version still named', () => {
    const result = calculateEventShoppingList(casualInput({ guests: 0 }));
    if (result.status !== 'COMPUTED') throw new Error('expected COMPUTED');
    expect(result.normsVersion).toBe(V1);
    expect(result.lines).toHaveLength(CASUAL_NORMS.length);
    for (const line of result.lines) {
      expect(line.needMl).toBe(0);
      expect(line.plannedUnits).toEqual([]);
      expect(line.totalUnits).toBe(0);
      expect(line.purchasedMl).toBe(0);
      expect(line.surplusMl).toBe(0);
    }
  });

  it('zero duration behaves identically', () => {
    const result = calculateEventShoppingList(casualInput({ durationHours: 0 }));
    if (result.status !== 'COMPUTED') throw new Error('expected COMPUTED');
    for (const line of result.lines) {
      expect(line.needMl).toBe(0);
      expect(line.surplusMl).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Norms version handling
// ---------------------------------------------------------------------------

describe('norms version handling', () => {
  it('rejects norms spanning multiple version labels — no version is silently preferred', () => {
    const mixed: readonly EventNormRow[] = [
      CASUAL_NORMS[0],
      { drinkType: 'wine_still', normValuePerGuestPerHour: 0.06, versionLabel: V2 },
    ];
    expect(errorOf(() => calculateEventShoppingList(casualInput({ norms: mixed })))).toBeInstanceOf(
      MixedNormVersionsError,
    );
    // The step is guarded too — V2 sourcing cannot bypass it.
    expect(errorOf(() => computeConsumption(mixed, 10, 4))).toBeInstanceOf(MixedNormVersionsError);
  });

  it('toShoppingList rejects mixed versions in hand-built consumption lines', () => {
    const mixedLines = computeConsumption([CASUAL_NORMS[0]], 10, 4).map((line, i) =>
      i === 0 ? line : { ...line, versionLabel: V2 },
    );
    // Single line stays single-version; add a second line from V2.
    expect(() =>
      toShoppingList([
        ...mixedLines,
        { ...mixedLines[0], drinkType: 'spirits', versionLabel: V2 },
      ]),
    ).toThrowError(MixedNormVersionsError);
  });

  it('empty norms input yields the explicit NO_PUBLISHED_NORMS result state', () => {
    const result = calculateEventShoppingList(casualInput({ norms: [] }));
    expect(result).toEqual({
      status: 'NO_PUBLISHED_NORMS',
      eventDate: '2026-06-12',
      eventProfile: 'casual_gathering',
      guests: 10,
      durationHours: 4,
    });
  });
});

// ---------------------------------------------------------------------------
// Inconsistent norms and invalid input
// ---------------------------------------------------------------------------

describe('inconsistent norms input is rejected, never absorbed', () => {
  it('duplicate drink type rows', () => {
    const dupes: readonly EventNormRow[] = [CASUAL_NORMS[0], CASUAL_NORMS[0]];
    const err = errorOf(() => calculateEventShoppingList(casualInput({ norms: dupes })));
    expect(err).toBeInstanceOf(InconsistentNormsError);
    expect((err as InconsistentNormsError).reason).toBe('DUPLICATE_DRINK_TYPE');
  });

  it('unknown drink type', () => {
    const unknown: readonly EventNormRow[] = [
      { drinkType: 'moonshine', normValuePerGuestPerHour: 0.5, versionLabel: V1 },
    ];
    const err = errorOf(() => calculateEventShoppingList(casualInput({ norms: unknown })));
    expect(err).toBeInstanceOf(InconsistentNormsError);
    expect((err as InconsistentNormsError).reason).toBe('UNKNOWN_DRINK_TYPE');
  });

  it('norm value with sub-millilitre content (0.3333 l) — rejected, not rounded', () => {
    const subMl: readonly EventNormRow[] = [
      { drinkType: 'beer', normValuePerGuestPerHour: 0.3333, versionLabel: V1 },
    ];
    const err = errorOf(() => calculateEventShoppingList(casualInput({ norms: subMl })));
    expect(err).toBeInstanceOf(InconsistentNormsError);
    expect((err as InconsistentNormsError).reason).toBe('INVALID_NORM_VALUE');
  });

  it.each([0, -0.32, Number.NaN, Number.POSITIVE_INFINITY])(
    'non-positive / non-finite norm value %p rejected',
    (value) => {
      const bad: readonly EventNormRow[] = [
        { drinkType: 'beer', normValuePerGuestPerHour: value, versionLabel: V1 },
      ];
      const err = errorOf(() => calculateEventShoppingList(casualInput({ norms: bad })));
      expect((err as InconsistentNormsError).reason).toBe('INVALID_NORM_VALUE');
    },
  );

  it('blank version label', () => {
    const unlabeled: readonly EventNormRow[] = [
      { drinkType: 'beer', normValuePerGuestPerHour: 0.32, versionLabel: '  ' },
    ];
    const err = errorOf(() => calculateEventShoppingList(casualInput({ norms: unlabeled })));
    expect((err as InconsistentNormsError).reason).toBe('MISSING_VERSION_LABEL');
  });

  it('unknown event profile', () => {
    const err = errorOf(() =>
      calculateEventShoppingList({
        ...casualInput(),
        eventProfile: 'wedding' as EventCalcInput['eventProfile'],
      }),
    );
    expect(err).toBeInstanceOf(InconsistentNormsError);
    expect((err as InconsistentNormsError).reason).toBe('UNKNOWN_EVENT_PROFILE');
  });
});

describe('invalid event input is rejected', () => {
  it.each([
    ['negative guests', { guests: -1 }],
    ['fractional guests', { guests: 10.5 }],
    ['NaN guests', { guests: Number.NaN }],
    ['fractional duration (whole-hours contract)', { durationHours: 2.5 }],
    ['negative duration', { durationHours: -4 }],
    ['non-finite duration', { durationHours: Number.POSITIVE_INFINITY }],
  ])('%s throws InvalidEventInputError', (_name, overrides) => {
    expect(errorOf(() => calculateEventShoppingList(casualInput(overrides)))).toBeInstanceOf(
      InvalidEventInputError,
    );
  });

  it('non-ISO event date', () => {
    expect(() =>
      calculateEventShoppingList(casualInput({ eventDate: '2026/06/12' })),
    ).toThrowError(InvalidEventInputError);
  });

  it('a need volume beyond the safe-integer range throws instead of drifting', () => {
    // 320 ml × 10^15 guests overflows Number.MAX_SAFE_INTEGER — the
    // guard must refuse, not produce a drifted float product.
    expect(() => computeConsumption([CASUAL_NORMS[0]], 1e15, 4)).toThrowError(
      InvalidEventInputError,
    );
  });
});

// ---------------------------------------------------------------------------
// Determinism and the V2 extension seam
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('identical input produces an identical result, run to run', () => {
    expect(calculateEventShoppingList(casualInput())).toEqual(
      calculateEventShoppingList(casualInput()),
    );
  });

  it('norm row order never perturbs the shopping list', () => {
    const forward = calculateEventShoppingList(casualInput());
    const reversed = calculateEventShoppingList(casualInput({ norms: [...CASUAL_NORMS].reverse() }));
    expect(reversed).toEqual(forward);
  });

  it('the exported steps compose to exactly the orchestrator result (V2 seam)', () => {
    const orchestrated = calculateEventShoppingList(casualInput());
    const stepped = toShoppingList(
      computeConsumption(casualInput().norms, casualInput().guests, casualInput().durationHours),
    );
    if (orchestrated.status !== 'COMPUTED') throw new Error('expected COMPUTED');
    expect(stepped).toEqual(orchestrated.lines);
  });
});

// ---------------------------------------------------------------------------
// Catalogue and vocabulary pins
// ---------------------------------------------------------------------------

describe('retail unit catalogue and vocabulary pins', () => {
  it('every drink type has at least one retail unit, sizes strictly ascending', () => {
    for (const drinkType of EVENT_CALC_DRINK_TYPES) {
      const units = RETAIL_UNITS_BY_DRINK_TYPE[drinkType];
      expect(units.length).toBeGreaterThan(0);
      for (let i = 1; i < units.length; i += 1) {
        expect(units[i].sizeMl).toBeGreaterThan(units[i - 1].sizeMl);
      }
    }
  });

  it('catalogue values match the documented Finnish retail sizes', () => {
    expect(RETAIL_UNITS_BY_DRINK_TYPE.beer.map((u) => u.sizeMl)).toEqual([330, 500]);
    expect(RETAIL_UNITS_BY_DRINK_TYPE.other_fermented.map((u) => u.sizeMl)).toEqual([330, 500]);
    expect(RETAIL_UNITS_BY_DRINK_TYPE.wine_still.map((u) => u.sizeMl)).toEqual([750, 1000, 3000]);
    expect(RETAIL_UNITS_BY_DRINK_TYPE.wine_sparkling.map((u) => u.sizeMl)).toEqual([750, 1500]);
    expect(RETAIL_UNITS_BY_DRINK_TYPE.intermediate_products.map((u) => u.sizeMl)).toEqual([
      500, 750, 1000,
    ]);
    expect(RETAIL_UNITS_BY_DRINK_TYPE.spirits.map((u) => u.sizeMl)).toEqual([500, 700]);
  });

  it('vocabulary mirrors the tax-category keys and MVP profiles', () => {
    expect(EVENT_CALC_DRINK_TYPES).toEqual([
      'beer',
      'wine_still',
      'wine_sparkling',
      'intermediate_products',
      'other_fermented',
      'spirits',
    ]);
    expect(EVENT_CALC_EVENT_PROFILES).toEqual(['casual_gathering', 'dinner_party', 'celebration']);
  });
});
