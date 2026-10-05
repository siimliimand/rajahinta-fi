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
  CostCategory,
  CostLineCode,
  ItemizedCost,
  IProductDataPort,
  ICalculationRecordPort,
} from '../calculator.types';
import {
  ClassificationGateRejectionError,
  NoAllowanceDatasetError,
  ProductNotFoundError,
  NoRetailOffersError,
} from '../calculator.types';
import type { ITravellerAllowancePort, TripResolvedAllowances } from '../../optimizer/ports/traveller-allowance.port';
import type { ITransportOfferQuery } from '../../transport/transport-offer-query.interface';
import type { TransportOffer } from '../../transport/transport-offer.type';

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
  // Pinned so the import-VAT rate resolution is deterministic (the
  // effective-date lookup defaults to now, which a v3 seed could move).
  transactionDate: '2026-03-15T12:00:00.000Z',
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
 *
 * `travellerAllowances` defaults to UNWIRED (undefined) — the production
 * surfaces that never bound the token — so every test below that does not
 * opt into traveller mode exercises the pre-allowance engine exactly.
 */
function createService(options?: {
  productData?: IProductDataPort;
  calculationRecords?: ICalculationRecordPort;
  transportEstimate?: ReturnType<typeof createTransportEstimateStub>;
  /**
   * A real TransportEstimationService (task 3.3 weight-basis tests) —
   * takes precedence over `transportEstimate` when provided, so the
   * estimator's own tier/basis logic runs for real behind the calculator.
   */
  transportService?: TransportEstimationService;
  travellerAllowances?: ITravellerAllowancePort | null;
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
  const transportEstimation =
    options?.transportService ??
    ({
      estimate: vi.fn().mockResolvedValue({
        offer: { id: 200, priceCents: 150, sellerInvolvementIndicator: false },
        matchedWeightBracket: { minKg: 0, maxKg: 1 },
        reliabilityStatus: 'VERIFIED' as const,
      }),
    } as unknown as TransportEstimationService);

  // Override transport mock if provided (a real service wins over the stub)
  if (options?.transportEstimate && !options?.transportService) {
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
    options?.travellerAllowances,
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
// Real-estimator fixtures (task 3.3 weight-basis tests)
// ---------------------------------------------------------------------------

const TRANSPORT_BASE_DATE = new Date('2026-08-16T12:00:00Z');

/** Minimal transport_offers row — the fields estimate() consumes. */
function makeTransportOffer(
  overrides: Partial<TransportOffer> & {
    carrier: string;
    originCountry: string;
    destinationCountry: string;
  },
): TransportOffer {
  return {
    id: overrides.id ?? 1,
    carrier: overrides.carrier,
    originCountry: overrides.originCountry,
    destinationCountry: overrides.destinationCountry,
    weightBracket: overrides.weightBracket ?? { minKg: null, maxKg: null },
    packageTier: overrides.packageTier ?? 'pallet',
    priceCents: overrides.priceCents ?? 5000,
    currency: overrides.currency ?? 'EUR',
    sellerInvolvementIndicator: overrides.sellerInvolvementIndicator ?? false,
    observedAt: overrides.observedAt ?? TRANSPORT_BASE_DATE,
    refreshedAt: overrides.refreshedAt ?? TRANSPORT_BASE_DATE,
    reliabilityStatus: overrides.reliabilityStatus ?? 'VERIFIED',
  };
}

/** In-memory ITransportOfferQuery — the estimator sees only these rows. */
class StubOfferQuery implements ITransportOfferQuery {
  constructor(private readonly offers: TransportOffer[]) {}

  async findAllActive(): Promise<TransportOffer[]> {
    return this.offers;
  }

  async findByCarrier(carrierId: string): Promise<TransportOffer[]> {
    return this.offers.filter((o) => o.carrier === carrierId);
  }
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
  // Out-of-stock default selection (task 4.1): a persisted out_of_stock
  // availability keeps an offer out of default selection; every other state
  // (and the field's absence on legacy read models) stays eligible. When
  // every offer is out of stock, selection falls back to the full set —
  // the request succeeds on best-known data instead of failing.
  // ---------------------------------------------------------------------------

  describe('out-of-stock default selection (task 4.1)', () => {
    it('skips a single out-of-stock offer even when it is the cheapest', async () => {
      const offers: CalculatorRetailOfferData[] = [
        { id: 1, priceCents: 100, merchant: 'shop-a', country: 'DE', reliabilityStatus: 'VERIFIED', availability: 'out_of_stock' },
        { id: 2, priceCents: 300, merchant: 'shop-b', country: 'DE', reliabilityStatus: 'VERIFIED', availability: 'in_stock' },
      ];

      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue(offers),
      });

      const { service } = createService({ productData });

      const result = await service.calculate(DEFAULT_INPUT);

      expect(result.metadata.retailOfferIds).toContain(2);
    });

    it('skips many out-of-stock offers and picks the cheapest purchasable one', async () => {
      const offers: CalculatorRetailOfferData[] = [
        { id: 1, priceCents: 100, merchant: 'shop-a', country: 'DE', reliabilityStatus: 'VERIFIED', availability: 'out_of_stock' },
        { id: 2, priceCents: 150, merchant: 'shop-b', country: 'DE', reliabilityStatus: 'VERIFIED', availability: 'out_of_stock' },
        { id: 3, priceCents: 250, merchant: 'shop-c', country: 'DE', reliabilityStatus: 'VERIFIED', availability: 'out_of_stock' },
        { id: 4, priceCents: 400, merchant: 'shop-d', country: 'DE', reliabilityStatus: 'VERIFIED', availability: 'in_stock' },
        { id: 5, priceCents: 450, merchant: 'shop-e', country: 'DE', reliabilityStatus: 'VERIFIED', availability: 'low_stock' },
      ];

      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue(offers),
      });

      const { service } = createService({ productData });

      const result = await service.calculate(DEFAULT_INPUT);

      expect(result.metadata.retailOfferIds).toContain(4);
    });

    it('keeps low_stock and unknown eligible — only confirmed out_of_stock is excluded', async () => {
      const offers: CalculatorRetailOfferData[] = [
        { id: 1, priceCents: 100, merchant: 'shop-a', country: 'DE', reliabilityStatus: 'VERIFIED', availability: 'low_stock' },
        { id: 2, priceCents: 120, merchant: 'shop-b', country: 'DE', reliabilityStatus: 'VERIFIED', availability: 'unknown' },
        { id: 3, priceCents: 140, merchant: 'shop-c', country: 'DE', reliabilityStatus: 'VERIFIED' },
      ];

      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue(offers),
      });

      const { service } = createService({ productData });

      const result = await service.calculate(DEFAULT_INPUT);

      expect(result.metadata.retailOfferIds).toContain(1);
    });

    it('falls back to the current pick when EVERY offer is out of stock', async () => {
      const offers: CalculatorRetailOfferData[] = [
        { id: 1, priceCents: 300, merchant: 'shop-a', country: 'DE', reliabilityStatus: 'VERIFIED', availability: 'out_of_stock' },
        { id: 2, priceCents: 200, merchant: 'shop-b', country: 'DE', reliabilityStatus: 'VERIFIED', availability: 'out_of_stock' },
      ];

      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue(offers),
      });

      const { service } = createService({ productData });

      // No new error surface: the request succeeds with the pre-4.1 pick.
      const result = await service.calculate(DEFAULT_INPUT);

      expect(result.metadata.retailOfferIds).toContain(2);
    });

    it('treats a legacy offer without the availability field as eligible', async () => {
      const offers: CalculatorRetailOfferData[] = [
        { id: 1, priceCents: 100, merchant: 'shop-a', country: 'DE', reliabilityStatus: 'VERIFIED' },
        { id: 2, priceCents: 200, merchant: 'shop-b', country: 'DE', reliabilityStatus: 'VERIFIED', availability: 'in_stock' },
      ];

      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue(offers),
      });

      const { service } = createService({ productData });

      const result = await service.calculate(DEFAULT_INPUT);

      expect(result.metadata.retailOfferIds).toContain(1);
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
        'test-merchant-de', // carrier = transportMethod ?? carrierId ?? merchant
        'DE',              // origin = bestOffer.country
        'FI',              // destination = input.destination
        0.55,              // shipmentWeightKg = unit weight × quantity
        undefined,         // storedWeightGrams absent on the fixture product
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
        undefined,
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
  // Transport weight + carrier resolution (task 3.3, design D1/D4/D5)
  // ---------------------------------------------------------------------------

  describe('transport weight and carrier resolution (task 3.3)', () => {
    /** Product/offer fixtures with explicit per-test overrides. */
    function productDataWith(
      product: Partial<CalculatorProductData>,
      offers: CalculatorRetailOfferData[],
    ): IProductDataPort {
      return {
        findProductById: vi.fn().mockResolvedValue({
          ...DEFAULT_PRODUCT,
          ...product,
        }),
        findRetailOffers: vi.fn().mockResolvedValue(offers),
      };
    }

    it('scales the lookup weight by quantity — 12 × 1 kg prices a 12 kg shipment (D4)', async () => {
      const { service, mocks } = createService({
        productData: productDataWith({ weightKg: 1 }, DEFAULT_OFFERS),
      });

      await service.calculate({ ...DEFAULT_INPUT, quantity: 12 });

      expect(mocks.transportEstimation.estimate).toHaveBeenCalledWith(
        'test-merchant-de',
        'DE',
        'FI',
        12, // 1 kg unit × 12 units — the TOTAL shipment weight
        undefined,
      );
    });

    it('resolves the unit weight from stored grams and passes them through (D5)', async () => {
      const { service, mocks } = createService({
        productData: productDataWith(
          { weightKg: 1, storedWeightGrams: 1200 },
          DEFAULT_OFFERS,
        ),
      });

      await service.calculate({ ...DEFAULT_INPUT, quantity: 2 });

      expect(mocks.transportEstimation.estimate).toHaveBeenCalledWith(
        'test-merchant-de',
        'DE',
        'FI',
        2.4, // 1.2 kg stored unit × 2 units — stored weight, not the 1 kg guess
        1200,
      );
    });

    it('treats a non-positive stored weight as unknown — volume estimate, honest basis', async () => {
      const { service, mocks } = createService({
        productData: productDataWith(
          { weightKg: 0.55, storedWeightGrams: 0 },
          DEFAULT_OFFERS,
        ),
      });

      await service.calculate({ ...DEFAULT_INPUT, quantity: 1 });

      expect(mocks.transportEstimation.estimate).toHaveBeenCalledWith(
        'test-merchant-de',
        'DE',
        'FI',
        0.55,
        0, // passes through; the estimator reads any non-positive as VOLUME_ESTIMATE
      );
    });

    it('prefers the registry carrierId over the merchant name (D1)', async () => {
      const { service, mocks } = createService({
        productData: productDataWith({}, [
          { ...DEFAULT_OFFERS[0], merchant: 'Fransberg', carrierId: 'fransberg' },
        ]),
      });

      await service.calculate(DEFAULT_INPUT);

      expect(mocks.transportEstimation.estimate).toHaveBeenCalledWith(
        'fransberg',
        expect.any(String),
        expect.any(String),
        expect.any(Number),
        undefined, // no stored weight on this fixture
      );
    });

    it('falls back to the merchant name when carrierId is null — honest unknown', async () => {
      const { service, mocks } = createService({
        productData: productDataWith({}, [
          { ...DEFAULT_OFFERS[0], carrierId: null },
        ]),
      });

      await service.calculate(DEFAULT_INPUT);

      expect(mocks.transportEstimation.estimate).toHaveBeenCalledWith(
        'test-merchant-de',
        expect.any(String),
        expect.any(String),
        expect.any(Number),
        undefined, // no stored weight on this fixture
      );
    });

    it('keeps transportMethod ahead of the registry carrierId (D1)', async () => {
      const { service, mocks } = createService({
        productData: productDataWith({}, [
          { ...DEFAULT_OFFERS[0], carrierId: 'fransberg' },
        ]),
      });

      await service.calculate({ ...DEFAULT_INPUT, transportMethod: 'dhl' });

      expect(mocks.transportEstimation.estimate).toHaveBeenCalledWith(
        'dhl',
        expect.any(String),
        expect.any(String),
        expect.any(Number),
        undefined, // no stored weight on this fixture
      );
    });

    it('caps at ESTIMATED on a volume basis and verifies only on a stored weight (D6/D7)', async () => {
      // Real estimator + real bracket selection over an in-memory query —
      // the carrier's own dataset derives the parcel tier (D3), and the
      // 0.55 kg shipment fits the exact bracket either way, so the ONLY
      // variable is the weight basis behind the match.
      const query = new StubOfferQuery([
        makeTransportOffer({
          carrier: 'test-merchant-de',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 0, maxKg: 31.5 },
          priceCents: 1490,
        }),
      ]);

      const estimated = await createService({
        productData: productDataWith({ weightKg: 0.55 }, DEFAULT_OFFERS),
        transportService: new TransportEstimationService(query),
      }).service.calculate(DEFAULT_INPUT);
      const estimatedLine = estimated.itemizedCosts.find(
        (c) => c.label === 'Transport',
      );
      expect(estimatedLine?.reliability).toBe('ESTIMATED');
      expect(estimatedLine?.cents).toBe(1490);

      const verified = await createService({
        productData: productDataWith(
          { weightKg: 0.55, storedWeightGrams: 550 },
          DEFAULT_OFFERS,
        ),
        transportService: new TransportEstimationService(query),
      }).service.calculate(DEFAULT_INPUT);
      const verifiedLine = verified.itemizedCosts.find(
        (c) => c.label === 'Transport',
      );
      expect(verifiedLine?.reliability).toBe('VERIFIED');
      // Same bracket, same cents — the basis never moves money.
      expect(verifiedLine?.cents).toBe(1490);
    });

    it('degrades a NotFoundError to the 0 ¢ / UNAVAILABLE transport line, unchanged', async () => {
      const { service } = createService({
        productData: productDataWith({ weightKg: 0.55 }, DEFAULT_OFFERS),
        // No rows for any carrier — the real estimator throws NotFoundError.
        transportService: new TransportEstimationService(new StubOfferQuery([])),
      });

      const result = await service.calculate(DEFAULT_INPUT);

      const transportLine = result.itemizedCosts.find(
        (c) => c.label === 'Transport',
      );
      expect(transportLine?.cents).toBe(0);
      expect(transportLine?.reliability).toBe('UNAVAILABLE');
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

    it('includes five itemized cost lines for an import (otherCharges removed, task 10.3)', async () => {
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
      expect(byLabel.get('Import VAT (estimated)')!.category).toBe(
        'importVatEstimate',
      );

      // Every top-level line item carries one of the canonical categories;
      // no line resurrects the removed dead contract.
      const canonical = new Set([
        'foreignRetailPrice',
        'transportCost',
        'alcoholExciseEstimate',
        'containerDutyEstimate',
        'importVatEstimate',
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
      // Import: 200 + 150 + 30 + 26 = 406 base; 25.5 % → 103.53 → 104.
      expect(result.importVatEstimate).toBe(104);
      expect(result.totalCents).toBe(
        result.foreignRetailPrice +
          result.transportCost +
          result.alcoholExciseEstimate +
          result.containerDutyEstimate +
          result.importVatEstimate!,
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
  // EUR-only offers (change drop-sweden-eur-only-alko-benchmark, design D3)
  // ---------------------------------------------------------------------------

  describe('EUR-only offers (design D3)', () => {
    it('sums every offer — the exclusion path no longer exists', async () => {
      const offers: CalculatorRetailOfferData[] = [
        { id: 1, priceCents: 210, currency: 'EUR', merchant: 'shop-ee', country: 'EE', reliabilityStatus: 'VERIFIED' },
        { id: 2, priceCents: 200, currency: 'EUR', merchant: 'shop-de', country: 'DE', reliabilityStatus: 'VERIFIED' },
        // Legacy read models may omit the currency field — absence means EUR.
        { id: 3, priceCents: 260, merchant: 'shop-legacy', country: 'DE', reliabilityStatus: 'ESTIMATED' },
      ];
      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue(offers),
      });
      const { service } = createService({ productData });

      const result = await service.calculate(DEFAULT_INPUT);

      // Cheapest EUR offer wins; nothing is excluded because exclusion is
      // unrepresentable — the currency union is the 'EUR' literal.
      expect(result.metadata.retailOfferIds).toEqual([2]);
      expect(result.foreignRetailPrice).toBe(200);
      expect('excludedOffers' in result).toBe(false);
      expect('originalRetailPrice' in result).toBe(false);
      expect(result.currency).toBe('EUR');
    });

    it('datasetVersions carries only tax dataset versions (no FX provenance)', async () => {
      const { service } = createService();

      const result = await service.calculate(DEFAULT_INPUT);

      // Excise + container duty mocks, plus the import-VAT version the
      // consignment resolved (idempotency/cache keys derive from these).
      expect(result.metadata.datasetVersions).toEqual([
        'v1',
        'v1',
        'import-vat-2024.2',
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // Alko benchmark enrichment (change drop-sweden-eur-only-alko-benchmark)
  // ---------------------------------------------------------------------------

  describe('Alko benchmark enrichment', () => {
    /** Alko reference rows exercising the newest-observedAt selection. */
    const ALKO_REFERENCES: CalculatorRetailOfferData[] = [
      {
        id: 300,
        priceCents: 250,
        merchant: 'alko',
        country: 'FI',
        reliabilityStatus: 'VERIFIED',
        observedAt: new Date('2026-08-01T10:00:00.000Z'),
      },
      // Newest observation wins despite the higher id and lower
      // reliability — selection is by observedAt first, id on ties.
      {
        id: 301,
        priceCents: 240,
        merchant: 'alko',
        country: 'FI',
        reliabilityStatus: 'STALE',
        observedAt: new Date('2026-08-05T10:00:00.000Z'),
      },
    ];

    /** The exact snapshot the default fixtures must produce. */
    const EXPECTED_SNAPSHOT = {
      status: 'available',
      // Best offer (200) against the newest reference (240).
      referencePriceCents: 240,
      differenceCents: -40,
      // -40 / 240 * 100 = -16.666… → -16.7 (half away from zero).
      differencePercent: -16.7,
      reliabilityStatus: 'STALE',
      observedAt: '2026-08-05T10:00:00.000Z',
    };

    it('attaches the exact benchmark when an Alko reference exists', async () => {
      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue([
          ...DEFAULT_OFFERS,
          ...ALKO_REFERENCES,
        ]),
      });
      const { service } = createService({ productData });

      const result = await service.calculate(DEFAULT_INPUT);

      expect(result.alkoBenchmark).toEqual(EXPECTED_SNAPSHOT);
    });

    it('persists the benchmark with the calculation record', async () => {
      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue([
          ...DEFAULT_OFFERS,
          ...ALKO_REFERENCES,
        ]),
      });
      const calculationRecords = createMockCalculationRecordPort();
      const { service, mocks } = createService({
        productData,
        calculationRecords,
      });

      await service.calculate(DEFAULT_INPUT);

      const createCall = (mocks.calculationRecords.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createCall.alkoBenchmark).toEqual(EXPECTED_SNAPSHOT);
    });

    it('keeps totals, breakdown, and confidence byte-identical with references present (display-only)', async () => {
      const without = createService();
      const withoutResult = await without.service.calculate(DEFAULT_INPUT);

      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue([
          ...DEFAULT_OFFERS,
          ...ALKO_REFERENCES,
        ]),
      });
      const withRefs = createService({ productData });
      const withResult = await withRefs.service.calculate(DEFAULT_INPUT);

      // The benchmark varies; every calculated figure is invariant.
      expect(withResult.totalCents).toBe(withoutResult.totalCents);
      expect(withResult.itemizedCosts).toEqual(withoutResult.itemizedCosts);
      expect(withResult.confidence).toBe(withoutResult.confidence);
      expect(JSON.parse(JSON.stringify(withResult.itemizedCosts))).not.toHaveProperty(
        'alkoBenchmark',
      );
    });

    it('omits the key (never null) when no Alko reference exists', async () => {
      const calculationRecords = createMockCalculationRecordPort();
      const { service, mocks } = createService({ calculationRecords });

      const result = await service.calculate(DEFAULT_INPUT);

      // DEFAULT_OFFERS carry no 'alko' merchant row.
      expect('alkoBenchmark' in result).toBe(false);
      const createCall = (mocks.calculationRecords.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect('alkoBenchmark' in createCall).toBe(false);
    });

    it('omits the key when a reference row lacks an observation timestamp (legacy read model)', async () => {
      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue([
          ...DEFAULT_OFFERS,
          // Reference without observedAt — cannot sit on the observation
          // axis, so it cannot be selected as a reference.
          {
            id: 302,
            priceCents: 240,
            merchant: 'alko',
            country: 'FI',
            reliabilityStatus: 'VERIFIED',
          },
        ]),
      });
      const { service } = createService({ productData });

      const result = await service.calculate(DEFAULT_INPUT);

      expect('alkoBenchmark' in result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Linked Alko reference override (task 4.1, change
  // alko-reference-matching-pipeline, design D4)
  // -------------------------------------------------------------------------

  describe('linked Alko reference override (alkoReferenceProductId)', () => {
    /** The calculated (foreign) product's own offers — no alko row. */
    const FOREIGN_ONLY_OFFERS: CalculatorRetailOfferData[] = [
      { id: 100, priceCents: 200, merchant: 'test-merchant-de', country: 'DE', reliabilityStatus: 'VERIFIED' },
    ];

    /** The linked Alko product's reference rows — exercising the exact
     *  newest-observedAt selection on the override side. */
    const LINKED_ALKO_OFFERS: CalculatorRetailOfferData[] = [
      {
        id: 900,
        priceCents: 300,
        merchant: 'alko',
        country: 'FI',
        reliabilityStatus: 'VERIFIED',
        observedAt: new Date('2026-08-01T10:00:00.000Z'),
      },
      // Newest observation wins despite the lower price — selection is
      // the SAME resolveAlkoBenchmark predicate, override or not.
      {
        id: 901,
        priceCents: 260,
        merchant: 'alko',
        country: 'FI',
        reliabilityStatus: 'STALE',
        observedAt: new Date('2026-08-05T10:00:00.000Z'),
      },
    ];

    function createOverridePort(): IProductDataPort {
      return createMockProductDataPort({
        findProductById: vi.fn().mockResolvedValue(DEFAULT_PRODUCT),
        findRetailOffers: vi.fn().mockImplementation((productId: number) =>
          productId === 2
            ? Promise.resolve(LINKED_ALKO_OFFERS)
            : Promise.resolve(FOREIGN_ONLY_OFFERS),
        ),
      });
    }

    const LINKED_INPUT: CalculatorInput = {
      ...DEFAULT_INPUT,
      alkoReferenceProductId: 2,
    };

    it('resolves the benchmark from the linked product offers with the same newest-reference selection while the retail line stays on the target best offer', async () => {
      const productData = createOverridePort();
      const { service, mocks } = createService({ productData });

      const result = await service.calculate(LINKED_INPUT);

      // Both sides read: the target's offers AND the override's offers.
      const readIds = (productData.findRetailOffers as ReturnType<typeof vi.fn>).mock.calls
        .map((call) => call[0]);
      expect(readIds).toEqual([1, 2]);
      // Benchmark from the override's offers (newest = 260), retail from
      // the target's own offer (200).
      expect(result.alkoBenchmark).toEqual({
        status: 'available',
        referencePriceCents: 260,
        differenceCents: -60,
        // -60 / 260 * 100 = -23.076… → -23.1 (half away from zero).
        differencePercent: -23.1,
        reliabilityStatus: 'STALE',
        observedAt: '2026-08-05T10:00:00.000Z',
        // The explainability invariant: the record/result name the
        // product the reference came from.
        referenceProductId: 2,
      });
      expect(result.foreignRetailPrice).toBe(200);
      expect(result.metadata.retailOfferIds).toEqual([100]);

      // The persisted calculation record carries the same snapshot —
      // the reference product id travels into the record.
      const createCall = (mocks.calculationRecords.create as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      expect(createCall.alkoBenchmark).toEqual(result.alkoBenchmark);
      expect(
        (createCall.alkoBenchmark as { referenceProductId?: number }).referenceProductId,
      ).toBe(2);
    });

    it('yields benchmark absence — never an error — when the linked product has no offers', async () => {
      const productData = createMockProductDataPort({
        findProductById: vi.fn().mockResolvedValue(DEFAULT_PRODUCT),
        findRetailOffers: vi.fn().mockImplementation((productId: number) =>
          productId === 2 ? Promise.resolve([]) : Promise.resolve(FOREIGN_ONLY_OFFERS),
        ),
      });
      const { service } = createService({ productData });

      const result = await service.calculate(LINKED_INPUT);

      expect('alkoBenchmark' in result).toBe(false);
      // The calculation itself is unaffected — the override only governs
      // the display benchmark.
      expect(result.foreignRetailPrice).toBe(200);
    });

    it('keeps the direct path byte-identical: no override input, no referenceProductId anywhere', async () => {
      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue([
          ...FOREIGN_ONLY_OFFERS,
          {
            id: 902,
            priceCents: 240,
            merchant: 'alko',
            country: 'FI',
            reliabilityStatus: 'VERIFIED',
            observedAt: new Date('2026-08-05T10:00:00.000Z'),
          },
        ]),
      });
      const calculationRecords = createMockCalculationRecordPort();
      const { service, mocks } = createService({ productData, calculationRecords });

      const result = await service.calculate(DEFAULT_INPUT);

      expect(result.alkoBenchmark).toEqual({
        status: 'available',
        referencePriceCents: 240,
        differenceCents: -40,
        differencePercent: -16.7,
        reliabilityStatus: 'VERIFIED',
        observedAt: '2026-08-05T10:00:00.000Z',
      });
      expect('referenceProductId' in (result.alkoBenchmark ?? {})).toBe(false);
      const createCall = (mocks.calculationRecords.create as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      expect('referenceProductId' in (createCall.alkoBenchmark as object)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Import VAT — itemized line, domestic exclusion, date resolution
  // (task 4.3, design D6; landed-cost-calculator spec scenarios)
  // ---------------------------------------------------------------------------

  describe('import VAT (task 4.3, design D6)', () => {
    /** Base with the default fixtures: 200 + 150 + 30 + 26 = 406. */
    const BASE_CENTS = 406;

    it('carries the VAT line with amount, rate version, base breakdown, and reliability for a foreign seller', async () => {
      const { service } = createService();

      const result = await service.calculate(DEFAULT_INPUT);

      const vatLine = result.itemizedCosts.find(
        (c) => c.category === 'importVatEstimate',
      );
      expect(vatLine).toBeDefined();
      // 406 × 25.5 % = 103.53 → round HALF-UP → 104.
      expect(vatLine!.cents).toBe(104);
      expect(vatLine!.rateVersionId).toBe('import-vat-2024.2');
      expect(vatLine!.reliability).toBe('VERIFIED');
      expect(vatLine!.calculatedAt).toBe('2026-03-15T12:00:00.000Z');

      // The base breakdown names each component with its own amount —
      // traceable to the exact inputs (transport enters once, unscaled).
      const base = new Map(vatLine!.breakdown!.map((b) => [b.label, b.cents]));
      expect(base.get('Retail price')).toBe(200);
      expect(base.get('Transport')).toBe(150);
      expect(base.get('Alcohol excise')).toBe(30);
      expect(base.get('Container duty')).toBe(26);
      expect([...base.values()].reduce((s, v) => s + v, 0)).toBe(BASE_CENTS);
    });

    it('includes the VAT amount in totalCents exactly when the line is present', async () => {
      const { service } = createService();

      const result = await service.calculate(DEFAULT_INPUT);

      expect(result.totalCents).toBe(BASE_CENTS + 104);
      expect(result.importVatEstimate).toBe(104);
    });

    it('adds the VAT dataset version to datasetVersions', async () => {
      const { service } = createService();

      const result = await service.calculate(DEFAULT_INPUT);

      expect(result.metadata.datasetVersions).toContain('import-vat-2024.2');
    });

    it('persists the VAT line inside the record breakdown', async () => {
      const calculationRecords = createMockCalculationRecordPort();
      const { service, mocks } = createService({ calculationRecords });

      await service.calculate(DEFAULT_INPUT);

      const createCall = (mocks.calculationRecords.create as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      const persisted = createCall.breakdown as Array<{ category: string }>;
      expect(
        persisted.some((c) => c.category === 'importVatEstimate'),
      ).toBe(true);
      expect(createCall.totalCents).toBe(BASE_CENTS + 104);
    });

    it('omits the line entirely for a domestic offer — absence, not a displayed zero', async () => {
      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue([
          {
            id: 100,
            priceCents: 200,
            merchant: 'alko',
            country: 'FI',
            reliabilityStatus: 'VERIFIED',
          },
        ]),
      });
      const calculationRecords = createMockCalculationRecordPort();
      const { service, mocks } = createService({
        productData,
        calculationRecords,
      });

      const result = await service.calculate(DEFAULT_INPUT);

      expect(
        result.itemizedCosts.some((c) => c.category === 'importVatEstimate'),
      ).toBe(false);
      expect('importVatEstimate' in result).toBe(false);
      // The total equals the pre-change engine's component sum.
      expect(result.totalCents).toBe(BASE_CENTS);
      expect(result.metadata.datasetVersions).toEqual(['v1', 'v1']);

      const createCall = (mocks.calculationRecords.create as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      const persisted = createCall.breakdown as Array<{ category: string }>;
      expect(persisted.some((c) => c.category === 'importVatEstimate')).toBe(
        false,
      );
    });

    it('resolves the rate version by the transaction date (2024-08-15 → 24 %, 2024-09-15 → 25.5 %)', async () => {
      const { service } = createService();

      const before = await service.calculate({
        ...DEFAULT_INPUT,
        transactionDate: '2024-08-15T10:00:00.000Z',
      });
      const after = await service.calculate({
        ...DEFAULT_INPUT,
        transactionDate: '2024-09-15T10:00:00.000Z',
      });

      const beforeLine = before.itemizedCosts.find(
        (c) => c.category === 'importVatEstimate',
      );
      const afterLine = after.itemizedCosts.find(
        (c) => c.category === 'importVatEstimate',
      );

      // 406 × 24 % = 97.44 → 97; 406 × 25.5 % = 103.53 → 104.
      expect(beforeLine!.rateVersionId).toBe('import-vat-2024.1');
      expect(beforeLine!.cents).toBe(97);
      expect(afterLine!.rateVersionId).toBe('import-vat-2024.2');
      expect(afterLine!.cents).toBe(104);
    });

    it('scales retail and per-unit taxes into the base but keeps transport once', async () => {
      const { service } = createService();

      const result = await service.calculate({ ...DEFAULT_INPUT, quantity: 3 });

      // Base: 600 + 150 + 90 + 78 = 918; 918 × 25.5 % = 234.09 → 234.
      const vatLine = result.itemizedCosts.find(
        (c) => c.category === 'importVatEstimate',
      );
      expect(vatLine!.cents).toBe(234);
      expect(result.totalCents).toBe(918 + 234);
    });
  });

  // ---------------------------------------------------------------------------
  // Plausibility sanity rail (task 2.1, change
  // unit-integrity-and-result-trust): labels degrade, amounts never move.
  // ---------------------------------------------------------------------------

  describe('plausibility sanity rail (task 2.1)', () => {
    /** Koskenkorva unit-bug shape: €98.70 basket, €10,693 excise (≈108×). */
    const KOSKENKORVA_OFFER: CalculatorRetailOfferData = {
      id: 100,
      priceCents: 9870,
      merchant: 'test-merchant-de',
      country: 'DE',
      reliabilityStatus: 'VERIFIED',
    };

    function createKoskenkorvaService(options?: {
      calculationRecords?: ICalculationRecordPort;
    }) {
      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue([KOSKENKORVA_OFFER]),
      });
      const created = createService({
        productData,
        calculationRecords: options?.calculationRecords,
      });
      (created.mocks.alcoholExcise.calculate as ReturnType<typeof vi.fn>)
        .mockResolvedValue({
          category: 'beer',
          abv: 0.05,
          volumeLitres: 0.5,
          rateApplied: 0.0,
          taxCents: 1069300,
          taxDatasetVersion: 'v1',
          reliability: 'VERIFIED' as const,
          ruleId: null,
        });
      return created;
    }

    function exciseLineOf(result: Awaited<ReturnType<LandedCostCalculatorService['calculate']>>) {
      return result.itemizedCosts.find(
        (c) => c.category === 'alcoholExciseEstimate',
      )!;
    }

    it('leaves a plausible calculation untouched — no notes, normal confidence', async () => {
      const { service } = createService();

      const result = await service.calculate(DEFAULT_INPUT);

      expect('sanityNotes' in result).toBe(false);
      expect(result.confidence).toBe('HIGH');
      expect(result.confidenceBreakdown).toHaveLength(5);
      expect(exciseLineOf(result).reliability).toBe('VERIFIED');
    });

    it('degrades the Koskenkorva shape: LOW confidence, ESTIMATED excise, sanityNotes', async () => {
      const { service } = createKoskenkorvaService();

      const result = await service.calculate(DEFAULT_INPUT);

      expect(result.confidence).toBe('LOW');
      // The downgrade would only yield MEDIUM from status composition —
      // LOW proves the rail override applied.
      expect(exciseLineOf(result).reliability).toBe('ESTIMATED');

      expect(result.sanityNotes).toHaveLength(1);
      expect(result.sanityNotes![0]).toMatchObject({
        code: 'LINE_EXCISE_EXCEEDS_RETAIL_PLAUSIBILITY',
        component: 'alcoholExciseEstimate',
        figures: {
          lineComponentCents: 1069300,
          lineRetailPriceCents: 9870,
          thresholdMultiple: 5,
        },
      });
      // The downgrade is explainable in the breakdown the UI renders,
      // next to the machine-readable notes on the result.
      expect(
        result.confidenceBreakdown.some((d) => d.detail.includes('1069300')),
      ).toBe(true);
    });

    it('downgrades only the implausible component — retail and duty keep their statuses', async () => {
      const { service } = createKoskenkorvaService();

      const result = await service.calculate(DEFAULT_INPUT);

      const retailLine = result.itemizedCosts.find(
        (c) => c.category === 'foreignRetailPrice',
      )!;
      const dutyLine = result.itemizedCosts.find(
        (c) => c.category === 'containerDutyEstimate',
      )!;
      expect(retailLine.reliability).toBe('VERIFIED');
      expect(dutyLine.reliability).toBe('VERIFIED');
    });

    it('changes no amount when the rail trips — figures identical to the rail-less engine output', async () => {
      const { service } = createKoskenkorvaService();

      const result = await service.calculate(DEFAULT_INPUT);

      // Exact rail-less figures: retail 9870 + transport 150 + excise
      // 1069300 + duty 26 = base 1079346; VAT 25.5 % → 275233;
      // total 1354579. The rail only relabels.
      expect(result.foreignRetailPrice).toBe(9870);
      expect(result.transportCost).toBe(150);
      expect(result.alcoholExciseEstimate).toBe(1069300);
      expect(result.containerDutyEstimate).toBe(26);
      expect(result.importVatEstimate).toBe(275233);
      expect(result.totalCents).toBe(1354579);
      // The note's figures match the itemized amounts byte-for-byte.
      expect(result.sanityNotes![0].figures.lineComponentCents).toBe(
        result.alcoholExciseEstimate,
      );
    });

    it('evaluates the quantity-multiplied line — note figures scale with quantity', async () => {
      const { service } = createKoskenkorvaService();

      const result = await service.calculate({ ...DEFAULT_INPUT, quantity: 2 });

      expect(result.sanityNotes![0].figures).toEqual({
        lineComponentCents: 2138600,
        lineRetailPriceCents: 19740,
        thresholdMultiple: 5,
      });
      expect(result.alcoholExciseEstimate).toBe(2138600);
      expect(result.confidence).toBe('LOW');
    });

    it('never upgrades — an already-STALE excise keeps the worse status', async () => {
      const { service, mocks } = createKoskenkorvaService();
      (mocks.alcoholExcise.calculate as ReturnType<typeof vi.fn>).mockResolvedValue({
        category: 'beer',
        abv: 0.05,
        volumeLitres: 0.5,
        rateApplied: 0.0,
        taxCents: 1069300,
        taxDatasetVersion: 'v1',
        reliability: 'STALE' as const,
        ruleId: null,
      });

      const result = await service.calculate(DEFAULT_INPUT);

      expect(exciseLineOf(result).reliability).toBe('STALE');
      expect(result.confidence).toBe('LOW');
      expect(result.sanityNotes).toHaveLength(1);
    });

    it('downgrades container duty when duty alone breaches the threshold', async () => {
      const { service, mocks } = createService();
      (mocks.containerDuty.calculate as ReturnType<typeof vi.fn>).mockResolvedValue({
        volumeLitres: 0.5,
        ratePerLitre: 0.51,
        dutyCents: 5000, // 25× the 200-cent retail price
        taxDatasetVersion: 'v1',
        reliability: 'VERIFIED' as const,
        ruleId: null,
      });

      const result = await service.calculate(DEFAULT_INPUT);

      const dutyLine = result.itemizedCosts.find(
        (c) => c.category === 'containerDutyEstimate',
      )!;
      expect(dutyLine.reliability).toBe('ESTIMATED');
      expect(exciseLineOf(result).reliability).toBe('VERIFIED');
      expect(result.confidence).toBe('LOW');
      expect(result.sanityNotes!.map((n) => n.code)).toEqual([
        'LINE_CONTAINER_DUTY_EXCEEDS_RETAIL_PLAUSIBILITY',
      ]);
    });

    it('persists the downgraded confidence and labels with unchanged amounts', async () => {
      const calculationRecords = createMockCalculationRecordPort();
      const { service, mocks } = createKoskenkorvaService({
        calculationRecords,
      });

      await service.calculate(DEFAULT_INPUT);

      const createCall = (mocks.calculationRecords.create as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      expect(createCall.confidence).toBe('LOW');
      expect(createCall.totalCents).toBe(1354579);
      const persisted = createCall.breakdown as Array<{
        category: string;
        reliability: string;
      }>;
      const exciseLine = persisted.find(
        (c) => c.category === 'alcoholExciseEstimate',
      )!;
      expect(exciseLine.reliability).toBe('ESTIMATED');
    });
  });

  // ---------------------------------------------------------------------------
  // Traveller allowance PERSONAL branch (task 1.1, change
  // finnish-first-client-experience): the published allowance dataset
  // effective on the transaction date bounds the quantity; the allowed
  // portion carries shelf price only; the surplus runs the existing
  // engines with the established import-VAT base composition.
  // ---------------------------------------------------------------------------

  describe('traveller allowance PERSONAL branch (task 1.1)', () => {
    /** 6 × 1 l Jameson 40 % — the spec scenario's fixture shape. */
    const JAMESON_PRODUCT: CalculatorProductData = {
      id: 7,
      regulatoryClassification: 'spirits',
      category: 'spirits',
      volumeLitres: 1.0,
      alcoholByVolume: 0.4,
      containerType: 'glass',
      depositSystemStatus: false,
      weightKg: 1.75,
      normalizedName: 'Jameson Irish Whiskey 40% 1 l',
    };

    const JAMESON_OFFER: CalculatorRetailOfferData = {
      id: 700,
      priceCents: 3690,
      merchant: 'test-merchant-ee',
      country: 'EE',
      reliabilityStatus: 'VERIFIED',
    };

    const PERSONAL_INPUT: CalculatorInput = {
      productId: 7,
      quantity: 6,
      destination: 'FI',
      sessionId: 'traveller-session',
      transportArrangement: 'PERSONAL',
      transactionDate: '2026-03-15T12:00:00.000Z',
    };

    /** Deterministic per-unit tax figures for the stub engines. */
    const EXCISE_UNIT_CENTS = 2195;
    const DUTY_UNIT_CENTS = 51;

    function createAllowancePort(
      resolved: TripResolvedAllowances | null,
    ): ITravellerAllowancePort {
      return {
        resolveForTravelDate: vi.fn().mockResolvedValue(resolved),
      };
    }

    /** Published dataset: spirits capped at 6 l (volume shape). */
    const VOLUME_CAP_DATASET: TripResolvedAllowances = {
      dataset: { versionLabel: 'fi-allowances-2026.1' },
      limits: [{ category: 'spirits', volumeCapLitres: 6, quantityCap: null }],
    };

    function createJamesonService(options?: {
      travellerAllowances?: ITravellerAllowancePort | null;
      quantity?: number;
    }) {
      const productData = createMockProductDataPort({
        findProductById: vi.fn().mockResolvedValue(JAMESON_PRODUCT),
        findRetailOffers: vi.fn().mockResolvedValue([JAMESON_OFFER]),
      });
      const created = createService({
        productData,
        transportEstimate: createTransportEstimateStub(null),
        travellerAllowances: options?.travellerAllowances,
      });
      (created.mocks.alcoholExcise.calculate as ReturnType<typeof vi.fn>)
        .mockResolvedValue({
          category: 'spirits',
          abv: 0.4,
          volumeLitres: 1.0,
          rateApplied: 21.95,
          taxCents: EXCISE_UNIT_CENTS,
          taxDatasetVersion: 'v1',
          reliability: 'VERIFIED' as const,
          ruleId: null,
        });
      (created.mocks.containerDuty.calculate as ReturnType<typeof vi.fn>)
        .mockResolvedValue({
          volumeLitres: 1.0,
          ratePerLitre: 0.51,
          dutyCents: DUTY_UNIT_CENTS,
          taxDatasetVersion: 'v1',
          reliability: 'VERIFIED' as const,
          ruleId: null,
        });
      const input: CalculatorInput =
        options?.quantity !== undefined
          ? { ...PERSONAL_INPUT, quantity: options.quantity }
          : PERSONAL_INPUT;
      return { ...created, input };
    }

    it('quantity within the spirits cap is shelf price only — taxes zero, dataset version recorded', async () => {
      const { service, input } = createJamesonService({
        travellerAllowances: createAllowancePort(VOLUME_CAP_DATASET),
      });

      const result = await service.calculate(input);

      // 6 × €36.90 shelf price, no transport, no taxes.
      expect(result.foreignRetailPrice).toBe(22140);
      expect(result.transportCost).toBe(0);
      expect(result.alcoholExciseEstimate).toBe(0);
      expect(result.containerDutyEstimate).toBe(0);
      expect('importVatEstimate' in result).toBe(false);
      expect(result.totalCents).toBe(22140);

      // The dataset version travelled to the metadata.
      expect(result.metadata.allowanceDatasetVersion).toBe(
        'fi-allowances-2026.1',
      );

      // Within-allowance lines are explicit dataset-fact zeros.
      const byLabel = new Map(result.itemizedCosts.map((c) => [c.label, c]));
      expect(byLabel.get('Alcohol excise (within traveller allowance)')).toMatchObject({
        cents: 0,
        reliability: 'VERIFIED',
      });
      expect(byLabel.get('Container duty (within traveller allowance)')).toMatchObject({
        cents: 0,
        reliability: 'VERIFIED',
      });
      expect(byLabel.get('Import VAT (within traveller allowance)')).toMatchObject({
        cents: 0,
        reliability: 'VERIFIED',
      });
      expect(byLabel.has('Alcohol excise (over-allowance surplus)')).toBe(false);

      // The allowance application is classification evidence.
      expect(result.classification.classification).toBe('TravellerImport');
      expect(result.classification.evidence).toHaveLength(3);
      expect(result.classification.evidence[2].source).toBe(
        'TravellerAllowance',
      );
      expect(result.classification.evidence[2].supportingData).toContain(
        'covers 6 of 6 units',
      );
      expect(result.classification.evidence[2].supportingData).toContain(
        'travellers: 1',
      );
    });

    it('over-cap surplus is taxed on the surplus only — exact VAT base composition', async () => {
      const { service, input } = createJamesonService({
        travellerAllowances: createAllowancePort(VOLUME_CAP_DATASET),
        quantity: 12,
      });

      const result = await service.calculate(input);

      // Allowed 6, surplus 6 — the traveller pays shelf price for ALL
      // units, and only the surplus carries the engines' figures.
      expect(result.foreignRetailPrice).toBe(44280);
      expect(result.alcoholExciseEstimate).toBe(EXCISE_UNIT_CENTS * 6); // 13170
      expect(result.containerDutyEstimate).toBe(DUTY_UNIT_CENTS * 6); // 306

      // Import VAT on the surplus composition: retail(surplus) +
      // transport(0, once) + excise(surplus) + duty(surplus) = 35616;
      // 35616 × 25.5 % = 9082.08 → 9082 half-up.
      expect(result.importVatEstimate).toBe(9082);

      const vatLine = result.itemizedCosts.find(
        (c) => c.category === 'importVatEstimate' && c.cents > 0,
      )!;
      expect(vatLine.label).toBe(
        'Import VAT (over-allowance surplus, estimated)',
      );
      expect(vatLine.rateVersionId).toBe('import-vat-2024.2');
      const base = new Map(vatLine.breakdown!.map((b) => [b.label, b.cents]));
      expect(base.get('Retail price')).toBe(22140); // surplus retail only
      expect(base.get('Transport')).toBe(0);
      expect(base.get('Alcohol excise')).toBe(13170);
      expect(base.get('Container duty')).toBe(306);
      expect([...base.values()].reduce((s, v) => s + v, 0)).toBe(35616);

      expect(result.totalCents).toBe(44280 + 13170 + 306 + 9082);

      // Both portions are labeled in the breakdown.
      const labels = result.itemizedCosts.map((c) => c.label);
      expect(labels).toContain('Alcohol excise (within traveller allowance)');
      expect(labels).toContain('Alcohol excise (over-allowance surplus)');
      expect(labels).toContain('Container duty (over-allowance surplus)');
      expect(result.classification.evidence[2].supportingData).toContain(
        'covers 6 of 12 units; surplus 6 units taxed',
      );
    });

    it('a quantity cap (bottle count) bounds the split the same way', async () => {
      const { service, input } = createJamesonService({
        travellerAllowances: createAllowancePort({
          dataset: { versionLabel: 'fi-allowances-2026.1' },
          limits: [
            { category: 'spirits', volumeCapLitres: null, quantityCap: 2 },
          ],
        }),
        quantity: 5,
      });

      const result = await service.calculate(input);

      // Allowed 2, surplus 3: excise 3×2195 = 6585, duty 3×51 = 153.
      expect(result.foreignRetailPrice).toBe(18450);
      expect(result.alcoholExciseEstimate).toBe(6585);
      expect(result.containerDutyEstimate).toBe(153);
      // Base: 3×3690 + 6585 + 153 = 17808; × 25.5 % = 4541.04 → 4541.
      expect(result.importVatEstimate).toBe(4541);
      expect(result.totalCents).toBe(18450 + 6585 + 153 + 4541);
      expect(result.classification.evidence[2].supportingData).toContain(
        'covers 2 of 5 units; surplus 3 units taxed',
      );
    });

    it('no cap row for the category applies no allowance — full taxation, never an invented exemption', async () => {
      const { service, input } = createJamesonService({
        travellerAllowances: createAllowancePort({
          dataset: { versionLabel: 'fi-allowances-2026.1' },
          limits: [{ category: 'beer', volumeCapLitres: 24, quantityCap: null }],
        }),
      });

      const result = await service.calculate(input);

      // The split does not apply: the full quantity is taxed exactly as
      // the pre-allowance engine would.
      expect(result.alcoholExciseEstimate).toBe(EXCISE_UNIT_CENTS * 6);
      expect(result.containerDutyEstimate).toBe(DUTY_UNIT_CENTS * 6);
      expect(result.importVatEstimate).toBe(9082);
      expect(result.totalCents).toBe(22140 + 13170 + 306 + 9082);
      // Plain engine labels — no within/surplus split lines.
      const labels = result.itemizedCosts.map((c) => c.label);
      expect(labels).toContain('Alcohol excise');
      expect(labels).not.toContain('Alcohol excise (within traveller allowance)');
      // The consulted dataset is still the recorded provenance, and the
      // evidence says why nothing was applied.
      expect(result.metadata.allowanceDatasetVersion).toBe(
        'fi-allowances-2026.1',
      );
      expect(result.classification.evidence).toHaveLength(3);
      expect(result.classification.evidence[2].observation).toContain(
        'No traveller-allowance cap covers this product category',
      );
    });

    it('no published dataset rejects with the dedicated error carrying the transaction date', async () => {
      const port = createAllowancePort(null);
      const { service, mocks, input } = createJamesonService({
        travellerAllowances: port,
      });

      const error = await service.calculate(input).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NoAllowanceDatasetError);
      expect((error as NoAllowanceDatasetError).transactionDate).toBe(
        '2026-03-15',
      );
      expect((error as Error).message).toContain('2026-03-15');
      // The port resolved the transaction date's calendar part.
      expect(port.resolveForTravelDate).toHaveBeenCalledWith('2026-03-15');
      // Nothing was persisted for the rejected calculation.
      expect(mocks.calculationRecords.create).not.toHaveBeenCalled();
    });

    it('an unwired port degrades to the pre-allowance full-taxation math (no rejection)', async () => {
      // Default harness: the port token is not bound — today's surfaces.
      const { service, input } = createJamesonService();

      const result = await service.calculate(input);

      expect(result.alcoholExciseEstimate).toBe(EXCISE_UNIT_CENTS * 6);
      expect(result.importVatEstimate).toBe(9082);
      expect(result.totalCents).toBe(22140 + 13170 + 306 + 9082);
      expect('allowanceDatasetVersion' in result.metadata).toBe(false);
      // No allowance evidence — the branch never ran.
      expect(result.classification.evidence).toHaveLength(2);
    });

    it('delivery-mode pre-existing fields stay byte-for-byte identical with the port wired or unwired (task 1.2 adds only the callout key)', async () => {
      const deliveryInput: CalculatorInput = {
        productId: 7,
        quantity: 6,
        destination: 'FI',
        sessionId: 'delivery-session',
        transactionDate: '2026-03-15T12:00:00.000Z',
      };

      const port = createAllowancePort(VOLUME_CAP_DATASET);
      const wired = createJamesonService({ travellerAllowances: port });
      const unwired = createJamesonService();

      const withPort = await wired.service.calculate(deliveryInput);
      const withoutPort = await unwired.service.calculate(deliveryInput);

      // Task 1.2: the wired delivery performs exactly ONE allowance read —
      // the traveller-alternative callout's.
      expect(port.resolveForTravelDate).toHaveBeenCalledTimes(1);
      expect(port.resolveForTravelDate).toHaveBeenCalledWith('2026-03-15');

      // Design D4: apart from the ADDITIVE callout key, the wired delivery
      // result is byte-for-byte the unwired engine output — no amount,
      // status, confidence, or metadata field may move.
      const serialize = (result: unknown): string =>
        JSON.stringify(result, (key, value) =>
          key === 'calculationTimestamp' || key === 'travellerAlternative'
            ? undefined
            : value,
        );
      expect(serialize(withPort)).toBe(serialize(withoutPort));
      expect(withPort.totalCents).toBe(withoutPort.totalCents);
      expect(withPort.confidence).toBe(withoutPort.confidence);

      // The only difference IS the callout — present wired, absent unwired.
      expect(withPort.travellerAlternative).toEqual({
        estimatedTotalCents: 22140,
        withinAllowance: true,
        allowanceDatasetVersion: 'fi-allowances-2026.1',
        categoryKey: 'spirits',
      });
      expect('travellerAlternative' in withoutPort).toBe(false);

      // Delivery keeps the single plain tax lines.
      const labels = withPort.itemizedCosts.map((c) => c.label);
      expect(labels).toContain('Alcohol excise');
      expect(labels).not.toContain('Alcohol excise (within traveller allowance)');
      expect('allowanceDatasetVersion' in withPort.metadata).toBe(false);
    });
  });

  describe('traveller alternative callout on delivery results (task 1.2)', () => {
    /** 6 × 1 l Jameson 40 % — same fixture shape as the PERSONAL block. */
    const JAMESON_PRODUCT: CalculatorProductData = {
      id: 7,
      regulatoryClassification: 'spirits',
      category: 'spirits',
      volumeLitres: 1.0,
      alcoholByVolume: 0.4,
      containerType: 'glass',
      depositSystemStatus: false,
      weightKg: 1.75,
      normalizedName: 'Jameson Irish Whiskey 40% 1 l',
    };

    const JAMESON_OFFER: CalculatorRetailOfferData = {
      id: 700,
      priceCents: 3690,
      merchant: 'test-merchant-ee',
      country: 'EE',
      reliabilityStatus: 'VERIFIED',
    };

    const UNIT_PRICE_CENTS = 3690;

    const DELIVERY_INPUT: CalculatorInput = {
      productId: 7,
      quantity: 6,
      destination: 'FI',
      sessionId: 'delivery-session',
      transportArrangement: 'SELLER_ARRANGED',
      transactionDate: '2026-03-15T12:00:00.000Z',
    };

    const EXCISE_UNIT_CENTS = 2195;
    const DUTY_UNIT_CENTS = 51;

    /** Published dataset: spirits capped at 6 l (volume shape). */
    const VOLUME_CAP_DATASET: TripResolvedAllowances = {
      dataset: { versionLabel: 'fi-allowances-2026.1' },
      limits: [{ category: 'spirits', volumeCapLitres: 6, quantityCap: null }],
    };

    function createAllowancePort(
      resolved: TripResolvedAllowances | null,
    ): ITravellerAllowancePort {
      return {
        resolveForTravelDate: vi.fn().mockResolvedValue(resolved),
      };
    }

    function createDeliveryService(options?: {
      travellerAllowances?: ITravellerAllowancePort | null;
      product?: CalculatorProductData;
      input?: CalculatorInput;
    }) {
      const productData = createMockProductDataPort({
        findProductById: vi
          .fn()
          .mockResolvedValue(options?.product ?? JAMESON_PRODUCT),
        findRetailOffers: vi.fn().mockResolvedValue([JAMESON_OFFER]),
      });
      const created = createService({
        productData,
        transportEstimate: createTransportEstimateStub(null),
        travellerAllowances: options?.travellerAllowances,
      });
      (created.mocks.alcoholExcise.calculate as ReturnType<typeof vi.fn>)
        .mockResolvedValue({
          category: 'spirits',
          abv: 0.4,
          volumeLitres: 1.0,
          rateApplied: 21.95,
          taxCents: EXCISE_UNIT_CENTS,
          taxDatasetVersion: 'v1',
          reliability: 'VERIFIED' as const,
          ruleId: null,
        });
      (created.mocks.containerDuty.calculate as ReturnType<typeof vi.fn>)
        .mockResolvedValue({
          volumeLitres: 1.0,
          ratePerLitre: 0.51,
          dutyCents: DUTY_UNIT_CENTS,
          taxDatasetVersion: 'v1',
          reliability: 'VERIFIED' as const,
          ruleId: null,
        });
      return { ...created, input: options?.input ?? DELIVERY_INPUT };
    }

    /** Serialize with the volatile timestamp and the additive callout key stripped. */
    const serializeCore = (result: unknown): string =>
      JSON.stringify(result, (key, value) =>
        key === 'calculationTimestamp' || key === 'travellerAlternative'
          ? undefined
          : value,
      );

    it('carries the labelled traveller estimate — allowed quantity × shelf price, dataset version, category key', async () => {
      const port = createAllowancePort(VOLUME_CAP_DATASET);
      const { service, input } = createDeliveryService({
        travellerAllowances: port,
      });

      const result = await service.calculate(input);

      // 6 × 1 l within the 6 l spirits cap: the full quantity is allowed
      // and the estimate is the shelf price for all six units.
      expect(result.travellerAlternative).toEqual({
        estimatedTotalCents: 6 * UNIT_PRICE_CENTS,
        withinAllowance: true,
        allowanceDatasetVersion: 'fi-allowances-2026.1',
        categoryKey: 'spirits',
      });

      // Exactly ONE allowance read per delivery request — the callout's,
      // resolved on the transaction date's calendar part.
      expect(port.resolveForTravelDate).toHaveBeenCalledTimes(1);
      expect(port.resolveForTravelDate).toHaveBeenCalledWith('2026-03-15');
    });

    it('changes no delivery figure, status, or confidence (design D4) — identical to the unwired engine modulo the callout key', async () => {
      const wired = createDeliveryService({
        travellerAllowances: createAllowancePort(VOLUME_CAP_DATASET),
      });
      const unwired = createDeliveryService();

      const withCallout = await wired.service.calculate(wired.input);
      const without = await unwired.service.calculate(unwired.input);

      // The additive key is the ONLY byte-level difference.
      expect(serializeCore(withCallout)).toBe(serializeCore(without));
      expect(withCallout.totalCents).toBe(without.totalCents);
      expect(withCallout.confidence).toBe(without.confidence);
      expect('travellerAlternative' in without).toBe(false);
    });

    it('over-cap delivery pins withinAllowance false and the cap-bounded estimate', async () => {
      const { service, input } = createDeliveryService({
        travellerAllowances: createAllowancePort(VOLUME_CAP_DATASET),
        input: { ...DELIVERY_INPUT, quantity: 12 },
      });

      const result = await service.calculate(input);

      // The 6 l cap allows 6 of the requested 12 units — the estimate
      // covers the ALLOWED quantity only, never the full request.
      expect(result.travellerAlternative).toEqual({
        estimatedTotalCents: 6 * UNIT_PRICE_CENTS,
        withinAllowance: false,
        allowanceDatasetVersion: 'fi-allowances-2026.1',
        categoryKey: 'spirits',
      });
    });

    it('a bottle-count cap bounds the estimate the same way', async () => {
      const { service, input } = createDeliveryService({
        travellerAllowances: createAllowancePort({
          dataset: { versionLabel: 'fi-allowances-2026.1' },
          limits: [
            { category: 'spirits', volumeCapLitres: null, quantityCap: 2 },
          ],
        }),
        input: { ...DELIVERY_INPUT, quantity: 5 },
      });

      const result = await service.calculate(input);

      expect(result.travellerAlternative).toEqual({
        estimatedTotalCents: 2 * UNIT_PRICE_CENTS,
        withinAllowance: false,
        allowanceDatasetVersion: 'fi-allowances-2026.1',
        categoryKey: 'spirits',
      });
    });

    it('litres-cap arithmetic matches the trip-fill floor+epsilon conversion', async () => {
      // 0.7 l bottles against a 6 l cap: 8 fit (8 × 0.7 = 5.6), 9 do not
      // (9 × 0.7 = 6.3) — the same floor((cap + 1e-9) / unitVolume) the
      // PERSONAL branch and the fill engine apply, so the callout can
      // never advertise a bound traveller mode would not apply.
      const BOTTLE: CalculatorProductData = {
        ...JAMESON_PRODUCT,
        volumeLitres: 0.7,
      };
      const { service, input } = createDeliveryService({
        travellerAllowances: createAllowancePort(VOLUME_CAP_DATASET),
        product: BOTTLE,
        input: { ...DELIVERY_INPUT, quantity: 12 },
      });

      const result = await service.calculate(input);

      expect(result.travellerAlternative).toMatchObject({
        estimatedTotalCents: 8 * UNIT_PRICE_CENTS,
        withinAllowance: false,
        categoryKey: 'spirits',
      });
    });

    it('no cap row for the category → the key is absent and delivery figures equal the unwired engine', async () => {
      const wired = createDeliveryService({
        travellerAllowances: createAllowancePort({
          dataset: { versionLabel: 'fi-allowances-2026.1' },
          limits: [
            { category: 'beer', volumeCapLitres: 24, quantityCap: null },
          ],
        }),
      });
      const unwired = createDeliveryService();

      const result = await wired.service.calculate(wired.input);
      const baseline = await unwired.service.calculate(unwired.input);

      // Absence is the no-callout state — `?? null` for consumers, no key
      // on the wire (never a placeholder object).
      expect(result.travellerAlternative ?? null).toBeNull();
      expect('travellerAlternative' in result).toBe(false);
      // No cap row = no invented alternative: everything else identical.
      expect(serializeCore(result)).toBe(serializeCore(baseline));
    });

    it('no effective dataset degrades to no callout — never the PERSONAL rejection', async () => {
      const port = createAllowancePort(null);
      const { service, mocks, input } = createDeliveryService({
        travellerAllowances: port,
      });

      // MUST NOT throw NoAllowanceDatasetError — that rejection is the
      // PERSONAL branch's contract; the delivery path stays fully
      // available when no dataset is published (design D3).
      const result = await service.calculate(input);

      expect(result.travellerAlternative ?? null).toBeNull();
      expect('travellerAlternative' in result).toBe(false);
      expect(port.resolveForTravelDate).toHaveBeenCalledTimes(1);
      // The delivery calculation itself completed and persisted.
      expect(mocks.calculationRecords.create).toHaveBeenCalledTimes(1);
    });

    it('an unwired port emits no callout (the degrade rule of every existing surface)', async () => {
      const { service, input } = createDeliveryService();

      const result = await service.calculate(input);

      expect(result.travellerAlternative ?? null).toBeNull();
      expect('travellerAlternative' in result).toBe(false);
    });

    it('a cap row that cannot bound the line (degenerate unit volume) yields no callout', async () => {
      const UNBOUNDED: CalculatorProductData = {
        ...JAMESON_PRODUCT,
        volumeLitres: 0,
      };
      const { service, input } = createDeliveryService({
        travellerAllowances: createAllowancePort(VOLUME_CAP_DATASET),
        product: UNBOUNDED,
      });

      const result = await service.calculate(input);

      // A litres cap against a non-positive unit volume cannot bound a
      // quantity — no estimate is guessed.
      expect(result.travellerAlternative ?? null).toBeNull();
    });

    it('PERSONAL requests never carry the callout — the PERSONAL result IS the traveller scenario', async () => {
      const port = createAllowancePort(VOLUME_CAP_DATASET);
      const { service, input } = createDeliveryService({
        travellerAllowances: port,
        input: { ...DELIVERY_INPUT, transportArrangement: 'PERSONAL' },
      });

      const result = await service.calculate(input);

      expect(result.travellerAlternative ?? null).toBeNull();
      expect('travellerAlternative' in result).toBe(false);
      // Exactly one port read in total — the PERSONAL branch's; the
      // callout branch never runs for a traveller request.
      expect(port.resolveForTravelDate).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Cost-line codes (task 2.1, change fi-locale-surface-hardening, design
  // D1): every line the service emits carries an additive closed-set `code`
  // next to the unchanged English `label` — the machine-readable join key
  // consumers localize against, never a re-parsed label.
  // ---------------------------------------------------------------------------

  describe('cost-line codes (design D1)', () => {
    /** The closed set, pinned in full — removing a member breaks the array's type. */
    const ALL_CODES: readonly CostLineCode[] = [
      'foreign_retail_price',
      'foreign_unit_price',
      'transport',
      'alcohol_excise',
      'container_duty',
      'alcohol_excise_within_allowance',
      'container_duty_within_allowance',
      'alcohol_excise_over_allowance',
      'container_duty_over_allowance',
      'import_vat',
      'import_vat_over_allowance',
      'import_vat_within_allowance',
    ];

    /**
     * Exhaustive code → canonical-category mapping. The `default: never`
     * assignment makes a union member without a case a compile error, so
     * the switch can never drift from the closed set.
     */
    function codeToCategory(code: CostLineCode): CostCategory {
      switch (code) {
        case 'foreign_retail_price':
        case 'foreign_unit_price':
          return 'foreignRetailPrice';
        case 'transport':
          return 'transportCost';
        case 'alcohol_excise':
        case 'alcohol_excise_within_allowance':
        case 'alcohol_excise_over_allowance':
          return 'alcoholExciseEstimate';
        case 'container_duty':
        case 'container_duty_within_allowance':
        case 'container_duty_over_allowance':
          return 'containerDutyEstimate';
        case 'import_vat':
        case 'import_vat_over_allowance':
        case 'import_vat_within_allowance':
          return 'importVatEstimate';
        default: {
          const exhaustive: never = code;
          return exhaustive;
        }
      }
    }

    /** Flatten a line tree — nested breakdown lines carry codes too. */
    function flattenLines(lines: readonly ItemizedCost[]): ItemizedCost[] {
      return lines.flatMap((line) => [
        line,
        ...flattenLines(line.breakdown ?? []),
      ]);
    }

    /** Every emitted line: code present, from the closed set, category-consistent. */
    function expectCodesWellFormed(
      result: Awaited<
        ReturnType<LandedCostCalculatorService['calculate']>
      >,
    ): void {
      const lines = flattenLines(result.itemizedCosts);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.code).toBeDefined();
        expect(ALL_CODES).toContain(line.code);
        expect(codeToCategory(line.code!)).toBe(line.category);
      }
    }

    /** Minimal PERSONAL harness: spirits product, no transport, wired port. */
    function createPersonalService(resolved: TripResolvedAllowances | null) {
      const productData = createMockProductDataPort({
        findProductById: vi.fn().mockResolvedValue({
          ...DEFAULT_PRODUCT,
          regulatoryClassification: 'spirits',
          category: 'spirits',
          volumeLitres: 1.0,
          alcoholByVolume: 0.4,
          containerType: 'glass',
          depositSystemStatus: false,
          weightKg: 1.75,
          normalizedName: 'Jameson Irish Whiskey 40% 1 l',
        }),
        findRetailOffers: vi.fn().mockResolvedValue([
          {
            id: 700,
            priceCents: 3690,
            merchant: 'test-merchant-ee',
            country: 'EE',
            reliabilityStatus: 'VERIFIED',
          },
        ]),
      });
      return createService({
        productData,
        transportEstimate: createTransportEstimateStub(null),
        travellerAllowances: {
          resolveForTravelDate: vi.fn().mockResolvedValue(resolved),
        },
      });
    }

    const PERSONAL_INPUT: CalculatorInput = {
      productId: 1,
      quantity: 6,
      destination: 'FI',
      transportArrangement: 'PERSONAL',
      transactionDate: '2026-03-15T12:00:00.000Z',
    };

    const SPIRITS_CAP: TripResolvedAllowances = {
      dataset: { versionLabel: 'fi-allowances-2026.1' },
      limits: [{ category: 'spirits', volumeCapLitres: 6, quantityCap: null }],
    };

    it('exercises the exhaustive switch over every member of the closed set', () => {
      expect(ALL_CODES).toHaveLength(12);
      for (const code of ALL_CODES) {
        expect([
          'foreignRetailPrice',
          'transportCost',
          'alcoholExciseEstimate',
          'containerDutyEstimate',
          'importVatEstimate',
        ]).toContain(codeToCategory(code));
      }
    });

    it('every emitted line — top level and nested — carries a code from the closed set', async () => {
      const { service } = createService();

      const result = await service.calculate(DEFAULT_INPUT);

      expectCodesWellFormed(result);
      const codes = flattenLines(result.itemizedCosts).map((l) => l.code);
      expect(codes).toContain('foreign_retail_price');
      expect(codes).toContain('foreign_unit_price');
      expect(codes).toContain('transport');
      expect(codes).toContain('alcohol_excise');
      expect(codes).toContain('container_duty');
      expect(codes).toContain('import_vat');
    });

    it('labels stay byte-identical — codes ride next to the unchanged English copy', async () => {
      const { service } = createService();

      const result = await service.calculate(DEFAULT_INPUT);

      const byLabel = new Map(result.itemizedCosts.map((c) => [c.label, c]));
      expect(byLabel.get('Retail price')!.code).toBe('foreign_retail_price');
      expect(byLabel.get('Transport')!.code).toBe('transport');
      expect(byLabel.get('Alcohol excise')!.code).toBe('alcohol_excise');
      expect(byLabel.get('Container duty')!.code).toBe('container_duty');
      expect(byLabel.get('Import VAT (estimated)')!.code).toBe('import_vat');

      // The VAT base breakdown repeats the component codes under the
      // SAME labels — one kind, one code, regardless of nesting.
      const baseByLabel = new Map(
        byLabel.get('Import VAT (estimated)')!.breakdown!.map((b) => [
          b.label,
          b,
        ]),
      );
      expect(baseByLabel.get('Retail price')!.code).toBe(
        'foreign_retail_price',
      );
      expect(baseByLabel.get('Transport')!.code).toBe('transport');
      expect(baseByLabel.get('Alcohol excise')!.code).toBe('alcohol_excise');
      expect(baseByLabel.get('Container duty')!.code).toBe('container_duty');
    });

    it('the code never varies with the interpolated label — quantity rewording, stable code', async () => {
      const { service } = createService();

      const result = await service.calculate({ ...DEFAULT_INPUT, quantity: 3 });

      const retail = result.itemizedCosts.find(
        (c) => c.code === 'foreign_retail_price',
      )!;
      expect(retail.breakdown![0].label).toBe('Unit price (x3)');
      expect(retail.breakdown![0].code).toBe('foreign_unit_price');
    });

    it('a domestic delivery keeps the plain codes and emits no import-VAT line', async () => {
      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue([
          {
            id: 100,
            priceCents: 200,
            merchant: 'alko',
            country: 'FI',
            reliabilityStatus: 'VERIFIED',
          },
        ]),
      });
      const { service } = createService({ productData });

      const result = await service.calculate(DEFAULT_INPUT);

      expectCodesWellFormed(result);
      const codes = flattenLines(result.itemizedCosts).map((l) => l.code);
      expect(codes).not.toContain('import_vat');
      expect(codes).toEqual([
        'foreign_retail_price',
        'foreign_unit_price',
        'transport',
        'alcohol_excise',
        'container_duty',
      ]);
    });

    it('within-allowance lines carry the *_within_allowance codes', async () => {
      const { service } = createPersonalService(SPIRITS_CAP);

      const result = await service.calculate({
        ...PERSONAL_INPUT,
        quantity: 6,
      });

      expectCodesWellFormed(result);
      const byLabel = new Map(result.itemizedCosts.map((c) => [c.label, c]));
      expect(
        byLabel.get('Alcohol excise (within traveller allowance)')!.code,
      ).toBe('alcohol_excise_within_allowance');
      expect(
        byLabel.get('Container duty (within traveller allowance)')!.code,
      ).toBe('container_duty_within_allowance');
      expect(
        byLabel.get('Import VAT (within traveller allowance)')!.code,
      ).toBe('import_vat_within_allowance');
      // The capped components have no surplus lines and no plain lines.
      expect(byLabel.has('Alcohol excise (over-allowance surplus)')).toBe(
        false,
      );
      expect(byLabel.has('Alcohol excise')).toBe(false);
    });

    it('over-allowance lines carry the *_over_allowance codes — the plain VAT code stays out', async () => {
      const { service } = createPersonalService(SPIRITS_CAP);

      const result = await service.calculate({
        ...PERSONAL_INPUT,
        quantity: 12,
      });

      expectCodesWellFormed(result);
      const byLabel = new Map(result.itemizedCosts.map((c) => [c.label, c]));
      expect(byLabel.get('Alcohol excise (over-allowance surplus)')!.code).toBe(
        'alcohol_excise_over_allowance',
      );
      expect(
        byLabel.get('Container duty (over-allowance surplus)')!.code,
      ).toBe('container_duty_over_allowance');
      expect(
        byLabel.get('Import VAT (over-allowance surplus, estimated)')!.code,
      ).toBe('import_vat_over_allowance');
      expect(byLabel.has('Import VAT (estimated)')).toBe(false);
    });
  });
});
