/**
 * HistoricalDataController unit tests.
 *
 * In-memory fakes extending the data-platform abstracts (no vi.fn mocks, no
 * @nestjs/testing) — same pattern as sibling controller tests, exercising:
 *
 * - series served from summaries only, projected per metric/granularity
 * - per-point reliability carried through (narrowed, never overstated)
 * - merchant filter semantics (product-wide rows vs merchant rows)
 * - read-time attribution: TAX_RULE_CHANGE with bounding version labels,
 *   MERCHANT_PRICE_CHANGE, TRANSPORT_CHANGE; UNCHANGED steps excluded;
 *   per-merchant grouping for product-wide requests
 * - validation: 365-day cap, metric/granularity vocabulary, ISO dates,
 *   from<=to, merchant length; 404 for unknown products
 *
 * @module HistoricalDataControllerTest
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type {
  ITaxRuleRepositoryPort,
  TaxRuleRecordPort,
} from '@rajahinta/core-domain';
import { TaxChangeAttributionService } from '@rajahinta/core-domain';
import type {
  PriceHistorySummaryRecord,
  PriceObservationRecord,
} from '@rajahinta/data-platform';
import {
  PriceHistorySummaryRepository,
  PriceObservationRepository,
  ProductRepository,
} from '@rajahinta/data-platform';
import { HistoricalDataController } from '../historical.controller';
import type { PriceHistoryResponse } from '../historical.dto';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PRODUCT = {
  id: 1,
  name: 'Test Olut',
  manufacturer: 'Panimo Oy',
  brand: 'Test',
  category: 'beer',
  alcoholByVolume: '0.047',
  unitVolume: '0.33',
  containerType: 'bottle',
  regulatoryClassification: 'beer',
  depositSystemStatus: false,
  ean: '0642000123456',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const PRODUCT_NO_DATA = { ...PRODUCT, id: 2 };

/** Excise rule versions: boundary at 2026-01-02T00:00Z. */
const EXCISE_RULE_V1: TaxRuleRecordPort = {
  id: 11,
  taxType: 'excise',
  productCategory: 'beer',
  rate: '0.3620',
  effectiveFrom: new Date('2020-01-01T00:00:00Z'),
  effectiveTo: new Date('2026-01-02T00:00:00Z'),
  calculationFormulaReference: 'PER_CENTILITRE_ETHANOL',
  officialSource: 'Finnish Tax Administration',
  verificationDate: new Date('2024-01-01'),
  versionLabel: '2024-01',
  exemptionConditions: null,
};

const EXCISE_RULE_V2: TaxRuleRecordPort = {
  ...EXCISE_RULE_V1,
  id: 12,
  rate: '0.4000',
  effectiveFrom: new Date('2026-01-02T00:00:00Z'),
  effectiveTo: null,
  versionLabel: '2026-01',
};

function makeSummary(
  overrides: Partial<PriceHistorySummaryRecord>,
): PriceHistorySummaryRecord {
  return {
    id: 1,
    granularity: 'daily',
    periodStart: '2026-01-01',
    productId: 1,
    merchant: null,
    priceOpenCents: 200,
    priceCloseCents: 210,
    priceMinCents: 200,
    priceMaxCents: 210,
    priceAvgCents: 205,
    landedCostOpenCents: 500,
    landedCostCloseCents: 510,
    landedCostMinCents: 500,
    landedCostMaxCents: 510,
    landedCostAvgCents: 505,
    observationCount: 2,
    strictestReliability: 'VERIFIED',
    ...overrides,
  };
}

const SUMMARIES: PriceHistorySummaryRecord[] = [
  makeSummary({ id: 1, periodStart: '2026-01-01' }),
  makeSummary({
    id: 2,
    periodStart: '2026-01-02',
    priceOpenCents: 210,
    priceCloseCents: 220,
    priceAvgCents: 215,
    landedCostOpenCents: 510,
    landedCostCloseCents: 520,
    landedCostAvgCents: 515,
    strictestReliability: 'ESTIMATED',
  }),
  // Merchant-scoped row: must be excluded from product-wide series.
  makeSummary({
    id: 3,
    merchant: 'merchant-a',
    priceOpenCents: 190,
    priceCloseCents: 190,
    priceMinCents: 190,
    priceMaxCents: 190,
    priceAvgCents: 190,
    landedCostOpenCents: 480,
    landedCostCloseCents: 480,
    landedCostMinCents: 480,
    landedCostMaxCents: 480,
    landedCostAvgCents: 480,
    observationCount: 1,
    strictestReliability: 'STALE',
  }),
  // Weekly row: only served for granularity=week.
  makeSummary({
    id: 4,
    granularity: 'weekly',
    periodStart: '2026-01-05',
    observationCount: 7,
  }),
];

function makeObservation(
  overrides: Partial<PriceObservationRecord> & {
    observedAt: Date;
    merchant: string;
  },
): PriceObservationRecord {
  return {
    id: 1,
    productId: 1,
    retailOfferId: 100,
    foreignRetailPriceCents: 200,
    transportCostCents: 100,
    transportOfferId: 900,
    exciseRuleVersionId: 11,
    containerDutyRuleVersionId: null,
    landedCostCents: 500,
    inputReliability: {
      retailPrice: 'VERIFIED',
      transport: 'VERIFIED',
      exciseRule: 'VERIFIED',
      containerDutyRule: 'VERIFIED',
    },
    confidence: 'HIGH',
    ...overrides,
  };
}

const OBSERVATIONS: PriceObservationRecord[] = [
  // merchant-a series: tax change → merchant price change → unchanged
  makeObservation({
    id: 1,
    merchant: 'merchant-a',
    observedAt: new Date('2026-01-01T10:00:00Z'),
    exciseRuleVersionId: 11,
  }),
  makeObservation({
    id: 2,
    merchant: 'merchant-a',
    observedAt: new Date('2026-01-02T10:00:00Z'),
    exciseRuleVersionId: 12,
    landedCostCents: 520, // price+transport unchanged, excise boundary crossed
  }),
  makeObservation({
    id: 3,
    merchant: 'merchant-a',
    observedAt: new Date('2026-01-03T10:00:00Z'),
    exciseRuleVersionId: 12,
    foreignRetailPriceCents: 250,
    landedCostCents: 570,
  }),
  makeObservation({
    id: 4,
    merchant: 'merchant-a',
    observedAt: new Date('2026-01-04T10:00:00Z'),
    exciseRuleVersionId: 12,
    foreignRetailPriceCents: 250,
    landedCostCents: 570, // identical to #3 → UNCHANGED, must be excluded
  }),
  // merchant-b series: transport change only, entirely inside rule v2
  // (crossing the 2026-01-02 boundary would also cross the excise version
  // boundary and legitimately classify as MIXED)
  makeObservation({
    id: 5,
    merchant: 'merchant-b',
    observedAt: new Date('2026-01-03T11:00:00Z'),
    exciseRuleVersionId: 12,
    foreignRetailPriceCents: 300,
    landedCostCents: 600,
  }),
  makeObservation({
    id: 6,
    merchant: 'merchant-b',
    observedAt: new Date('2026-01-04T11:00:00Z'),
    exciseRuleVersionId: 12,
    foreignRetailPriceCents: 300,
    transportCostCents: 150,
    landedCostCents: 650,
  }),
];

// ---------------------------------------------------------------------------
// In-memory fakes (extend the abstracts — no vi.fn)
// ---------------------------------------------------------------------------

class InMemoryProductRepository extends ProductRepository {
  async findById(
    id: number,
  ): Promise<(typeof PRODUCT) | null> {
    if (id === PRODUCT.id) return PRODUCT;
    if (id === PRODUCT_NO_DATA.id) return PRODUCT_NO_DATA;
    return null;
  }

  async searchByName(): Promise<never[]> {
    throw new Error('not implemented in fake');
  }
  async findOffers(): Promise<never[]> {
    throw new Error('not implemented in fake');
  }
  async findRetailOfferById(): Promise<null> {
    throw new Error('not implemented in fake');
  }
  async create(): Promise<never> {
    throw new Error('not implemented in fake');
  }
  async upsertByEan(): Promise<never> {
    throw new Error('not implemented in fake');
  }
}

class InMemoryObservationRepository extends PriceObservationRepository {
  constructor(private readonly rows: PriceObservationRecord[]) {
    super();
  }

  async findByProductRange(
    productId: number,
    from: Date,
    to: Date,
    merchant?: string | null,
  ): Promise<PriceObservationRecord[]> {
    return this.rows
      .filter(
        (r) =>
          r.productId === productId &&
          r.observedAt.getTime() >= from.getTime() &&
          r.observedAt.getTime() < to.getTime() &&
          (merchant == null || r.merchant === merchant),
      )
      .sort(
        (a, b) =>
          a.observedAt.getTime() - b.observedAt.getTime() || a.id - b.id,
      );
  }

  async findEarliestObservedAt(
    productId: number,
    merchant?: string | null,
  ): Promise<Date | null> {
    const rows = this.rows
      .filter(
        (r) =>
          r.productId === productId &&
          (merchant == null || r.merchant === merchant),
      )
      .sort(
        (a, b) =>
          a.observedAt.getTime() - b.observedAt.getTime() || a.id - b.id,
      );
    return rows.length > 0 ? rows[0].observedAt : null;
  }

  async append(): Promise<never> {
    throw new Error('not implemented in fake');
  }
  async findByMerchantOfferRange(): Promise<never[]> {
    throw new Error('not implemented in fake');
  }
  async findByMerchantProductRange(): Promise<never[]> {
    throw new Error('not implemented in fake');
  }
  async findProductActivitySince(): Promise<never[]> {
    throw new Error('not implemented in fake');
  }
}

class InMemorySummaryRepository extends PriceHistorySummaryRepository {
  constructor(private readonly rows: PriceHistorySummaryRecord[]) {
    super();
  }

  /** Closed [from, to] period-start range; null merchant → product-wide rows. */
  async findByProductRange(
    productId: number,
    granularity: string,
    from: string,
    to: string,
    merchant?: string | null,
  ): Promise<PriceHistorySummaryRecord[]> {
    return this.rows
      .filter(
        (r) =>
          r.productId === productId &&
          r.granularity === granularity &&
          r.periodStart >= from &&
          r.periodStart <= to &&
          (r.merchant ?? null) === (merchant ?? null),
      )
      .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  }

  async upsertBucket(): Promise<never> {
    throw new Error('not implemented in fake');
  }
}

class FakeTaxRuleRepository implements ITaxRuleRepositoryPort {
  constructor(private readonly rules: TaxRuleRecordPort[]) {}

  async findHistoryRates(
    taxType: string,
    productCategory: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<TaxRuleRecordPort[]> {
    return this.rules.filter(
      (r) =>
        r.taxType === taxType &&
        r.productCategory === productCategory &&
        r.effectiveFrom.getTime() <= toDate.getTime() &&
        (r.effectiveTo === null ||
          r.effectiveTo.getTime() >= fromDate.getTime()),
    );
  }

  async findApplicable(): Promise<null> {
    return null;
  }
  async findAllApplicable(): Promise<never[]> {
    return [];
  }
  async findActiveVersionLabels(): Promise<readonly string[]> {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function createController(): HistoricalDataController {
  return new HistoricalDataController(
    new InMemoryProductRepository(),
    new InMemorySummaryRepository(SUMMARIES),
    new InMemoryObservationRepository(OBSERVATIONS),
    new TaxChangeAttributionService(),
    new FakeTaxRuleRepository([EXCISE_RULE_V1, EXCISE_RULE_V2]),
  );
}

const RANGE = { from: '2026-01-01', to: '2026-01-31' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HistoricalDataController — series from summaries', () => {
  let controller: HistoricalDataController;

  beforeEach(() => {
    controller = createController();
  });

  it('returns daily price points with per-point reliability by default', async () => {
    const result = await controller.getPriceHistory(
      PRODUCT.id, undefined, undefined, RANGE.from, RANGE.to, undefined,
    );

    expect(result.metric).toBe('price');
    expect(result.granularity).toBe('day');
    expect(result.merchant).toBeNull();
    expect(result.series).toHaveLength(2);

    const [first, second] = result.series;
    expect(first).toEqual({
      periodStart: '2026-01-01',
      openCents: 200,
      closeCents: 210,
      minCents: 200,
      maxCents: 210,
      avgCents: 205,
      observationCount: 2,
      reliability: 'VERIFIED',
    });
    expect(second.reliability).toBe('ESTIMATED');
    expect(second.avgCents).toBe(215);
  });

  it('metric=landed-cost returns the landed-cost columns', async () => {
    const result = await controller.getPriceHistory(
      PRODUCT.id, 'landed-cost', undefined, RANGE.from, RANGE.to, undefined,
    );

    expect(result.metric).toBe('landed-cost');
    expect(result.series[0]).toMatchObject({
      openCents: 500,
      closeCents: 510,
      minCents: 500,
      maxCents: 510,
      avgCents: 505,
    });
  });

  it('granularity=week reads the weekly summary rows', async () => {
    const result = await controller.getPriceHistory(
      PRODUCT.id, undefined, 'week', RANGE.from, RANGE.to, undefined,
    );

    expect(result.granularity).toBe('week');
    expect(result.series).toHaveLength(1);
    expect(result.series[0].periodStart).toBe('2026-01-05');
    expect(result.series[0].observationCount).toBe(7);
  });

  it('merchant filter returns only that merchant’s rows', async () => {
    const result = await controller.getPriceHistory(
      PRODUCT.id, undefined, undefined, RANGE.from, RANGE.to, 'merchant-a',
    );

    expect(result.merchant).toBe('merchant-a');
    expect(result.series).toHaveLength(1);
    expect(result.series[0].reliability).toBe('STALE');
    expect(result.series[0].avgCents).toBe(190);
  });

  it('carries the earliest available observation date', async () => {
    const result = await controller.getPriceHistory(
      PRODUCT.id, undefined, undefined, RANGE.from, RANGE.to, undefined,
    );

    expect(result.earliestAvailableObservationDate).toBe(
      '2026-01-01T10:00:00.000Z',
    );
  });

  it('earliest date is merchant-scoped when a merchant is requested', async () => {
    const result = await controller.getPriceHistory(
      PRODUCT.id, undefined, undefined, RANGE.from, RANGE.to, 'merchant-b',
    );

    expect(result.earliestAvailableObservationDate).toBe(
      '2026-01-03T11:00:00.000Z',
    );
  });

  it('returns empty series, no attribution, and null earliest date for a product without data', async () => {
    const result: PriceHistoryResponse = await controller.getPriceHistory(
      PRODUCT_NO_DATA.id, undefined, undefined, RANGE.from, RANGE.to, undefined,
    );

    expect(result.series).toEqual([]);
    expect(result.attribution).toEqual([]);
    expect(result.earliestAvailableObservationDate).toBeNull();
  });
});

describe('HistoricalDataController — read-time attribution', () => {
  let controller: HistoricalDataController;

  beforeEach(() => {
    controller = createController();
  });

  it('labels a tax-driven change TAX_RULE_CHANGE with bounding version labels', async () => {
    const result = await controller.getPriceHistory(
      PRODUCT.id, 'landed-cost', undefined, RANGE.from, RANGE.to, 'merchant-a',
    );

    const taxStep = result.attribution.find(
      (a) => a.classification === 'TAX_RULE_CHANGE',
    );
    expect(taxStep).toBeDefined();
    expect(taxStep!.merchant).toBe('merchant-a');
    expect(taxStep!.fromObservedAt).toBe('2026-01-01T10:00:00.000Z');
    expect(taxStep!.toObservedAt).toBe('2026-01-02T10:00:00.000Z');
    expect(taxStep!.movedInputs).toEqual({
      exciseRule: true,
      containerDutyRule: false,
      merchantPrice: false,
      transport: false,
    });
    expect(taxStep!.exciseRuleBoundary).toEqual({
      fromVersionLabel: '2024-01',
      toVersionLabel: '2026-01',
    });
  });

  it('labels a pure price move MERCHANT_PRICE_CHANGE and excludes UNCHANGED steps', async () => {
    const result = await controller.getPriceHistory(
      PRODUCT.id, undefined, undefined, RANGE.from, RANGE.to, 'merchant-a',
    );

    expect(result.attribution.map((a) => a.classification)).toEqual([
      'TAX_RULE_CHANGE',
      'MERCHANT_PRICE_CHANGE',
    ]);
  });

  it('groups product-wide attribution per merchant series (never interleaved)', async () => {
    const result = await controller.getPriceHistory(
      PRODUCT.id, undefined, undefined, RANGE.from, RANGE.to, undefined,
    );

    // merchant-a: TAX_RULE_CHANGE + MERCHANT_PRICE_CHANGE
    // merchant-b: TRANSPORT_CHANGE
    // UNCHANGED (merchant-a obs3→obs4) excluded
    expect(result.attribution).toHaveLength(3);

    const byMerchant = result.attribution.reduce<
      Record<string, string[]>
    >((acc, a) => {
      (acc[a.merchant] ??= []).push(a.classification);
      return acc;
    }, {});
    expect(byMerchant['merchant-a']).toEqual([
      'TAX_RULE_CHANGE',
      'MERCHANT_PRICE_CHANGE',
    ]);
    expect(byMerchant['merchant-b']).toEqual(['TRANSPORT_CHANGE']);

    // Deterministic chronological order.
    const times = result.attribution.map((a) => a.toObservedAt);
    expect([...times].sort()).toEqual(times);
  });

  it('transport move carries TRANSPORT_CHANGE evidence', async () => {
    const result = await controller.getPriceHistory(
      PRODUCT.id, undefined, undefined, RANGE.from, RANGE.to, 'merchant-b',
    );

    expect(result.attribution).toHaveLength(1);
    const step = result.attribution[0];
    expect(step.classification).toBe('TRANSPORT_CHANGE');
    expect(step.movedInputs.transport).toBe(true);
    expect(step.movedInputs.merchantPrice).toBe(false);
    expect(step.exciseRuleBoundary).toBeNull();
  });
});

describe('HistoricalDataController — validation', () => {
  let controller: HistoricalDataController;

  beforeEach(() => {
    controller = createController();
  });

  async function expectBadRequest(
    params: {
      metric?: string;
      granularity?: string;
      from?: string;
      to?: string;
      merchant?: string;
    },
    messagePattern: RegExp,
  ): Promise<void> {
    try {
      await controller.getPriceHistory(
        PRODUCT.id,
        params.metric,
        params.granularity,
        params.from,
        params.to,
        params.merchant,
      );
      expect.unreachable('Expected BadRequestException');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const response = (err as BadRequestException).getResponse() as {
        message: string;
        error: string;
      };
      expect(response.error).toBe('ValidationError');
      expect(response.message).toMatch(messagePattern);
    }
  }

  it('rejects a range wider than 365 days', async () => {
    await expectBadRequest(
      { from: '2025-01-01', to: '2026-01-02' },
      /must not exceed 365 days/,
    );
  });

  it('accepts a range of exactly 365 days', async () => {
    const result = await controller.getPriceHistory(
      PRODUCT.id, undefined, undefined, '2025-01-01', '2026-01-01', undefined,
    );
    expect(result.from).toBe('2025-01-01');
    expect(result.to).toBe('2026-01-01');
  });

  it('rejects an invalid metric', async () => {
    await expectBadRequest(
      { ...RANGE, metric: 'volume' },
      /metric must be one of/,
    );
  });

  it('rejects an invalid granularity', async () => {
    await expectBadRequest(
      { ...RANGE, granularity: 'month' },
      /granularity must be one of/,
    );
  });

  it('rejects missing from/to', async () => {
    await expectBadRequest({ to: RANGE.to }, /from is required/);
    await expectBadRequest({ from: RANGE.from }, /to is required/);
  });

  it('rejects malformed and calendar-invalid dates', async () => {
    await expectBadRequest(
      { ...RANGE, from: '01-02-2026' },
      /from is required and must be an ISO date/,
    );
    await expectBadRequest(
      { ...RANGE, to: '2026-02-30' },
      /to is required and must be an ISO date/,
    );
  });

  it('rejects from after to', async () => {
    await expectBadRequest(
      { from: '2026-01-31', to: '2026-01-01' },
      /to must not be before from/,
    );
  });

  it('rejects an empty or oversized merchant', async () => {
    await expectBadRequest(
      { ...RANGE, merchant: '' },
      /merchant must be a non-empty string/,
    );
    await expectBadRequest(
      { ...RANGE, merchant: 'x'.repeat(129) },
      /merchant must be a non-empty string/,
    );
  });

  it('throws NotFoundException for an unknown product', async () => {
    await expect(
      controller.getPriceHistory(
        999, undefined, undefined, RANGE.from, RANGE.to, undefined,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
