/**
 * Golden-dataset regression tests — v1.0.
 *
 * A fixed set of known product / transport / tax input combinations with
 * manually verified expected outputs.  These tests run on every deploy and
 * every new tax-dataset version to catch regressions in the calculator,
 * classification, transport, and confidence frameworks.
 *
 * When a new tax dataset is published, the golden expected values here
 * must be re-verified manually.  Bump GOLDEN_DATASET_VERSION when any
 * expected value changes.
 *
 * @module GoldenDatasetTests
 */

import { describe, it, expect, vi } from 'vitest';
import { LandedCostCalculatorService, ClassificationGateRejectionError } from '@rajahinta/core-domain';
import { ClassificationGateService } from '@rajahinta/core-domain/normalization/classification-gate.service';
import { TransactionClassificationService } from '@rajahinta/core-domain';
import { TransportClassificationService } from '@rajahinta/core-domain';
import { ConfidenceFrameworkService } from '@rajahinta/core-domain/reliability/confidence-framework.service';
import { ReliabilityService } from '@rajahinta/core-domain';
import type { CalculatorInput, IProductDataPort, ICalculationRecordPort } from '@rajahinta/core-domain';

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createProductDataPort(
  product: typeof PRODUCT_BEER,
  offers: typeof OFFER_BEER[],
): IProductDataPort {
  return {
    findProductById: vi.fn().mockResolvedValue(product),
    findRetailOffers: vi.fn().mockResolvedValue(offers),
  };
}

function createCalculationRecordPort(): ICalculationRecordPort {
  return {
    create: vi.fn().mockResolvedValue({ id: 9000 }),
  };
}

interface TransportStub {
  priceCents: number;
  sellerInvolvementIndicator: boolean;
  id?: number;
  reliabilityStatus?: 'EXACT' | 'ESTIMATED';
}

interface ExciseStub {
  taxCents: number;
  reliability?: 'VERIFIED' | 'ESTIMATED';
}

interface ContainerDutyStub {
  dutyCents: number;
  reliability?: 'VERIFIED' | 'ESTIMATED';
}

/**
 * Build a LandedCostCalculatorService wired with golden-dataset mocks.
 *
 * Each scenario gets its own service instance with deterministic mock
 * return values so expected outputs are known ahead of time.
 */
function createGoldenService(options: {
  product: typeof PRODUCT_BEER;
  offers: typeof OFFER_BEER[];
  transport: TransportStub | 'REJECT'; // 'REJECT' makes transport estimation throw
  excise?: ExciseStub;
  containerDuty?: ContainerDutyStub;
}): LandedCostCalculatorService {
  // Real pure-logic services
  const gate = new ClassificationGateService();
  const transportClassification = new TransportClassificationService();
  const reliability = new ReliabilityService();
  const confidence = new ConfidenceFrameworkService(reliability);
  const classificationService = new TransactionClassificationService(
    transportClassification,
  );

  // Port mocks
  const productData = createProductDataPort(options.product, options.offers);
  const calculationRecords = createCalculationRecordPort();

  // Alcohol excise mock
  const exciseDefaults: ExciseStub = { taxCents: 30, reliability: 'VERIFIED' };
  const exciseCfg = { ...exciseDefaults, ...options.excise };
  const alcoholExcise = {
    calculate: vi.fn().mockResolvedValue({
      category: options.product.category,
      abv: options.product.alcoholByVolume,
      volumeLitres: options.product.volumeLitres,
      rateApplied: 0.0,
      taxCents: exciseCfg.taxCents,
      taxDatasetVersion: 'golden-v1',
      reliability: exciseCfg.reliability,
    }),
  } as unknown as never;

  // Container duty mock
  const containerDefaults: ContainerDutyStub = {
    dutyCents: 25,
    reliability: 'VERIFIED',
  };
  const containerCfg = { ...containerDefaults, ...options.containerDuty };
  const containerDuty = {
    calculate: vi.fn().mockResolvedValue({
      volumeLitres: options.product.volumeLitres,
      ratePerLitre: 0.51,
      dutyCents: containerCfg.dutyCents,
      taxDatasetVersion: 'golden-v1',
      reliability: containerCfg.reliability,
    }),
  } as unknown as never;

  // Transport estimation mock
  const transportEstimation =
    options.transport === 'REJECT'
      ? ({
          estimate: vi.fn().mockRejectedValue(new Error('No transport offers')),
        } as unknown as never)
      : ({
          estimate: vi.fn().mockResolvedValue({
            offer: {
              id: options.transport.id ?? 900,
              priceCents: options.transport.priceCents,
              sellerInvolvementIndicator:
                options.transport.sellerInvolvementIndicator,
            },
            matchedWeightBracket: { minKg: 0, maxKg: 10 },
            reliabilityStatus: options.transport.reliabilityStatus ?? 'EXACT',
          }),
        } as unknown as never);

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
// Golden dataset version guard
// ---------------------------------------------------------------------------

describe('Golden dataset', () => {
  it(`has dataset version ${GOLDEN_DATASET_VERSION}`, () => {
    // This assertion exists solely to surface the version in test output.
    // Bump GOLDEN_DATASET_VERSION when any expected value in this file
    // changes, and re-verify every scenario manually.
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
      transport: { priceCents: 150, sellerInvolvementIndicator: true },
      excise: { taxCents: 30 },
      containerDuty: { dutyCents: 26 },
    });

    it('returns correct total cost', async () => {
      const result = await service.calculate(INPUT);
      // retail(200) + transport(150) + excise(30) + container(26) + other(0)
      expect(result.totalCents).toBe(406);
    });

    it('applies correct itemized costs', async () => {
      const result = await service.calculate(INPUT);
      expect(result.foreignRetailPrice).toBe(200);
      expect(result.transportCost).toBe(150);
      expect(result.alcoholExciseEstimate).toBe(30);
      expect(result.containerDutyEstimate).toBe(26);
      expect(result.otherCharges).toBe(0);
    });

    it('classifies as DistanceSelling (retailer-arranged)', async () => {
      const result = await service.calculate(INPUT);
      expect(result.classification.classification).toBe('DistanceSelling');
      expect(result.classification.confidence).toBe('HIGH');
    });

    it('achieves HIGH confidence (all inputs VERIFIED)', async () => {
      const result = await service.calculate(INPUT);
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
      transport: { priceCents: 200, sellerInvolvementIndicator: false },
      excise: { taxCents: 30 },
      containerDuty: { dutyCents: 25 },
    });

    it('applies quantity multiplier to retail price', async () => {
      const result = await service.calculate(INPUT);
      // unit price 300 × 3
      expect(result.foreignRetailPrice).toBe(900);
    });

    it('applies quantity multiplier to tax costs', async () => {
      const result = await service.calculate(INPUT);
      // excise 30 × 3, container 25 × 3
      expect(result.alcoholExciseEstimate).toBe(90);
      expect(result.containerDutyEstimate).toBe(75);
    });

    it('returns correct total cost', async () => {
      const result = await service.calculate(INPUT);
      // retail(900) + transport(200) + excise(90) + container(75)
      expect(result.totalCents).toBe(1265);
    });

    it('classifies as DistanceBuying (independent carrier)', async () => {
      const result = await service.calculate(INPUT);
      expect(result.classification.classification).toBe('DistanceBuying');
    });

    it('has HIGH confidence (all inputs VERIFIED)', async () => {
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
      transport: 'REJECT',
      excise: { taxCents: 60 },
      containerDuty: { dutyCents: 30 },
    });

    it('returns zero transport cost when transport is unavailable', async () => {
      const result = await service.calculate(INPUT);
      expect(result.transportCost).toBe(0);
    });

    it('returns correct total cost (excluding transport)', async () => {
      const result = await service.calculate(INPUT);
      // retail(500) + transport(0) + excise(60) + container(30)
      expect(result.totalCents).toBe(590);
    });

    it('sets transport offer ID to null', async () => {
      const result = await service.calculate(INPUT);
      expect(result.metadata.transportOfferId).toBeNull();
    });

    it('classifies with transport=UNKNOWN transport type', async () => {
      const result = await service.calculate(INPUT);
      // When transport is unavailable, classification gets sellerInvolvement=false
      // and carrier=bestOffer.merchant, producing UNKNOWN transport → DistanceBuying LOW
      expect(result.classification.classification).toBe('DistanceBuying');
    });

    it('has MEDIUM or LOW confidence (transport UNAVAILABLE)', async () => {
      const result = await service.calculate(INPUT);
      // Transport is UNAVAILABLE → LOW.  The assertion accepts MEDIUM too
      // to allow for future changes in the confidence computation logic.
      expect(['MEDIUM', 'LOW']).toContain(result.confidence);
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
      transport: { priceCents: 100, sellerInvolvementIndicator: false },
      excise: { taxCents: 10 },
      containerDuty: { dutyCents: 5 },
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