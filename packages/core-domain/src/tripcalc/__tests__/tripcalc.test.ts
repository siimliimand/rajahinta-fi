/**
 * Tests for the trip feasibility calculator (task 5.2, spec
 * trip-feasibility-calculator, design R7).
 *
 * Exact numeric expectations are computed by hand and were
 * float-verified in node before writing (whatif precedent). Allowance
 * fixtures mirror the committed 5.1 record contract and transcribe the
 * curated seed's caps (spirits 10 l, intermediate products 20 l, still
 * wine 90 l, sparkling wine 60 l, beer 110 l; version
 * `eu-2007-74-2026.1`) — but are INLINE for purity: the module must not
 * import data-platform, and neither may its tests. The seed
 * deliberately carries NO `other_fermented` row, so the missing-row
 * boundary is exercised against real curation data.
 *
 * Boundary conventions (documented, pinned by tests):
 * - the cap is an inclusive maximum: break-even exactly at the cap is
 *   WITHIN_ALLOWANCE; the comparison uses the stated (half-up rounded)
 *   whole-litre figure;
 * - half-up rounding is pinned at exact .5 boundaries for both the
 *   per-traveller cost and the break-even volume;
 * - a non-positive price difference is the explicit NO_BREAK_EVEN line
 *   state — never a division by zero, negative volume, or Infinity;
 * - a category missing from the resolved dataset (NO_ALLOWANCE_ROW) and
 *   a quantity-only cap row (CAP_NOT_VOLUME) carry no cap figures at
 *   all — never an invented number.
 *
 * @module TripCalcTests
 */
import { describe, it, expect } from 'vitest';
import { calculateTripBreakEven } from '../tripcalc';
import {
  TRIP_CATEGORY_KEYS,
  TRIP_VEHICLE_TYPES,
  InvalidTripInputError,
} from '../tripcalc.types';
import type {
  TripCalcInput,
  TripCalcResult,
  TripResolvedAllowances,
  TripVehicleType,
} from '../tripcalc.types';
import { TRIP_DISCLAIMER_EN, TRIP_DISCLAIMER_FI } from '../tripcalc.disclaimer';

// ---------------------------------------------------------------------------
// Fixtures — 5.1 seed caps transcribed, never imported
// ---------------------------------------------------------------------------

const SEED_VERSION = 'eu-2007-74-2026.1';

/** The curated seed's five categories — other_fermented deliberately absent. */
const SEED_ALLOWANCES: TripResolvedAllowances = {
  dataset: { versionLabel: SEED_VERSION },
  limits: [
    { category: 'spirits', volumeCapLitres: 10, quantityCap: null },
    { category: 'intermediate_products', volumeCapLitres: 20, quantityCap: null },
    { category: 'wine_still', volumeCapLitres: 90, quantityCap: null },
    { category: 'wine_sparkling', volumeCapLitres: 60, quantityCap: null },
    { category: 'beer', volumeCapLitres: 110, quantityCap: null },
  ],
};

/**
 * Canonical trip: 2 travellers, 45.00 € tickets + 30.00 € fuel →
 * 7500 c ÷ 2 = 3750 c per traveller.
 */
function tripInput(overrides: Partial<TripCalcInput> = {}): TripCalcInput {
  return {
    travelDate: '2026-06-12',
    vehicleType: 'car',
    passengers: 2,
    ticketCostCents: 4500,
    fuelCostCents: 3000,
    prices: [
      { category: 'beer', domesticPriceCentsPerLitre: 250, foreignPriceCentsPerLitre: 100 },
      { category: 'spirits', domesticPriceCentsPerLitre: 3000, foreignPriceCentsPerLitre: 2500 },
    ],
    allowances: SEED_ALLOWANCES,
    ...overrides,
  };
}

/** Run the calculator, returning a thrown error (fails the test on no-throw). */
function errorOf(fn: () => unknown): InvalidTripInputError {
  try {
    fn();
  } catch (e) {
    return e as InvalidTripInputError;
  }
  throw new Error('expected the function to throw, but it returned');
}

/** Assert the rejection reason and that it is the module's own error type. */
function expectReason(fn: () => unknown, reason: string): void {
  const error = errorOf(fn);
  expect(error).toBeInstanceOf(InvalidTripInputError);
  expect(error.reason).toBe(reason);
}

/** The single BREAK_EVEN line of a one-category result. */
function soleLine(result: TripCalcResult): Extract<TripCalcResult['lines'][number], { status: 'BREAK_EVEN' }> {
  expect(result.lines).toHaveLength(1);
  const line = result.lines[0];
  if (line.status !== 'BREAK_EVEN') {
    throw new Error(`expected a BREAK_EVEN line, got ${line.status}`);
  }
  return line;
}

// ---------------------------------------------------------------------------
// Travel cost per traveller — the derivation, exactly
// ---------------------------------------------------------------------------

describe('travel cost per traveller', () => {
  it('7500 c ÷ 2 travellers = 3750 c exactly; derivation echoed on the result', () => {
    const result = calculateTripBreakEven(tripInput());
    expect(result.travelCostCents).toBe(7500);
    expect(result.travelCostPerTravellerCents).toBe(3750);
    expect(result.ticketCostCents).toBe(4500);
    expect(result.fuelCostCents).toBe(3000);
    expect(result.passengers).toBe(2);
  });

  it('half-up at an exact .5: 5 c ÷ 2 travellers → 3 c', () => {
    const result = calculateTripBreakEven(
      tripInput({ ticketCostCents: 5, fuelCostCents: 0, prices: [{ category: 'beer', domesticPriceCentsPerLitre: 100, foreignPriceCentsPerLitre: 50 }] }),
    );
    expect(result.travelCostPerTravellerCents).toBe(3);
  });

  it('7550 c ÷ 3 travellers → 2517 c (2516.67 rounds up)', () => {
    const result = calculateTripBreakEven(
      tripInput({ passengers: 3, ticketCostCents: 7550, fuelCostCents: 0 }),
    );
    expect(result.travelCostPerTravellerCents).toBe(2517);
  });
});

// ---------------------------------------------------------------------------
// Break-even volumes — exact vectors
// ---------------------------------------------------------------------------

describe('break-even computation', () => {
  it('beer: 3750 c ÷ 150 c/l = 25 l; wine_still joins and lines sort by category', () => {
    const result = calculateTripBreakEven(
      tripInput({
        prices: [
          { category: 'wine_still', domesticPriceCentsPerLitre: 1200, foreignPriceCentsPerLitre: 500 },
          { category: 'beer', domesticPriceCentsPerLitre: 250, foreignPriceCentsPerLitre: 100 },
        ],
      }),
    );
    expect(result.lines.map((line) => line.category)).toEqual(['beer', 'wine_still']);
    const beer = result.lines[0];
    const wine = result.lines[1];
    expect(beer.status).toBe('BREAK_EVEN');
    expect(wine.status).toBe('BREAK_EVEN');
    if (beer.status === 'BREAK_EVEN') {
      expect(beer.breakEvenLitres).toBe(25);
      expect(beer.priceDifferenceCentsPerLitre).toBe(150);
    }
    if (wine.status === 'BREAK_EVEN') {
      // 3750 ÷ 700 = 5.357… → 5 (remainder 250 × 2 = 500 < 700 stays down)
      expect(wine.breakEvenLitres).toBe(5);
      expect(wine.priceDifferenceCentsPerLitre).toBe(700);
    }
  });

  it('half-up boundary: 3750 c ÷ 300 c/l = 12.5 l → 13 l', () => {
    const line = soleLine(
      calculateTripBreakEven(
        tripInput({ prices: [{ category: 'wine_still', domesticPriceCentsPerLitre: 1300, foreignPriceCentsPerLitre: 1000 }] }),
      ),
    );
    expect(line.breakEvenLitres).toBe(13);
  });

  it('zero travel cost breaks even at exactly 0 litres', () => {
    const line = soleLine(
      calculateTripBreakEven(
        tripInput({ ticketCostCents: 0, fuelCostCents: 0, prices: [{ category: 'beer', domesticPriceCentsPerLitre: 250, foreignPriceCentsPerLitre: 100 }] }),
      ),
    );
    expect(line.breakEvenLitres).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// NO_BREAK_EVEN — explicit value state, never zero-division or negatives
// ---------------------------------------------------------------------------

describe('no-break-even state', () => {
  it('equal prices (difference 0) yield NO_BREAK_EVEN with no volume fields', () => {
    const result = calculateTripBreakEven(
      tripInput({ prices: [{ category: 'spirits', domesticPriceCentsPerLitre: 3000, foreignPriceCentsPerLitre: 3000 }] }),
    );
    expect(result.lines).toEqual([
      {
        status: 'NO_BREAK_EVEN',
        category: 'spirits',
        domesticPriceCentsPerLitre: 3000,
        foreignPriceCentsPerLitre: 3000,
        priceDifferenceCentsPerLitre: 0,
      },
    ]);
  });

  it('foreign above domestic (difference −100) yields NO_BREAK_EVEN, never a negative volume', () => {
    const result = calculateTripBreakEven(
      tripInput({ prices: [{ category: 'beer', domesticPriceCentsPerLitre: 1200, foreignPriceCentsPerLitre: 1300 }] }),
    );
    const line = result.lines[0];
    expect(line.status).toBe('NO_BREAK_EVEN');
    expect(line).not.toHaveProperty('breakEvenLitres');
    expect(line).not.toHaveProperty('cappedBreakEvenLitres');
    expect(line).not.toHaveProperty('capStatus');
  });

  it('statuses are per line: one category can break even while another cannot', () => {
    const result = calculateTripBreakEven(tripInput());
    expect(result.lines.map((line) => line.status)).toEqual(['BREAK_EVEN', 'BREAK_EVEN']);
    const mixed = calculateTripBreakEven(
      tripInput({
        prices: [
          { category: 'spirits', domesticPriceCentsPerLitre: 2500, foreignPriceCentsPerLitre: 2500 },
          { category: 'beer', domesticPriceCentsPerLitre: 250, foreignPriceCentsPerLitre: 100 },
        ],
      }),
    );
    expect(mixed.lines.map((line) => [line.category, line.status])).toEqual([
      ['beer', 'BREAK_EVEN'],
      ['spirits', 'NO_BREAK_EVEN'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Allowance capping — boundary cases against the 5.1 seed caps
// ---------------------------------------------------------------------------

describe('allowance capping', () => {
  it('within allowance: 25 l beer against a 110 l cap stays uncapped', () => {
    const result = calculateTripBreakEven(tripInput());
    const beer = result.lines[0];
    if (beer.status !== 'BREAK_EVEN') throw new Error('expected BREAK_EVEN');
    expect(beer.capStatus).toBe('WITHIN_ALLOWANCE');
    expect(beer.capLitres).toBe(110);
    expect(beer.cappedBreakEvenLitres).toBe(25);
  });

  it('exactly at cap is WITHIN: cost 2500 ÷ diff 250 = 10 l against the 10 l spirits cap', () => {
    const line = soleLine(
      calculateTripBreakEven(
        tripInput({
          passengers: 1,
          ticketCostCents: 2500,
          fuelCostCents: 0,
          prices: [{ category: 'spirits', domesticPriceCentsPerLitre: 3000, foreignPriceCentsPerLitre: 2750 }],
        }),
      ),
    );
    expect(line.breakEvenLitres).toBe(10);
    expect(line.capStatus).toBe('WITHIN_ALLOWANCE');
    expect(line.cappedBreakEvenLitres).toBe(10);
  });

  it('just over cap: cost 2750 ÷ diff 250 = 11 l > 10 l → CAPPED, uncapped figure kept beside the cap', () => {
    const line = soleLine(
      calculateTripBreakEven(
        tripInput({
          passengers: 1,
          ticketCostCents: 2750,
          fuelCostCents: 0,
          prices: [{ category: 'spirits', domesticPriceCentsPerLitre: 3000, foreignPriceCentsPerLitre: 2750 }],
        }),
      ),
    );
    expect(line.breakEvenLitres).toBe(11);
    expect(line.capStatus).toBe('CAPPED');
    expect(line.capLitres).toBe(10);
    expect(line.cappedBreakEvenLitres).toBe(10);
  });

  it('rounded onto the cap stays within: cost 7550 ÷ 3 travellers → 2517 c ÷ 250 c/l → 10 l = cap', () => {
    const line = soleLine(
      calculateTripBreakEven(
        tripInput({
          passengers: 3,
          ticketCostCents: 7550,
          fuelCostCents: 0,
          prices: [{ category: 'spirits', domesticPriceCentsPerLitre: 3000, foreignPriceCentsPerLitre: 2750 }],
        }),
      ),
    );
    expect(line.breakEvenLitres).toBe(10);
    expect(line.capStatus).toBe('WITHIN_ALLOWANCE');
  });

  it('missing category (other_fermented, deliberately unseeded) is NO_ALLOWANCE_ROW — uncapped figure, no invented cap', () => {
    const result = calculateTripBreakEven(
      tripInput({
        prices: [{ category: 'other_fermented', domesticPriceCentsPerLitre: 900, foreignPriceCentsPerLitre: 650 }],
      }),
    );
    expect(result.lines).toEqual([
      {
        status: 'BREAK_EVEN',
        category: 'other_fermented',
        domesticPriceCentsPerLitre: 900,
        foreignPriceCentsPerLitre: 650,
        priceDifferenceCentsPerLitre: 250,
        breakEvenLitres: 15,
        capLitres: null,
        capStatus: 'NO_ALLOWANCE_ROW',
        cappedBreakEvenLitres: null,
      },
    ]);
  });

  it('quantity-only cap row is CAP_NOT_VOLUME — no litre conversion is invented', () => {
    const result = calculateTripBreakEven(
      tripInput({
        allowances: {
          dataset: { versionLabel: 'test-quantity-only' },
          limits: [{ category: 'wine_sparkling', volumeCapLitres: null, quantityCap: 24 }],
        },
        prices: [{ category: 'wine_sparkling', domesticPriceCentsPerLitre: 1800, foreignPriceCentsPerLitre: 1550 }],
      }),
    );
    const line = soleLine(result);
    expect(line.capStatus).toBe('CAP_NOT_VOLUME');
    expect(line.capLitres).toBeNull();
    expect(line.cappedBreakEvenLitres).toBeNull();
    expect(line.breakEvenLitres).toBe(15); // 3750 ÷ 250 = 15
  });

  it('the named dataset version is the one passed in, per trip date evaluation', () => {
    const v1 = calculateTripBreakEven(tripInput());
    expect(v1.allowanceDatasetVersion).toBe('eu-2007-74-2026.1');
    const v2 = calculateTripBreakEven(
      tripInput({
        travelDate: '2027-06-12',
        allowances: {
          dataset: { versionLabel: 'eu-2027-revision.1' },
          limits: SEED_ALLOWANCES.limits,
        },
      }),
    );
    expect(v2.allowanceDatasetVersion).toBe('eu-2027-revision.1');
  });
});

// ---------------------------------------------------------------------------
// Result structure — provenance, disclaimer, determinism
// ---------------------------------------------------------------------------

describe('result structure', () => {
  it('echoes inputs, names the version, and carries the structural disclaimer', () => {
    const result = calculateTripBreakEven(tripInput());
    expect(result.status).toBe('COMPUTED');
    expect(result.travelDate).toBe('2026-06-12');
    expect(result.vehicleType).toBe('car');
    expect(result.allowanceDatasetVersion).toBe(SEED_VERSION);
    expect(result.disclaimer).toBe(TRIP_DISCLAIMER_EN);
    expect(result.disclaimer.text).toMatch(/indicative/i);
    expect(result.disclaimer.text).toMatch(/not legal advice/i);
    expect(result.disclaimer.language).toBe('en');
  });

  it('both disclaimer languages are exported with semver versions', () => {
    expect(TRIP_DISCLAIMER_FI.language).toBe('fi');
    expect(TRIP_DISCLAIMER_FI.version).toBe('1.0');
    expect(TRIP_DISCLAIMER_EN.version).toBe('1.0');
  });

  it('is deterministic and pure: same input, equal result; frozen input untouched', () => {
    const input = Object.freeze(tripInput());
    const a = calculateTripBreakEven(input);
    const b = calculateTripBreakEven(input);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Validation — caller-contract violations, first violation wins
// ---------------------------------------------------------------------------

describe('validation', () => {
  it('rejects a non-ISO travel date', () => {
    expectReason(() => calculateTripBreakEven(tripInput({ travelDate: '12.6.2026' })), 'INVALID_TRAVEL_DATE');
    expectReason(() => calculateTripBreakEven(tripInput({ travelDate: '20260612' })), 'INVALID_TRAVEL_DATE');
  });

  it('rejects unknown vehicle types despite the closed type union (defense in depth)', () => {
    expect(TRIP_VEHICLE_TYPES).toEqual(['car', 'van']);
    expectReason(
      () => calculateTripBreakEven(tripInput({ vehicleType: 'lorry' as unknown as TripVehicleType })),
      'UNKNOWN_VEHICLE_TYPE',
    );
  });

  it('rejects passengers below 1 and non-integer passengers', () => {
    expectReason(() => calculateTripBreakEven(tripInput({ passengers: 0 })), 'INVALID_PASSENGERS');
    expectReason(() => calculateTripBreakEven(tripInput({ passengers: 2.5 })), 'INVALID_PASSENGERS');
    expectReason(() => calculateTripBreakEven(tripInput({ passengers: -1 })), 'INVALID_PASSENGERS');
    expectReason(() => calculateTripBreakEven(tripInput({ passengers: Infinity })), 'INVALID_PASSENGERS');
  });

  it('rejects negative, fractional, and non-finite costs', () => {
    expectReason(() => calculateTripBreakEven(tripInput({ ticketCostCents: -1 })), 'INVALID_TICKET_COST');
    expectReason(() => calculateTripBreakEven(tripInput({ ticketCostCents: 45.5 })), 'INVALID_TICKET_COST');
    expectReason(() => calculateTripBreakEven(tripInput({ fuelCostCents: -1 })), 'INVALID_FUEL_COST');
    expectReason(() => calculateTripBreakEven(tripInput({ fuelCostCents: NaN })), 'INVALID_FUEL_COST');
  });

  it('rejects a ticket + fuel sum beyond the safe-integer range', () => {
    expectReason(
      () =>
        calculateTripBreakEven(
          tripInput({ ticketCostCents: Number.MAX_SAFE_INTEGER, fuelCostCents: 1 }),
        ),
      'TRAVEL_COST_OVERFLOW',
    );
  });

  it('rejects a blank allowance version and an empty limit list', () => {
    expectReason(
      () =>
        calculateTripBreakEven(
          tripInput({ allowances: { dataset: { versionLabel: '  ' }, limits: SEED_ALLOWANCES.limits } }),
        ),
      'INVALID_ALLOWANCE_VERSION',
    );
    expectReason(
      () =>
        calculateTripBreakEven(
          tripInput({ allowances: { dataset: { versionLabel: 'v1' }, limits: [] } }),
        ),
      'EMPTY_ALLOWANCE_LIMITS',
    );
  });

  it('rejects unknown and duplicate categories in the allowance limits', () => {
    expectReason(
      () =>
        calculateTripBreakEven(
          tripInput({
            allowances: {
              dataset: SEED_ALLOWANCES.dataset,
              limits: [{ category: 'cider', volumeCapLitres: 5, quantityCap: null }],
            },
          }),
        ),
      'UNKNOWN_ALLOWANCE_CATEGORY',
    );
    expectReason(
      () =>
        calculateTripBreakEven(
          tripInput({
            allowances: {
              dataset: SEED_ALLOWANCES.dataset,
              limits: [
                { category: 'beer', volumeCapLitres: 110, quantityCap: null },
                { category: 'beer', volumeCapLitres: 20, quantityCap: null },
              ],
            },
          }),
        ),
      'DUPLICATE_ALLOWANCE_CATEGORY',
    );
  });

  it('rejects malformed caps: both null, non-positive volume, fractional/zero quantity', () => {
    const limitsOf = (
      limit: TripResolvedAllowances['limits'][number],
    ): TripResolvedAllowances => ({
      dataset: { versionLabel: 'v1' },
      limits: [limit],
    });
    expectReason(
      () =>
        calculateTripBreakEven(
          tripInput({ allowances: limitsOf({ category: 'beer', volumeCapLitres: null, quantityCap: null }) }),
        ),
      'INVALID_ALLOWANCE_CAPS',
    );
    expectReason(
      () =>
        calculateTripBreakEven(
          tripInput({ allowances: limitsOf({ category: 'beer', volumeCapLitres: 0, quantityCap: null }) }),
        ),
      'INVALID_ALLOWANCE_CAPS',
    );
    expectReason(
      () =>
        calculateTripBreakEven(
          tripInput({ allowances: limitsOf({ category: 'beer', volumeCapLitres: -5, quantityCap: null }) }),
        ),
      'INVALID_ALLOWANCE_CAPS',
    );
    expectReason(
      () =>
        calculateTripBreakEven(
          tripInput({ allowances: limitsOf({ category: 'beer', volumeCapLitres: null, quantityCap: 1.5 }) }),
        ),
      'INVALID_ALLOWANCE_CAPS',
    );
    expectReason(
      () =>
        calculateTripBreakEven(
          tripInput({ allowances: limitsOf({ category: 'beer', volumeCapLitres: null, quantityCap: 0 }) }),
        ),
      'INVALID_ALLOWANCE_CAPS',
    );
  });

  it('rejects an empty price list and unknown/duplicate price categories', () => {
    expectReason(() => calculateTripBreakEven(tripInput({ prices: [] })), 'EMPTY_CATEGORY_LIST');
    expectReason(
      () =>
        calculateTripBreakEven(
          tripInput({ prices: [{ category: 'cider', domesticPriceCentsPerLitre: 100, foreignPriceCentsPerLitre: 50 }] }),
        ),
      'UNKNOWN_CATEGORY',
    );
    expectReason(
      () =>
        calculateTripBreakEven(
          tripInput({
            prices: [
              { category: 'beer', domesticPriceCentsPerLitre: 250, foreignPriceCentsPerLitre: 100 },
              { category: 'beer', domesticPriceCentsPerLitre: 300, foreignPriceCentsPerLitre: 100 },
            ],
          }),
        ),
      'DUPLICATE_CATEGORY',
    );
  });

  it('rejects negative and fractional per-litre prices', () => {
    expectReason(
      () =>
        calculateTripBreakEven(
          tripInput({ prices: [{ category: 'beer', domesticPriceCentsPerLitre: -1, foreignPriceCentsPerLitre: 50 }] }),
        ),
      'INVALID_PRICE',
    );
    expectReason(
      () =>
        calculateTripBreakEven(
          tripInput({ prices: [{ category: 'beer', domesticPriceCentsPerLitre: 250, foreignPriceCentsPerLitre: 99.5 }] }),
        ),
      'INVALID_PRICE',
    );
  });

  it('the canonical category key set mirrors the 5.1 allowance categories', () => {
    expect(TRIP_CATEGORY_KEYS).toEqual([
      'beer',
      'wine_still',
      'wine_sparkling',
      'intermediate_products',
      'other_fermented',
      'spirits',
    ]);
  });
});
