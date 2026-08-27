/**
 * Calculator-consistency regression test (Task 5.3 / T2.8).
 *
 * Proves that for a single-item basket, the basket optimizer produces
 * IDENTICAL cost components (retail, excise, container duty, transport)
 * and total to the single-item LandedCostCalculatorService.
 *
 * Golden-dataset convention: REAL production services everywhere, in-memory
 * port implementations, NO vi.fn() mocks.
 *
 * Real divergence found and fixed:
 *   BasketShippingCalculator.calculateBasket lacked an originCountry filter,
 *   so when transportMethod was not set it could select offers from carriers
 *   other than the merchant's, or from different origin countries.  Added
 *   optional originCountry parameter and wired it in the optimizer's
 *   prefetch phase (commit T2.8).
 *
 * @module BasketCalculatorConsistencyTest
 */
import { describe, it, expect } from 'vitest';
import {
  LandedCostCalculatorService,
  type CalculatorInput,
} from '@rajahinta/core-domain';
import { ClassificationGateService } from '@rajahinta/core-domain/normalization/classification-gate.service';
import { TransactionClassificationService } from '@rajahinta/core-domain';
import { TransportClassificationService } from '@rajahinta/core-domain';
import { ConfidenceFrameworkService } from '@rajahinta/core-domain/reliability/confidence-framework.service';
import { ReliabilityService } from '@rajahinta/core-domain';
import { AlcoholExciseService } from '@rajahinta/core-domain/tax/services/alcohol-excise.service';
import { ContainerDutyService } from '@rajahinta/core-domain/tax/services/container-duty.service';
import { TransportEstimationService } from '@rajahinta/core-domain/transport/transport-estimation.service';
import { BasketShippingCalculator } from '@rajahinta/core-domain/transport/basket-shipping-calculator.service';
import { BasketOptimizerService } from '@rajahinta/core-domain/optimizer/services/basket-optimizer.service';
import type { ITransportOfferQuery } from '@rajahinta/core-domain/transport/transport-offer-query.interface';
import type { TransportOffer } from '@rajahinta/core-domain/transport/transport-offer.type';
import type {
  IProductDataPort,
  ICalculationRecordPort,
  CalculatorProductData,
  CalculatorRetailOfferData,
} from '@rajahinta/core-domain';
import type { IMerchantTermsPort } from '@rajahinta/core-domain/optimizer/ports/merchant-terms.port';
import type { IBasketCalculationRecordPort } from '@rajahinta/core-domain/optimizer/ports/basket-calculation-record.port';
import type { BasketOptimizationInput } from '@rajahinta/core-domain/optimizer/optimizer.types';
import { InMemoryTaxRuleRepository } from '../golden/helpers/in-memory-tax-rule.repository';
import {
  PRODUCT_BEER,
  OFFER_BEER,
} from '../golden/data/products';

// ---------------------------------------------------------------------------
// Fixtures — reuse golden PRODUCT_BEER, add a second merchant offer
// ---------------------------------------------------------------------------

/** Second offer for the same product from a different merchant. */
const OFFER_BEER_ALT: CalculatorRetailOfferData = {
  id: 200,
  priceCents: 250,
  merchant: 'vinos-es',
  country: 'ES',
  reliabilityStatus: 'EXACT',
};

const ALL_OFFERS = [OFFER_BEER, OFFER_BEER_ALT];

// ---------------------------------------------------------------------------
// Transport offers — each merchant route has a matching offer.
// Brackets are wide enough to cover all tested quantities (up to 10 units,
// 0.55 kg × 10 = 5.5 kg).
// ---------------------------------------------------------------------------

const BASE_DATE = new Date('2026-08-16T12:00:00Z');

const TRANSPORT_BEVERAGE_DE: TransportOffer = {
  id: 1000,
  carrier: 'beverage-de',
  originCountry: 'DE',
  destinationCountry: 'FI',
  weightBracket: { minKg: 0, maxKg: 10 },
  packageTier: 'can',
  priceCents: 150,
  currency: 'EUR',
  sellerInvolvementIndicator: true,
  observedAt: BASE_DATE,
  refreshedAt: BASE_DATE,
  reliabilityStatus: 'EXACT',
};

const TRANSPORT_VINOS_ES: TransportOffer = {
  id: 1001,
  carrier: 'vinos-es',
  originCountry: 'ES',
  destinationCountry: 'FI',
  weightBracket: { minKg: 0, maxKg: 10 },
  packageTier: 'can',
  priceCents: 200,
  currency: 'EUR',
  sellerInvolvementIndicator: true,
  observedAt: BASE_DATE,
  refreshedAt: BASE_DATE,
  reliabilityStatus: 'EXACT',
};

const ALL_TRANSPORT_OFFERS = [TRANSPORT_BEVERAGE_DE, TRANSPORT_VINOS_ES];

// ---------------------------------------------------------------------------
// In-memory port implementations
// ---------------------------------------------------------------------------

class InMemoryTransportOfferQuery implements ITransportOfferQuery {
  constructor(private readonly offers: TransportOffer[]) {}

  async findAllActive(): Promise<TransportOffer[]> {
    return this.offers;
  }

  async findByCarrier(carrierId: string): Promise<TransportOffer[]> {
    return this.offers.filter((o) => o.carrier === carrierId);
  }
}

class InMemoryProductDataPort implements IProductDataPort {
  constructor(
    private readonly product: CalculatorProductData,
    private readonly offers: CalculatorRetailOfferData[],
  ) {}

  async findProductById(id: number): Promise<CalculatorProductData | null> {
    return id === this.product.id ? this.product : null;
  }

  async findRetailOffers(
    productId: number,
  ): Promise<CalculatorRetailOfferData[]> {
    return productId === this.product.id ? this.offers : [];
  }
}

class InMemoryCalcRecordPort implements ICalculationRecordPort {
  async create(): Promise<{ id: number }> {
    return { id: 1 };
  }
}

class InMemoryBasketCalcRecordPort implements IBasketCalculationRecordPort {
  async create(): Promise<{ id: number }> {
    return { id: 1 };
  }
}

class InMemoryMerchantTermsPort implements IMerchantTermsPort {
  async getTerms(): Promise<null> {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Shared engine wiring — identical for calculator and optimizer
// ---------------------------------------------------------------------------

const TAX_REPO = new InMemoryTaxRuleRepository();
const TRANSPORT_QUERY = new InMemoryTransportOfferQuery(ALL_TRANSPORT_OFFERS);
const PRODUCT_DATA = new InMemoryProductDataPort(PRODUCT_BEER, ALL_OFFERS);
const CALC_RECORDS = new InMemoryCalcRecordPort();
const BASKET_CALC_RECORDS = new InMemoryBasketCalcRecordPort();
const MERCHANT_TERMS = new InMemoryMerchantTermsPort();

// Pure-logic services (zero I/O)
const GATE = new ClassificationGateService();
const TRANSPORT_CLASSIFICATION = new TransportClassificationService();
const RELIABILITY = new ReliabilityService();
const CONFIDENCE = new ConfidenceFrameworkService(RELIABILITY);
const CLASSIFICATION_SERVICE = new TransactionClassificationService(
  TRANSPORT_CLASSIFICATION,
);

// Real engines
const EXCISE = new AlcoholExciseService(TAX_REPO);
const CONTAINER = new ContainerDutyService(TAX_REPO);
const TRANSPORT_ESTIMATION = new TransportEstimationService(TRANSPORT_QUERY);
const SHIPPING_CALC = new BasketShippingCalculator(TRANSPORT_QUERY);

// Calculator — same engine instances the optimizer delegates to
const CALCULATOR = new LandedCostCalculatorService(
  GATE,
  EXCISE,
  CONTAINER,
  CLASSIFICATION_SERVICE,
  TRANSPORT_ESTIMATION,
  CONFIDENCE,
  PRODUCT_DATA,
  CALC_RECORDS,
);

// Optimizer — shares the same CALCULATOR instance
const OPTIMIZER = new BasketOptimizerService(
  GATE,
  CALCULATOR,
  SHIPPING_CALC,
  PRODUCT_DATA,
  MERCHANT_TERMS,
  BASKET_CALC_RECORDS,
  CONFIDENCE,
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a single-item basket input matching the calculator input. */
function toBasketInput(
  calcInput: CalculatorInput,
): BasketOptimizationInput {
  return {
    items: [{ productId: calcInput.productId, quantity: calcInput.quantity }],
    destination: calcInput.destination,
    transportMethod: calcInput.transportMethod,
    transportArrangement: calcInput.transportArrangement as
      | 'SELLER_ARRANGED'
      | 'INDEPENDENT_CARRIER'
      | 'PERSONAL'
      | undefined,
    sessionId: calcInput.sessionId,
  };
}

/** Expected per-unit excise for PRODUCT_BEER (5% ABV, 0.5 L, beer full rate 36.20). */
const EXPECTED_EXCISE_PER_UNIT = 91; // Math.round(36.20 × 0.05 × 0.5 × 100) = Math.round(90.5) = 91

/** Expected per-unit container duty for PRODUCT_BEER (deposit exempt). */
const EXPECTED_CONTAINER_PER_UNIT = 0; // depositSystemStatus=true → EXEMPTED

/** Expected transport cost when carrier=beverage-de for 0.55 kg can. */
const EXPECTED_TRANSPORT = 150;

/** Expected unit price for the cheapest offer (OFFER_BEER = 200). */
const EXPECTED_UNIT_PRICE = 200;

/**
 * Total for qty=1: retail(200) + transport(150) + excise(91) + container(0)
 */
const EXPECTED_TOTAL_Q1 = 441;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Basket optimizer — calculator consistency (T2.8)', () => {
  // =========================================================================
  // (a) Single quantity — default transport
  // =========================================================================

  describe('quantity=1, seller-arranged, no transportMethod override', () => {
    const CALC_INPUT: CalculatorInput = {
      productId: PRODUCT_BEER.id,
      quantity: 1,
      destination: 'FI',
    };

    it('total cost matches between calculator and optimizer', async () => {
      const calcResult = await CALCULATOR.calculate(CALC_INPUT);
      const optResult = await OPTIMIZER.optimize(toBasketInput(CALC_INPUT));

      expect(calcResult.totalCents).toBe(EXPECTED_TOTAL_Q1);
      expect(calcResult.totalCents).toBe(optResult.totalCents);
    });

    it('identical retail component', async () => {
      const calcResult = await CALCULATOR.calculate(CALC_INPUT);
      const optResult = await OPTIMIZER.optimize(toBasketInput(CALC_INPUT));

      expect(calcResult.foreignRetailPrice).toBe(
        optResult.shipments[0].retailSubtotalCents,
      );
      expect(calcResult.foreignRetailPrice).toBe(EXPECTED_UNIT_PRICE);
    });

    it('identical excise component', async () => {
      const calcResult = await CALCULATOR.calculate(CALC_INPUT);
      const optResult = await OPTIMIZER.optimize(toBasketInput(CALC_INPUT));

      expect(calcResult.alcoholExciseEstimate).toBe(EXPECTED_EXCISE_PER_UNIT);

      const exciseItems = optResult.shipments[0].items.filter(
        (i) => i.category === 'alcoholExciseEstimate',
      );
      const optExcise = exciseItems.reduce((s, i) => s + i.cents, 0);
      expect(calcResult.alcoholExciseEstimate).toBe(optExcise);
    });

    it('identical container duty component', async () => {
      const calcResult = await CALCULATOR.calculate(CALC_INPUT);
      const optResult = await OPTIMIZER.optimize(toBasketInput(CALC_INPUT));

      expect(calcResult.containerDutyEstimate).toBe(EXPECTED_CONTAINER_PER_UNIT);

      const dutyItems = optResult.shipments[0].items.filter(
        (i) => i.category === 'containerDutyEstimate',
      );
      const optDuty = dutyItems.reduce((s, i) => s + i.cents, 0);
      expect(calcResult.containerDutyEstimate).toBe(optDuty);
    });

    it('identical transport cost and offer id', async () => {
      const calcResult = await CALCULATOR.calculate(CALC_INPUT);
      const optResult = await OPTIMIZER.optimize(toBasketInput(CALC_INPUT));

      expect(calcResult.transportCost).toBe(EXPECTED_TRANSPORT);
      expect(calcResult.metadata.transportOfferId).toBe(
        TRANSPORT_BEVERAGE_DE.id,
      );

      expect(
        optResult.shipments[0].consolidatedTransport.totalCents,
      ).toBe(EXPECTED_TRANSPORT);
    });

    it('identical transport reliability (semantic: EXACT = VERIFIED)', async () => {
      const calcResult = await CALCULATOR.calculate(CALC_INPUT);
      const optResult = await OPTIMIZER.optimize(toBasketInput(CALC_INPUT));

      // Calculator uses ReliabilityStatus ('VERIFIED'/'ESTIMATED'/'UNAVAILABLE')
      const transportItem = calcResult.itemizedCosts.find(
        (i) => i.category === 'transportCost',
      );
      expect(transportItem?.reliability).toBe('VERIFIED');

      // Optimizer uses ConsolidatedTransportReliability ('EXACT'/'ESTIMATED'/'PARTIAL')
      // Both mean "perfect bracket match" — different vocabularies for same concept
      expect(
        optResult.shipments[0].consolidatedTransport.reliability,
      ).toBe('EXACT');
    });

    it('identical itemized costs (excluding transport)', async () => {
      const calcResult = await CALCULATOR.calculate(CALC_INPUT);
      const optResult = await OPTIMIZER.optimize(toBasketInput(CALC_INPUT));

      const calcNonTransport = calcResult.itemizedCosts.filter(
        (i) => i.category !== 'transportCost',
      );
      const optItems = optResult.shipments[0].items;

      const calcByCategory = new Map(
        calcNonTransport.map((i) => [i.category, i]),
      );
      const optByCategory = new Map(
        optItems.map((i) => [i.category, i]),
      );

      for (const [category, calcItem] of calcByCategory) {
        const optItem = optByCategory.get(category);
        expect(optItem).toBeDefined();
        expect(optItem!.cents).toBe(calcItem.cents);
        expect(optItem!.reliability).toBe(calcItem.reliability);
      }
    });
  });

  // =========================================================================
  // (b) Multiple quantity — verify scaling is consistent
  // =========================================================================

  describe('quantity=3, seller-arranged', () => {
    const CALC_INPUT: CalculatorInput = {
      productId: PRODUCT_BEER.id,
      quantity: 3,
      destination: 'FI',
    };

    it('total cost matches between calculator and optimizer', async () => {
      const calcResult = await CALCULATOR.calculate(CALC_INPUT);
      const optResult = await OPTIMIZER.optimize(toBasketInput(CALC_INPUT));

      // retail(600) + transport(150) + excise(273) + container(0) = 1023
      expect(calcResult.totalCents).toBe(optResult.totalCents);
      expect(calcResult.totalCents).toBe(1023);
    });

    it('retail price is quantity-scaled identically', async () => {
      const calcResult = await CALCULATOR.calculate(CALC_INPUT);
      const optResult = await OPTIMIZER.optimize(toBasketInput(CALC_INPUT));

      expect(calcResult.foreignRetailPrice).toBe(EXPECTED_UNIT_PRICE * 3);
      expect(calcResult.foreignRetailPrice).toBe(
        optResult.shipments[0].retailSubtotalCents,
      );
    });

    it('excise is quantity-scaled identically', async () => {
      const calcResult = await CALCULATOR.calculate(CALC_INPUT);
      const optResult = await OPTIMIZER.optimize(toBasketInput(CALC_INPUT));

      expect(calcResult.alcoholExciseEstimate).toBe(
        EXPECTED_EXCISE_PER_UNIT * 3,
      );

      const exciseItems = optResult.shipments[0].items.filter(
        (i) => i.category === 'alcoholExciseEstimate',
      );
      const optExcise = exciseItems.reduce((s, i) => s + i.cents, 0);
      expect(calcResult.alcoholExciseEstimate).toBe(optExcise);
    });

    it('transport is per-shipment (not per-unit), cost matches', async () => {
      const calcResult = await CALCULATOR.calculate(CALC_INPUT);
      const optResult = await OPTIMIZER.optimize(toBasketInput(CALC_INPUT));

      // Calculator: weight=0.55 kg (not scaled by quantity) → bracket match → 150¢
      expect(calcResult.transportCost).toBe(EXPECTED_TRANSPORT);

      // Optimizer: totalWeight = 0.55 × 3 = 1.65 kg, same carrier after origin fix
      expect(
        optResult.shipments[0].consolidatedTransport.totalCents,
      ).toBe(EXPECTED_TRANSPORT);
    });
  });

  // =========================================================================
  // (c) Quantity-scaled excise and container duty — high quantity
  // =========================================================================

  describe('quantity=10 — large basket tax scaling', () => {
    const CALC_INPUT: CalculatorInput = {
      productId: PRODUCT_BEER.id,
      quantity: 10,
      destination: 'FI',
    };

    it('excise and container duty scale linearly with quantity', async () => {
      const calcResult = await CALCULATOR.calculate(CALC_INPUT);
      const optResult = await OPTIMIZER.optimize(toBasketInput(CALC_INPUT));

      // Excise: 91 × 10 = 910
      expect(calcResult.alcoholExciseEstimate).toBe(910);

      const optExciseItems = optResult.shipments[0].items.filter(
        (i) => i.category === 'alcoholExciseEstimate',
      );
      expect(optExciseItems.reduce((s, i) => s + i.cents, 0)).toBe(910);

      // Container: 0 × 10 = 0 (deposit exempt)
      expect(calcResult.containerDutyEstimate).toBe(0);
      const optDutyItems = optResult.shipments[0].items.filter(
        (i) => i.category === 'containerDutyEstimate',
      );
      expect(optDutyItems.reduce((s, i) => s + i.cents, 0)).toBe(0);
    });

    it('total cost matches at higher quantity', async () => {
      const calcResult = await CALCULATOR.calculate(CALC_INPUT);
      const optResult = await OPTIMIZER.optimize(toBasketInput(CALC_INPUT));

      // retail(2000) + transport(150) + excise(910) + container(0) = 3060
      expect(calcResult.totalCents).toBe(3060);
      expect(calcResult.totalCents).toBe(optResult.totalCents);
    });
  });

  // =========================================================================
  // (e) Determinism — repeated calls produce identical results
  // =========================================================================

  describe('determinism across repeated calls', () => {
    const CALC_INPUT: CalculatorInput = {
      productId: PRODUCT_BEER.id,
      quantity: 2,
      destination: 'FI',
    };

    it('calculator produces the same total on repeated calls', async () => {
      const r1 = await CALCULATOR.calculate(CALC_INPUT);
      const r2 = await CALCULATOR.calculate(CALC_INPUT);
      expect(r1.totalCents).toBe(r2.totalCents);
      expect(r1.transportCost).toBe(r2.transportCost);
    });

    it('optimizer produces the same total on repeated calls', async () => {
      const basketInput = toBasketInput(CALC_INPUT);
      const r1 = await OPTIMIZER.optimize(basketInput);
      const r2 = await OPTIMIZER.optimize(basketInput);
      expect(r1.totalCents).toBe(r2.totalCents);
      expect(r1.shipments[0].merchant).toBe(r2.shipments[0].merchant);
    });
  });

  // =========================================================================
  // (f) Confidence consistency — same inputs produce same confidence
  // =========================================================================

  describe('confidence consistency', () => {
    it('matches confidence level between calculator and optimizer', async () => {
      const calcInput: CalculatorInput = {
        productId: PRODUCT_BEER.id,
        quantity: 1,
        destination: 'FI',
      };
      const calcResult = await CALCULATOR.calculate(calcInput);
      const optResult = await OPTIMIZER.optimize(toBasketInput(calcInput));

      // Both produce MEDIUM confidence (EXACT retail → ESTIMATED in framework)
      expect(calcResult.confidence).toBe(optResult.confidence);
    });
  });
});