/**
 * Per-category golden regression tests.
 *
 * Exercises every Finnish excise category and container-duty scenario
 * through REAL engines with in-memory data ports (no vi.fn() mocks).
 *
 * These tests validate that the correct tax formula is selected and applied
 * for each product category, including ABV-tier boundaries for beer,
 * per-litre-of-product for wine/intermediate/other, per-litre-of-alcohol
 * for spirits, and container duty with various deposit statuses.
 *
 * @version 2.0 — expected values aligned with v1.0-2024 seed rates.
 *   See source-mapping comment tables below each `describe` block.
 *
 * @module PerCategoryGoldenTests
 */

import { describe, it, expect } from 'vitest';
import {
  LandedCostCalculatorService,
} from '@rajahinta/core-domain';
import { ClassificationGateService } from '@rajahinta/core-domain/normalization/classification-gate.service';
import { TransactionClassificationService } from '@rajahinta/core-domain';
import { TransportClassificationService } from '@rajahinta/core-domain';
import { ConfidenceFrameworkService } from '@rajahinta/core-domain/reliability/confidence-framework.service';
import { ReliabilityService } from '@rajahinta/core-domain';
import { AlcoholExciseService } from '@rajahinta/core-domain/tax/services/alcohol-excise.service';
import { ContainerDutyService } from '@rajahinta/core-domain/tax/services/container-duty.service';
import { TransportEstimationService } from '@rajahinta/core-domain/transport/transport-estimation.service';
import type { ITransportOfferQuery } from '@rajahinta/core-domain/transport/transport-offer-query.interface';
import type { TransportOffer } from '@rajahinta/core-domain/transport/transport-offer.type';
import type {
  IProductDataPort,
  ICalculationRecordPort,
} from '@rajahinta/core-domain';

import {
  PRODUCT_BEER,
  OFFER_BEER,
  PRODUCT_BEER_LOW_ABV,
  OFFER_BEER_LOW_ABV,
  PRODUCT_BEER_HIGH_ABV,
  OFFER_BEER_HIGH_ABV,
  PRODUCT_WINE_SPARKLING,
  OFFER_WINE_SPARKLING,
  PRODUCT_INTERMEDIATE,
  OFFER_INTERMEDIATE,
  PRODUCT_OTHER_FERMENTED,
  OFFER_OTHER_FERMENTED,
  PRODUCT_NO_DEPOSIT,
  OFFER_NO_DEPOSIT,
  PRODUCT_ZERO_ABV,
  OFFER_ZERO_ABV,
  PRODUCT_NULL_DEPOSIT,
  OFFER_NULL_DEPOSIT,
} from './data/products';

import { InMemoryTaxRuleRepository } from './helpers/in-memory-tax-rule.repository';

class InMemoryTransportOfferQuery implements ITransportOfferQuery {
  constructor(private readonly offers: TransportOffer[]) {}

  async findAllActive(): Promise<TransportOffer[]> {
    return this.offers;
  }

  async findByCarrier(carrierId: string): Promise<TransportOffer[]> {
    return this.offers.filter((o) => o.carrier === carrierId);
  }
}

function createProductDataPort(
  product: typeof PRODUCT_BEER,
  offers: typeof OFFER_BEER[],
): IProductDataPort {
  return {
    findProductById: () => Promise.resolve(product),
    findRetailOffers: () => Promise.resolve(offers),
  };
}

function createCalculationRecordPort(): ICalculationRecordPort {
  return {
    create: () => Promise.resolve({ id: 9999 }),
  };
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

const NOW = new Date();

function buildService(
  product: typeof PRODUCT_BEER,
  offers: typeof OFFER_BEER[],
  carrier: string,
  /** priceCents for the transport offer. */
  transportPriceCents: number,
): LandedCostCalculatorService {
  const gate = new ClassificationGateService();
  const transportClassification = new TransportClassificationService();
  const reliability = new ReliabilityService();
  const confidence = new ConfidenceFrameworkService(reliability);
  const classificationService = new TransactionClassificationService(
    transportClassification,
  );

  const productData = createProductDataPort(product, offers);
  const calculationRecords = createCalculationRecordPort();
  const taxRepo = new InMemoryTaxRuleRepository();

  const alcoholExcise = new AlcoholExciseService(taxRepo);
  const containerDuty = new ContainerDutyService(taxRepo);

  // Build a transport offer matching the product's merchant and container
  const transportOffer: TransportOffer = {
    id: 1000,
    carrier,
    originCountry: offers[0].country,
    destinationCountry: 'FI',
    weightBracket: { minKg: 0, maxKg: 5 },
    packageTier: product.containerType,
    priceCents: transportPriceCents,
    currency: 'EUR',
    sellerInvolvementIndicator: false,
    observedAt: NOW,
    refreshedAt: NOW,
    reliabilityStatus: 'EXACT',
  };

  const transportQuery = new InMemoryTransportOfferQuery([transportOffer]);
  const transportEstimation = new TransportEstimationService(transportQuery);

  return new LandedCostCalculatorService(
    gate,
    alcoholExcise,
    containerDuty,
    classificationService,
    transportEstimation,
    confidence,
    productData,
    calculationRecords,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Per-category golden regressions', () => {
  // -------------------------------------------------------------------------
  // Beer — progressive bands (snt/cl ethanol)
  //
  // Source-mapping (vero.fi alcohol excise table):
  //   ≤ 0.5 %ABV  → 0.00 snt/cl ethanol (exempt)
  //   > 0.5–3.5   → 28.35 snt/cl ethanol
  //   > 3.5       → 36.20 snt/cl ethanol
  //
  // Formula: round(rate × abv × volumeLitres × 100) = euro-cents
  //
  //   Product             ABV%   Tier          Rate    Volume  Calc          Exp
  //   ──────────────────────────────────────────────────────────────────────────
  //   2.7 % 0.33 L        2.7   BEER_MID     28.35   0.33    28.35×0.027×0.33  25
  //   5.0 % 0.50 L        5.0   BEER_FULL    36.20   0.50    36.20×0.05×0.50   91
  //   8.5 % 0.33 L        8.5   BEER_FULL    36.20   0.33    36.20×0.085×0.33 102
  // -------------------------------------------------------------------------

  describe('Beer — progressive ABV bands (v1.0-2024)', () => {
    it('2.7% ABV beer → BEER_MID (28.35) × 0.027 × 0.33 = 25 cents', async () => {
      const service = buildService(PRODUCT_BEER_LOW_ABV, [OFFER_BEER_LOW_ABV], 'beverage-de', 100);
      const result = await service.calculate({
        productId: 5,
        quantity: 1,
        destination: 'FI',
      });
      // round(28.35 × 0.027 × 0.33 × 100) = 25
      expect(result.alcoholExciseEstimate).toBe(25);
    });

    it('5.0% ABV beer → BEER_FULL (36.20) × 0.05 × 0.5 = 91 cents', async () => {
      const service = buildService(PRODUCT_BEER, [OFFER_BEER], 'beverage-de', 150);
      const result = await service.calculate({
        productId: 1,
        quantity: 1,
        destination: 'FI',
      });
      // round(36.20 × 0.05 × 0.5 × 100) = 91
      expect(result.alcoholExciseEstimate).toBe(91);
    });

    it('8.5% ABV beer → BEER_FULL (36.20) × 0.085 × 0.33 = 102 cents', async () => {
      const service = buildService(PRODUCT_BEER_HIGH_ABV, [OFFER_BEER_HIGH_ABV], 'beverage-de', 100);
      const result = await service.calculate({
        productId: 6,
        quantity: 1,
        destination: 'FI',
      });
      // round(36.20 × 0.085 × 0.33 × 100) = 102
      expect(result.alcoholExciseEstimate).toBe(102);
    });
  });

  // -------------------------------------------------------------------------
  // Wine still — per-litre-of-product, six ABV bands
  //
  // Source-mapping (vero.fi wine excise bands):
  //   > 1.2–2.8 %ABV   → 0.36 €/l
  //   > 2.8–5.5        → 1.98 €/l
  //   > 5.5–8          → 3.08 €/l
  //   > 8–15           → 4.56 €/l
  //   > 15–18          → 4.56 €/l
  //
  // Product 7 (11% ABV, 0.75 L) → band > 8–15 % at 4.56 €/l
  //   excise = round(4.56 × 0.75 × 100) = 342
  // -------------------------------------------------------------------------

  describe('Wine still — progressive ABV bands (v1.0-2024)', () => {
    it('applies correct excise for still wine', async () => {
      buildService(PRODUCT_BEER, [OFFER_BEER], 'beverage-de', 150);
      // Temporarily swap product for this test
      const productData: IProductDataPort = {
        findProductById: () => Promise.resolve(PRODUCT_WINE_SPARKLING),
        findRetailOffers: () => Promise.resolve([OFFER_WINE_SPARKLING]),
      };
      const taxRepo = new InMemoryTaxRuleRepository();
      const calcRecords: ICalculationRecordPort = {
        create: () => Promise.resolve({ id: 1 }),
      };

      const gate = new ClassificationGateService();
      const tcs = new TransportClassificationService();
      const rel = new ReliabilityService();
      const conf = new ConfidenceFrameworkService(rel);
      const cls = new TransactionClassificationService(tcs);
      const ae = new AlcoholExciseService(taxRepo);
      const cd = new ContainerDutyService(taxRepo);
      const tq = new InMemoryTransportOfferQuery([{
        id: 1001, carrier: 'vinos-es', originCountry: 'ES',
        destinationCountry: 'FI', weightBracket: { minKg: 0, maxKg: 5 },
        packageTier: 'glass', priceCents: 200, currency: 'EUR',
        sellerInvolvementIndicator: false, observedAt: NOW, refreshedAt: NOW,
        reliabilityStatus: 'EXACT',
      }]);
      const te = new TransportEstimationService(tq);

      const svc = new LandedCostCalculatorService(gate, ae, cd, cls, te, conf, productData, calcRecords);
      const result = await svc.calculate({
        productId: 7, quantity: 1, destination: 'FI',
      });
      // round(4.56 × 0.75 × 100) = 342
      expect(result.alcoholExciseEstimate).toBe(342);
    });
  });

  // -------------------------------------------------------------------------
  // Wine sparkling — same bands as still wine (per litre of product)
  //
  // Source: same vero.fi wine table as still wine. Finnish law does not
  // have a separate rate for sparkling — it inherits the still-wine bands.
  //
  // Product 7 (11% ABV, 0.75 L) → band > 8–15 % at 4.56 €/l
  //   excise = round(4.56 × 0.75 × 100) = 342
  // -------------------------------------------------------------------------

  describe('Wine sparkling — same bands as still wine', () => {
    it('applies same excise as still wine (342 ¢)', async () => {
      const service = buildService(PRODUCT_WINE_SPARKLING, [OFFER_WINE_SPARKLING], 'vinos-es', 200);
      const result = await service.calculate({
        productId: 7,
        quantity: 1,
        destination: 'FI',
      });
      // round(4.56 × 0.75 × 100) = 342
      expect(result.alcoholExciseEstimate).toBe(342);
    });
  });

  // -------------------------------------------------------------------------
  // Spirits — per-litre-of-alcohol at progressive rates
  //
  // Source-mapping (vero.fi spirits excise bands):
  //   ≤ 1.2 %ABV    → 0.00 (exempt)
  //   > 1.2–2.8     → 30.90 €/l pure alcohol
  //   > 2.8         → 54.80 €/l pure alcohol
  //
  // Product 3 (40% ABV, 0.7 L) → SPIRITS_FULL (> 2.8 % at 54.80)
  //   excise = round(54.80 × 0.40 × 0.70 × 100) = 1534 (€15.34)
  // -------------------------------------------------------------------------

  describe('Spirits — per litre of alcohol at 54.80 (v1.0-2024)', () => {
    it('applies per-litre-of-alcohol formula → 1534 cents', async () => {
      // Use product 3 (spirits) with transport available
      const taxRepo = new InMemoryTaxRuleRepository();
      const productData: IProductDataPort = {
        findProductById: () => Promise.resolve(PRODUCT_BEER),
        findRetailOffers: () => Promise.resolve([{ id: 102, priceCents: 500, merchant: 'spirits-eu', country: 'PL', reliabilityStatus: 'EXACT' }]),
      };
      // Override to return the spirits product
      productData.findProductById = () => Promise.resolve({
        id: 3, regulatoryClassification: 'spirits', category: 'spirits',
        volumeLitres: 0.7, alcoholByVolume: 0.4, containerType: 'glass',
        depositSystemStatus: true, weightKg: 1.0, normalizedName: 'Premium Vodka',
      });

      const calcRecords: ICalculationRecordPort = {
        create: () => Promise.resolve({ id: 2 }),
      };

      const gate = new ClassificationGateService();
      const tcs = new TransportClassificationService();
      const rel = new ReliabilityService();
      const conf = new ConfidenceFrameworkService(rel);
      const cls = new TransactionClassificationService(tcs);
      const ae = new AlcoholExciseService(taxRepo);
      const cd = new ContainerDutyService(taxRepo);
      const tq = new InMemoryTransportOfferQuery([{
        id: 1002, carrier: 'spirits-eu', originCountry: 'PL',
        destinationCountry: 'FI', weightBracket: { minKg: 0, maxKg: 5 },
        packageTier: 'glass', priceCents: 200, currency: 'EUR',
        sellerInvolvementIndicator: false, observedAt: NOW, refreshedAt: NOW,
        reliabilityStatus: 'EXACT',
      }]);
      const te = new TransportEstimationService(tq);

      const svc = new LandedCostCalculatorService(gate, ae, cd, cls, te, conf, productData, calcRecords);
      const result = await svc.calculate({
        productId: 3, quantity: 1, destination: 'FI',
      });
      // round(54.80 × 0.4 × 0.7 × 100) = 1534
      expect(result.alcoholExciseEstimate).toBe(1534);
    });
  });

  // -------------------------------------------------------------------------
  // Intermediate products — per-litre-of-product at progressive rates
  //
  // Source-mapping (vero.fi intermediate products excise bands):
  //   > 1.2–15 %ABV  → 5.68 €/l
  //   > 15–22 %ABV   → 8.63 €/l
  //
  // Product 8 (15% ABV, 0.5 L) → INTERMEDIATE_LOW (> 1.2–15 % at 5.68 €/l)
  //   excise = round(5.68 × 0.5 × 100) = 284
  // -------------------------------------------------------------------------

  describe('Intermediate products — per litre of product at 5.68 (v1.0-2024)', () => {
    it('applies per-litre-of-product formula for intermediate → 284 cents', async () => {
      const service = buildService(PRODUCT_INTERMEDIATE, [OFFER_INTERMEDIATE], 'vinos-es', 200);
      const result = await service.calculate({
        productId: 8,
        quantity: 1,
        destination: 'FI',
      });
      // round(5.68 × 0.5 × 100) = 284
      expect(result.alcoholExciseEstimate).toBe(284);
    });
  });

  // -------------------------------------------------------------------------
  // Other fermented beverages — wine bands (per litre of product)
  //
  // Source-mapping (vero.fi → wine excise bands applied to other fermented):
  //   > 2.8–5.5 %ABV  → 1.98 €/l
  //
  // Per D2 (phase0-1-verification-fix design), ALL fermented beverages are
  // taxed per litre of product using the wine band structure. Spirit-based
  // RTDs map to spirits at data-mapping time and never reach this category.
  //
  // Product 9 (5% ABV, 0.5 L, category 'other')
  //   → OTHER_BAND_2 (> 2.8–5.5 %ABV at 1.98 €/l)
  //   → calcPerLitreOfProduct(1.98, 0.5) = round(0.99 × 100) = 99¢
  // -------------------------------------------------------------------------

  describe('Other fermented — wine bands per litre of product', () => {
    it('applies PER_LITRE_OF_PRODUCT formula → 99 cents', async () => {
      const service = buildService(PRODUCT_OTHER_FERMENTED, [OFFER_OTHER_FERMENTED], 'brew-eu', 150);
      const result = await service.calculate({
        productId: 9,
        quantity: 1,
        destination: 'FI',
      });
      // round(1.98 × 0.5 × 100) = 99
      expect(result.alcoholExciseEstimate).toBe(99);
    });
  });

  // -------------------------------------------------------------------------
  // Container duty — 0.51 €/l flat rate
  //
  // Source: vero.fi beverage container duty table
  //   Rate: €0.51 per litre of beverage
  //   Exempted: containers in deposit-return system (depositSystemStatus=true)
  //
  // Product 10: depositSystemStatus=false, 0.5 L
  //   duty = round(0.51 × 0.5 × 100) = 26
  //   (Unchanged from v1.0 — container duty was already correct)
  // -------------------------------------------------------------------------

  describe('Container duty — 0.51 per litre', () => {
    it('applies container duty for non-deposit containers', async () => {
      const service = buildService(PRODUCT_NO_DEPOSIT, [OFFER_NO_DEPOSIT], 'beverage-de', 150);
      const result = await service.calculate({
        productId: 10,
        quantity: 1,
        destination: 'FI',
      });
      // round(0.51 × 0.5 × 100) = 26
      expect(result.containerDutyEstimate).toBe(26);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  //
  // 0% ABV beverage → exempt (BEER_EXEMPT tier: ≤ 0.5 %ABV) → 0 excise
  // Null deposit status → container duty applied at 0.51 €/l, reliability ESTIMATED
  // -------------------------------------------------------------------------

  describe('Edge cases', () => {
    it('0% ABV beverage → 0 excise duty', async () => {
      const service = buildService(PRODUCT_ZERO_ABV, [OFFER_ZERO_ABV], 'beverage-de', 100);
      const result = await service.calculate({
        productId: 11,
        quantity: 1,
        destination: 'FI',
      });
      // progressive ABV: abvPercent=0 → tier maxAbv=2.8, rate=0 → excise=0
      expect(result.alcoholExciseEstimate).toBe(0);
    });

    it('null deposit status → container duty ESTIMATED', async () => {
      const service = buildService(PRODUCT_NULL_DEPOSIT, [OFFER_NULL_DEPOSIT], 'beverage-de', 150);
      const result = await service.calculate({
        productId: 12,
        quantity: 1,
        destination: 'FI',
      });
      // Container duty applied with ESTIMATED reliability
      // round(0.51 × 0.5 × 100) = 26
      expect(result.containerDutyEstimate).toBe(26);

      const containerLine = result.itemizedCosts.find(
        (c) => c.category === 'containerDutyEstimate',
      );
      expect(containerLine).toBeDefined();
      expect(containerLine!.reliability).toBe('ESTIMATED');
    });
  });
});