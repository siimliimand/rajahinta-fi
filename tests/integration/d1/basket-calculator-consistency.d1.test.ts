/**
 * Calculator-consistency regression on D1 (task 2.7, change
 * migrate-to-cloudflare). D1 port of
 * tests/integration/basket-calculator-consistency.test.ts; the pg original
 * stays untouched until cutover.
 *
 * Same proof as the original — for a single-item basket the optimizer
 * produces IDENTICAL cost components and totals to the single-item
 * LandedCostCalculatorService — with one upgrade: the write-once record
 * ports are wired to the REAL D1 repositories (migrations applied) instead
 * of { id: 1 } stubs, so every calculation/persisted-record assertion runs
 * through the SQLite engine the Worker will use. Engine wiring, fixtures,
 * and expected figures are otherwise identical to the pg suite.
 *
 * Golden-dataset convention: REAL production services everywhere, in-memory
 * read ports, NO vi.fn() mocks.
 *
 * @module BasketCalculatorConsistencyD1Test
 */
import { describe, it, expect, beforeAll } from 'vitest';
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
  CreateCalculationRecordInput,
} from '@rajahinta/core-domain';
import type { IMerchantTermsPort } from '@rajahinta/core-domain/optimizer/ports/merchant-terms.port';
import type { MerchantTerms } from '@rajahinta/core-domain/optimizer/ports/merchant-terms.port';
import type {
  CreateBasketCalculationRecordInput,
  IBasketCalculationRecordPort,
} from '@rajahinta/core-domain/optimizer/ports/basket-calculation-record.port';
import type { BasketOptimizationInput } from '@rajahinta/core-domain/optimizer/optimizer.types';
import { InMemoryTaxRuleRepository } from '../../golden/helpers/in-memory-tax-rule.repository';
import {
  PRODUCT_BEER,
  OFFER_BEER,
} from '../../golden/data/products';

import { openMigratedD1 } from './harness';
import { D1BasketCalculationRecordRepository } from '../../../packages/data-platform/src/repositories/d1/basket-calculation-record.repository';
import { D1CalculationRecordRepository } from '../../../packages/data-platform/src/repositories/d1/calculation-record.repository';
import { D1MerchantTermsRepository } from '../../../packages/data-platform/src/repositories/d1/merchant-terms.repository';

// ---------------------------------------------------------------------------
// D1-backed write ports — the same domain→row mapping the composition-root
// adapters perform (disclaimer object JSON-stringified into the text column,
// drizzle-typed rows into the D1 repositories).
// ---------------------------------------------------------------------------

class D1CalcRecordPort implements ICalculationRecordPort {
  constructor(private readonly repo: D1CalculationRecordRepository) {}

  async create(
    record: CreateCalculationRecordInput,
  ): Promise<{ id: number }> {
    const persisted = await this.repo.create({
      productMasterId: record.productMasterId,
      retailOfferIds: record.retailOfferIds as unknown,
      transportOfferId: record.transportOfferId,
      exciseRuleVersionId: record.exciseRuleVersionId,
      containerDutyRuleVersionId: record.containerDutyRuleVersionId,
      totalCents: record.totalCents,
      breakdown: record.breakdown,
      confidence: record.confidence,
      quantity: record.quantity,
      destination: record.destination,
      disclaimer: JSON.stringify(record.disclaimer),
      sessionId: record.sessionId,
    });
    return { id: persisted.id };
  }
}

class D1BasketCalcRecordPort implements IBasketCalculationRecordPort {
  constructor(private readonly repo: D1BasketCalculationRecordRepository) {}

  async create(
    record: CreateBasketCalculationRecordInput,
  ): Promise<{ id: number }> {
    // The port shape mirrors the table 1:1 — the D1 repository's drizzle
    // insert type accepts it structurally.
    const persisted = await this.repo.create(record);
    return { id: persisted.id };
  }
}

class D1MerchantTermsPort implements IMerchantTermsPort {
  constructor(private readonly repo: D1MerchantTermsRepository) {}

  async getTerms(merchantId: string) {
    // Map the repository row onto the port's MerchantTerms shape — the
    // boundary translation the composition-root adapter owns (the repo
    // carries reliabilityStatus as a raw string; the port narrows it).
    const terms = await this.repo.findByMerchant(merchantId);
    if (terms === null) return null;
    return {
      merchantId: terms.merchantId,
      minimumOrderValueCents: terms.minimumOrderValueCents,
      currency: terms.currency,
      reliabilityStatus: terms.reliabilityStatus as MerchantTerms['reliabilityStatus'],
      observedAt: terms.observedAt,
    };
  }
}

// ---------------------------------------------------------------------------
// Fixtures — reuse golden PRODUCT_BEER, add a second merchant offer
// (identical to the pg suite)
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
// Transport offers — each merchant route has a matching offer (identical)
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
// Remaining in-memory port implementations (read side)
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

// ---------------------------------------------------------------------------
// Shared engine wiring — identical for calculator and optimizer, with the
// write ports on real D1 repositories
// ---------------------------------------------------------------------------

const { db, d1 } = openMigratedD1();
const CALC_REPO = new D1CalculationRecordRepository(d1);
const BASKET_REPO = new D1BasketCalculationRecordRepository(d1);
const TERMS_REPO = new D1MerchantTermsRepository(d1);

const TAX_REPO = new InMemoryTaxRuleRepository();
const TRANSPORT_QUERY = new InMemoryTransportOfferQuery(ALL_TRANSPORT_OFFERS);
const PRODUCT_DATA = new InMemoryProductDataPort(PRODUCT_BEER, ALL_OFFERS);
const CALC_RECORDS = new D1CalcRecordPort(CALC_REPO);
const BASKET_CALC_RECORDS = new D1BasketCalcRecordPort(BASKET_REPO);
const MERCHANT_TERMS = new D1MerchantTermsPort(TERMS_REPO);

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
// Helpers (identical to the pg suite)
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

describe('Basket optimizer — calculator consistency on D1 (T2.8 port)', () => {
  let productId: number;

  beforeAll(async () => {
    // calculation_records.product_master_id is an FK — seed the golden
    // product under its canonical id so every write targets a real row.
    productId = PRODUCT_BEER.id;
    await d1
      .prepare(
        `INSERT INTO product_master (id, name, manufacturer, brand, category,
            unit_volume, container_type, regulatory_classification)
         VALUES (?, 'Premium Lager 5%', 'Golden Brewery', 'Golden', 'beer',
                 0.5, 'can', 'beer')`,
      )
      .bind(productId)
      .run();

    // The golden tax-rule and fixture transport ids become FK values on
    // the persisted records (excise_rule_version_id / container_duty_
    // rule_version_id / transport_offer_id) — seed the D1 parents so the
    // write path lands like production, where the rules live in tax_rules
    // and the offers in transport_offers.
    for (const id of [1, 2, 101, 102]) {
      await d1
        .prepare(
          `INSERT INTO tax_rules (id, tax_type, product_category, rate, effective_from,
              calculation_formula_reference, official_source, version_label)
           VALUES (?, 'excise', 'beer', 36.20, '2024-01-01T00:00:00Z',
                   'PER_DEGREE_PLATO', 'Finnish Tax Administration (vero.fi) — golden fixture',
                   'v1.0-2024')`,
        )
        .bind(id)
        .run();
    }
    for (const id of [3, 4, 5, 6, 7, 8]) {
      await d1
        .prepare(
          `INSERT INTO tax_rules (id, tax_type, product_category, rate, effective_from,
              calculation_formula_reference, official_source, version_label)
           VALUES (?, 'container_duty', 'all_beverages', 0.51, '2024-01-01T00:00:00Z',
                   'FLAT_PER_LITRE', 'Finnish Tax Administration (vero.fi) — golden fixture',
                   'v1.0-2024')`,
        )
        .bind(id)
        .run();
    }
    for (const offer of [TRANSPORT_BEVERAGE_DE, TRANSPORT_VINOS_ES]) {
      await d1
        .prepare(
          `INSERT INTO transport_offers (id, carrier, origin_country, destination_country,
              weight_min_kg, weight_max_kg, package_tier, price_cents, currency,
              seller_involvement_indicator, refreshed_at, reliability_status)
           VALUES (?, ?, 'DE', 'FI', 0, 10, 'parcel', ?, 'EUR', 1,
                   ?, 'VERIFIED')`,
        )
        .bind(
          offer.id,
          offer.carrier,
          offer.priceCents,
          offer.refreshedAt.toISOString(),
        )
        .run();
    }
  });

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

    it('persists the calculation record to D1 and reads it back intact', async () => {
      const before = latestCalcRecordId();
      const calcResult = await CALCULATOR.calculate(CALC_INPUT);

      // calculate() persists exactly one write-once audit record per call.
      const id = latestCalcRecordId();
      expect(id).toBeGreaterThan(before);

      const persisted = await CALC_REPO.findById(id);
      expect(persisted).not.toBeNull();
      expect(persisted!.productMasterId).toBe(productId);
      expect(persisted!.totalCents).toBe(calcResult.totalCents);
      expect(persisted!.quantity).toBe(1);
      // The disclaimer object round-trips through its JSON text column.
      const disclaimer = JSON.parse(persisted!.disclaimer as unknown as string) as {
        language?: string;
      };
      expect(disclaimer.language).toBe('fi');
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

  // =========================================================================
  // (g) D1 write path — calculation audit records persist
  // =========================================================================

  /** Highest assigned calculation-record id (app-side MAX(id)+1 assigner). */
  const latestCalcRecordId = (): number =>
    (db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM calculation_records').get() as { id: number }).id;

  describe('D1 record persistence', () => {
    it('persists a basket calculation record and reads it back intact', async () => {
      const optResult = await OPTIMIZER.optimize({
        items: [{ productId: PRODUCT_BEER.id, quantity: 1 }],
        destination: 'FI',
        sessionId: 'd1-consistency-basket-session',
      });

      // The optimizer surfaces the persisted record id in its metadata.
      expect(optResult.metadata.calculationRecordId).toBeGreaterThan(0);
      const persisted = await BASKET_REPO.findById(
        optResult.metadata.calculationRecordId as number,
      );
      expect(persisted).not.toBeNull();
      expect(persisted!.sessionId).toBe('d1-consistency-basket-session');
      expect(persisted!.totalCents).toBe(EXPECTED_TOTAL_Q1);
    });

    it('holds no merchant terms for the fixture merchants (port returns null)', async () => {
      expect(await MERCHANT_TERMS.getTerms('beverage-de')).toBeNull();
    });
  });
});
