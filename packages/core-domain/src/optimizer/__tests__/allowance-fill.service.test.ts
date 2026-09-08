/**
 * AllowanceFillService tests — date-resolved limits (half-open effective
 * windows, newest-effectiveFrom precedence), bound exhaustion (explicit
 * honest empty result), per-line contribution + headroom math, exact
 * optimality of the bounded branch-and-bound search, dataset-version
 * provenance carriage, dataset validation errors, and determinism.
 *
 * All I/O is stubbed via port interfaces: an in-memory product-data port
 * (the basket optimizer test pattern) and an in-memory traveller
 * allowance port that resolves versions over half-open windows the same
 * way the 5.1 D1 repository's SQL does — ISO calendar dates compared as
 * TEXT, `effectiveFrom ≤ date < effectiveTo` (null open-ended), newest
 * effectiveFrom wins on overlap. The D1 adapter itself is task 8.2.
 */

import { describe, it, expect, vi } from 'vitest';
import { AllowanceFillService } from '../services/allowance-fill.service';
import { ClassificationGateService } from '../../normalization/classification-gate.service';
import { DISCLAIMER_FI } from '../../disclaimer';
import {
  MAX_FILL_ITEMS,
  MAX_FILL_QUANTITY,
} from '../allowance-fill.types';
import { BasketClassificationGateError } from '../optimizer.types';
import type {
  AllowanceFillInput,
  AllowanceFillResult,
} from '../allowance-fill.types';
import type { ITravellerAllowancePort } from '../ports/traveller-allowance.port';
import type { TripAllowanceLimitRow, TripResolvedAllowances } from '../../tripcalc/tripcalc.types';
import type {
  IProductDataPort,
  CalculatorProductData,
  CalculatorRetailOfferData,
} from '../../calculator/calculator.types';

// ---------------------------------------------------------------------------
// Fixtures — products
// ---------------------------------------------------------------------------

function makeProduct(overrides: Partial<CalculatorProductData> & { id: number; category: string }): CalculatorProductData {
  return {
    regulatoryClassification: overrides.category,
    volumeLitres: 0.5,
    alcoholByVolume: 0.05,
    containerType: 'can',
    depositSystemStatus: true,
    weightKg: 0.55,
    normalizedName: `Test Product ${overrides.id}`,
    ...overrides,
  };
}

const BEER_CAN = makeProduct({ id: 101, category: 'beer' }); // 0.5 l
const WINE_BOTTLE = makeProduct({ id: 102, category: 'wine', volumeLitres: 0.75, containerType: 'bottle' });
const SPIRITS_A = makeProduct({ id: 103, category: 'spirits' });
const SPIRITS_B = makeProduct({ id: 104, category: 'spirits' });
const CIDER = makeProduct({ id: 105, category: 'cider' });
const BIG_BEER = makeProduct({ id: 106, category: 'beer', volumeLitres: 2.0, containerType: 'keg' });
const MID_BEER = makeProduct({ id: 107, category: 'beer', volumeLitres: 1.5, containerType: 'bottle' });
const FREE_BEER = makeProduct({ id: 108, category: 'beer' });
const TINY_BEER = makeProduct({ id: 109, category: 'beer', volumeLitres: 0.1 });

const PRODUCTS_BY_ID: Record<number, CalculatorProductData> = {
  [BEER_CAN.id]: BEER_CAN,
  [WINE_BOTTLE.id]: WINE_BOTTLE,
  [SPIRITS_A.id]: SPIRITS_A,
  [SPIRITS_B.id]: SPIRITS_B,
  [CIDER.id]: CIDER,
  [BIG_BEER.id]: BIG_BEER,
  [MID_BEER.id]: MID_BEER,
  [FREE_BEER.id]: FREE_BEER,
  [TINY_BEER.id]: TINY_BEER,
};

function offersFor(productId: number, priceCents: number, merchant = 'merchant-a'): CalculatorRetailOfferData[] {
  return [{ id: productId * 10, priceCents, merchant, country: 'DE', reliabilityStatus: 'VERIFIED' }];
}

const DEFAULT_PRICES: Record<number, CalculatorRetailOfferData[]> = {
  [BEER_CAN.id]: offersFor(BEER_CAN.id, 500),
  [WINE_BOTTLE.id]: offersFor(WINE_BOTTLE.id, 900),
  [SPIRITS_A.id]: offersFor(SPIRITS_A.id, 1000),
  [SPIRITS_B.id]: offersFor(SPIRITS_B.id, 2500),
  [CIDER.id]: offersFor(CIDER.id, 400),
  [BIG_BEER.id]: offersFor(BIG_BEER.id, 600),
  [MID_BEER.id]: offersFor(MID_BEER.id, 400),
  [FREE_BEER.id]: offersFor(FREE_BEER.id, 0),
  [TINY_BEER.id]: offersFor(TINY_BEER.id, 199),
};

// ---------------------------------------------------------------------------
// Fixtures — versioned allowance datasets (half-open windows, as 5.1)
// ---------------------------------------------------------------------------

interface VersionedDataset {
  readonly versionLabel: string;
  readonly status: 'PENDING_CONFIRMATION' | 'PUBLISHED';
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly limits: readonly TripAllowanceLimitRow[];
}

function cap(category: string, volumeCapLitres: number | null, quantityCap: number | null): TripAllowanceLimitRow {
  return { category, volumeCapLitres, quantityCap };
}

const DATASET_V2024: VersionedDataset = {
  versionLabel: 'eu-indicative-2024.1',
  status: 'PUBLISHED',
  effectiveFrom: '2024-01-01',
  effectiveTo: '2025-01-01',
  limits: [cap('beer', 5, null), cap('wine_still', 3, null), cap('spirits', null, 1)],
};

const DATASET_V2025: VersionedDataset = {
  versionLabel: 'eu-indicative-2025.1',
  status: 'PUBLISHED',
  effectiveFrom: '2025-01-01',
  effectiveTo: null,
  limits: [
    cap('beer', 3, null),
    cap('wine_still', 2, null),
    cap('spirits', null, 1),
    // other_fermented deliberately absent — the version-gap discipline.
  ],
};

/**
 * In-memory traveller allowance port — resolves the PUBLISHED dataset
 * whose half-open window covers the date (newest effectiveFrom wins),
 * mirroring the repository's effective-date resolution contract.
 */
class InMemoryAllowancePort implements ITravellerAllowancePort {
  constructor(private readonly datasets: readonly VersionedDataset[]) {}

  async resolveForTravelDate(travelDate: string): Promise<TripResolvedAllowances | null> {
    const effective = this.datasets
      .filter(
        (d) =>
          d.status === 'PUBLISHED' &&
          d.effectiveFrom <= travelDate &&
          (d.effectiveTo === null || d.effectiveTo > travelDate),
      )
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    if (!effective) return null;
    return { dataset: { versionLabel: effective.versionLabel }, limits: effective.limits };
  }
}

const DEFAULT_DATASETS: readonly VersionedDataset[] = [DATASET_V2024, DATASET_V2025];

// ---------------------------------------------------------------------------
// Mock factories + service factory
// ---------------------------------------------------------------------------

function createMockProductDataPort(
  offersByProduct: Record<number, CalculatorRetailOfferData[]> = DEFAULT_PRICES,
): IProductDataPort {
  return {
    findProductById: vi.fn().mockImplementation(async (id: number) => PRODUCTS_BY_ID[id] ?? null),
    findRetailOffers: vi.fn().mockImplementation(async (id: number) => offersByProduct[id] ?? []),
  };
}

function createFillService(options?: {
  productData?: IProductDataPort;
  allowancePort?: ITravellerAllowancePort | null;
  datasets?: readonly VersionedDataset[];
}): AllowanceFillService {
  const gate = new ClassificationGateService();
  const productData = options?.productData ?? createMockProductDataPort();
  const allowancePort =
    options?.allowancePort !== undefined
      ? options.allowancePort
      : new InMemoryAllowancePort(options?.datasets ?? DEFAULT_DATASETS);
  return new AllowanceFillService(gate, productData, allowancePort);
}

function fillInput(
  items: readonly { productId: number; maxQuantity: number }[],
  travelDate = '2025-06-15',
): AllowanceFillInput {
  return { items, travelDate };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AllowanceFillService', () => {
  // -------------------------------------------------------------------------
  // Date-resolved limits
  // -------------------------------------------------------------------------

  describe('date-resolved limits', () => {
    it('resolves the OLDER dataset version when the travel date falls inside its window', async () => {
      const service = createFillService();
      const result = await service.fill(fillInput([{ productId: BEER_CAN.id, maxQuantity: 10 }], '2024-06-15'));

      expect(result.allowanceDatasetVersion).toBe('eu-indicative-2024.1');
      // 2024 cap is 5 l → 10 cans of 0.5 l fill completely; under the
      // 2025 cap (3 l) the same request would fill only 6.
      expect(result.lines[0].filledQuantity).toBe(10);
      expect(result.filledValueCents).toBe(5000);
    });

    it('effectiveFrom is INCLUSIVE — the travel date on the newer version start resolves the newer version', async () => {
      const service = createFillService();
      const result = await service.fill(fillInput([{ productId: BEER_CAN.id, maxQuantity: 10 }], '2025-01-01'));

      expect(result.allowanceDatasetVersion).toBe('eu-indicative-2025.1');
      // 2025 cap is 3 l → 6 cans, not the older version's 10.
      expect(result.lines[0].filledQuantity).toBe(6);
      expect(result.filledValueCents).toBe(3000);
    });

    it('effectiveTo is EXCLUSIVE — the older version no longer applies on its own effectiveTo edge', async () => {
      // '2025-01-01' is DATASET_V2024.effectiveTo: the half-open window
      // excludes it, so the same date as the inclusive-effectiveFrom test
      // must resolve the NEWER version (covered above); this test pins
      // the boundary through a dataset whose successor starts later.
      const datasets: readonly VersionedDataset[] = [
        { ...DATASET_V2024, effectiveTo: '2025-06-01' },
        { ...DATASET_V2025, effectiveFrom: '2025-06-01' },
      ];
      const service = createFillService({ datasets });

      const onEdge = await service.fill(fillInput([{ productId: BEER_CAN.id, maxQuantity: 10 }], '2025-06-01'));
      expect(onEdge.allowanceDatasetVersion).toBe('eu-indicative-2025.1');

      const dayBefore = await service.fill(fillInput([{ productId: BEER_CAN.id, maxQuantity: 10 }], '2025-05-31'));
      expect(dayBefore.allowanceDatasetVersion).toBe('eu-indicative-2024.1');
    });

    it('newest effectiveFrom wins when published versions transiently overlap', async () => {
      const datasets: readonly VersionedDataset[] = [
        DATASET_V2024,
        DATASET_V2025,
        {
          versionLabel: 'eu-indicative-2025.0-override',
          status: 'PUBLISHED',
          effectiveFrom: '2025-03-01',
          effectiveTo: null,
          limits: [cap('beer', 1, null)],
        },
      ];
      const service = createFillService({ datasets });
      const result = await service.fill(fillInput([{ productId: BEER_CAN.id, maxQuantity: 10 }], '2025-06-15'));

      expect(result.allowanceDatasetVersion).toBe('eu-indicative-2025.0-override');
      expect(result.lines[0].filledQuantity).toBe(2); // 1 l / 0.5 l
    });

    it('throws AllowanceFillError(NO_ALLOWANCE_DATASET) when no published version covers the date', async () => {
      const service = createFillService();
      await expect(
        service.fill(fillInput([{ productId: BEER_CAN.id, maxQuantity: 1 }], '2023-12-31')),
      ).rejects.toMatchObject({ name: 'AllowanceFillError', reason: 'NO_ALLOWANCE_DATASET' });
    });

    it('throws AllowanceFillError(NO_ALLOWANCE_DATASET) when the port is not wired (null default)', async () => {
      const service = createFillService({ allowancePort: null });
      await expect(
        service.fill(fillInput([{ productId: BEER_CAN.id, maxQuantity: 1 }])),
      ).rejects.toMatchObject({ name: 'AllowanceFillError', reason: 'NO_ALLOWANCE_DATASET' });
    });

    it('passes the raw travel date through — the service never guesses versions itself', async () => {
      const resolveForTravelDate = vi.fn().mockResolvedValue({
        dataset: { versionLabel: 'probe' },
        limits: [cap('beer', 3, null)],
      });
      const service = createFillService({
        allowancePort: { resolveForTravelDate },
      });

      await service.fill(fillInput([{ productId: BEER_CAN.id, maxQuantity: 1 }], '2025-06-15'));

      expect(resolveForTravelDate).toHaveBeenCalledOnce();
      expect(resolveForTravelDate).toHaveBeenCalledWith('2025-06-15');
    });
  });

  // -------------------------------------------------------------------------
  // Bound exhaustion — the explicit, honest empty result
  // -------------------------------------------------------------------------

  describe('bound exhaustion', () => {
    it('reports BOUND_EXHAUSTED when the allowance is too small for even one unit', async () => {
      const datasets: readonly VersionedDataset[] = [
        {
          versionLabel: 'tiny',
          status: 'PUBLISHED',
          effectiveFrom: '2025-01-01',
          effectiveTo: null,
          limits: [cap('beer', 0.3, null)], // < one 0.5 l can
        },
      ];
      const service = createFillService({ datasets });
      const result = await service.fill(fillInput([{ productId: BEER_CAN.id, maxQuantity: 4 }]));

      expect(result.status).toBe('BOUND_EXHAUSTED');
      expect(result.filledValueCents).toBe(0);
      expect(result.filledUnits).toBe(0);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]).toMatchObject({
        filledQuantity: 0,
        valueContributionCents: 0,
        status: 'CAP_EXHAUSTED',
      });
      // The headroom honestly states the untouched cap — no invented basket.
      expect(result.categoryHeadroom).toEqual([
        {
          category: 'beer',
          capLitres: 0.3,
          capUnits: null,
          usedLitres: 0,
          usedUnits: 0,
          remainingLitres: 0.3,
          remainingUnits: null,
        },
      ]);
    });

    it('fills exactly to the volume cap when only a volume cap applies', async () => {
      const service = createFillService();
      const result = await service.fill(
        fillInput([{ productId: BEER_CAN.id, maxQuantity: 6 }], '2025-06-15'),
      );

      // beer cap 2025: 3 l, quantity-uncapped → 6 cans = 3.0 l exactly.
      expect(result.status).toBe('FILLED');
      expect(result.lines[0].filledQuantity).toBe(6);
      expect(result.filledValueCents).toBe(3000);
      expect(result.categoryHeadroom[0].remainingLitres).toBe(0);
    });

    it('a single quantity cap forces choosing the pricier line', async () => {
      const service = createFillService();
      const result = await service.fill(
        fillInput([
          { productId: SPIRITS_A.id, maxQuantity: 1 }, // 1000¢
          { productId: SPIRITS_B.id, maxQuantity: 1 }, // 2500¢
        ]),
      );

      // spirits: quantityCap 1 → one unit total, the 2500¢ one.
      expect(result.status).toBe('FILLED');
      expect(result.filledValueCents).toBe(2500);
      expect(result.filledUnits).toBe(1);
      const byProduct = new Map(result.lines.map((l) => [l.productId, l]));
      expect(byProduct.get(SPIRITS_B.id)).toMatchObject({ filledQuantity: 1, status: 'FILLED' });
      expect(byProduct.get(SPIRITS_A.id)).toMatchObject({ filledQuantity: 0, status: 'CAP_EXHAUSTED' });
    });

    it('a category missing from the resolved version is excluded (NO_ALLOWANCE_ROW), never filled unbounded', async () => {
      const service = createFillService();
      const result = await service.fill(
        fillInput([
          { productId: CIDER.id, maxQuantity: 10 }, // other_fermented — no row in 2025.1
          { productId: BEER_CAN.id, maxQuantity: 2 },
        ]),
      );

      expect(result.status).toBe('FILLED');
      const byProduct = new Map(result.lines.map((l) => [l.productId, l]));
      expect(byProduct.get(CIDER.id)).toMatchObject({
        filledQuantity: 0,
        status: 'NO_ALLOWANCE_ROW',
        headroomAfter: null,
      });
      expect(byProduct.get(BEER_CAN.id)).toMatchObject({ filledQuantity: 2, status: 'FILLED' });
      expect(result.filledValueCents).toBe(1000); // beer only
      // Touched boundable categories only — no invented rows.
      expect(result.categoryHeadroom.map((h) => h.category)).toEqual(['beer']);
    });

    it('reports NO_BOUNDABLE_LINE when every line lacks an allowance row (data gap, not exhaustion)', async () => {
      const service = createFillService();
      const result = await service.fill(fillInput([{ productId: CIDER.id, maxQuantity: 3 }]));

      expect(result.status).toBe('NO_BOUNDABLE_LINE');
      expect(result.filledValueCents).toBe(0);
      expect(result.lines[0].status).toBe('NO_ALLOWANCE_ROW');
      expect(result.categoryHeadroom).toEqual([]);
    });

    it('bound exhaustion alongside a data gap keeps the two states distinct', async () => {
      const datasets: readonly VersionedDataset[] = [
        {
          versionLabel: 'tiny',
          status: 'PUBLISHED',
          effectiveFrom: '2025-01-01',
          effectiveTo: null,
          limits: [cap('beer', 0.3, null)],
        },
      ];
      const service = createFillService({ datasets });
      const result = await service.fill(
        fillInput([
          { productId: BEER_CAN.id, maxQuantity: 4 }, // boundable, cannot fit
          { productId: CIDER.id, maxQuantity: 4 }, // no row at all
        ]),
      );

      expect(result.status).toBe('BOUND_EXHAUSTED');
      expect(result.lines[0].status).toBe('CAP_EXHAUSTED');
      expect(result.lines[1].status).toBe('NO_ALLOWANCE_ROW');
    });
  });

  // -------------------------------------------------------------------------
  // Per-line contribution + headroom math
  // -------------------------------------------------------------------------

  describe('per-line contribution and headroom', () => {
    it('fills to the cap with per-line contribution, consumption, and running headroom', async () => {
      const service = createFillService();
      const result = await service.fill(
        fillInput([
          { productId: BEER_CAN.id, maxQuantity: 4 }, // 0.5 l, 500¢, beer cap 3 l
          { productId: WINE_BOTTLE.id, maxQuantity: 5 }, // 0.75 l, 900¢, wine cap 2 l
        ]),
      );

      expect(result.status).toBe('FILLED');
      expect(result.filledValueCents).toBe(2000 + 1800);
      expect(result.filledUnits).toBe(6);

      const [beer, wine] = result.lines;
      expect(beer).toMatchObject({
        productId: BEER_CAN.id,
        category: 'beer',
        merchant: 'merchant-a',
        unitPriceCents: 500,
        unitVolumeLitres: 0.5,
        maxQuantity: 4,
        filledQuantity: 4,
        valueContributionCents: 2000,
        consumedVolumeLitres: 2,
        status: 'FILLED',
      });
      expect(beer.headroomAfter).toEqual({
        category: 'beer',
        capLitres: 3,
        capUnits: null,
        remainingLitres: 1,
        remainingUnits: null,
      });

      expect(wine).toMatchObject({
        filledQuantity: 2,
        valueContributionCents: 1800,
        consumedVolumeLitres: 1.5,
        status: 'FILLED',
      });
      expect(wine.headroomAfter).toEqual({
        category: 'wine_still',
        capLitres: 2,
        capUnits: null,
        remainingLitres: 0.5,
        remainingUnits: null,
      });

      expect(result.categoryHeadroom).toEqual([
        {
          category: 'beer',
          capLitres: 3,
          capUnits: null,
          usedLitres: 2,
          usedUnits: 0,
          remainingLitres: 1,
          remainingUnits: null,
        },
        {
          category: 'wine_still',
          capLitres: 2,
          capUnits: null,
          usedLitres: 1.5,
          usedUnits: 0,
          remainingLitres: 0.5,
          remainingUnits: null,
        },
      ]);
    });

    it('partial fill: the next unit would not fit, so the line stops below maxQuantity', async () => {
      const datasets: readonly VersionedDataset[] = [
        {
          versionLabel: 'partial',
          status: 'PUBLISHED',
          effectiveFrom: '2025-01-01',
          effectiveTo: null,
          limits: [cap('wine_still', 2.5, null)],
        },
      ];
      const service = createFillService({ datasets });
      const result = await service.fill(fillInput([{ productId: WINE_BOTTLE.id, maxQuantity: 5 }]));

      // floor(2.5 / 0.75) = 3 bottles = 2.25 l; a 4th would exceed 2.5 l.
      expect(result.lines[0].filledQuantity).toBe(3);
      expect(result.filledValueCents).toBe(2700);
      expect(result.categoryHeadroom[0].remainingLitres).toBe(0.25);
    });

    it('volume and quantity caps both bind the same line', async () => {
      const datasets: readonly VersionedDataset[] = [
        {
          versionLabel: 'mixed',
          status: 'PUBLISHED',
          effectiveFrom: '2025-01-01',
          effectiveTo: null,
          limits: [cap('beer', 2, 2)],
        },
      ];
      const service = createFillService({ datasets });
      const result = await service.fill(fillInput([{ productId: BEER_CAN.id, maxQuantity: 5 }]));

      // min(5 units, 2 l / 0.5 l = 4, quantityCap 2) = 2.
      expect(result.lines[0].filledQuantity).toBe(2);
      expect(result.categoryHeadroom[0]).toMatchObject({
        capLitres: 2,
        capUnits: 2,
        usedLitres: 1,
        usedUnits: 2,
        remainingLitres: 1,
        remainingUnits: 0,
      });
    });

    it('exact optimality: the search outperforms the density-greedy first descent', async () => {
      const datasets: readonly VersionedDataset[] = [
        {
          versionLabel: 'knapsack',
          status: 'PUBLISHED',
          effectiveFrom: '2025-01-01',
          effectiveTo: null,
          limits: [cap('beer', 3, null)],
        },
      ];
      const service = createFillService({ datasets });
      const result = await service.fill(
        fillInput([
          { productId: BIG_BEER.id, maxQuantity: 1 }, // 2.0 l @ 600¢ — denser
          { productId: MID_BEER.id, maxQuantity: 2 }, // 1.5 l @ 400¢
        ]),
      );

      // Greedy takes BIG_BEER (density 300 vs 267) and cannot fit MID_BEER
      // after it (600¢). The optimum is 2 × MID_BEER = 3.0 l = 800¢.
      expect(result.filledValueCents).toBe(800);
      const byProduct = new Map(result.lines.map((l) => [l.productId, l]));
      expect(byProduct.get(BIG_BEER.id)).toMatchObject({ filledQuantity: 0 });
      expect(byProduct.get(MID_BEER.id)).toMatchObject({ filledQuantity: 2 });
    });

    it('bound effectiveness: a wide-allowance max-shape request completes exactly, not approximately', async () => {
      const datasets: readonly VersionedDataset[] = [
        {
          versionLabel: 'wide',
          status: 'PUBLISHED',
          effectiveFrom: '2025-01-01',
          effectiveTo: null,
          limits: [cap('beer', 110, null)],
        },
      ];
      const service = createFillService({ datasets });
      const items = Array.from({ length: MAX_FILL_ITEMS }, () => ({
        productId: TINY_BEER.id, // 0.1 l @ 199¢, maxQuantity 99
        maxQuantity: MAX_FILL_QUANTITY,
      }));
      const result = await service.fill(fillInput(items));

      // All 10 lines fill to 99 units (99 l ≤ 110 l) — provable optimum.
      expect(result.status).toBe('FILLED');
      expect(result.filledUnits).toBe(10 * 99);
      expect(result.filledValueCents).toBe(990 * 199);
    });

    it('an equal-value line left out of the optimal fill is NOT_SELECTED (zero-priced offer)', async () => {
      const service = createFillService();
      const result = await service.fill(
        fillInput([
          { productId: BEER_CAN.id, maxQuantity: 2 }, // 2 × 500¢
          { productId: FREE_BEER.id, maxQuantity: 2 }, // 0¢ — adding value-free units
        ]),
      );

      // beer cap 3 l: optimum takes the 2 × 500¢ cans (1.0 l). The free
      // cans WOULD still physically fit (1.5 l more available), but the
      // search stops at value ties with fewer units — honest NOT_SELECTED.
      expect(result.status).toBe('FILLED');
      expect(result.filledValueCents).toBe(1000);
      const byProduct = new Map(result.lines.map((l) => [l.productId, l]));
      expect(byProduct.get(BEER_CAN.id)).toMatchObject({ filledQuantity: 2, status: 'FILLED' });
      expect(byProduct.get(FREE_BEER.id)).toMatchObject({ filledQuantity: 0, status: 'NOT_SELECTED' });
    });
  });

  // -------------------------------------------------------------------------
  // Provenance carriage
  // -------------------------------------------------------------------------

  describe('dataset-version provenance', () => {
    it('names the resolved versionLabel, echoes the input, and carries the structural disclaimer', async () => {
      const service = createFillService();
      const result = await service.fill(
        fillInput([{ productId: BEER_CAN.id, maxQuantity: 1 }], '2024-06-15'),
      );

      expect(result.allowanceDatasetVersion).toBe('eu-indicative-2024.1');
      expect(result.travelDate).toBe('2024-06-15');
      expect(result.metadata.input.items).toEqual([{ productId: BEER_CAN.id, maxQuantity: 1 }]);
      expect(result.metadata.input.travelDate).toBe('2024-06-15');
      expect(result.disclaimer).toEqual(DISCLAIMER_FI);
      expect(() => new Date(result.metadata.calculationTimestamp)).not.toThrow();
      expect(Number.isNaN(new Date(result.metadata.calculationTimestamp).getTime())).toBe(false);
    });

    it('carries the sessionId into the metadata echo when provided', async () => {
      const service = createFillService();
      const result = await service.fill(
        fillInput([{ productId: BEER_CAN.id, maxQuantity: 1 }]),
      );
      const withSession = await service.fill({
        items: [{ productId: BEER_CAN.id, maxQuantity: 1 }],
        travelDate: '2025-06-15',
        sessionId: 'session-8.1',
      });

      expect(result.metadata.input.sessionId).toBeUndefined();
      expect(withSession.metadata.input.sessionId).toBe('session-8.1');
    });
  });

  // -------------------------------------------------------------------------
  // Input + dataset validation errors
  // -------------------------------------------------------------------------

  describe('validation errors', () => {
    it('rejects a non-ISO travel date', async () => {
      const service = createFillService();
      await expect(
        service.fill(fillInput([{ productId: BEER_CAN.id, maxQuantity: 1 }], 'not-a-date')),
      ).rejects.toMatchObject({ reason: 'INVALID_TRAVEL_DATE' });
    });

    it('rejects more than MAX_FILL_ITEMS lines', async () => {
      const service = createFillService();
      const items = Array.from({ length: MAX_FILL_ITEMS + 1 }, () => ({
        productId: BEER_CAN.id,
        maxQuantity: 1,
      }));
      await expect(service.fill(fillInput(items))).rejects.toMatchObject({
        reason: 'TOO_MANY_ITEMS',
      });
    });

    it('rejects maxQuantity below 1 or above MAX_FILL_QUANTITY', async () => {
      const service = createFillService();
      await expect(
        service.fill(fillInput([{ productId: BEER_CAN.id, maxQuantity: 0 }])),
      ).rejects.toMatchObject({ reason: 'INVALID_QUANTITY' });
      await expect(
        service.fill(fillInput([{ productId: BEER_CAN.id, maxQuantity: MAX_FILL_QUANTITY + 1 }])),
      ).rejects.toMatchObject({ reason: 'INVALID_QUANTITY' });
    });

    it('rejects an unknown product and a product without offers', async () => {
      const service = createFillService();
      await expect(
        service.fill(fillInput([{ productId: 999, maxQuantity: 1 }])),
      ).rejects.toMatchObject({ reason: 'PRODUCT_NOT_FOUND' });

      const noOffers = createMockProductDataPort({ [BEER_CAN.id]: [] });
      const service2 = createFillService({ productData: noOffers });
      await expect(
        service2.fill(fillInput([{ productId: BEER_CAN.id, maxQuantity: 1 }])),
      ).rejects.toMatchObject({ reason: 'NO_OFFERS' });
    });

    it('applies the classification gate (basket rule) before filling', async () => {
      const productData = createMockProductDataPort();
      (productData.findProductById as ReturnType<typeof vi.fn>).mockImplementation(
        async (id: number) =>
          id === BEER_CAN.id ? { ...BEER_CAN, regulatoryClassification: null } : PRODUCTS_BY_ID[id] ?? null,
      );
      const service = createFillService({ productData });
      await expect(
        service.fill(fillInput([{ productId: BEER_CAN.id, maxQuantity: 1 }])),
      ).rejects.toThrow(BasketClassificationGateError);
    });

    it('rejects a resolved dataset row that caps nothing (both caps null)', async () => {
      const service = createFillService({
        datasets: [
          {
            versionLabel: 'broken',
            status: 'PUBLISHED',
            effectiveFrom: '2025-01-01',
            effectiveTo: null,
            limits: [cap('beer', null, null)],
          },
        ],
      });
      await expect(
        service.fill(fillInput([{ productId: BEER_CAN.id, maxQuantity: 1 }])),
      ).rejects.toMatchObject({ reason: 'INVALID_ALLOWANCE_DATASET' });
    });

    it('rejects duplicate and unknown allowance categories in the resolved version', async () => {
      const dupes = createFillService({
        datasets: [
          {
            versionLabel: 'dupes',
            status: 'PUBLISHED',
            effectiveFrom: '2025-01-01',
            effectiveTo: null,
            limits: [cap('beer', 3, null), cap('beer', 5, null)],
          },
        ],
      });
      await expect(
        dupes.fill(fillInput([{ productId: BEER_CAN.id, maxQuantity: 1 }])),
      ).rejects.toMatchObject({ reason: 'INVALID_ALLOWANCE_DATASET' });

      const unknown = createFillService({
        datasets: [
          {
            versionLabel: 'unknown-cat',
            status: 'PUBLISHED',
            effectiveFrom: '2025-01-01',
            effectiveTo: null,
            limits: [cap('mead', 3, null)],
          },
        ],
      });
      await expect(
        unknown.fill(fillInput([{ productId: BEER_CAN.id, maxQuantity: 1 }])),
      ).rejects.toMatchObject({ reason: 'INVALID_ALLOWANCE_DATASET' });
    });

    it('rejects non-positive caps', async () => {
      const negative = createFillService({
        datasets: [
          {
            versionLabel: 'negative',
            status: 'PUBLISHED',
            effectiveFrom: '2025-01-01',
            effectiveTo: null,
            limits: [cap('beer', -1, null)],
          },
        ],
      });
      await expect(
        negative.fill(fillInput([{ productId: BEER_CAN.id, maxQuantity: 1 }])),
      ).rejects.toMatchObject({ reason: 'INVALID_ALLOWANCE_DATASET' });

      const zeroQuantity = createFillService({
        datasets: [
          {
            versionLabel: 'zero-qty',
            status: 'PUBLISHED',
            effectiveFrom: '2025-01-01',
            effectiveTo: null,
            limits: [cap('beer', null, 0)],
          },
        ],
      });
      await expect(
        zeroQuantity.fill(fillInput([{ productId: BEER_CAN.id, maxQuantity: 1 }])),
      ).rejects.toMatchObject({ reason: 'INVALID_ALLOWANCE_DATASET' });
    });
  });

  // -------------------------------------------------------------------------
  // Determinism
  // -------------------------------------------------------------------------

  describe('determinism', () => {
    it('two identical fills produce identical results (modulo the calculation timestamp)', async () => {
      const service = createFillService();
      const input = fillInput([
        { productId: BEER_CAN.id, maxQuantity: 4 },
        { productId: WINE_BOTTLE.id, maxQuantity: 5 },
        { productId: SPIRITS_B.id, maxQuantity: 2 },
      ]);

      const [r1, r2]: [AllowanceFillResult, AllowanceFillResult] = await Promise.all([
        service.fill(input),
        service.fill(input),
      ]);

      const strip = (r: AllowanceFillResult): AllowanceFillResult => ({
        ...r,
        metadata: { ...r.metadata, calculationTimestamp: '' },
      });
      expect(strip(r1)).toEqual(strip(r2));
    });
  });
});
