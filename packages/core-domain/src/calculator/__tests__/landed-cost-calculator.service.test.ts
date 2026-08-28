/**
 * LandedCostCalculatorService tests.
 *
 * High-liability orchestrator coverage:
 *   - Classification gate enforcement
 *   - Product and offer resolution
 *   - Sub-service dispatch (transport, excise, container duty, classification)
 *   - Confidence aggregation
 *   - Itemized-result assembly
 *   - Persistence
 *   - Error handling for missing data
 */

import { describe, it, expect, vi } from 'vitest';
import { LandedCostCalculatorService } from '../landed-cost-calculator.service';
import { ClassificationGateService } from '../../normalization/classification-gate.service';
import { AlcoholExciseService } from '../../tax/services/alcohol-excise.service';
import { ContainerDutyService } from '../../tax/services/container-duty.service';
import { TransactionClassificationService } from '../../classification/transaction-classification.service';
import { TransportEstimationService } from '../../transport/transport-estimation.service';
import { ConfidenceFrameworkService } from '../../reliability/confidence-framework.service';
import { ReliabilityService } from '../../reliability/reliability.service';
import { TransportClassificationService } from '../../transport/transport-classification.service';
import type {
  CalculatorInput,
  CalculatorProductData,
  CalculatorRetailOfferData,
  IProductDataPort,
  ICalculationRecordPort,
} from '../calculator.types';
import {
  ClassificationGateRejectionError,
  ProductNotFoundError,
  NoRetailOffersError,
} from '../calculator.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEFAULT_PRODUCT: CalculatorProductData = {
  id: 1,
  regulatoryClassification: 'beer',
  category: 'beer',
  volumeLitres: 0.5,
  alcoholByVolume: 0.05,
  containerType: 'can',
  depositSystemStatus: true,
  weightKg: 0.55,
  normalizedName: 'Test Beer 5%',
};

const DEFAULT_OFFERS: CalculatorRetailOfferData[] = [
  {
    id: 100,
    priceCents: 200,
    merchant: 'test-merchant-de',
    country: 'DE',
    reliabilityStatus: 'VERIFIED',
  },
];

const DEFAULT_INPUT: CalculatorInput = {
  productId: 1,
  quantity: 1,
  destination: 'FI',
  sessionId: 'test-session-1',
};

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

function createMockProductDataPort(
  overrides?: Partial<IProductDataPort>,
): IProductDataPort {
  return {
    findProductById: vi.fn().mockResolvedValue(DEFAULT_PRODUCT),
    findRetailOffers: vi.fn().mockResolvedValue(DEFAULT_OFFERS),
    ...overrides,
  };
}

function createMockCalculationRecordPort(
  overrides?: Partial<ICalculationRecordPort>,
): ICalculationRecordPort {
  return {
    create: vi.fn().mockResolvedValue({ id: 42 }),
    ...overrides,
  };
}

/**
 * Create service with real sub-services (where cheap) and mocked ports.
 */
function createService(options?: {
  productData?: IProductDataPort;
  calculationRecords?: ICalculationRecordPort;
  transportEstimate?: ReturnType<typeof createTransportEstimateStub>;
}): {
  service: LandedCostCalculatorService;
  mocks: {
    productData: IProductDataPort;
    calculationRecords: ICalculationRecordPort;
    transportEstimation: TransportEstimationService;
    alcoholExcise: AlcoholExciseService;
    containerDuty: ContainerDutyService;
    transactionClassification: TransactionClassificationService;
  };
} {
  // Real services (zero I/O, pure logic)
  const gate = new ClassificationGateService();
  const transportClassification = new TransportClassificationService();
  const reliability = new ReliabilityService();
  const confidence = new ConfidenceFrameworkService(reliability);
  const classificationService = new TransactionClassificationService(
    transportClassification,
  );

  // Mocks for port dependencies
  const productData =
    options?.productData ?? createMockProductDataPort();
  const calculationRecords =
    options?.calculationRecords ?? createMockCalculationRecordPort();

  // Mocks for tax engines
  const alcoholExcise = {
    calculate: vi.fn().mockResolvedValue({
      category: 'beer',
      abv: 0.05,
      volumeLitres: 0.5,
      rateApplied: 0.0,
      taxCents: 30,
      taxDatasetVersion: 'v1',
      reliability: 'VERIFIED' as const,
      ruleId: null,
    }),
  } as unknown as AlcoholExciseService;

  const containerDuty = {
    calculate: vi.fn().mockResolvedValue({
      volumeLitres: 0.5,
      ratePerLitre: 0.51,
      dutyCents: 26,
      taxDatasetVersion: 'v1',
      reliability: 'VERIFIED' as const,
      ruleId: null,
    }),
  } as unknown as ContainerDutyService;

  // Mock for transport estimation
  const transportEstimation = {
    estimate: vi.fn().mockResolvedValue({
      offer: { id: 200, priceCents: 150, sellerInvolvementIndicator: false },
      matchedWeightBracket: { minKg: 0, maxKg: 1 },
      reliabilityStatus: 'VERIFIED' as const,
    }),
  } as unknown as TransportEstimationService;

  // Override transport mock if provided
  if (options?.transportEstimate) {
    const stub = options.transportEstimate;
    transportEstimation.estimate = stub;
  }

  const service = new LandedCostCalculatorService(
    gate,
    alcoholExcise,
    containerDuty,
    classificationService,
    transportEstimation,
    confidence,
    productData,
    calculationRecords,
  );

  return {
    service,
    mocks: {
      productData,
      calculationRecords,
      transportEstimation,
      alcoholExcise,
      containerDuty,
      transactionClassification: classificationService,
    },
  };
}

function createTransportEstimateStub(
  result: {
    id?: number;
    priceCents?: number;
    sellerInvolvementIndicator?: boolean;
    reliabilityStatus?: 'VERIFIED' | 'ESTIMATED';
  } | null,
) {
  if (result === null) {
    return vi.fn().mockRejectedValue(new Error('No transport offers'));
  }
  return vi.fn().mockResolvedValue({
    offer: {
      id: result.id ?? 200,
      priceCents: result.priceCents ?? 150,
      sellerInvolvementIndicator: result.sellerInvolvementIndicator ?? false,
    },
    matchedWeightBracket: { minKg: 0, maxKg: 1 },
    reliabilityStatus: result.reliabilityStatus ?? 'VERIFIED',
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LandedCostCalculatorService', () => {
  // ---------------------------------------------------------------------------
  // Gate enforcement
  // ---------------------------------------------------------------------------

  describe('classification gate', () => {
    it('rejects product with null regulatoryClassification', async () => {
      const productData = createMockProductDataPort({
        findProductById: vi.fn().mockResolvedValue({
          ...DEFAULT_PRODUCT,
          regulatoryClassification: null,
        }),
      });

      const { service } = createService({ productData });

      await expect(service.calculate(DEFAULT_INPUT)).rejects.toThrow(
        ClassificationGateRejectionError,
      );
    });

    it('rejects product with empty regulatoryClassification', async () => {
      const productData = createMockProductDataPort({
        findProductById: vi.fn().mockResolvedValue({
          ...DEFAULT_PRODUCT,
          regulatoryClassification: '',
        }),
      });

      const { service } = createService({ productData });

      await expect(service.calculate(DEFAULT_INPUT)).rejects.toThrow(
        ClassificationGateRejectionError,
      );
    });

    it('passes gate for classified product', async () => {
      const { service } = createService();

      const result = await service.calculate(DEFAULT_INPUT);

      expect(result.totalCents).toBeGreaterThanOrEqual(0);
      expect(result.classification).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Product and offer resolution
  // ---------------------------------------------------------------------------

  describe('product resolution', () => {
    it('throws ProductNotFoundError when product is null', async () => {
      const productData = createMockProductDataPort({
        findProductById: vi.fn().mockResolvedValue(null),
      });

      const { service } = createService({ productData });

      await expect(service.calculate(DEFAULT_INPUT)).rejects.toThrow(
        ProductNotFoundError,
      );
    });

    it('throws NoRetailOffersError when offers array is empty', async () => {
      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue([]),
      });

      const { service } = createService({ productData });

      await expect(service.calculate(DEFAULT_INPUT)).rejects.toThrow(
        NoRetailOffersError,
      );
    });

    it('selects the lowest-price offer', async () => {
      const offers: CalculatorRetailOfferData[] = [
        { id: 1, priceCents: 300, merchant: 'shop-a', country: 'DE', reliabilityStatus: 'VERIFIED' },
        { id: 2, priceCents: 200, merchant: 'shop-b', country: 'DE', reliabilityStatus: 'VERIFIED' },
        { id: 3, priceCents: 250, merchant: 'shop-c', country: 'DE', reliabilityStatus: 'VERIFIED' },
      ];

      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue(offers),
      });

      const { service } = createService({ productData });

      const result = await service.calculate(DEFAULT_INPUT);

      // Lowest offer is 200 cents, so total should reflect that
      expect(result.metadata.retailOfferIds).toContain(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Transport estimation
  // ---------------------------------------------------------------------------

  describe('transport estimation', () => {
    it('calls transport estimation with correct parameters', async () => {
      const transportStub = createTransportEstimateStub({
        priceCents: 150,
        reliabilityStatus: 'VERIFIED',
      });

      const { service, mocks } = createService({
        transportEstimate: transportStub,
      });

      await service.calculate(DEFAULT_INPUT);

      expect(mocks.transportEstimation.estimate).toHaveBeenCalledWith(
        'test-merchant-de', // carrier = input.transportMethod ?? bestOffer.merchant
        'DE',              // origin = bestOffer.country
        'FI',              // destination = input.destination
        0.55,              // weightKg from product
        'can',             // containerType from product
      );
    });

    it('uses transportMethod when provided', async () => {
      const transportStub = createTransportEstimateStub({
        priceCents: 150,
        reliabilityStatus: 'VERIFIED',
      });

      const { service, mocks } = createService({
        transportEstimate: transportStub,
      });

      await service.calculate({
        ...DEFAULT_INPUT,
        transportMethod: 'dhl',
      });

      expect(mocks.transportEstimation.estimate).toHaveBeenCalledWith(
        'dhl',
        expect.any(String),
        expect.any(String),
        expect.any(Number),
        expect.any(String),
      );
    });

    it('degrades gracefully when no transport offers exist', async () => {
      const transportStub = createTransportEstimateStub(null);

      const { service } = createService({
        transportEstimate: transportStub,
      });

      const result = await service.calculate(DEFAULT_INPUT);

      // Transport cost is zero when no transport data is available
      const transportLine = result.itemizedCosts.find(
        (c) => c.label === 'Transport',
      );
      expect(transportLine).toBeDefined();
      expect(transportLine!.cents).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Tax engine dispatch
  // ---------------------------------------------------------------------------

  describe('tax engine dispatch', () => {
    it('calls alcohol excise with correct parameters', async () => {
      const { service, mocks } = createService();

      await service.calculate(DEFAULT_INPUT);

      expect(mocks.alcoholExcise.calculate).toHaveBeenCalledWith(
        'beer',    // category (lowercased)
        0.05,      // abv decimal
        0.5,       // volumeLitres
      );
    });

    it('calls container duty with correct parameters', async () => {
      const { service, mocks } = createService();

      await service.calculate(DEFAULT_INPUT);

      expect(mocks.containerDuty.calculate).toHaveBeenCalledWith(
        0.5,       // volumeLitres
        'can',     // containerType / packaging
        true,      // depositSystemStatus
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Transaction classification
  // ---------------------------------------------------------------------------

  describe('transaction classification', () => {
    it('classifies with distance-selling context', async () => {
      const transportStub = createTransportEstimateStub({
        priceCents: 150,
        sellerInvolvementIndicator: true,
        reliabilityStatus: 'VERIFIED',
      });

      const { service } = createService({
        transportEstimate: transportStub,
      });

      const result = await service.calculate(DEFAULT_INPUT);

      // When seller is involved in transport, classification should be DistanceSelling
      expect(result.classification.classification).toBe('DistanceSelling');
    });

    it('classifies as TravellerImport when transportArrangement is PERSONAL', async () => {
      const { service } = createService();

      const result = await service.calculate({
        ...DEFAULT_INPUT,
        transportArrangement: 'PERSONAL',
      });

      expect(result.classification.classification).toBe('TravellerImport');
      expect(result.classification.confidence).toBe('HIGH');
      expect(result.classification.evidence).toHaveLength(2);
      expect(result.classification.evidence[1].observation).toContain('excluded');
    });

    it('defaults to SELLER_ARRANGED when transportArrangement is absent', async () => {
      const { service } = createService();

      const result = await service.calculate(DEFAULT_INPUT);

      // Default SELLER_ARRANGED → buyerIsTravelling: false → not TravellerImport
      expect(result.classification.classification).not.toBe('TravellerImport');
    });
  });

  // ---------------------------------------------------------------------------
  // Confidence
  // ---------------------------------------------------------------------------

  describe('confidence', () => {
    it('returns HIGH when all inputs are VERIFIED', async () => {
      const { service } = createService();

      const result = await service.calculate(DEFAULT_INPUT);

      expect(result.confidence).toBe('HIGH');
      expect(result.confidenceBreakdown).toHaveLength(5);
    });

    it('returns MEDIUM when transport is ESTIMATED', async () => {
      const transportStub = createTransportEstimateStub({
        priceCents: 150,
        reliabilityStatus: 'ESTIMATED',
      });

      const { service } = createService({
        transportEstimate: transportStub,
      });

      const result = await service.calculate(DEFAULT_INPUT);

      expect(result.confidence).toBe('MEDIUM');
    });
  });

  // ---------------------------------------------------------------------------
  // Quantity
  // ---------------------------------------------------------------------------

  describe('quantity multiplier', () => {
    it('scales retail and tax costs by quantity', async () => {
      const { service } = createService();

      const singleResult = await service.calculate({ ...DEFAULT_INPUT, quantity: 1 });
      const multiResult = await service.calculate({ ...DEFAULT_INPUT, quantity: 3 });

      // Retail: 200 * 1 vs 200 * 3
      const retailSingle = singleResult.itemizedCosts.find((c) => c.label === 'Retail price')!;
      const retailMulti = multiResult.itemizedCosts.find((c) => c.label === 'Retail price')!;
      expect(retailMulti.cents).toBe(retailSingle.cents * 3);
    });
  });

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  describe('persistence', () => {
    it('persists the calculation record', async () => {
      const calculationRecords = createMockCalculationRecordPort();
      const { service, mocks } = createService({ calculationRecords });

      const result = await service.calculate(DEFAULT_INPUT);

      expect(mocks.calculationRecords.create).toHaveBeenCalledTimes(1);
      expect(result.calculationRecordId).toBe(42);
    });

    it('passes correct data to persistence', async () => {
      const calculationRecords = createMockCalculationRecordPort();
      const { service, mocks } = createService({ calculationRecords });

      await service.calculate(DEFAULT_INPUT);

      const createCall = (mocks.calculationRecords.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createCall.productMasterId).toBe(1);
      expect(createCall.quantity).toBe(1);
      expect(createCall.destination).toBe('FI');
      expect(createCall.sessionId).toBe('test-session-1');
      expect(createCall.confidence).toBe('HIGH');
      expect(createCall.totalCents).toBeGreaterThan(0);
    });

    it('passes null sessionId when not provided', async () => {
      const calculationRecords = createMockCalculationRecordPort();
      const { service, mocks } = createService({ calculationRecords });

      await service.calculate({ ...DEFAULT_INPUT, sessionId: undefined });

      const createCall = (mocks.calculationRecords.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createCall.sessionId).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Result shape
  // ---------------------------------------------------------------------------

  describe('result shape', () => {
    it('returns a well-formed CalculatorResult', async () => {
      const { service } = createService();

      const result = await service.calculate(DEFAULT_INPUT);

      expect(result.currency).toBe('EUR');
      expect(result.disclaimer.text).toBeTruthy();
      expect(result.disclaimer.language).toBe('fi');
      expect(result.disclaimer.version).toBe('1.0');
      expect(result.totalCents).toBeGreaterThan(0);
      expect(result.metadata.productMasterId).toBe(1);
      expect(typeof result.calculationRecordId).toBe('number');
      expect(result.calculationRecordId).toBe(42);
    });

    it('includes four itemized cost lines with categories (otherCharges removed, task 10.3)', async () => {
      const { service } = createService();

      const result = await service.calculate(DEFAULT_INPUT);

      const byLabel = new Map(result.itemizedCosts.map((c) => [c.label, c]));

      expect(byLabel.get('Retail price')!.category).toBe('foreignRetailPrice');
      expect(byLabel.get('Transport')!.category).toBe('transportCost');
      expect(byLabel.get('Alcohol excise')!.category).toBe(
        'alcoholExciseEstimate',
      );
      expect(byLabel.get('Container duty')!.category).toBe(
        'containerDutyEstimate',
      );

      // Every top-level line item carries one of the canonical categories;
      // no line resurrects the removed dead contract.
      const canonical = new Set([
        'foreignRetailPrice',
        'transportCost',
        'alcoholExciseEstimate',
        'containerDutyEstimate',
      ]);
      for (const cost of result.itemizedCosts) {
        expect(canonical.has(cost.category)).toBe(true);
      }
      expect(byLabel.has('Other charges')).toBe(false);
    });

    it('exposes flat breakdown fields that sum to the total', async () => {
      const { service } = createService();

      const result = await service.calculate(DEFAULT_INPUT);

      expect(result.foreignRetailPrice).toBe(200); // 200 * 1
      expect(result.transportCost).toBe(150);
      expect(result.alcoholExciseEstimate).toBe(30);
      expect(result.containerDutyEstimate).toBe(26);
      expect(result.totalCents).toBe(
        result.foreignRetailPrice +
          result.transportCost +
          result.alcoholExciseEstimate +
          result.containerDutyEstimate,
      );
    });

    it('does not contain an otherCharges key anywhere in the serialized result (task 10.3, D3)', async () => {
      const { service } = createService();

      const result = await service.calculate(DEFAULT_INPUT);

      expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty(
        'otherCharges',
      );
      expect(result.itemizedCosts.some((c) => c.category === ('otherCharges' as never))).toBe(false);
    });

    it('includes calculation-status metadata', async () => {
      const { service } = createService();

      const result = await service.calculate(DEFAULT_INPUT);

      expect(result.metadata.calculationTimestamp).toBeDefined();
      expect(
        new Date(result.metadata.calculationTimestamp).getTime(),
      ).not.toBeNaN();
      expect(result.metadata.datasetVersions).toContain('v1'); // excise + container duty mocks
      expect(result.metadata.transportOfferId).toBe(200);
    });

    it('includes input snapshot metadata', async () => {
      const { service } = createService();

      const result = await service.calculate({
        ...DEFAULT_INPUT,
        quantity: 2,
        destination: 'SE',
      });

      expect(result.metadata.quantity).toBe(2);
      expect(result.metadata.destination).toBe('SE');
      expect(result.metadata.productName).toBe('Test Beer 5%');
    });

    it('sets transportOfferId to null when transport is unavailable', async () => {
      const transportStub = createTransportEstimateStub(null);

      const { service } = createService({
        transportEstimate: transportStub,
      });

      const result = await service.calculate(DEFAULT_INPUT);

      expect(result.metadata.transportOfferId).toBeNull();
      expect(result.transportCost).toBe(0);
    });

    it('every itemized cost has a reliability status', async () => {
      const { service } = createService();

      const result = await service.calculate(DEFAULT_INPUT);

      for (const cost of result.itemizedCosts) {
        expect(cost.reliability).toBeDefined();
      }
    });

    it('classification result is present with all fields', async () => {
      const { service } = createService();

      const result = await service.calculate(DEFAULT_INPUT);

      expect(result.classification.classification).toBeDefined();
      expect(result.classification.confidence).toBeDefined();
      expect(result.classification.evidence).toBeDefined();
      expect(result.classification.evidenceSummary).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Single-currency totals (task 1.5) — EUR-converted cents only
  // ---------------------------------------------------------------------------

  describe('single-currency totals (task 1.5)', () => {
    it('excludes an offer whose canonical currency is not EUR, with a visible reason', async () => {
      // SEK-currency offer is cheaper — it must NOT win the price race.
      const offers: CalculatorRetailOfferData[] = [
        {
          id: 1,
          priceCents: 50,
          currency: 'SEK',
          merchant: 'shop-se',
          country: 'SE',
          reliabilityStatus: 'VERIFIED',
          originalPriceCents: 500,
          originalCurrency: 'SEK',
        },
        {
          id: 2,
          priceCents: 200,
          currency: 'EUR',
          merchant: 'shop-de',
          country: 'DE',
          reliabilityStatus: 'VERIFIED',
        },
      ];
      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue(offers),
      });
      const { service } = createService({ productData });

      const result = await service.calculate(DEFAULT_INPUT);

      // The EUR offer was summed; the SEK offer never entered the total.
      expect(result.metadata.retailOfferIds).toContain(2);
      expect(result.foreignRetailPrice).toBe(200);
      expect(result.excludedOffers).toHaveLength(1);
      expect(result.excludedOffers[0]).toEqual({
        offerId: 1,
        merchant: 'shop-se',
        country: 'SE',
        reason: 'NO_VALID_EUR_CONVERSION',
        detail: expect.stringContaining('lacks a valid EUR conversion'),
        originalPriceCents: 500,
        originalCurrency: 'SEK',
      });
    });

    it('excludes a foreign-original offer with no recorded FX conversion', async () => {
      // Claims EUR cents but the SEK→EUR conversion is unattributed —
      // unrecorded conversions are not trustworthy (design D2).
      const offers: CalculatorRetailOfferData[] = [
        {
          id: 1,
          priceCents: 100,
          merchant: 'shop-se',
          country: 'SE',
          reliabilityStatus: 'VERIFIED',
          originalPriceCents: 1130,
          originalCurrency: 'SEK',
          // fxDatasetVersion absent
        },
        {
          id: 2,
          priceCents: 180,
          merchant: 'shop-se-2',
          country: 'SE',
          reliabilityStatus: 'VERIFIED',
          originalPriceCents: 2030,
          originalCurrency: 'SEK',
          fxDatasetVersion: 'ecb-2026-08-27.1',
        },
      ];
      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue(offers),
      });
      const { service } = createService({ productData });

      const result = await service.calculate(DEFAULT_INPUT);

      // Only the attributed conversion entered the total.
      expect(result.metadata.retailOfferIds).toContain(2);
      expect(result.excludedOffers).toHaveLength(1);
      expect(result.excludedOffers[0].offerId).toBe(1);
      expect(result.excludedOffers[0].reason).toBe('NO_VALID_EUR_CONVERSION');
      expect(result.excludedOffers[0].originalCurrency).toBe('SEK');
    });

    it('sums a converted offer and surfaces its original amount for display', async () => {
      const offers: CalculatorRetailOfferData[] = [
        {
          id: 1,
          priceCents: 141,
          currency: 'EUR',
          merchant: 'systembolaget',
          country: 'SE',
          reliabilityStatus: 'VERIFIED',
          originalPriceCents: 1590,
          originalCurrency: 'SEK',
          fxDatasetVersion: 'ecb-2026-08-27.1',
        },
        {
          id: 2,
          priceCents: 200,
          currency: 'EUR',
          merchant: 'shop-de',
          country: 'DE',
          reliabilityStatus: 'VERIFIED',
        },
      ];
      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue(offers),
      });
      const { service } = createService({ productData });

      const result = await service.calculate(DEFAULT_INPUT);

      // Converted SEK offer won on price and was summed as EUR cents.
      expect(result.metadata.retailOfferIds).toContain(1);
      expect(result.foreignRetailPrice).toBe(141);
      expect(result.excludedOffers).toEqual([]);
      // Original amount/currency surfaced for display (task 1.5).
      expect(result.originalRetailPrice).toEqual({
        priceCents: 1590,
        currency: 'SEK',
      });
      // Total is a truthful EUR sum: 141 retail + 150 transport + 30 excise + 26 duty.
      expect(result.totalCents).toBe(347);
      expect(result.currency).toBe('EUR');
    });

    it('omits originalRetailPrice for EUR-native offers carrying no original', async () => {
      const { service } = createService();

      const result = await service.calculate(DEFAULT_INPUT);

      expect(result.originalRetailPrice).toBeUndefined();
    });

    it('treats offers without currency fields as EUR (legacy read models)', async () => {
      const { service } = createService();

      const result = await service.calculate(DEFAULT_INPUT);

      expect(result.excludedOffers).toEqual([]);
      expect(result.foreignRetailPrice).toBe(200);
    });

    it('throws NoRetailOffersError when every offer lacks a valid conversion', async () => {
      const offers: CalculatorRetailOfferData[] = [
        {
          id: 1,
          priceCents: 100,
          currency: 'SEK',
          merchant: 'shop-se',
          country: 'SE',
          reliabilityStatus: 'VERIFIED',
        },
        {
          id: 2,
          priceCents: 150,
          currency: 'NOK',
          merchant: 'shop-no',
          country: 'NO',
          reliabilityStatus: 'VERIFIED',
        },
      ];
      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue(offers),
      });
      const { service } = createService({ productData });

      // An honest failure beats a mixed-currency total pretending to be EUR.
      await expect(service.calculate(DEFAULT_INPUT)).rejects.toThrow(
        NoRetailOffersError,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // FX dataset version → datasetVersions (task 1.6 — cache invalidation chain)
  // ---------------------------------------------------------------------------

  describe('FX dataset version in datasetVersions (task 1.6)', () => {
    function convertedOffer(fxDatasetVersion: string): CalculatorRetailOfferData {
      return {
        id: 1,
        priceCents: 141,
        currency: 'EUR',
        merchant: 'systembolaget',
        country: 'SE',
        reliabilityStatus: 'VERIFIED',
        originalPriceCents: 1590,
        originalCurrency: 'SEK',
        fxDatasetVersion,
      };
    }

    function serviceWithOffer(offer: CalculatorRetailOfferData) {
      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue([offer]),
      });
      return createService({ productData });
    }

    it("includes the selected offer's FX dataset version in metadata.datasetVersions", async () => {
      const { service } = serviceWithOffer(convertedOffer('ecb-2026-08-27.1'));

      const result = await service.calculate(DEFAULT_INPUT);

      // Offer → fxDatasetVersion → datasetVersions: the provenance chain
      // idempotency/cache keys consume (hashInput includes datasetVersions).
      expect(result.metadata.datasetVersions).toContain('ecb-2026-08-27.1');
    });

    it('does not fabricate an FX version for EUR-native offers', async () => {
      const { service } = createService();

      const result = await service.calculate(DEFAULT_INPUT);

      expect(
        result.metadata.datasetVersions.every((v) => !v.startsWith('ecb-')),
      ).toBe(true);
    });

    it('changes datasetVersions when the FX dataset version changes — version-keyed caches invalidate', async () => {
      const before = await serviceWithOffer(
        convertedOffer('ecb-2026-08-27.1'),
      ).service.calculate(DEFAULT_INPUT);
      const after = await serviceWithOffer(
        convertedOffer('ecb-2026-08-28.1'),
      ).service.calculate(DEFAULT_INPUT);

      const sorted = (versions: readonly string[]) => [...versions].sort();
      expect(sorted(before.metadata.datasetVersions)).not.toEqual(
        sorted(after.metadata.datasetVersions),
      );
      // Pin the convention precisely: identical inputs, only the FX
      // version moved — a hash over (input, datasetVersions) must differ.
      const keyBefore = JSON.stringify({
        ...before.metadata.input,
        datasetVersions: sorted(before.metadata.datasetVersions),
      });
      const keyAfter = JSON.stringify({
        ...after.metadata.input,
        datasetVersions: sorted(after.metadata.datasetVersions),
      });
      expect(keyBefore).not.toEqual(keyAfter);
    });
  });
});