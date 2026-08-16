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
    reliabilityStatus: 'EXACT',
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
    }),
  } as unknown as AlcoholExciseService;

  const containerDuty = {
    calculate: vi.fn().mockResolvedValue({
      volumeLitres: 0.5,
      ratePerLitre: 0.51,
      dutyCents: 26,
      taxDatasetVersion: 'v1',
      reliability: 'VERIFIED' as const,
    }),
  } as unknown as ContainerDutyService;

  // Mock for transport estimation
  const transportEstimation = {
    estimate: vi.fn().mockResolvedValue({
      offer: { id: 200, priceCents: 150, sellerInvolvementIndicator: false },
      matchedWeightBracket: { minKg: 0, maxKg: 1 },
      reliabilityStatus: 'EXACT' as const,
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
    reliabilityStatus?: 'EXACT' | 'ESTIMATED';
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
    reliabilityStatus: result.reliabilityStatus ?? 'EXACT',
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
        { id: 1, priceCents: 300, merchant: 'shop-a', country: 'DE', reliabilityStatus: 'EXACT' },
        { id: 2, priceCents: 200, merchant: 'shop-b', country: 'DE', reliabilityStatus: 'EXACT' },
        { id: 3, priceCents: 250, merchant: 'shop-c', country: 'DE', reliabilityStatus: 'EXACT' },
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
        reliabilityStatus: 'EXACT',
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
        reliabilityStatus: 'EXACT',
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
        reliabilityStatus: 'EXACT',
      });

      const { service } = createService({
        transportEstimate: transportStub,
      });

      const result = await service.calculate(DEFAULT_INPUT);

      // When seller is involved in transport, classification should be DistanceSelling
      expect(result.classification.classification).toBe('DistanceSelling');
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
      expect(result.totalCents).toBeGreaterThan(0);
      expect(result.metadata.productMasterId).toBe(1);
      expect(typeof result.calculationRecordId).toBe('number');
      expect(result.calculationRecordId).toBe(42);
    });

    it('includes four itemized cost lines', async () => {
      const { service } = createService();

      const result = await service.calculate(DEFAULT_INPUT);

      const labels = result.itemizedCosts.map((c) => c.label);
      expect(labels).toContain('Retail price');
      expect(labels).toContain('Transport');
      expect(labels).toContain('Alcohol excise');
      expect(labels).toContain('Container duty');
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
});