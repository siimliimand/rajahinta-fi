/**
 * Tests for the deterministic packing suggestion (first-fit-decreasing).
 *
 * Spec: packing-optimization + design R4/R14 — pure functions, exact
 * numeric expectations computed by hand, fixtures transcribed from the
 * real curated box catalogue and real beverage packaging dimensions.
 * The module must not import data-platform, so the seed rows are
 * copied here as fixture data with provenance noted. No DB, no mocks.
 *
 * Boundary convention (documented, pinned by tests): every mixing
 * threshold triggers on STRICT EXCEEDANCE — a figure exactly AT the
 * threshold stays warning-free ("beyond/exceeding" in the spec).
 *
 * @module PackingTests
 */
import { describe, it, expect } from 'vitest';
import { suggestPacking } from '../packing';
import {
  MIXED_MATERIAL_MAX_UNITS,
  MIXED_MATERIAL_MAX_COMBINED_WEIGHT_G,
} from '../thresholds';
import type { CarrierBoxType, PackingItem } from '../packing.types';

// ---------------------------------------------------------------------------
// Fixtures — box catalogue
// ---------------------------------------------------------------------------

/**
 * The task 3.1 seed catalogue (packages/data-platform/src/seed/
 * carrier-box-types.seed.ts), transcribed verbatim as pure fixture
 * data. Ids are assigned in seed order; the seed itself leaves ids to
 * autoincrement. Internal-volume order differs from seed order (DHL
 * Paket S 4 375 000 mm³ < PostNord Box M 4 560 000 mm³; PostNord Box
 * XL 26 400 000 mm³ < DHL Paket L 27 000 000 mm³) — the volume-order
 * tests below lean on exactly that.
 */
const BOXES: readonly CarrierBoxType[] = [
  { id: 1, carrier: 'postnord', name: 'PostNord Box S', internalHeightMm: 180, internalWidthMm: 130, internalDepthMm: 60, maxWeightG: 2000 },
  { id: 2, carrier: 'postnord', name: 'PostNord Box M', internalHeightMm: 240, internalWidthMm: 190, internalDepthMm: 100, maxWeightG: 5000 },
  { id: 3, carrier: 'postnord', name: 'PostNord Box L', internalHeightMm: 340, internalWidthMm: 250, internalDepthMm: 160, maxWeightG: 10000 },
  { id: 4, carrier: 'postnord', name: 'PostNord Box XL', internalHeightMm: 400, internalWidthMm: 300, internalDepthMm: 220, maxWeightG: 20000 },
  { id: 5, carrier: 'dhl', name: 'DHL Paket S', internalHeightMm: 250, internalWidthMm: 175, internalDepthMm: 100, maxWeightG: 5000 },
  { id: 6, carrier: 'dhl', name: 'DHL Paket M', internalHeightMm: 350, internalWidthMm: 250, internalDepthMm: 150, maxWeightG: 10000 },
  { id: 7, carrier: 'dhl', name: 'DHL Paket L', internalHeightMm: 450, internalWidthMm: 300, internalDepthMm: 200, maxWeightG: 20000 },
  { id: 8, carrier: 'dhl', name: 'DHL Paket XL', internalHeightMm: 600, internalWidthMm: 400, internalDepthMm: 300, maxWeightG: 31500 },
];

// ---------------------------------------------------------------------------
// Fixtures — real packaging dimensions (weight = filled packed unit)
// ---------------------------------------------------------------------------

/** 330 ml aluminium beverage can — Ø66 × 115 mm, 348 g. */
const CAN_33 = { weightG: 348, heightMm: 115, diameterMm: 66, material: 'CAN' as const };
/** 500 ml aluminium beverage can — Ø66 × 168 mm, 522 g. */
const CAN_50 = { weightG: 522, heightMm: 168, diameterMm: 66, material: 'CAN' as const };
/** 560 ml steel food can — Ø99 × 118 mm, 600 g. */
const FOOD_CAN_560 = { weightG: 600, heightMm: 118, diameterMm: 99, material: 'CAN' as const };
/** 500 ml long-neck glass beer bottle — Ø66 × 240 mm, 735 g. */
const BEER_BOTTLE_50 = { weightG: 735, heightMm: 240, diameterMm: 66, material: 'GLASS' as const };
/** 750 ml glass wine bottle (Bordeaux) — Ø76 × 300 mm, 1230 g. */
const WINE_BOTTLE_75 = { weightG: 1230, heightMm: 300, diameterMm: 76, material: 'GLASS' as const };
/** 700 ml glass spirits bottle — Ø89 × 300 mm, 1315 g. */
const SPIRITS_BOTTLE_70 = { weightG: 1315, heightMm: 300, diameterMm: 89, material: 'GLASS' as const };
/** 500 ml swing-top glass bottle (thick flip-top glass) — Ø66 × 240 mm, 1300 g. */
const SWING_TOP_50 = { weightG: 1300, heightMm: 240, diameterMm: 66, material: 'GLASS' as const };
/** 500 ml PET bottle — Ø66 × 230 mm, 540 g. */
const PET_BOTTLE_50 = { weightG: 540, heightMm: 230, diameterMm: 66, material: 'PLASTIC' as const };
/** 10 l glass demijohn — Ø320 × 500 mm, 11000 g: fits no seeded box. */
const DEMIJOHN_10L = { weightG: 11000, heightMm: 500, diameterMm: 320, material: 'GLASS' as const };

/** Build a basket line; omit dims to model a product without a dimension row. */
function line(productId: number, quantity: number, dims: Partial<PackingItem> = {}): PackingItem {
  return {
    productId,
    quantity,
    weightG: null,
    heightMm: null,
    diameterMm: null,
    material: null,
    ...dims,
  };
}

// ---------------------------------------------------------------------------
// Threshold pins
// ---------------------------------------------------------------------------

describe('mixing thresholds — pinned policy values', () => {
  it('MIXED_MATERIAL_MAX_UNITS is exactly 12 (one mixed dozen)', () => {
    expect(MIXED_MATERIAL_MAX_UNITS).toBe(12);
  });

  it('MIXED_MATERIAL_MAX_COMBINED_WEIGHT_G is exactly 10 000 g', () => {
    expect(MIXED_MATERIAL_MAX_COMBINED_WEIGHT_G).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('suggestPacking — determinism', () => {
  it('running twice on identical input yields an identical suggestion', () => {
    const basket = [
      line(201, 12, WINE_BOTTLE_75),
      line(101, 1, SPIRITS_BOTTLE_70),
      line(301, 15, CAN_33),
    ];
    const first = suggestPacking(basket, BOXES);
    const second = suggestPacking(basket, BOXES);
    expect(second).toEqual(first);
  });

  it('is independent of basket input order', () => {
    const basket = [
      line(201, 12, WINE_BOTTLE_75),
      line(101, 1, SPIRITS_BOTTLE_70),
      line(301, 15, CAN_33),
    ];
    const forward = suggestPacking(basket, BOXES);
    const reversed = suggestPacking([...basket].reverse(), BOXES);
    expect(reversed).toEqual(forward);
  });

  it('is independent of box-catalogue input order — re-sorted smallest internal volume first', () => {
    const basket = [line(201, 12, WINE_BOTTLE_75), line(301, 15, CAN_33)];
    const ordered = suggestPacking(basket, BOXES);
    const shuffled = suggestPacking(basket, [...BOXES].reverse());
    expect(shuffled).toEqual(ordered);
  });

  it('an empty basket computes an empty suggestion', () => {
    expect(suggestPacking([], BOXES)).toEqual({
      status: 'COMPUTED',
      boxes: [],
      excludedItems: [],
      mixingWarning: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Smallest sufficient box
// ---------------------------------------------------------------------------

describe('suggestPacking — smallest sufficient box', () => {
  it('a 330 ml can lands in DHL Paket S — smallest by internal VOLUME, not seed order', () => {
    // Volume order: PostNord S (1 404 000) → DHL S (4 375 000) →
    // PostNord M (4 560 000) → … Seed order would try PostNord M
    // before DHL S; only the volume order can pick DHL S here.
    // PostNord S itself fails the orientation rule: Ø66 > min(130, 60).
    const result = suggestPacking([line(301, 1, CAN_33)], BOXES);
    expect(result.status).toBe('COMPUTED');
    expect(result.boxes).toHaveLength(1);
    expect(result.boxes[0]).toMatchObject({
      boxTypeId: 5,
      carrier: 'dhl',
      boxName: 'DHL Paket S',
      items: [{ productId: 301, units: 1 }],
      totalWeightG: 348,
    });
  });

  it('a 500 ml can also skips PostNord S (Ø66 > depth 60) and takes DHL Paket S', () => {
    const result = suggestPacking([line(302, 1, CAN_50)], BOXES);
    expect(result.boxes[0]).toMatchObject({ boxTypeId: 5, boxName: 'DHL Paket S' });
  });

  it('a 5 l flagon fitting both PostNord XL and DHL L takes PostNord XL — smaller volume (26.4 M < 27.0 M mm³)', () => {
    // Ø180 × 380 mm, 4500 g fits both; the seed lists DHL L before
    // PostNord XL, the volume order puts PostNord XL first.
    const flagon = { weightG: 4500, heightMm: 380, diameterMm: 180, material: 'GLASS' as const };
    const result = suggestPacking([line(601, 1, flagon)], BOXES);
    expect(result.boxes[0]).toMatchObject({ boxTypeId: 4, boxName: 'PostNord Box XL' });
  });

  it('fill rate is the hand-computed cylinder volume over box internal volume', () => {
    // Unit: π × 33² × 115 = 393 437.36 mm³; box: 250 × 175 × 100 =
    // 4 375 000 mm³ → 0.0899285…
    const result = suggestPacking([line(301, 1, CAN_33)], BOXES);
    expect(result.boxes[0].fillRate).toBeCloseTo(0.0899285, 6);
  });
});

// ---------------------------------------------------------------------------
// Multi-box overflow (weight ceiling and FFD continuation)
// ---------------------------------------------------------------------------

describe('suggestPacking — multi-box overflow', () => {
  it('12 wine bottles split 8 + 4 across two DHL Paket M boxes on the 10 kg weight ceiling', () => {
    const result = suggestPacking([line(201, 12, WINE_BOTTLE_75)], BOXES);
    expect(result.status).toBe('COMPUTED');
    expect(result.boxes).toHaveLength(2);
    // 8 × 1230 = 9840 ≤ 10 000; a 9th would reach 11 070.
    expect(result.boxes[0]).toMatchObject({
      boxTypeId: 6,
      boxName: 'DHL Paket M',
      items: [{ productId: 201, units: 8 }],
      totalWeightG: 9840,
    });
    expect(result.boxes[1]).toMatchObject({
      boxTypeId: 6,
      boxName: 'DHL Paket M',
      items: [{ productId: 201, units: 4 }],
      totalWeightG: 4920,
    });
  });

  it('fill rate per box: 8 wine bottles fill 0.8295241 of a DHL Paket M, 4 fill 0.414762', () => {
    // Unit: π × 38² × 300 = 1 360 937.94 mm³; box: 350 × 250 × 150 =
    // 13 125 000 mm³. 8 units → 0.8295241…; 4 units → 0.4147620…
    const result = suggestPacking([line(201, 12, WINE_BOTTLE_75)], BOXES);
    expect(result.boxes[0].fillRate).toBeCloseTo(0.8295241, 6);
    expect(result.boxes[1].fillRate).toBeCloseTo(0.414762, 5);
  });

  it('15 cans split 14 + 1 across two DHL Paket S boxes (14 × 348 = 4872 ≤ 5000 < 15 × 348)', () => {
    const result = suggestPacking([line(301, 15, CAN_33)], BOXES);
    expect(result.boxes).toHaveLength(2);
    expect(result.boxes[0]).toMatchObject({ boxTypeId: 5, items: [{ productId: 301, units: 14 }], totalWeightG: 4872 });
    expect(result.boxes[1]).toMatchObject({ boxTypeId: 5, items: [{ productId: 301, units: 1 }], totalWeightG: 348 });
  });
});

// ---------------------------------------------------------------------------
// FFD ordering — height desc, then diameter desc
// ---------------------------------------------------------------------------

describe('suggestPacking — first-fit-decreasing order', () => {
  it('height desc: the tall spirits bottle opens the box and the small can joins it — ONE box, not two', () => {
    // If the can (Ø66 × 115) were placed first it would open a DHL
    // Paket S and the spirits bottle would need a second box. Height
    // desc places the spirits bottle (300 mm) first, opening DHL
    // Paket M, and the can first-fits into it.
    const result = suggestPacking(
      [line(101, 1, SPIRITS_BOTTLE_70), line(301, 1, CAN_33)],
      BOXES,
    );
    expect(result.boxes).toHaveLength(1);
    expect(result.boxes[0]).toMatchObject({
      boxTypeId: 6,
      boxName: 'DHL Paket M',
      items: [
        { productId: 101, units: 1 },
        { productId: 301, units: 1 },
      ],
      totalWeightG: 1315 + 348,
    });
  });

  it('diameter desc at equal height: the Ø89 spirits bottle is placed before the Ø76 wine bottles', () => {
    // Correct order: spirits opens DHL Paket M (1315 g), 7 of the 8
    // wine bottles join it (9925 g ≤ 10 000), the 8th opens a second
    // box. Wine-first would put 8 bottles in box 1 (9840 g) and the
    // spirits bottle alone in box 2.
    const result = suggestPacking(
      [line(201, 8, WINE_BOTTLE_75), line(101, 1, SPIRITS_BOTTLE_70)],
      BOXES,
    );
    expect(result.boxes).toHaveLength(2);
    expect(result.boxes[0]).toMatchObject({
      boxTypeId: 6,
      items: [
        { productId: 101, units: 1 },
        { productId: 201, units: 7 },
      ],
      totalWeightG: 9925,
    });
    expect(result.boxes[1]).toMatchObject({
      boxTypeId: 6,
      items: [{ productId: 201, units: 1 }],
      totalWeightG: 1230,
    });
  });

  it('per-box groups are ordered by productId ascending', () => {
    const result = suggestPacking(
      [line(201, 8, WINE_BOTTLE_75), line(101, 1, SPIRITS_BOTTLE_70)],
      BOXES,
    );
    const productIds = result.boxes[0].items.map((group) => group.productId);
    expect(productIds).toEqual([...productIds].sort((a, b) => a - b));
  });
});

// ---------------------------------------------------------------------------
// Mixing warning — explicit thresholds, strict-exceedance boundaries
// ---------------------------------------------------------------------------

describe('suggestPacking — glass+metal mixing warning', () => {
  it('exactly 12 mixed units (at the threshold) do NOT warn — strict exceedance', () => {
    // 6 glass (4410 g) + 6 cans (2088 g) = 12 units = MAX_UNITS, and
    // 6498 g < 10 000 g. "Beyond/exceeding" reads strict: no warning.
    const result = suggestPacking(
      [line(303, 6, BEER_BOTTLE_50), line(301, 6, CAN_33)],
      BOXES,
    );
    expect(result.status).toBe('COMPUTED');
    expect(result.mixingWarning).toBeNull();
  });

  it('13 mixed units warn, citing the observed counts and weights and the UNIT_COUNT trigger', () => {
    // 7 × 735 = 5145 g glass + 6 × 348 = 2088 g can = 13 units, 7233 g.
    const result = suggestPacking(
      [line(303, 7, BEER_BOTTLE_50), line(301, 6, CAN_33)],
      BOXES,
    );
    expect(result.mixingWarning).toEqual({
      glassUnits: 7,
      canUnits: 6,
      glassWeightG: 5145,
      canWeightG: 2088,
      combinedWeightG: 7233,
      triggeredBy: ['UNIT_COUNT'],
    });
  });

  it('combined weight exactly 10 000 g at ≤ 12 units does NOT warn — the weight boundary is exclusive', () => {
    // 4 × 1300 + 8 × 600 = 5200 + 4800 = 10 000 g exactly, 12 units.
    const result = suggestPacking(
      [line(311, 4, SWING_TOP_50), line(312, 8, FOOD_CAN_560)],
      BOXES,
    );
    expect(result.status).toBe('COMPUTED');
    expect(result.mixingWarning).toBeNull();
  });

  it('combined weight beyond 10 000 g at ≤ 12 units warns on COMBINED_WEIGHT only', () => {
    // 5 × 1300 + 7 × 600 = 10 700 g, 12 units (count threshold not hit).
    const result = suggestPacking(
      [line(311, 5, SWING_TOP_50), line(312, 7, FOOD_CAN_560)],
      BOXES,
    );
    expect(result.mixingWarning).toEqual({
      glassUnits: 5,
      canUnits: 7,
      glassWeightG: 6500,
      canWeightG: 4200,
      combinedWeightG: 10700,
      triggeredBy: ['COMBINED_WEIGHT'],
    });
  });

  it('both thresholds breached → both triggers, UNIT_COUNT listed first', () => {
    // 5 × 1300 + 8 × 600 = 13 units, 11 300 g.
    const result = suggestPacking(
      [line(311, 5, SWING_TOP_50), line(312, 8, FOOD_CAN_560)],
      BOXES,
    );
    expect(result.mixingWarning).not.toBeNull();
    expect(result.mixingWarning?.triggeredBy).toEqual(['UNIT_COUNT', 'COMBINED_WEIGHT']);
  });

  it('single-material shipments never warn, whatever the size', () => {
    const glassOnly = suggestPacking([line(201, 20, WINE_BOTTLE_75)], BOXES);
    const cansOnly = suggestPacking([line(301, 20, CAN_33)], BOXES);
    expect(glassOnly.mixingWarning).toBeNull();
    expect(cansOnly.mixingWarning).toBeNull();
  });

  it('glass + plastic is not glass + metal — plastic units count towards neither side', () => {
    const result = suggestPacking(
      [line(201, 10, WINE_BOTTLE_75), line(401, 10, PET_BOTTLE_50)],
      BOXES,
    );
    expect(result.mixingWarning).toBeNull();
  });

  it('the warning counts PACKED units only — an excluded glass line does not join the counts', () => {
    // The demijohn fits no box (Ø320 > min(400, 300) of DHL XL) and is
    // excluded; the 5 packed wine bottles (6150 g) + 8 cans (2784 g)
    // make 13 mixed units — counted WITHOUT the excluded glass unit.
    const result = suggestPacking(
      [line(501, 1, DEMIJOHN_10L), line(201, 5, WINE_BOTTLE_75), line(301, 8, CAN_33)],
      BOXES,
    );
    expect(result.status).toBe('ESTIMATED');
    expect(result.mixingWarning).toEqual({
      glassUnits: 5,
      canUnits: 8,
      glassWeightG: 6150,
      canWeightG: 2784,
      combinedWeightG: 8934,
      triggeredBy: ['UNIT_COUNT'],
    });
  });
});

// ---------------------------------------------------------------------------
// Missing dimensions degrade explicitly
// ---------------------------------------------------------------------------

describe('suggestPacking — missing dimensions degrade explicitly', () => {
  it('a product without a dimension row is excluded, named, and flips the status to ESTIMATED', () => {
    const result = suggestPacking(
      [line(201, 2, WINE_BOTTLE_75), line(999, 2)],
      BOXES,
    );
    expect(result.status).toBe('ESTIMATED');
    expect(result.excludedItems).toEqual([
      { productId: 999, quantity: 2, reason: 'MISSING_DIMENSIONS' },
    ]);
    // The known items still pack.
    expect(result.boxes).toHaveLength(1);
    expect(result.boxes[0]).toMatchObject({ boxTypeId: 6, items: [{ productId: 201, units: 2 }], totalWeightG: 2460 });
  });

  it('a partially dimensioned line (weight only) is MISSING_DIMENSIONS, never estimated', () => {
    const result = suggestPacking([line(998, 1, { weightG: 350 })], BOXES);
    expect(result.excludedItems).toEqual([
      { productId: 998, quantity: 1, reason: 'MISSING_DIMENSIONS' },
    ]);
    expect(result.status).toBe('ESTIMATED');
  });

  it('non-positive or non-finite dimensions are INVALID_DIMENSIONS', () => {
    const cases: Array<Partial<PackingItem>> = [
      { weightG: 350, heightMm: 0, diameterMm: 66 },
      { weightG: 350, heightMm: 240, diameterMm: -5 },
      { weightG: Number.NaN, heightMm: 240, diameterMm: 66 },
      { weightG: Number.POSITIVE_INFINITY, heightMm: 240, diameterMm: 66 },
    ];
    for (const dims of cases) {
      const result = suggestPacking([line(997, 1, dims)], BOXES);
      expect(result.excludedItems).toEqual([
        { productId: 997, quantity: 1, reason: 'INVALID_DIMENSIONS' },
      ]);
    }
  });

  it('quantity must be an integer ≥ 1; the raw value is echoed in the exclusion', () => {
    for (const quantity of [0, -1, 2.5]) {
      const result = suggestPacking([line(301, quantity, CAN_33)], BOXES);
      expect(result.excludedItems).toEqual([
        { productId: 301, quantity, reason: 'INVALID_QUANTITY' },
      ]);
      expect(result.boxes).toEqual([]);
      expect(result.status).toBe('ESTIMATED');
    }
  });
});

// ---------------------------------------------------------------------------
// No fitting box
// ---------------------------------------------------------------------------

describe('suggestPacking — no fitting box', () => {
  it('a unit exceeding every box (10 l demijohn) is excluded as NO_FITTING_BOX', () => {
    // Tallest seeded box: DHL XL 600 × 400 × 300 — Ø320 > min(400, 300).
    const result = suggestPacking([line(501, 1, DEMIJOHN_10L)], BOXES);
    expect(result.status).toBe('ESTIMATED');
    expect(result.boxes).toEqual([]);
    expect(result.excludedItems).toEqual([
      { productId: 501, quantity: 1, reason: 'NO_FITTING_BOX' },
    ]);
  });

  it('an empty box catalogue excludes everything', () => {
    const result = suggestPacking([line(301, 3, CAN_33)], []);
    expect(result.status).toBe('ESTIMATED');
    expect(result.boxes).toEqual([]);
    expect(result.excludedItems).toEqual([
      { productId: 301, quantity: 3, reason: 'NO_FITTING_BOX' },
    ]);
  });
});
