/**
 * Golden-dataset regression tests — v1.0.
 *
 * A fixed set of known product / transport / tax input combinations with
 * manually verified expected outputs.  These tests run on every deploy and
 * every new tax-dataset version to catch regressions in the calculator,
 * classification, transport, and confidence frameworks.
 *
 * Unlike the unit tests under packages/, this suite exercises REAL tax and
 * transport engines against in-memory repositories seeded with known data.
 * There are NO `vi.fn()` mocks — every service is the production class.
 *
 * When a new tax dataset is published, the golden expected values here
 * must be re-verified manually.  Bump GOLDEN_DATASET_VERSION when any
 * expected value changes.
 *
 * @module GoldenDatasetTests
 */

import { describe, it, expect } from 'vitest';
import {
  LandedCostCalculatorService,
  ClassificationGateRejectionError,
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
  CalculatorInput,
  IProductDataPort,
  ICalculationRecordPort,
} from '@rajahinta/core-domain';

import {
  GOLDEN_DATASET_VERSION,
  PRODUCT_BEER,
  OFFER_BEER,
  PRODUCT_WINE,
  OFFER_WINE,
  PRODUCT_SPIRITS,
  OFFER_SPIRITS,
  PRODUCT_UNCLASSIFIED,
  OFFER_UNCLASSIFIED,
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

function createCalculationRecordPort(id = 9000): ICalculationRecordPort {
  return {
    create: () => Promise.resolve({ id }),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a LandedCostCalculatorService wired with REAL engines and
 * in-memory data ports (no vi.fn() mocks).
 */
function createGoldenService(options: {
  product: typeof PRODUCT_BEER;
  offers: typeof OFFER_BEER[];
  /** Transport offers to seed for the carrier, or empty array for REJECT. */
  transportOffers: TransportOffer[];
  transportCarrier?: string;
}): LandedCostCalculatorService {
  // Pure-logic services (zero I/O)
  const gate = new ClassificationGateService();
  const transportClassification = new TransportClassificationService();
  const reliability = new ReliabilityService();
  const confidence = new ConfidenceFrameworkService(reliability);
  const classificationService = new TransactionClassificationService(
    transportClassification,
  );

  // Port stubs
  const productData = createProductDataPort(options.product, options.offers);
  const calculationRecords = createCalculationRecordPort();

  // In-memory repositories
  const taxRepo = new InMemoryTaxRuleRepository();

  // Real engines (production classes, zero mocking)
  const alcoholExcise = new AlcoholExciseService(taxRepo);
  const containerDuty = new ContainerDutyService(taxRepo);
  const transportOffers = new InMemoryTransportOfferQuery(options.transportOffers);
  const transportEstimation = new TransportEstimationService(transportOffers);

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
// Seed transport offers
// ---------------------------------------------------------------------------

const NOW = new Date();

/** Offer for carrierA: DE → FI, can/parcel up to 1 kg, seller involved. */
const OFFER_CARRIER_A: TransportOffer = {
  id: 900,
  carrier: 'carrierA',
  originCountry: 'DE',
  destinationCountry: 'FI',
  weightBracket: { minKg: 0, maxKg: 1 },
  packageTier: 'can',
  priceCents: 150,
  currency: 'EUR',
  sellerInvolvementIndicator: true,
  observedAt: NOW,
  refreshedAt: NOW,
  reliabilityStatus: 'EXACT',
};

/** Offer for carrierB: ES → FI, glass up to 2 kg, independent. */
const OFFER_CARRIER_B: TransportOffer = {
  id: 901,
  carrier: 'carrierB',
  originCountry: 'ES',
  destinationCountry: 'FI',
  weightBracket: { minKg: 0, maxKg: 2 },
  packageTier: 'glass',
  priceCents: 200,
  currency: 'EUR',
  sellerInvolvementIndicator: false,
  observedAt: NOW,
  refreshedAt: NOW,
  reliabilityStatus: 'EXACT',
};

// ---------------------------------------------------------------------------
// Expected value computation reference (seeded rates):
//
// Beer  (5% ABV, 0.5 L) → PER_DEGREE_PLATO at 33.00
//   excise = round(33.00 × 0.05 × 0.5 × 100) = 83 ¢
//   container: depositSystemStatus=true → EXEMPTED → 0 ¢
//
// Wine  (12% ABV, 0.75 L) → per-litre-of-product, 3.40
//   excise = round(3.40 × 0.75 × 100) = 255 ¢
//   container: depositSystemStatus=true → EXEMPTED → 0 ¢
//
// Spirits  (40% ABV, 0.7 L) → per-litre-of-alcohol, 29.50
//   excise = round(29.50 × 0.4 × 0.7 × 100) = 826 ¢
//   container: depositSystemStatus=true → EXEMPTED → 0 ¢
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Golden dataset version guard
// ---------------------------------------------------------------------------

describe('Golden dataset', () => {
  it(`has dataset version ${GOLDEN_DATASET_VERSION}`, () => {
    expect(GOLDEN_DATASET_VERSION).toBe('1.0');
  });

  // -----------------------------------------------------------------------
  // Case 1: Beer, 1 unit, Distance Selling (retailer-arranged transport)
  // -----------------------------------------------------------------------

  describe('Case 1 — Beer, qty=1, Distance Selling', () => {
    const INPUT: CalculatorInput = {
      productId: 1,
      quantity: 1,
      destination: 'FI',
      transportMethod: 'carrierA',
    };

    const service = createGoldenService({
      product: PRODUCT_BEER,
      offers: [OFFER_BEER],
      transportOffers: [OFFER_CARRIER_A],
    });

    it('returns correct total cost', async () => {
      const result = await service.calculate(INPUT);
      // retail(200) + transport(150) + excise(83) + container(0) + other(0)
      expect(result.totalCents).toBe(433);
    });

    it('applies correct itemized costs', async () => {
      const result = await service.calculate(INPUT);
      expect(result.foreignRetailPrice).toBe(200);
      expect(result.transportCost).toBe(150);
      expect(result.alcoholExciseEstimate).toBe(83);
      expect(result.containerDutyEstimate).toBe(0);
      expect(result.otherCharges).toBe(0);
    });

    it('classifies as DistanceSelling (retailer-arranged)', async () => {
      const result = await service.calculate(INPUT);
      expect(result.classification.classification).toBe('DistanceSelling');
      expect(result.classification.confidence).toBe('HIGH');
    });

    it('has HIGH confidence (all components VERIFIED)', async () => {
      const result = await service.calculate(INPUT);
      // excise is VERIFIED (seed data with verificationDate); all others VERIFIED → HIGH
      expect(result.confidence).toBe('HIGH');
    });

    it('persists calculation record', async () => {
      const result = await service.calculate(INPUT);
      expect(result.calculationRecordId).toBe(9000);
    });
  });

  // -----------------------------------------------------------------------
  // Case 2: Wine, 3 units, Distance Buying (independent carrier)
  // -----------------------------------------------------------------------

  describe('Case 2 — Wine, qty=3, Distance Buying', () => {
    const INPUT: CalculatorInput = {
      productId: 2,
      quantity: 3,
      destination: 'FI',
      transportMethod: 'carrierB',
    };

    const service = createGoldenService({
      product: PRODUCT_WINE,
      offers: [OFFER_WINE],
      transportOffers: [OFFER_CARRIER_B],
    });

    it('applies quantity multiplier to retail price', async () => {
      const result = await service.calculate(INPUT);
      // unit price 300 × 3
      expect(result.foreignRetailPrice).toBe(900);
    });

    it('applies quantity multiplier to tax costs', async () => {
      const result = await service.calculate(INPUT);
      // excise 255 × 3, container 0 × 3
      expect(result.alcoholExciseEstimate).toBe(765);
      expect(result.containerDutyEstimate).toBe(0);
    });

    it('returns correct total cost', async () => {
      const result = await service.calculate(INPUT);
      // retail(900) + transport(200) + excise(765) + container(0)
      expect(result.totalCents).toBe(1865);
    });

    it('classifies as DistanceBuying (independent carrier)', async () => {
      const result = await service.calculate(INPUT);
      expect(result.classification.classification).toBe('DistanceBuying');
    });

    it('has HIGH confidence (all components VERIFIED)', async () => {
      const result = await service.calculate(INPUT);
      expect(result.confidence).toBe('HIGH');
    });

    it('transport is not per-shipment — not scaled by quantity', async () => {
      const result = await service.calculate(INPUT);
      expect(result.transportCost).toBe(200);
    });
  });

  // -----------------------------------------------------------------------
  // Case 3: Spirits, 1 unit, Transport unavailable
  // -----------------------------------------------------------------------

  describe('Case 3 — Spirits, qty=1, transport unavailable', () => {
    const INPUT: CalculatorInput = {
      productId: 3,
      quantity: 1,
      destination: 'FI',
    };

    const service = createGoldenService({
      product: PRODUCT_SPIRITS,
      offers: [OFFER_SPIRITS],
      transportOffers: [], // no transport offers → graceful degradation
    });

    it('returns zero transport cost when transport is unavailable', async () => {
      const result = await service.calculate(INPUT);
      expect(result.transportCost).toBe(0);
    });

    it('returns correct total cost (excluding transport)', async () => {
      const result = await service.calculate(INPUT);
      // retail(500) + transport(0) + excise(826) + container(0)
      expect(result.totalCents).toBe(1326);
    });

    it('sets transport offer ID to null', async () => {
      const result = await service.calculate(INPUT);
      expect(result.metadata.transportOfferId).toBeNull();
    });

    it('classifies with INDEPENDENT_CARRIER transport type', async () => {
      const result = await service.calculate(INPUT);
      // transport unavailable → sellerInvolvement=false,
      // carrierId=offer.merchant='spirits-eu' → INDEPENDENT_CARRIER → DistanceBuying
      expect(result.classification.classification).toBe('DistanceBuying');
    });

    it('has LOW confidence (transport UNAVAILABLE)', async () => {
      const result = await service.calculate(INPUT);
      // transport is UNAVAILABLE → LOW
      expect(result.confidence).toBe('LOW');
    });
  });

  // -----------------------------------------------------------------------
  // Case 4: Product without regulatory classification (gate rejection)
  // -----------------------------------------------------------------------

  describe('Case 4 — Unclassified product (gate rejection)', () => {
    const INPUT: CalculatorInput = {
      productId: 4,
      quantity: 1,
      destination: 'FI',
    };

    const service = createGoldenService({
      product: PRODUCT_UNCLASSIFIED,
      offers: [OFFER_UNCLASSIFIED],
      transportOffers: [],
    });

    it('throws ClassificationGateRejectionError', async () => {
      await expect(service.calculate(INPUT)).rejects.toThrow(
        ClassificationGateRejectionError,
      );
    });

    it('includes productId and reason in error', async () => {
      try {
        await service.calculate(INPUT);
        // Force fail — should never reach here
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ClassificationGateRejectionError);
        const gateError = err as ClassificationGateRejectionError;
        expect(gateError.productId).toBe(4);
        expect(gateError.reason).toContain('classification');
      }
    });
  });
});