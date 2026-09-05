/**
 * Tests for the V2 cross-border sourcing plan (task 4.5, spec
 * event-calculator "V2 cross-border sourcing plan", design R6).
 *
 * Pinned here, with exact figures:
 * - the cheapest source wins per line, with the component figures shown;
 * - a foreign source wins ONLY by undercutting the domestic total — an
 *   exact tie keeps the domestic store (FI first in the fixed order);
 * - total-cost ties between foreign sources break by
 *   SOURCING_COUNTRY_ORDER, identically regardless of the order the
 *   options arrive in (the determinism scenario 4.6 pins);
 * - the budget NEVER changes the assignment: an exceeded budget returns
 *   the complete plan with an explicit met:false block and the exact
 *   overrun (never silent truncation);
 * - unpriced lines are an explicit value, never silently dropped;
 * - every caller-contract violation (unknown country, duplicate or
 *   missing domestic option, bad figures, budget shape, foreign key)
 *   throws SourcingInputError with its reason.
 *
 * Options fixtures mirror what the API route maps in from the
 * landed-cost engines (ComputedItemCostsResult + transport) but are
 * INLINE for purity: the module must not import engine code, and
 * neither may its tests.
 *
 * @module EventSourcingTests
 */
import { describe, it, expect } from 'vitest';
import { buildEventSourcingPlan } from '../sourcing';
import {
  SOURCING_COUNTRY_ORDER,
  SourcingInputError,
  sourcingCountryRank,
} from '../sourcing.types';
import type { EventSourcingInput, SourcingCostOption, EventSourcingPlan } from '../sourcing.types';
import { calculateEventShoppingList } from '../eventcalc';
import type { EventCalcResult } from '../eventcalc.types';
import type { EventCalcInput, EventNormRow, EventDrinkType, EventShoppingList } from '../eventcalc.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const V1 = 'standard-drink-fi-2026.1';

/** Single-type norms keep the arithmetic readable; a second type pins multi-line behavior. */
const NORMS: readonly EventNormRow[] = [
  { drinkType: 'beer', normValuePerGuestPerHour: 0.5, versionLabel: V1 },
  { drinkType: 'wine_still', normValuePerGuestPerHour: 0.1, versionLabel: V1 },
];

function planInput(overrides: Partial<EventCalcInput> = {}): EventCalcInput {
  return {
    eventDate: '2026-06-12',
    eventProfile: 'casual_gathering',
    guests: 10,
    durationHours: 4,
    norms: NORMS,
    ...overrides,
  };
}

// 0.5 l × 10 × 4 = 20 000 ml need → 40 × 0.5 l cans = 20 000 ml, zero surplus.
function assertComputed(result: EventCalcResult): EventShoppingList {
  if (result.status !== 'COMPUTED') throw new Error('fixture: norms must compute');
  return result;
}

const SHOPPING_LIST: EventShoppingList = assertComputed(calculateEventShoppingList(planInput()));

/** A complete, valid option — override any field per test. */
function option(overrides: Partial<SourcingCostOption> & { country: string }): SourcingCostOption {
  return {
    retailCents: 5_000,
    exciseCents: 0,
    containerDutyCents: 0,
    transportCents: 0,
    statuses: {
      retail: 'ESTIMATED',
      excise: 'ESTIMATED',
      containerDuty: 'ESTIMATED',
      transport: 'UNAVAILABLE',
    },
    confidenceOverall: 'MEDIUM',
    // Fixed per country, NOT per instance: deep-equality between runs must
    // hold (the module echoes these verbatim onto the plan line).
    datasetVersions: [`fixture-ds-${overrides.country}`],
    ...overrides,
  };
}

/** Domestic (FI) plus one foreign option, as the route builds them. */
function domesticAnd(foreign: SourcingCostOption): SourcingCostOption[] {
  return [option({ country: 'FI' }), foreign];
}

function sourcingInput(
  overrides: Partial<Omit<EventSourcingInput, 'plan'>> & { plan?: EventCalcInput } = {},
): EventSourcingInput {
  const { plan, ...rest } = overrides;
  const resolvedPlan = plan ? assertComputed(calculateEventShoppingList(plan)) : SHOPPING_LIST;
  return {
    plan: resolvedPlan,
    options: new Map([
      ['beer', domesticAnd(option({ country: 'EE', retailCents: 3_000 }))],
      ['wine_still', domesticAnd(option({ country: 'EE', retailCents: 4_000 }))],
    ]),
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// Assignment — cheapest source wins, figures shown
// ---------------------------------------------------------------------------

describe('buildEventSourcingPlan — assignment', () => {
  it('assigns a line to the foreign source that undercuts the domestic total, with figures', () => {
    const plan = buildEventSourcingPlan(
      sourcingInput({
        options: new Map([
          // FI: 5 000 €-cents retail; EE: 3 000 + 1 200 excise + 300 duty = 4 500 — undercuts.
          ['beer', [option({ country: 'FI' }), option({ country: 'EE', retailCents: 3_000, exciseCents: 1_200, containerDutyCents: 300 })]],
        ]),
      }),
    );

    expect(plan.unpricedDrinkTypes).toEqual(['wine_still']);
    const line = plan.lines[0]!;
    expect(line.drinkType).toBe('beer');
    expect(line.sourceCountry).toBe('EE');
    expect(line.sourceKind).toBe('FOREIGN');
    expect(line.components).toEqual({
      retailCents: 3_000,
      exciseCents: 1_200,
      containerDutyCents: 300,
      transportCents: 0,
    });
    expect(line.totalCents).toBe(4_500);
    expect(line.domesticTotalCents).toBe(5_000);
    expect(line.savingsVsDomesticCents).toBe(500);
    expect(plan.totalCents).toBe(4_500);
    expect(plan.budget).toBeNull();
  });

  it('keeps the domestic store when it is cheaper (taxes erase the shelf-price gap)', () => {
    const plan = buildEventSourcingPlan(
      sourcingInput({
        options: new Map([
          // EE shelf price is lower, but excise + duty push the total above FI.
          ['beer', [option({ country: 'FI', retailCents: 5_000 }), option({ country: 'EE', retailCents: 3_000, exciseCents: 1_500, containerDutyCents: 900 })]],
        ]),
      }),
    );

    const line = plan.lines[0]!;
    expect(line.sourceCountry).toBe('FI');
    expect(line.sourceKind).toBe('DOMESTIC');
    expect(line.totalCents).toBe(5_000);
    expect(line.savingsVsDomesticCents).toBe(0);
  });

  it('breaks an exact domestic/foreign tie in favour of the domestic store', () => {
    const plan = buildEventSourcingPlan(
      sourcingInput({
        options: new Map([
          ['beer', [option({ country: 'EE', retailCents: 3_800, exciseCents: 1_200 }), option({ country: 'FI', retailCents: 5_000 })]],
        ]),
      }),
    );

    expect(plan.lines[0]!.sourceCountry).toBe('FI');
  });

  it('orders lines by drink type and sums the plan total across priced lines', () => {
    const plan = buildEventSourcingPlan(sourcingInput());

    expect(plan.lines.map((line) => line.drinkType)).toEqual(['beer', 'wine_still']);
    expect(plan.totalCents).toBe(3_000 + 4_000);
    expect(plan.unpricedDrinkTypes).toEqual([]);
  });

  it('echoes statuses, confidence, and dataset versions of the winning option verbatim', () => {
    const winner = option({
      country: 'LV',
      retailCents: 2_500,
      statuses: { retail: 'STALE', excise: 'VERIFIED', containerDuty: 'ESTIMATED', transport: 'UNAVAILABLE' },
      confidenceOverall: 'LOW',
      datasetVersions: ['excise-2026.1', 'duty-2026.1'],
    });
    const plan = buildEventSourcingPlan(
      sourcingInput({
        options: new Map([['beer', [option({ country: 'FI' }), winner]]]),
      }),
    );

    const line = plan.lines[0]!;
    expect(line.statuses).toEqual(winner.statuses);
    expect(line.confidenceOverall).toBe('LOW');
    expect(line.datasetVersions).toEqual(['excise-2026.1', 'duty-2026.1']);
  });
});

// ---------------------------------------------------------------------------
// Determinism — fixed country order breaks ties, input order is irrelevant
// ---------------------------------------------------------------------------

describe('buildEventSourcingPlan — determinism', () => {
  it('breaks a three-way total tie by SOURCING_COUNTRY_ORDER, not input order', () => {
    const tie = (country: string): SourcingCostOption => option({ country, retailCents: 4_000 });
    // Same tie, two different input orders — the winner and the whole plan must be identical.
    const a = buildEventSourcingPlan(
      sourcingInput({ options: new Map([['beer', [tie('DE'), tie('LV'), option({ country: 'FI', retailCents: 5_000 })]]]) }),
    );
    const b = buildEventSourcingPlan(
      sourcingInput({ options: new Map([['beer', [tie('LV'), option({ country: 'FI', retailCents: 5_000 }), tie('DE')]]]) }),
    );

    expect(a).toEqual(b);
    // EE < LV < DE in the fixed sequence (all behind FI, which lost on total).
    expect(a.lines[0]!.sourceCountry).toBe('LV');
  });

  it('is deterministic across repeated runs with shuffled option arrays', () => {
    const options = [
      option({ country: 'FI', retailCents: 5_000 }),
      option({ country: 'SE', retailCents: 4_200, transportCents: 100 }),
      option({ country: 'EE', retailCents: 4_000, exciseCents: 250 }),
      option({ country: 'DE', retailCents: 4_000, exciseCents: 250 }),
    ];
    const run = (order: readonly SourcingCostOption[]): EventSourcingPlan['lines'] =>
      buildEventSourcingPlan(sourcingInput({ options: new Map([['beer', order]]) })).lines;

    expect(run(options)).toEqual(run([...options].reverse()));
    expect(run(options)[0]!.sourceCountry).toBe('EE'); // EE before DE at 4 250
  });

  it('fixes the documented country sequence with FI first', () => {
    expect([...SOURCING_COUNTRY_ORDER]).toEqual(['FI', 'EE', 'LV', 'LT', 'SE', 'DE']);
    expect(sourcingCountryRank('FI')).toBe(0);
    expect(sourcingCountryRank('FI')).toBeLessThan(sourcingCountryRank('EE'));
  });
});

// ---------------------------------------------------------------------------
// Budget — explicit degradation, never silent truncation
// ---------------------------------------------------------------------------

describe('buildEventSourcingPlan — budget', () => {
  it('reports met:true when the priced total fits and the plan is unchanged', () => {
    const withBudget = buildEventSourcingPlan(sourcingInput({ budgetCents: 7_000 }));
    const withoutBudget = buildEventSourcingPlan(sourcingInput());

    expect(withBudget.lines).toEqual(withoutBudget.lines);
    expect(withBudget.budget).toEqual({ limitCents: 7_000, totalCents: 7_000, met: true, overrunCents: 0 });
  });

  it('degrades explicitly on overrun: complete plan, met:false, exact overrun', () => {
    const withBudget = buildEventSourcingPlan(sourcingInput({ budgetCents: 5_000 }));
    const withoutBudget = buildEventSourcingPlan(sourcingInput());

    // Truncation would show up as fewer/cheaper lines — pinned absent.
    expect(withBudget.lines).toEqual(withoutBudget.lines);
    expect(withBudget.totalCents).toBe(withoutBudget.totalCents);
    expect(withBudget.budget).toEqual({ limitCents: 5_000, totalCents: 7_000, met: false, overrunCents: 2_000 });
  });

  it('rejects an invalid budget shape', () => {
    for (const budgetCents of [0, -1, 1.5, Number.NaN]) {
      expect(() => buildEventSourcingPlan(sourcingInput({ budgetCents }))).toThrow(SourcingInputError);
    }
  });
});

// ---------------------------------------------------------------------------
// Unpriced lines — explicit values, not errors
// ---------------------------------------------------------------------------

describe('buildEventSourcingPlan — unpriced lines', () => {
  it('lists plan lines without options as explicitly unpriced and excludes them from totals', () => {
    const plan = buildEventSourcingPlan(
      sourcingInput({
        options: new Map([['wine_still', domesticAnd(option({ country: 'EE', retailCents: 4_000 }))]]),
      }),
    );

    expect(plan.lines.map((line) => line.drinkType)).toEqual(['wine_still']);
    expect(plan.unpricedDrinkTypes).toEqual(['beer']);
    expect(plan.totalCents).toBe(4_000);
  });

  it('handles a fully unpriced plan as an empty, valid plan', () => {
    const plan = buildEventSourcingPlan(sourcingInput({ options: new Map(), budgetCents: 7_000 }));

    expect(plan.lines).toEqual([]);
    expect(plan.unpricedDrinkTypes).toEqual(['beer', 'wine_still']);
    expect(plan.totalCents).toBe(0);
    expect(plan.budget).toEqual({ limitCents: 7_000, totalCents: 0, met: true, overrunCents: 0 });
  });
});

// ---------------------------------------------------------------------------
// Caller-contract violations
// ---------------------------------------------------------------------------

describe('buildEventSourcingPlan — validation', () => {
  it('rejects an unknown country', () => {
    const input = sourcingInput({
      options: new Map([['beer', domesticAnd(option({ country: 'ESTONIA', retailCents: 3_000 }))]]),
    });
    expect(() => buildEventSourcingPlan(input)).toThrow(/UNKNOWN_COUNTRY/);
  });

  it('rejects duplicate country options per line', () => {
    const input = sourcingInput({
      options: new Map([['beer', [option({ country: 'FI' }), option({ country: 'EE' }), option({ country: 'EE', retailCents: 9_000 })]]]),
    });
    expect(() => buildEventSourcingPlan(input)).toThrow(/DUPLICATE_COUNTRY_OPTION/);
  });

  it('rejects a priced line without a domestic option, and a duplicated domestic one', () => {
    const missing = sourcingInput({ options: new Map([['beer', [option({ country: 'EE' })]]]) });
    expect(() => buildEventSourcingPlan(missing)).toThrow(/MISSING_DOMESTIC_OPTION/);

    const doubled = sourcingInput({
      options: new Map([['beer', [option({ country: 'FI' }), option({ country: 'FI', retailCents: 1 })]]]),
    });
    // Duplicate detection runs before the domestic count (documented order).
    expect(() => buildEventSourcingPlan(doubled)).toThrow(/DUPLICATE_COUNTRY_OPTION/);
  });

  it('rejects negative, fractional, or non-finite cost figures', () => {
    for (const figure of ['exciseCents', 'retailCents', 'containerDutyCents', 'transportCents'] as const) {
      for (const value of [-1, 2.5, Number.NaN]) {
        const input = sourcingInput({
          options: new Map([['beer', domesticAnd(option({ country: 'EE', [figure]: value }))]]),
        });
        expect(() => buildEventSourcingPlan(input)).toThrow(/INVALID_COST_FIGURE/);
      }
    }
  });

  it('rejects options naming a drink type outside the plan', () => {
    const input = sourcingInput({
      options: new Map([
        ['beer', domesticAnd(option({ country: 'EE' }))],
        ['spirits' as EventDrinkType, domesticAnd(option({ country: 'EE' }))],
      ]),
    });
    expect(() => buildEventSourcingPlan(input)).toThrow(/LINE_NOT_IN_PLAN/);
  });

  it('rejects an empty option set for a priced line', () => {
    const input = sourcingInput({ options: new Map([['beer', []]]) });
    expect(() => buildEventSourcingPlan(input)).toThrow(/UNPRICED_LINE/);
  });
});
