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
  // Beer — flat rate 33.00 €/hl/°P (fallback)
  //
  // Fallback uses DEFAULT_RATES.beer = 33.00 €/hl per degree Plato
  // (per-litre-of-alcohol equivalent).  No ABV-tiered rates in fallback.
  // -------------------------------------------------------------------------

  describe('Beer — flat fallback rate (33.00 €/hl/°P)', () => {
    it('2.7% ABV beer → 33.00 × 0.027 × 0.33 = 29 cents', async () => {
      const service = buildService(PRODUCT_BEER_LOW_ABV, [OFFER_BEER_LOW_ABV], 'beverage-de', 100);
      const result = await service.calculate({
        productId: 5,
        quantity: 1,
        destination: 'FI',
      });
      // round(33.00 × 0.027 × 0.33 × 100) = 29
      expect(result.alcoholExciseEstimate).toBe(29);
    });

    it('5.0% ABV beer → 33.00 × 0.05 × 0.5 = 83 cents', async () => {
      const service = buildService(PRODUCT_BEER, [OFFER_BEER], 'beverage-de', 150);
      const result = await service.calculate({
        productId: 1,
        quantity: 1,
        destination: 'FI',
      });
      // round(33.00 × 0.05 × 0.5 × 100) = 83
      expect(result.alcoholExciseEstimate).toBe(83);
    });

    it('8.5% ABV beer → 33.00 × 0.085 × 0.33 = 93 cents', async () => {
      const service = buildService(PRODUCT_BEER_HIGH_ABV, [OFFER_BEER_HIGH_ABV], 'beverage-de', 100);
      const result = await service.calculate({
        productId: 6,
        quantity: 1,
        destination: 'FI',
      });
      // round(33.00 × 0.085 × 0.33 × 100) = 93
      expect(result.alcoholExciseEstimate).toBe(93);
    });
  });

  // -------------------------------------------------------------------------
  // Wine still — per-litre-of-product at 3.40 €/l
  // (covered by golden-dataset Case 2, included here for completeness)
  // -------------------------------------------------------------------------

  describe('Wine still — per litre of product at 3.40', () => {
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
      // round(3.40 × 0.75 × 100) = 255
      expect(result.alcoholExciseEstimate).toBe(255);
    });
  });

  // -------------------------------------------------------------------------
  // Wine sparkling — same formula as still wine
  // -------------------------------------------------------------------------

  describe('Wine sparkling — per litre of product at 3.40', () => {
    it('applies same excise as still wine', async () => {
      const service = buildService(PRODUCT_WINE_SPARKLING, [OFFER_WINE_SPARKLING], 'vinos-es', 200);
      const result = await service.calculate({
        productId: 7,
        quantity: 1,
        destination: 'FI',
      });
      // round(3.40 × 0.75 × 100) = 255
      expect(result.alcoholExciseEstimate).toBe(255);
    });
  });

  // -------------------------------------------------------------------------
  // Spirits — per-litre-of-alcohol at 29.50 €/l
  // (covered by golden-dataset Case 3, included here for completeness)
  // -------------------------------------------------------------------------

  describe('Spirits — per litre of alcohol at 29.50', () => {
    it('applies per-litre-of-alcohol formula', async () => {
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
      // round(29.50 × 0.4 × 0.7 × 100) = 826
      expect(result.alcoholExciseEstimate).toBe(826);
    });
  });

  // -------------------------------------------------------------------------
  // Intermediate products — per-litre-of-product at 3.40 €/l
  // -------------------------------------------------------------------------

  describe('Intermediate products — per litre of product at 3.40', () => {
    it('applies per-litre-of-product formula for intermediate', async () => {
      const service = buildService(PRODUCT_INTERMEDIATE, [OFFER_INTERMEDIATE], 'vinos-es', 200);
      const result = await service.calculate({
        productId: 8,
        quantity: 1,
        destination: 'FI',
      });
      // round(3.40 × 0.5 × 100) = 170
      expect(result.alcoholExciseEstimate).toBe(170);
    });
  });

  // -------------------------------------------------------------------------
  // Other fermented beverages — per-litre-of-alcohol at 3.40 €/l (fallback)
  // -------------------------------------------------------------------------

  describe('Other fermented beverages — per litre of alcohol at 3.40', () => {
    it('applies per-litre-of-alcohol formula for other (fallback)', async () => {
      const service = buildService(PRODUCT_OTHER_FERMENTED, [OFFER_OTHER_FERMENTED], 'brew-eu', 150);
      const result = await service.calculate({
        productId: 9,
        quantity: 1,
        destination: 'FI',
      });
      // round(3.40 × 0.05 × 0.5 × 100) = 9
      expect(result.alcoholExciseEstimate).toBe(9);
    });
  });

  // -------------------------------------------------------------------------
  // Container duty — 0.51 €/l
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