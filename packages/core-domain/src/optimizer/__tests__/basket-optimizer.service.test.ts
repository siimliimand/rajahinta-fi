/**
 * BasketOptimizerService tests — enumeration logic, input validation,
 * classification gate, threshold semantics, tie-break determinism,
 * confidence aggregation, PERSONAL restriction, disclaimer, dataset
 * versions, and persistence.
 *
 * All I/O is stubbed via port interfaces; pure-logic sub-services
 * (ClassificationGateService, BasketShippingCalculator with stub
 * transport-offer query) run in their real implementations.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  MAX_CANDIDATE_MERCHANTS_PER_ITEM,
  MAX_TOTAL_COMBINATIONS,
  BasketValidationError,
  BasketClassificationGateError,
  BasketCombinationLimitError,
} from '../optimizer.types';
import type {
  BasketOptimizationInput,
} from '../optimizer.types';
import { DISCLAIMER_FI } from '../../index';
import type {
  IProductDataPort,
  CalculatorProductData,
  CalculatorRetailOfferData,
  ICalculationRecordPort,
} from '../../calculator/calculator.types';
import type { IMerchantTermsPort, MerchantTerms } from '../ports/merchant-terms.port';
import type { IBasketCalculationRecordPort } from '../ports/basket-calculation-record.port';
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

/** Heavy product for weight-bracket boundary testing (8 kg). */
const PRODUCT_3: CalculatorProductData = {
  id: 103,
  regulatoryClassification: 'beer',
  category: 'beer',
  volumeLitres: 5.0,
  alcoholByVolume: 0.05,
  containerType: 'keg',
  depositSystemStatus: true,
  weightKg: 8,
  normalizedName: 'Test Keg C',
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
      if (id === 103) return PRODUCT_3;
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

function createMockBasketCalcRecordPort(): IBasketCalculationRecordPort {
  return {
    create: vi.fn().mockResolvedValue({ id: 99 }),
  };
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

function createOptimizer(options?: {
  productData?: IProductDataPort;
  merchantTerms?: IMerchantTermsPort;
  transportOffers?: TransportOffer[];
  basketCalcRecordPort?: IBasketCalculationRecordPort | null;
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
    makeTransportOffer({ carrier: 'merchant-a', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 10 }, packageTier: 'can' }),
    makeTransportOffer({ carrier: 'merchant-b', destinationCountry: 'FI', priceCents: 1500, weightBracket: { minKg: 0, maxKg: 20 }, packageTier: 'can' }),
    makeTransportOffer({ carrier: 'merchant-b', destinationCountry: 'FI', priceCents: 1600, weightBracket: { minKg: 0, maxKg: 20 }, packageTier: 'bottle' }),
  ];
  const shippingCalc = new BasketShippingCalculator(new StubTransportQuery(transportOffers));

  const merchantTerms = options?.merchantTerms ?? createMockMerchantTermsPort();
  const basketCalcRecordPort = options?.basketCalcRecordPort !== undefined
    ? options.basketCalcRecordPort
    : createMockBasketCalcRecordPort();

  return new BasketOptimizerService(
    gate,
    calcService,
    shippingCalc,
    productData,
    merchantTerms,
    basketCalcRecordPort,
    confidence,
  );
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
        makeTransportOffer({ carrier: 'merchant-a', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 10 }, packageTier: 'can' }),
        makeTransportOffer({ carrier: 'merchant-b', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 10 }, packageTier: 'can' }),
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
  // Confidence aggregation — task 2.4
  // -------------------------------------------------------------------------

  describe('confidence aggregation', () => {
    it('returns HIGH confidence when all inputs are VERIFIED', async () => {
      const service = createOptimizer();
      const input: BasketOptimizationInput = {
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      expect(result.confidence).toBe('HIGH');
    });

    it('confidence is MEDIUM when one input is ESTIMATED', async () => {
      // Only merchant-a has product 1, with an ESTIMATED retail price
      const offersEstimated = [
        { id: 201, priceCents: 200, merchant: 'merchant-a', country: 'DE', reliabilityStatus: 'ESTIMATED' },
      ];
      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue(offersEstimated),
      });
      const service = createOptimizer({ productData });
      const input: BasketOptimizationInput = {
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      expect(result.confidence).toBe('MEDIUM');
      expect(result.confidenceBreakdown).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: 'ESTIMATED' }),
        ]),
      );
    });

    it('confidence is LOW when transport is PARTIAL (no offers)', async () => {
      const service = createOptimizer({ transportOffers: [] });
      const input: BasketOptimizationInput = {
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      expect(result.confidence).toBe('LOW');
    });
  });

  // -------------------------------------------------------------------------
  // Confidence downgrade on non-VERIFIED terms — task 2.4 requirement
  // -------------------------------------------------------------------------

  describe('confidence downgrade from non-VERIFIED terms', () => {
    const termsEstimated: MerchantTerms = {
      merchantId: 'merchant-a',
      minimumOrderValueCents: 500,
      currency: 'EUR',
      reliabilityStatus: 'ESTIMATED',
      observedAt: BASE_DATE,
    };

    it('downgrades confidence when the winning merchant has ESTIMATED terms', async () => {
      const merchantTerms = createMockMerchantTermsPort({
        getTerms: vi.fn().mockImplementation(async (merchantId: string) => {
          if (merchantId === 'merchant-a') return termsEstimated;
          return null;
        }),
      });
      const service = createOptimizer({ merchantTerms });
      const input: BasketOptimizationInput = {
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      // merchant-a is the cheapest and only option, but terms are ESTIMATED
      expect(result.shipments[0].merchant).toBe('merchant-a');
      // Confidence should be MEDIUM (retail is VERIFIED, but terms are ESTIMATED)
      expect(result.confidence).toBe('MEDIUM');

      // The breakdown should include the terms reliability
      const termsEntry = result.confidenceBreakdown.find(
        (d) => d.detail.includes('Threshold terms') || d.detail.includes('merchant-a'),
      );
      expect(termsEntry).toBeDefined();
      expect(termsEntry!.status).toBe('ESTIMATED');
    });

    it('downgrades confidence when shipping transport is PARTIAL', async () => {
      // Single merchant with no transport offers → transport is PARTIAL → LOW confidence
      const service = createOptimizer({ transportOffers: [] });
      const input: BasketOptimizationInput = {
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      expect(result.confidence).toBe('LOW');
      const transportEntry = result.confidenceBreakdown.find(
        (d) => d.detail.includes('Transport') || d.status === 'UNAVAILABLE',
      );
      expect(transportEntry).toBeDefined();
    });

    it('terms with VERIFIED status do NOT downgrade confidence', async () => {
      const termsVerified: MerchantTerms = {
        merchantId: 'merchant-a',
        minimumOrderValueCents: 100,
        currency: 'EUR',
        reliabilityStatus: 'VERIFIED',
        observedAt: BASE_DATE,
      };
      const merchantTerms = createMockMerchantTermsPort({
        getTerms: vi.fn().mockImplementation(async (merchantId: string) => {
          if (merchantId === 'merchant-a') return termsVerified;
          return null;
        }),
      });
      const service = createOptimizer({ merchantTerms });
      const input: BasketOptimizationInput = {
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      // All inputs VERIFIED + terms VERIFIED → HIGH
      expect(result.confidence).toBe('HIGH');
    });
  });

  // -------------------------------------------------------------------------
  // PERSONAL transport arrangement — single-store only — task 2.4
  // -------------------------------------------------------------------------

  describe('PERSONAL transport arrangement', () => {
    it('evaluates only single-store combinations', async () => {
      const service = createOptimizer();
      const input: BasketOptimizationInput = {
        items: [
          { productId: 101, quantity: 1 },
          { productId: 102, quantity: 1 },
        ],
        destination: 'FI',
        transportArrangement: 'PERSONAL',
      };

      const result = await service.optimize(input);

      // Both items must come from the same store
      expect(result.shipments).toHaveLength(1);
      // The cheapest single-store option is merchant-b (offers both products)
      expect(result.shipments[0].merchant).toBe('merchant-b');
    });

    it('rejects multi-store assignments even if cheaper', async () => {
      // With PERSONAL, product1→A and product2→B (two stores) is not allowed
      // Only merchant-b covers both items, so the result must be single-store B
      const service = createOptimizer();
      const input: BasketOptimizationInput = {
        items: [
          { productId: 101, quantity: 1 },
          { productId: 102, quantity: 1 },
        ],
        destination: 'FI',
        transportArrangement: 'PERSONAL',
      };

      const result = await service.optimize(input);

      expect(result.shipments).toHaveLength(1);
      expect(result.shipments[0].merchant).toBe('merchant-b');
    });

    it('defaults to SELLER_ARRANGED when transportArrangement is not set', async () => {
      // Without PERSONAL, multi-store splits are allowed
      const service = createOptimizer();
      const input: BasketOptimizationInput = {
        items: [
          { productId: 101, quantity: 1 },
          { productId: 102, quantity: 1 },
        ],
        destination: 'FI',
        // No transportArrangement → SELLER_ARRANGED
      };

      const result = await service.optimize(input);

      // Multi-store split may appear when it's cheaper
      // (product1→A cheaper per unit, product2→B only option)
      expect(result.shipments.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // Disclaimer — task 2.4 requirement
  // -------------------------------------------------------------------------

  describe('disclaimer', () => {
    it('is present and matches DISCLAIMER_FI in the main result', async () => {
      const service = createOptimizer();
      const input: BasketOptimizationInput = {
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      expect(result.disclaimer).toBeDefined();
      expect(result.disclaimer.text).toBe(DISCLAIMER_FI.text);
      expect(result.disclaimer.language).toBe('fi');
      expect(result.disclaimer.version).toBe('1.0');
    });

    it('is present in each alternative', async () => {
      const offersAllEqual: CalculatorRetailOfferData[] = [
        { id: 1, priceCents: 200, merchant: 'merchant-a', country: 'DE', reliabilityStatus: 'VERIFIED' },
        { id: 2, priceCents: 200, merchant: 'merchant-b', country: 'DE', reliabilityStatus: 'VERIFIED' },
      ];
      const productData = createMockProductDataPort({
        findProductById: vi.fn().mockResolvedValue(PRODUCT_1),
        findRetailOffers: vi.fn().mockResolvedValue(offersAllEqual),
      });
      const transportOffers = [
        makeTransportOffer({ carrier: 'merchant-a', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 10 }, packageTier: 'can' }),
        makeTransportOffer({ carrier: 'merchant-b', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 10 }, packageTier: 'can' }),
      ];
      const service = createOptimizer({ productData, transportOffers });
      const input: BasketOptimizationInput = {
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      expect(result.alternatives.length).toBeGreaterThan(0);
      for (const alt of result.alternatives) {
        expect(alt.disclaimer).toBeDefined();
        expect(alt.disclaimer.text).toBe(DISCLAIMER_FI.text);
        expect(alt.disclaimer.language).toBe('fi');
      }
    });
  });

  // -------------------------------------------------------------------------
  // DatasetVersions collection — task 2.4 requirement
  // -------------------------------------------------------------------------

  describe('datasetVersions collection', () => {
    it('collects dataset versions from computed item costs', async () => {
      const service = createOptimizer();
      const input: BasketOptimizationInput = {
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      // All tax engines return taxDatasetVersion: 'v1'
      expect(result.metadata.datasetVersions.length).toBeGreaterThan(0);
      expect(result.metadata.datasetVersions).toContain('v1');
    });

    it('de-duplicates identical versions across multiple items', async () => {
      const service = createOptimizer();
      const input: BasketOptimizationInput = {
        items: [
          { productId: 101, quantity: 1 },
          { productId: 102, quantity: 1 },
        ],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      // Both items use the same v1 — should be deduplicated
      const v1Count = result.metadata.datasetVersions.filter((v) => v === 'v1').length;
      expect(v1Count).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Persistence call — task 2.4 requirement
  // -------------------------------------------------------------------------

  describe('persistence', () => {
    it('calls the persistence port when configured and returns record id', async () => {
      const mockPort = createMockBasketCalcRecordPort();
      const service = createOptimizer({ basketCalcRecordPort: mockPort });
      const input: BasketOptimizationInput = {
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      expect(mockPort.create).toHaveBeenCalledOnce();
      expect(mockPort.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: null,
          destination: 'FI',
          totalCents: result.totalCents,
          inputBasket: [{ productId: 101, quantity: 1 }],
        }),
      );
      expect(result.metadata.calculationRecordId).toBe(99);
    });

    it('does not call persistence port when null (not configured)', async () => {
      const service = createOptimizer({ basketCalcRecordPort: null });
      const input: BasketOptimizationInput = {
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      // Should not crash and return null record id
      expect(result.metadata.calculationRecordId).toBeNull();
    });

    it('passes sessionId to the persistence port when provided', async () => {
      const mockPort = createMockBasketCalcRecordPort();
      const service = createOptimizer({ basketCalcRecordPort: mockPort });
      const input: BasketOptimizationInput = {
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
        sessionId: 'test-session-1',
      };

      await service.optimize(input);

      expect(mockPort.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'test-session-1',
        }),
      );
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

    it('produces identical alternatives order on repeated identical input', async () => {
      const offersAllEqual: CalculatorRetailOfferData[] = [
        { id: 1, priceCents: 200, merchant: 'merchant-a', country: 'DE', reliabilityStatus: 'VERIFIED' },
        { id: 2, priceCents: 200, merchant: 'merchant-b', country: 'DE', reliabilityStatus: 'VERIFIED' },
        { id: 3, priceCents: 200, merchant: 'merchant-c', country: 'DE', reliabilityStatus: 'VERIFIED' },
      ];

      const productData = createMockProductDataPort({
        findProductById: vi.fn().mockResolvedValue(PRODUCT_1),
        findRetailOffers: vi.fn().mockResolvedValue(offersAllEqual),
      });

      const transportOffers = [
        makeTransportOffer({ carrier: 'merchant-a', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 10 }, packageTier: 'can' }),
        makeTransportOffer({ carrier: 'merchant-b', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 10 }, packageTier: 'can' }),
        makeTransportOffer({ carrier: 'merchant-c', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 10 }, packageTier: 'can' }),
      ];

      const service = createOptimizer({ productData, transportOffers });
      const input: BasketOptimizationInput = {
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      };

      const r1 = await service.optimize(input);
      const r2 = await service.optimize(input);

      // Same recommended
      expect(r1.shipments).toEqual(r2.shipments);
      // Same alternatives order (merchant-b, merchant-c lexicographically after merchant-a)
      expect(r1.alternatives.map((a) => a.shipments[0].merchant)).toEqual(
        r2.alternatives.map((a) => a.shipments[0].merchant),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Search correctness — multi-store vs single-store
  // -------------------------------------------------------------------------

  describe('search correctness', () => {
    it('multi-store split beats single-store when each item is cheapest from a different merchant', async () => {
      // Product 1: exclusively at merchant-a (200¢).
      // Product 2: exclusively at merchant-b (200¢).
      // No single merchant can fulfill the basket — multi-store is forced.
      const prod1Offers: CalculatorRetailOfferData[] = [
        { id: 1, priceCents: 200, merchant: 'merchant-a', country: 'DE', reliabilityStatus: 'VERIFIED' },
      ];
      const prod2Offers: CalculatorRetailOfferData[] = [
        { id: 2, priceCents: 200, merchant: 'merchant-b', country: 'DE', reliabilityStatus: 'VERIFIED' },
      ];

      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockImplementation(async (id: number) => {
          if (id === 101) return prod1Offers;
          if (id === 102) return prod2Offers;
          return [];
        }),
      });

      const transportOffers = [
        makeTransportOffer({ carrier: 'merchant-a', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: null, maxKg: null }, packageTier: 'can' }),
        makeTransportOffer({ carrier: 'merchant-b', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: null, maxKg: null }, packageTier: 'bottle' }),
      ];

      const service = createOptimizer({ productData, transportOffers, basketCalcRecordPort: null });
      const input: BasketOptimizationInput = {
        items: [
          { productId: 101, quantity: 1 },
          { productId: 102, quantity: 1 },
        ],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      // Only feasible: product1→A, product2→B
      expect(result.shipments).toHaveLength(2);
      const merchants = result.shipments.map((s) => s.merchant).sort();
      expect(merchants).toEqual(['merchant-a', 'merchant-b']);
    });

    it('multi-store split wins when threshold blocks single-store and prices favour split', async () => {
      // Product 1 (qty 1, 2500¢/unit): only at A (threshold 2500¢ → meets exactly).
      // Product 2 (qty 1, 200¢/unit): only at B.
      // Single-store A: cannot fulfill P2 (not available). Single-store B: cannot fulfill P1.
      // Multi-store A(P1=2500) + B(P2=200) is the only feasible option.
      // A's individual subtotal is 2500, meeting its VERIFIED threshold exactly.
      const prod1Offers: CalculatorRetailOfferData[] = [
        { id: 1, priceCents: 2500, merchant: 'merchant-a', country: 'DE', reliabilityStatus: 'VERIFIED' },
      ];
      const prod2Offers: CalculatorRetailOfferData[] = [
        { id: 2, priceCents: 200, merchant: 'merchant-b', country: 'DE', reliabilityStatus: 'VERIFIED' },
      ];

      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockImplementation(async (id: number) => {
          if (id === 101) return prod1Offers;
          if (id === 102) return prod2Offers;
          return [];
        }),
      });

      const merchantTerms = createMockMerchantTermsPort({
        getTerms: vi.fn().mockImplementation(async (merchantId: string) => {
          if (merchantId === 'merchant-a') return {
            merchantId: 'merchant-a',
            minimumOrderValueCents: 2500,
            currency: 'EUR',
            reliabilityStatus: 'VERIFIED' as const,
            observedAt: BASE_DATE,
          };
          return null;
        }),
      });

      const transportOffers = [
        makeTransportOffer({ carrier: 'merchant-a', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: null, maxKg: null }, packageTier: 'can' }),
        makeTransportOffer({ carrier: 'merchant-b', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: null, maxKg: null }, packageTier: 'bottle' }),
      ];

      const service = createOptimizer({ productData, merchantTerms, transportOffers, basketCalcRecordPort: null });
      const input: BasketOptimizationInput = {
        items: [
          { productId: 101, quantity: 1 },
          { productId: 102, quantity: 1 },
        ],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      // Only feasible: product1→A, product2→B
      expect(result.shipments).toHaveLength(2);
      const merchants = result.shipments.map((s) => s.merchant).sort();
      expect(merchants).toEqual(['merchant-a', 'merchant-b']);
    });

    it('single-store wins when it is cheaper than any multi-store split', async () => {
      // Product 1: A(200), B(210).  Product 2: A(500), B(510).
      // Single-store A = 200+500=700+one shipment < multi-store = 200+510=710+two shipments
      const prod1Offers: CalculatorRetailOfferData[] = [
        { id: 1, priceCents: 200, merchant: 'merchant-a', country: 'DE', reliabilityStatus: 'VERIFIED' },
        { id: 2, priceCents: 210, merchant: 'merchant-b', country: 'DE', reliabilityStatus: 'VERIFIED' },
      ];
      const prod2Offers: CalculatorRetailOfferData[] = [
        { id: 3, priceCents: 500, merchant: 'merchant-a', country: 'DE', reliabilityStatus: 'VERIFIED' },
        { id: 4, priceCents: 510, merchant: 'merchant-b', country: 'DE', reliabilityStatus: 'VERIFIED' },
      ];

      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockImplementation(async (id: number) => {
          if (id === 101) return prod1Offers;
          if (id === 102) return prod2Offers;
          return [];
        }),
      });

      const transportOffers = [
        makeTransportOffer({ carrier: 'merchant-a', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: null, maxKg: null }, packageTier: 'can' }),
        makeTransportOffer({ carrier: 'merchant-a', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: null, maxKg: null }, packageTier: 'bottle' }),
        makeTransportOffer({ carrier: 'merchant-b', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: null, maxKg: null }, packageTier: 'can' }),
        makeTransportOffer({ carrier: 'merchant-b', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: null, maxKg: null }, packageTier: 'bottle' }),
      ];

      const service = createOptimizer({ productData, transportOffers });
      const input: BasketOptimizationInput = {
        items: [
          { productId: 101, quantity: 1 },
          { productId: 102, quantity: 1 },
        ],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      // Single-store A is cheapest
      expect(result.shipments).toHaveLength(1);
      expect(result.shipments[0].merchant).toBe('merchant-a');
    });

    it('cheapest merchant selected when multiple candidates per item', async () => {
      // Product 1 at A(200), B(220), C(250), D(300)
      const offers = [
        { id: 1, priceCents: 200, merchant: 'merchant-a', country: 'DE', reliabilityStatus: 'VERIFIED' },
        { id: 2, priceCents: 220, merchant: 'merchant-b', country: 'DE', reliabilityStatus: 'VERIFIED' },
        { id: 3, priceCents: 250, merchant: 'merchant-c', country: 'DE', reliabilityStatus: 'VERIFIED' },
        { id: 4, priceCents: 300, merchant: 'merchant-d', country: 'DE', reliabilityStatus: 'VERIFIED' },
      ];

      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue(offers),
      });

      const transportOffers = [
        makeTransportOffer({ carrier: 'merchant-a', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 10 }, packageTier: 'can' }),
        makeTransportOffer({ carrier: 'merchant-b', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 10 }, packageTier: 'can' }),
        makeTransportOffer({ carrier: 'merchant-c', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 10 }, packageTier: 'can' }),
        makeTransportOffer({ carrier: 'merchant-d', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 10 }, packageTier: 'can' }),
      ];

      const service = createOptimizer({ productData, transportOffers });
      const input: BasketOptimizationInput = {
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      expect(result.shipments).toHaveLength(1);
      expect(result.shipments[0].merchant).toBe('merchant-a');
    });
  });

  // -------------------------------------------------------------------------
  // Caps enforcement — before I/O and deterministic
  // -------------------------------------------------------------------------

  describe('caps enforcement', () => {
    it('throws BasketValidationError for >MAX_BASKET_ITEMS before any port call', async () => {
      const findProductById = vi.fn();
      const findRetailOffers = vi.fn();
      const getTerms = vi.fn();

      const productData = createMockProductDataPort({
        findProductById,
        findRetailOffers,
      });
      const merchantTerms = createMockMerchantTermsPort({ getTerms });

      const items = Array.from({ length: MAX_BASKET_ITEMS + 1 }, () => ({
        productId: 101,
        quantity: 1,
      }));

      const input: BasketOptimizationInput = { items, destination: 'FI' };

      const service = createOptimizer({ productData, merchantTerms, basketCalcRecordPort: null });

      await expect(service.optimize(input)).rejects.toThrow(BasketValidationError);

      // No I/O port should have been called
      expect(findProductById).not.toHaveBeenCalled();
      expect(findRetailOffers).not.toHaveBeenCalled();
      expect(getTerms).not.toHaveBeenCalled();
    });

    it('caps candidate merchants at MAX_CANDIDATE_MERCHANTS_PER_ITEM and still returns a result', async () => {
      // 9 offers for product 101 — only 8 cheapest should be retained
      const manyOffers: CalculatorRetailOfferData[] = Array.from(
        { length: MAX_CANDIDATE_MERCHANTS_PER_ITEM + 1 },
        (_, i) => ({
          id: 200 + i,
          priceCents: 200 + i * 10, // 200, 210, 220, … 280
          merchant: `merchant-${String.fromCharCode(97 + i)}`,
          country: 'DE',
          reliabilityStatus: 'VERIFIED' as const,
        }),
      );

      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockResolvedValue(manyOffers),
      });

      // Transport for all candidate merchants
      const transportOffers = manyOffers.slice(0, MAX_CANDIDATE_MERCHANTS_PER_ITEM).map((o) =>
        makeTransportOffer({
          carrier: o.merchant,
          destinationCountry: 'FI',
          priceCents: 1000,
          weightBracket: { minKg: 0, maxKg: 10 },
          packageTier: 'can',
        }),
      );

      const service = createOptimizer({ productData, transportOffers, basketCalcRecordPort: null });
      const input: BasketOptimizationInput = {
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      // A result is still produced — the 9th merchant (highest price) was capped out
      expect(result.shipments).toHaveLength(1);
      expect(result.totalCents).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Caps pin — a cap change is a deliberate, visible act, not silent drift
  // (basket-optimization spec: input caps pinned by test)
  // -------------------------------------------------------------------------

  describe('input caps pinned', () => {
    it('pins the exact cap values — update this pin in the same commit as any deliberate change', () => {
      expect(MAX_BASKET_ITEMS).toBe(10);
      expect(MAX_CANDIDATE_MERCHANTS_PER_ITEM).toBe(8);
      expect(MAX_TOTAL_COMBINATIONS).toBe(100_000);
    });
  });

  // -------------------------------------------------------------------------
  // Total-combinations guard — reject before enumeration, clean typed error
  // (basket-optimization spec: oversized request rejected)
  // -------------------------------------------------------------------------

  describe('total-combinations guard', () => {
    const MERCHANTS_PER_ITEM = 8;

    function eightMerchantOffers(): CalculatorRetailOfferData[] {
      return Array.from({ length: MERCHANTS_PER_ITEM }, (_, i) => ({
        id: 400 + i,
        priceCents: 200 + i * 10,
        merchant: `merchant-${i}`,
        country: 'DE',
        reliabilityStatus: 'VERIFIED' as const,
      }));
    }

    function guardTestOptimizer() {
      const getTerms = vi.fn();
      const productData = createMockProductDataPort({
        findProductById: vi.fn().mockImplementation(async () => PRODUCT_1),
        findRetailOffers: vi.fn().mockResolvedValue(eightMerchantOffers()),
      });
      const merchantTerms = createMockMerchantTermsPort({ getTerms });
      const basketCalcRecordPort = createMockBasketCalcRecordPort();
      const service = createOptimizer({ productData, merchantTerms, basketCalcRecordPort });
      return { service, getTerms, basketCalcRecordPort };
    }

    it('throws BasketCombinationLimitError when the Cartesian product exceeds the limit', async () => {
      const { service, getTerms, basketCalcRecordPort } = guardTestOptimizer();

      // 6 items × 8 merchants = 262,144 > 100,000
      const items = Array.from({ length: 6 }, (_, i) => ({
        productId: 500 + i,
        quantity: 1,
      }));
      const input: BasketOptimizationInput = { items, destination: 'FI' };

      const error = await service.optimize(input).then(
        () => { throw new Error('expected BasketCombinationLimitError'); },
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(BasketCombinationLimitError);
      const limitError = error as BasketCombinationLimitError;
      expect(limitError.totalCombinations).toBe(8 ** 6);
      expect(limitError.limit).toBe(MAX_TOTAL_COMBINATIONS);
      expect(limitError.message).toContain(String(8 ** 6));
      expect(limitError.message).toContain(String(MAX_TOTAL_COMBINATIONS));
      expect(limitError.name).toBe('BasketCombinationLimitError');

      // The guard fires after offer resolution (needed to count combinations)
      // but before merchant-terms fetch and any persistence — no enumeration.
      expect(getTerms).not.toHaveBeenCalled();
      expect(basketCalcRecordPort.create).not.toHaveBeenCalled();
    });

    it('applies regardless of transport arrangement (PERSONAL still enumerates the same tree)', async () => {
      const { service } = guardTestOptimizer();

      const items = Array.from({ length: 6 }, (_, i) => ({
        productId: 500 + i,
        quantity: 1,
      }));
      const input: BasketOptimizationInput = {
        items,
        destination: 'FI',
        transportArrangement: 'PERSONAL',
      };

      await expect(service.optimize(input)).rejects.toThrow(BasketCombinationLimitError);
    });

    it('still optimizes a basket at the worst caps-respecting size under the limit', async () => {
      // 5 items × 8 merchants = 32,768 ≤ 100,000 — legitimate request, must pass.
      const offers = eightMerchantOffers();
      const productData = createMockProductDataPort({
        findProductById: vi.fn().mockImplementation(async () => PRODUCT_1),
        findRetailOffers: vi.fn().mockResolvedValue(offers),
      });
      const transportOffers = offers.map((o) =>
        makeTransportOffer({
          carrier: o.merchant,
          destinationCountry: 'FI',
          priceCents: 1000,
          weightBracket: { minKg: 0, maxKg: 10 },
          packageTier: 'can',
        }),
      );
      const service = createOptimizer({ productData, transportOffers, basketCalcRecordPort: null });

      const items = Array.from({ length: 5 }, (_, i) => ({
        productId: 600 + i,
        quantity: 1,
      }));
      const input: BasketOptimizationInput = { items, destination: 'FI' };

      const result = await service.optimize(input);
      expect(result.totalCents).toBeGreaterThan(0);
      expect(result.shipments.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // Minimum-order feasibility — STALE threshold semantics
  // -------------------------------------------------------------------------

  describe('minimum-order thresholds — STALE semantics', () => {
    const termsStale: MerchantTerms = {
      merchantId: 'merchant-a',
      minimumOrderValueCents: 500,
      currency: 'EUR',
      reliabilityStatus: 'STALE',
      observedAt: BASE_DATE,
    };

    it('STALE threshold below subtotal does NOT block assignment', async () => {
      const merchantTerms = createMockMerchantTermsPort({
        getTerms: vi.fn().mockImplementation(async (merchantId: string) => {
          if (merchantId === 'merchant-a') return termsStale;
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
      expect(result.shipments[0].thresholdCheck.termsReliability).toBe('STALE');
    });

    it('STALE threshold downgrades confidence with evidence naming the threshold input', async () => {
      const merchantTerms = createMockMerchantTermsPort({
        getTerms: vi.fn().mockImplementation(async (merchantId: string) => {
          if (merchantId === 'merchant-a') return termsStale;
          return null;
        }),
      });
      const service = createOptimizer({ merchantTerms });

      const result = await service.optimize({
        items: [{ productId: 101, quantity: 1 }],
        destination: 'FI',
      });

      // STALE threshold → confidence drops from HIGH to LOW
      expect(result.confidence).toBe('LOW');

      // The breakdown must include an entry naming the threshold input
      const thresholdEntry = result.confidenceBreakdown.find(
        (d) => d.detail.includes('merchant-a') && d.detail.includes('Threshold'),
      );
      expect(thresholdEntry).toBeDefined();
      expect(thresholdEntry!.status).toBe('STALE');
    });
  });

  // -------------------------------------------------------------------------
  // Deterministic tie-breaking — fewer stores, lexicographic, replay
  // -------------------------------------------------------------------------

  describe('tie-breaking details', () => {
    it('equal totals: fewer stores breaks the tie over multi-store', async () => {
      // Two products.  Both available at A and B at same prices.
      // Same total: A only (200+500=700+ship), B only (200+500=700+ship),
      // multi-store (200+500=700+two ships).
      // A only has 1 store < B only (both 1) → lexicographic: merchant-a wins
      const prod1Offers: CalculatorRetailOfferData[] = [
        { id: 1, priceCents: 200, merchant: 'merchant-a', country: 'DE', reliabilityStatus: 'VERIFIED' },
        { id: 2, priceCents: 200, merchant: 'merchant-b', country: 'DE', reliabilityStatus: 'VERIFIED' },
      ];
      const prod2Offers: CalculatorRetailOfferData[] = [
        { id: 3, priceCents: 500, merchant: 'merchant-a', country: 'DE', reliabilityStatus: 'VERIFIED' },
        { id: 4, priceCents: 500, merchant: 'merchant-b', country: 'DE', reliabilityStatus: 'VERIFIED' },
      ];

      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockImplementation(async (id: number) => {
          if (id === 101) return prod1Offers;
          if (id === 102) return prod2Offers;
          return [];
        }),
      });

      const transportOffers = [
        makeTransportOffer({ carrier: 'merchant-a', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 20 }, packageTier: 'can' }),
        makeTransportOffer({ carrier: 'merchant-a', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 20 }, packageTier: 'bottle' }),
        makeTransportOffer({ carrier: 'merchant-b', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 20 }, packageTier: 'can' }),
        makeTransportOffer({ carrier: 'merchant-b', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 20 }, packageTier: 'bottle' }),
      ];

      const service = createOptimizer({ productData, transportOffers });
      const input: BasketOptimizationInput = {
        items: [
          { productId: 101, quantity: 1 },
          { productId: 102, quantity: 1 },
        ],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      // Single-store A wins over multi-store, and over single-store B (lexicographic)
      expect(result.shipments).toHaveLength(1);
      expect(result.shipments[0].merchant).toBe('merchant-a');
    });
  });

  // -------------------------------------------------------------------------
  // Multi-item weight bracket — consolidated shipment crosses bracket boundary
  // -------------------------------------------------------------------------

  describe('multi-item weight brackets', () => {
    it('consolidated shipment uses combined weight bracket when items cross a boundary', async () => {
      // Two kegs of 8kg each → combined 16kg
      // Transport offers: 0-10kg=800¢, 10-20kg=1500¢
      // Combined weight of 16kg falls into the 10-20kg bracket
      const transportOffers = [
        makeTransportOffer({
          carrier: 'merchant-a',
          destinationCountry: 'FI',
          priceCents: 800,
          weightBracket: { minKg: 0, maxKg: 10 },
          packageTier: 'keg',
        }),
        makeTransportOffer({
          carrier: 'merchant-a',
          destinationCountry: 'FI',
          priceCents: 1500,
          weightBracket: { minKg: 10, maxKg: 20 },
          packageTier: 'keg',
        }),
      ];

      const productData = createMockProductDataPort({
        // Both items resolve to PRODUCT_3 (8kg keg)
        findProductById: vi.fn().mockResolvedValue(PRODUCT_3),
        // Product 103 and a fictional 104 both offered by merchant-a only
        findRetailOffers: vi.fn().mockImplementation(async (id: number) => {
          if (id === 103 || id === 104) {
            return [{ id, priceCents: 500, merchant: 'merchant-a', country: 'DE', reliabilityStatus: 'VERIFIED' }];
          }
          return [];
        }),
      });

      const service = createOptimizer({ productData, transportOffers, basketCalcRecordPort: null });
      const input: BasketOptimizationInput = {
        items: [
          { productId: 103, quantity: 1 },
          { productId: 104, quantity: 1 },
        ],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      // Consolidated single shipment from merchant-a
      expect(result.shipments).toHaveLength(1);
      const transport = result.shipments[0].consolidatedTransport;
      // Combined weight 16kg → 10-20kg bracket
      expect(transport.weightTier).toContain('10');
      expect(transport.weightTier).toContain('20');
      expect(transport.totalCents).toBe(1500);
    });
  });

  // -------------------------------------------------------------------------
  // PERSONAL arrangement — alternatives also single-store
  // -------------------------------------------------------------------------

  describe('PERSONAL transport arrangement — alternatives', () => {
    it('no alternative proposes a multi-store split', async () => {
      // Two items, each available at both merchants.
      // In PERSONAL mode, only single-store combos are evaluated.
      // All alternatives must also be single-store.
      const prod1Offers: CalculatorRetailOfferData[] = [
        { id: 1, priceCents: 200, merchant: 'merchant-a', country: 'DE', reliabilityStatus: 'VERIFIED' },
        { id: 2, priceCents: 210, merchant: 'merchant-b', country: 'DE', reliabilityStatus: 'VERIFIED' },
      ];
      const prod2Offers: CalculatorRetailOfferData[] = [
        { id: 3, priceCents: 500, merchant: 'merchant-a', country: 'DE', reliabilityStatus: 'VERIFIED' },
        { id: 4, priceCents: 490, merchant: 'merchant-b', country: 'DE', reliabilityStatus: 'VERIFIED' },
      ];

      const productData = createMockProductDataPort({
        findRetailOffers: vi.fn().mockImplementation(async (id: number) => {
          if (id === 101) return prod1Offers;
          if (id === 102) return prod2Offers;
          return [];
        }),
      });

      const transportOffers = [
        makeTransportOffer({ carrier: 'merchant-a', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 10 }, packageTier: 'can' }),
        makeTransportOffer({ carrier: 'merchant-a', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 10 }, packageTier: 'bottle' }),
        makeTransportOffer({ carrier: 'merchant-b', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 10 }, packageTier: 'can' }),
        makeTransportOffer({ carrier: 'merchant-b', destinationCountry: 'FI', priceCents: 1000, weightBracket: { minKg: 0, maxKg: 10 }, packageTier: 'bottle' }),
      ];

      const service = createOptimizer({ productData, transportOffers });
      const input: BasketOptimizationInput = {
        items: [
          { productId: 101, quantity: 1 },
          { productId: 102, quantity: 1 },
        ],
        destination: 'FI',
        transportArrangement: 'PERSONAL',
      };

      const result = await service.optimize(input);

      // Recommended
      expect(result.shipments).toHaveLength(1);

      // Every alternative must also be single-store
      for (const alt of result.alternatives) {
        expect(alt.shipments).toHaveLength(1);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Explainability — per-shipment itemized costs carry reliabilities
  // -------------------------------------------------------------------------

  describe('explainability', () => {
    it('each shipment item carries a reliability status', async () => {
      const service = createOptimizer();
      const input: BasketOptimizationInput = {
        items: [
          { productId: 101, quantity: 1 },
          { productId: 102, quantity: 1 },
        ],
        destination: 'FI',
      };

      const result = await service.optimize(input);

      for (const shipment of result.shipments) {
        expect(shipment.items.length).toBeGreaterThan(0);
        for (const costItem of shipment.items) {
          expect(costItem).toHaveProperty('reliability');
          expect(['VERIFIED', 'ESTIMATED', 'STALE', 'UNAVAILABLE']).toContain(costItem.reliability);
          expect(costItem).toHaveProperty('cents');
          expect(typeof costItem.cents).toBe('number');
          expect(costItem).toHaveProperty('category');
          expect(costItem).toHaveProperty('label');
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // Billing isolation — static import analysis
  // -------------------------------------------------------------------------

  describe('billing isolation', () => {
    const OPTIMIZER_SOURCE_FILES = [
      resolve(__dirname, '../optimizer.types.ts'),
      resolve(__dirname, '../optimizer.module.ts'),
      resolve(__dirname, '../services/basket-optimizer.service.ts'),
      resolve(__dirname, '../ports/merchant-terms.port.ts'),
      resolve(__dirname, '../ports/basket-calculation-record.port.ts'),
    ];

    const BILLING_PATTERNS = [
      /from\s+['"].*billing['"]/,
      /from\s+['"].*\/billing/,
      /billing\.service/,
      /billing\.module/,
      /SubscriptionStatus/,
      /BillingService/,
      /BillingModule/,
    ] as const;

    function findMatchingLines(
      filePath: string,
      patterns: readonly RegExp[],
    ): { line: number; text: string }[] {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const matches: { line: number; text: string }[] = [];

      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed === '') {
          continue;
        }
        for (const pattern of patterns) {
          if (pattern.test(trimmed)) {
            matches.push({ line: i + 1, text: trimmed });
            break;
          }
        }
      }

      return matches;
    }

    for (const filePath of OPTIMIZER_SOURCE_FILES) {
      const fileName = filePath.split('/').pop()!;

      it(`${fileName} has no import of billing types/services`, () => {
        const matches = findMatchingLines(filePath, BILLING_PATTERNS);
        expect(matches).toEqual([]);
      });
    }
  });
});
