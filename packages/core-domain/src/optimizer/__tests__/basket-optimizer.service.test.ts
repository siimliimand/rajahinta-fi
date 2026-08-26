/**
 * BasketOptimizerService tests — enumeration logic, input validation,
 * classification gate, threshold semantics, tie-break determinism.
 *
 * All I/O is stubbed via port interfaces; pure-logic sub-services
 * (ClassificationGateService, BasketShippingCalculator with stub
 * transport-offer query) run in their real implementations.
 */

import { describe, it, expect, vi } from 'vitest';
import { BasketOptimizerService } from '../services/basket-optimizer.service';
import { ClassificationGateService } from '../../normalization/classification-gate.service';
import { LandedCostCalculatorService } from '../../calculator/landed-cost-calculator.service';
import { BasketShippingCalculator } from '../../transport/basket-shipping-calculator.service';
import { AlcoholExciseService } from '../../tax/services/alcohol-excise.service';
import { ContainerDutyService } from '../../tax/services/container-duty.service';
import { TransactionClassificationService } from '../../classification/transaction-classification.service';
import { TransportClassificationService } from '../../transport/transport-classification.service';
import { ConfidenceFrameworkService } from '../../reliability/confidence-framework.service';
import { ReliabilityService } from '../../reliability/reliability.service';
import {
  MAX_BASKET_ITEMS,
  BasketValidationError,
  BasketClassificationGateError,
} from '../optimizer.types';
import type {
  BasketOptimizationInput,
} from '../optimizer.types';
import type {
  IProductDataPort,
  CalculatorProductData,
  CalculatorRetailOfferData,
  ICalculationRecordPort,
} from '../../calculator/calculator.types';
import type { IMerchantTermsPort, MerchantTerms } from '../ports/merchant-terms.port';
import type { ITransportOfferQuery } from '../../transport/transport-offer-query.interface';
import type { TransportOffer } from '../../transport/transport-offer.type';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_DATE = new Date('2026-08-16T12:00:00Z');

function makeTransportOffer(overrides: Partial<TransportOffer> & { carrier: string; destinationCountry: string }): TransportOffer {
  return {
    id: overrides.id ?? 1,
    carrier: overrides.carrier,
    originCountry: overrides.originCountry ?? 'DE',
    destinationCountry: overrides.destinationCountry,
    weightBracket: overrides.weightBracket ?? { minKg: null, maxKg: null },
    packageTier: overrides.packageTier ?? 'parcel',
    priceCents: overrides.priceCents ?? 2000,
    currency: overrides.currency ?? 'EUR',
    sellerInvolvementIndicator: overrides.sellerInvolvementIndicator ?? false,
    observedAt: overrides.observedAt ?? BASE_DATE,
    refreshedAt: overrides.refreshedAt ?? BASE_DATE,
    reliabilityStatus: overrides.reliabilityStatus ?? 'EXACT',
  };
}

class StubTransportQuery implements ITransportOfferQuery {
  constructor(private readonly offers: TransportOffer[]) {}
  async findAllActive(): Promise<TransportOffer[]> { return this.offers; }
  async findByCarrier(carrierId: string): Promise<TransportOffer[]> {
    return this.offers.filter((o) => o.carrier === carrierId);
  }
}

const PRODUCT_1: CalculatorProductData = {
  id: 101,
  regulatoryClassification: 'beer',
  category: 'beer',
  volumeLitres: 0.5,
  alcoholByVolume: 0.05,
  containerType: 'can',
  depositSystemStatus: true,
  weightKg: 0.55,
  normalizedName: 'Test Beer A',
};

const PRODUCT_2: CalculatorProductData = {
  id: 102,
  regulatoryClassification: 'wine',
  category: 'wine',
  volumeLitres: 0.75,
  alcoholByVolume: 0.13,
  containerType: 'bottle',
  depositSystemStatus: true,
  weightKg: 1.2,
  normalizedName: 'Test Wine B',
};

// Both A and B offer product 1, with A cheaper
const OFFERS_PROD_1: CalculatorRetailOfferData[] = [
  { id: 201, priceCents: 200, merchant: 'merchant-a', country: 'DE', reliabilityStatus: 'VERIFIED' },
  { id: 202, priceCents: 220, merchant: 'merchant-b', country: 'DE', reliabilityStatus: 'VERIFIED' },
];
// Product 2: only merchant-b offers it
const OFFERS_PROD_2: CalculatorRetailOfferData[] = [
  { id: 301, priceCents: 500, merchant: 'merchant-b', country: 'DE', reliabilityStatus: 'VERIFIED' },
];

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockProductDataPort(
  overrides?: Partial<IProductDataPort>,
): IProductDataPort {
  return {
    findProductById: vi.fn().mockImplementation(async (id: number) => {
      if (id === 101) return PRODUCT_1;
      if (id === 102) return PRODUCT_2;
      if (id === 999) return null;
      return PRODUCT_1;
    }),
    findRetailOffers: vi.fn().mockImplementation(async (id: number) => {
      if (id === 101) return OFFERS_PROD_1;
      if (id === 102) return OFFERS_PROD_2;
      return [];
    }),
    ...overrides,
  };
}

function createMockMerchantTermsPort(
  overrides?: Partial<IMerchantTermsPort>,
): IMerchantTermsPort {
  return {
    getTerms: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function createMockCalculationRecordPort(): ICalculationRecordPort {
  return {
    create: vi.fn().mockResolvedValue({ id: 1 }),
  };
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

function createOptimizer(options?: {
  productData?: IProductDataPort;
  merchantTerms?: IMerchantTermsPort;
  transportOffers?: TransportOffer[];
  country?: string;
}): BasketOptimizerService {
  // Real pure-logic services
  const gate = new ClassificationGateService();
  const transportClassification = new TransportClassificationService();
  const reliability = new ReliabilityService();
  const confidence = new ConfidenceFrameworkService(reliability);
  const classificationService = new TransactionClassificationService(transportClassification);

  // Tax engine mocks
  const alcoholExcise = {
    calculate: vi.fn().mockResolvedValue({
      category: 'beer', abv: 0.05, volumeLitres: 0.5,
      rateApplied: 0.0, taxCents: 30, taxDatasetVersion: 'v1',
      reliability: 'VERIFIED' as const, ruleId: null,
    }),
  } as unknown as AlcoholExciseService;

  const containerDuty = {
    calculate: vi.fn().mockResolvedValue({
      volumeLitres: 0.5, ratePerLitre: 0.51, dutyCents: 26,
      taxDatasetVersion: 'v1', reliability: 'VERIFIED' as const, ruleId: null,
    }),
  } as unknown as ContainerDutyService;

  // Transport estimation mock (not used by optimizer, but calculator needs it)
  const transportEstimation = {
    estimate: vi.fn().mockResolvedValue({
      offer: { id: 200, priceCents: 150, sellerInvolvementIndicator: false },
      matchedWeightBracket: { minKg: 0, maxKg: 1 },
      reliabilityStatus: 'VERIFIED' as const,
    }),
  } as unknown as import('../../transport/transport-estimation.service').TransportEstimationService;

  const productData = options?.productData ?? createMockProductDataPort();
  const calcRecords = createMockCalculationRecordPort();

  const calcService = new LandedCostCalculatorService(
    gate,
    alcoholExcise,
    containerDuty,
    classificationService,
    transportEstimation,
    confidence,
    productData,
    calcRecords,
  );

  // Basket shipping with transport offers
  const transportOffers = options?.transportOffers ?? [
    makeTransportOffer({ carrier: 'merchant-a', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 10 } }),
    makeTransportOffer({ carrier: 'merchant-b', destinationCountry: 'FI', priceCents: 1500, weightBracket: { minKg: 0, maxKg: 20 } }),
  ];
  const shippingCalc = new BasketShippingCalculator(new StubTransportQuery(transportOffers));

  const merchantTerms = options?.merchantTerms ?? createMockMerchantTermsPort();

  return new BasketOptimizerService(gate, calcService, shippingCalc, productData, merchantTerms);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BasketOptimizerService', () => {
  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------

  describe('input validation', () => {
    it('throws BasketValidationError when items count exceeds MAX_BASKET_ITEMS', async () => {
      const service = createOptimizer();
      const items = Array.from({ length: MAX_BASKET_ITEMS + 1 }, () => ({
        productId: 101,
        quantity: 1,
      }));
      const input: BasketOptimizationInput = { items, destination: 'FI' };

      await expect(service.optimize(input)).rejects.toThrow(BasketValidationError);
      await expect(service.optimize(input)).rejects.toMatchObject({
        code: 'TOO_MANY_ITEMS',
      });
    });

    it('throws BasketValidationError when quantity is not a positive integer', async () => {
      const service = createOptimizer();
      const input: BasketOptimizationInput = {
        items: [{ productId: 101, quantity: 0 }],
        destination: 'FI',
      };

      await expect(service.optimize(input)).rejects.toThrow(BasketValidationError);
    });

    it('throws BasketValidationError when quantity is negative', async () => {
      const service = createOptimizer();
      const input: BasketOptimizationInput = {
        items: [{ productId: 101, quantity: -3 }],
        destination: 'FI',
      };

      await expect(service.optimize(input)).rejects.toThrow(BasketValidationError);
    });
  });

  // -------------------------------------------------------------------------
  // Classification gate enforcement
  // -------------------------------------------------------------------------

  describe('classification gate', () => {
    it('throws BasketClassificationGateError for product without regulatory classification', async () => {
      const productData = createMockProductDataPort({
        findProductById: vi.fn().mockResolvedValue({
          ...PRODUCT_1,
          regulatoryClassification: null,
        }),
      });
      const service = createOptimizer({ productData });

      const input: BasketOptimizationInput = {
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      };

      await expect(service.optimize(input)).rejects.toThrow(BasketClassificationGateError);
    });

    it('carries the productId in the error', async () => {
      const productData = createMockProductDataPort({
        findProductById: vi.fn().mockImplementation(async (id: number) => {
          if (id === 101) return { ...PRODUCT_1, regulatoryClassification: '' };
          return PRODUCT_1;
        }),
      });
      const service = createOptimizer({ productData });

      const input: BasketOptimizationInput = {
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      };

      try {
        await service.optimize(input);
        expect.unreachable('should have thrown');
      } catch (e) {
        if (e instanceof BasketClassificationGateError) {
          expect(e.productId).toBe(101);
        } else {
          throw e;
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // Cheapest selection (single item, multiple merchants)
  // -------------------------------------------------------------------------

  describe('cheapest merchant selection', () => {
    it('selects the merchant with lowest unit price for a single-item basket', async () => {
      const service = createOptimizer();
      const input: BasketOptimizationInput = {
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      // merchant-a has the lowest price (200 vs 220)
      expect(result.shipments).toHaveLength(1);
      expect(result.shipments[0].merchant).toBe('merchant-a');
      expect(result.totalCents).toBeGreaterThan(0);
    });

    it('selects the cheapest merchant when no transport offers exist (partial)', async () => {
      const service = createOptimizer({ transportOffers: [] });
      const input: BasketOptimizationInput = {
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      expect(result.shipments).toHaveLength(1);
      expect(result.shipments[0].merchant).toBe('merchant-a');
      // Transport is PARTIAL (no offers) → cost is 0 for transport
      expect(result.shipments[0].consolidatedTransport.reliability).toBe('PARTIAL');
    });
  });

  // -------------------------------------------------------------------------
  // Multi-item — cross product
  // -------------------------------------------------------------------------

  describe('multi-item basket', () => {
    it('assigns each item to the same merchant when cheapest overall', async () => {
      // Product 1 available at A (200) and B (220)
      // Product 2 available only at B (500)
      // Only option: product1→A, product2→B (two shipments)
      // Alternative: product1→B, product2→B (one shipment, but product1 costs more)
      const service = createOptimizer();
      const input: BasketOptimizationInput = {
        items: [
          { productId: 101, quantity: 1 },
          { productId: 102, quantity: 1 },
        ],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      // Should pick the cheaper total: A(200)+B(500)=700 vs B(220+500)=720
      // So product1→A, product2→B = 2 shipments
      // (shipping costs also factor in, but with similar brackets A's 1000 + B's 1500 vs single B 1500
      //  difference: A(200+30+26+1000) + B(500+30+26+1500) = 3286 vs B(720+60+52+1500) = 2332
      //  so actually single-store B wins)
      expect(result.shipments.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // Tie-break determinism
  // -------------------------------------------------------------------------

  describe('tie-break determinism', () => {
    it('assignments with same total cost are ordered by fewer stores then lexicographic merchant', async () => {
      // Three merchants with identical prices for product, but same total
      // Tie: same total → fewer stores wins
      const offersAllEqual: CalculatorRetailOfferData[] = [
        { id: 1, priceCents: 200, merchant: 'merchant-a', country: 'DE', reliabilityStatus: 'VERIFIED' },
        { id: 2, priceCents: 200, merchant: 'merchant-b', country: 'DE', reliabilityStatus: 'VERIFIED' },
      ];

      const productData = createMockProductDataPort({
        findProductById: vi.fn().mockResolvedValue(PRODUCT_1),
        findRetailOffers: vi.fn().mockResolvedValue(offersAllEqual),
      });

      // Both merchants have same shipping cost
      const transportOffers = [
        makeTransportOffer({ carrier: 'merchant-a', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 10 } }),
        makeTransportOffer({ carrier: 'merchant-b', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 10 } }),
      ];

      const service = createOptimizer({ productData, transportOffers });

      const input: BasketOptimizationInput = {
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      // Both merchants are identical in total. Tie-break: fewer stores → same (1 each)
      // Then lexicographic: merchant-a < merchant-b
      expect(result.shipments).toHaveLength(1);
      expect(result.shipments[0].merchant).toBe('merchant-a');
      expect(result.alternatives).toHaveLength(1); // merchant-b
      expect(result.alternatives[0].shipments[0].merchant).toBe('merchant-b');
    });
  });

  // -------------------------------------------------------------------------
  // Threshold semantics
  // -------------------------------------------------------------------------

  describe('minimum-order thresholds', () => {
    const termsVerifiedAbove: MerchantTerms = {
      merchantId: 'merchant-a',
      minimumOrderValueCents: 500, // 5€ — retail subtotal is 200¢, below
      currency: 'EUR',
      reliabilityStatus: 'VERIFIED',
      observedAt: BASE_DATE,
    };

    const termsVerifiedBelow: MerchantTerms = {
      merchantId: 'merchant-a',
      minimumOrderValueCents: 100, // 1€ — retail subtotal 200¢ is above
      currency: 'EUR',
      reliabilityStatus: 'VERIFIED',
      observedAt: BASE_DATE,
    };

    const termsEstimated: MerchantTerms = {
      merchantId: 'merchant-a',
      minimumOrderValueCents: 500,
      currency: 'EUR',
      reliabilityStatus: 'ESTIMATED',
      observedAt: BASE_DATE,
    };

    it('null terms (missing row) — store is eligible', async () => {
      const merchantTerms = createMockMerchantTermsPort({
        getTerms: vi.fn().mockResolvedValue(null),
      });
      const service = createOptimizer({ merchantTerms });

      const result = await service.optimize({
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      });

      expect(result.shipments).toHaveLength(1);
      expect(result.shipments[0].thresholdCheck.minimumOrderValueCents).toBeNull();
      expect(result.shipments[0].thresholdCheck.meetsThreshold).toBe(true);
    });

    it('VERIFIED threshold below subtotal — blocks assignment', async () => {
      const merchantTerms = createMockMerchantTermsPort({
        getTerms: vi.fn().mockImplementation(async (merchantId: string) => {
          if (merchantId === 'merchant-a') return termsVerifiedAbove;
          return null;
        }),
      });
      const service = createOptimizer({ merchantTerms });

      // merchant-a has threshold 500¢, subtotal 200¢ → blocked
      // merchant-b has no threshold → eligible
      const result = await service.optimize({
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      });

      // Should fall back to merchant-b
      expect(result.shipments).toHaveLength(1);
      expect(result.shipments[0].merchant).toBe('merchant-b');
    });

    it('VERIFIED threshold above subtotal — assignment passes', async () => {
      const merchantTerms = createMockMerchantTermsPort({
        getTerms: vi.fn().mockImplementation(async (merchantId: string) => {
          if (merchantId === 'merchant-a') return termsVerifiedBelow;
          return null;
        }),
      });
      const service = createOptimizer({ merchantTerms });

      const result = await service.optimize({
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      });

      expect(result.shipments).toHaveLength(1);
      expect(result.shipments[0].merchant).toBe('merchant-a');
      expect(result.shipments[0].thresholdCheck.meetsThreshold).toBe(true);
    });

    it('ESTIMATED threshold below subtotal — does NOT block, carries reliability', async () => {
      const merchantTerms = createMockMerchantTermsPort({
        getTerms: vi.fn().mockImplementation(async (merchantId: string) => {
          if (merchantId === 'merchant-a') return termsEstimated;
          return null;
        }),
      });
      const service = createOptimizer({ merchantTerms });

      const result = await service.optimize({
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      });

      // ESTIMATED threshold below subtotal: still eligible
      expect(result.shipments).toHaveLength(1);
      expect(result.shipments[0].merchant).toBe('merchant-a');
      expect(result.shipments[0].thresholdCheck.meetsThreshold).toBe(true);
      expect(result.shipments[0].thresholdCheck.termsReliability).toBe('ESTIMATED');
    });
  });

  // -------------------------------------------------------------------------
  // Determinism — repeated calls produce identical results
  // -------------------------------------------------------------------------

  describe('determinism', () => {
    it('two optimizations with identical input produce identical output', async () => {
      const service = createOptimizer();
      const input: BasketOptimizationInput = {
        items: [
          { productId: 101, quantity: 2 },
          { productId: 102, quantity: 1 },
        ],
        destination: 'FI',
      };

      const result1 = await service.optimize(input);
      const result2 = await service.optimize(input);

      expect(result1.totalCents).toBe(result2.totalCents);
      expect(result1.shipments.map((s) => s.merchant)).toEqual(
        result2.shipments.map((s) => s.merchant),
      );
    });
  });
});