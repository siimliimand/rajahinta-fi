/**
 * PriceObservationRecorderService tests.
 *
 * High-liability coverage for the observation recorder:
 *   - Tax-rule version resolution at observedAt (asOf propagation)
 *   - Engine reuse — landed cost equals the engines' outputs combined the
 *     same way the calculator combines them at quantity=1
 *   - Per-input reliability snapshot (including degradation paths)
 *   - Transport-offer selection and graceful unavailability
 *   - Calculator-parity errors (gate rejection, product not found)
 *   - Append-only persistence contract (single append, returned id)
 */

import { describe, it, expect, vi } from 'vitest';
import { PriceObservationRecorderService } from '../price-observation-recorder.service';
import { ClassificationGateService } from '../../normalization/classification-gate.service';
import { AlcoholExciseService } from '../../tax/services/alcohol-excise.service';
import { ContainerDutyService } from '../../tax/services/container-duty.service';
import { TransportEstimationService } from '../../transport/transport-estimation.service';
import { ConfidenceFrameworkService } from '../../reliability/confidence-framework.service';
import { ReliabilityService } from '../../reliability/reliability.service';
import type { IProductDataPort } from '../../calculator/calculator.types';
import type { IPriceObservationPort } from '../price-observation.port';
import type { CalculatorProductData, CalculatorRetailOfferData } from '../../calculator/calculator.types';
import {
  ClassificationGateRejectionError,
  ProductNotFoundError,
} from '../../calculator/calculator.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OBSERVED_AT = new Date('2026-08-20T12:00:00.000Z');

const DEFAULT_PRODUCT: CalculatorProductData = {
  id: 7,
  regulatoryClassification: 'beer',
  category: 'beer',
  volumeLitres: 0.5,
  alcoholByVolume: 0.05,
  containerType: 'can',
  depositSystemStatus: true,
  weightKg: 0.55,
  normalizedName: 'Test Beer 5%',
};

const DEFAULT_OFFER: CalculatorRetailOfferData = {
  id: 100,
  priceCents: 200,
  merchant: 'test-merchant-de',
  country: 'DE',
  reliabilityStatus: 'VERIFIED',
};

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

function createMockProductDataPort(
  overrides?: Partial<IProductDataPort>,
): IProductDataPort {
  return {
    findProductById: vi.fn().mockResolvedValue(DEFAULT_PRODUCT),
    ...overrides,
  } as IProductDataPort;
}

function createMockObservationPort(
  overrides?: Partial<IPriceObservationPort>,
): IPriceObservationPort {
  return {
    append: vi.fn().mockResolvedValue({ id: 555 }),
    ...overrides,
  } as IPriceObservationPort;
}

/**
 * Create the recorder with real pure services (gate, confidence framework)
 * and mocked engines/ports, mirroring the calculator test conventions.
 */
function createRecorder(options?: {
  productData?: IProductDataPort;
  observations?: IPriceObservationPort;
  exciseResult?: Record<string, unknown>;
  containerDutyResult?: Record<string, unknown>;
  transportEstimate?: ReturnType<typeof vi.fn>;
}): {
  service: PriceObservationRecorderService;
  mocks: {
    productData: IProductDataPort;
    observations: IPriceObservationPort;
    transportEstimation: TransportEstimationService;
    alcoholExcise: AlcoholExciseService;
    containerDuty: ContainerDutyService;
  };
} {
  const alcoholExcise = {
    calculate: vi.fn().mockResolvedValue({
      category: 'beer',
      abv: 0.05,
      volumeLitres: 0.5,
      rateApplied: 38.35,
      taxCents: 30,
      taxDatasetVersion: 'excise-2024-01',
      reliability: 'VERIFIED' as const,
      ruleId: 11,
      ...options?.exciseResult,
    }),
  } as unknown as AlcoholExciseService;

  const containerDuty = {
    calculate: vi.fn().mockResolvedValue({
      volumeLitres: 0.5,
      ratePerLitre: 0.51,
      dutyCents: 26,
      taxDatasetVersion: 'container-2024-01',
      reliability: 'VERIFIED' as const,
      ruleId: 12,
      ...options?.containerDutyResult,
    }),
  } as unknown as ContainerDutyService;

  const transportEstimation = {
    estimate:
      options?.transportEstimate ??
      vi.fn().mockResolvedValue({
        offer: { id: 200, priceCents: 150, sellerInvolvementIndicator: false },
        matchedWeightBracket: { minKg: 0, maxKg: 1 },
        reliabilityStatus: 'VERIFIED' as const,
      }),
  } as unknown as TransportEstimationService;

  const productData = options?.productData ?? createMockProductDataPort();
  const observations = options?.observations ?? createMockObservationPort();

  const service = new PriceObservationRecorderService(
    new ClassificationGateService(),
    alcoholExcise,
    containerDuty,
    transportEstimation,
    new ConfidenceFrameworkService(new ReliabilityService()),
    productData,
    observations,
  );

  return {
    service,
    mocks: { productData, observations, transportEstimation, alcoholExcise, containerDuty },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PriceObservationRecorderService', () => {
  describe('observation assembly', () => {
    it('appends a self-contained observation with id', async () => {
      const { service, mocks } = createRecorder();

      const result = await service.record({
        productId: 7,
        offer: DEFAULT_OFFER,
        observedAt: OBSERVED_AT,
      });

      expect(mocks.observations.append).toHaveBeenCalledTimes(1);
      expect(result.id).toBe(555);

      // Identity and provenance
      expect(result.productId).toBe(7);
      expect(result.merchant).toBe('test-merchant-de');
      expect(result.retailOfferId).toBe(100);
      expect(result.observedAt).toBe(OBSERVED_AT);
      expect(result.foreignRetailPriceCents).toBe(200);

      // Transport selection
      expect(result.transportOfferId).toBe(200);
      expect(result.transportCostCents).toBe(150);

      // Tax rule version snapshots from the engine results
      expect(result.exciseRuleVersion).toEqual({
        ruleId: 11,
        versionLabel: 'excise-2024-01',
      });
      expect(result.containerDutyRuleVersion).toEqual({
        ruleId: 12,
        versionLabel: 'container-2024-01',
      });
    });

    it('computes the quantity=1 baseline from the engine outputs (calculator composition)', async () => {
      // Engine outputs chosen so each component is distinguishable.
      const { service } = createRecorder({
        exciseResult: { taxCents: 30, ruleId: 11 },
        containerDutyResult: { dutyCents: 26, ruleId: 12 },
      });

      const result = await service.record({
        productId: 7,
        offer: DEFAULT_OFFER, // retail 200
        observedAt: OBSERVED_AT,
      });

      // retail (200) + excise (30) + container duty (26) + transport (150)
      expect(result.landedCostCents).toBe(406);
    });
  });

  describe('tax-version resolution at observedAt', () => {
    it('passes observedAt as the effective date to both tax engines', async () => {
      const { service, mocks } = createRecorder();

      await service.record({
        productId: 7,
        offer: DEFAULT_OFFER,
        observedAt: OBSERVED_AT,
      });

      expect(mocks.alcoholExcise.calculate).toHaveBeenCalledWith(
        'beer',
        0.05,
        0.5,
        OBSERVED_AT,
      );
      expect(mocks.containerDuty.calculate).toHaveBeenCalledWith(
        0.5,
        'can',
        true,
        OBSERVED_AT,
      );
    });

    it('snapshots null rule versions when an engine falls back to defaults', async () => {
      const { service } = createRecorder({
        exciseResult: { ruleId: null, taxDatasetVersion: 'FALLBACK', reliability: 'ESTIMATED' },
        containerDutyResult: { ruleId: null, taxDatasetVersion: 'FALLBACK', reliability: 'ESTIMATED' },
      });

      const result = await service.record({
        productId: 7,
        offer: DEFAULT_OFFER,
        observedAt: OBSERVED_AT,
      });

      expect(result.exciseRuleVersion).toBeNull();
      expect(result.containerDutyRuleVersion).toBeNull();
      expect(result.inputReliability.exciseRule).toBe('ESTIMATED');
      expect(result.inputReliability.containerDutyRule).toBe('ESTIMATED');
    });
  });

  describe('transport offer selection', () => {
    it('selects the current offer for merchant route to FI with product attributes', async () => {
      const { service, mocks } = createRecorder();

      await service.record({
        productId: 7,
        offer: DEFAULT_OFFER,
        observedAt: OBSERVED_AT,
      });

      expect(mocks.transportEstimation.estimate).toHaveBeenCalledWith(
        'test-merchant-de',
        'DE',
        'FI',
        0.55,
        'can',
      );
    });

    it('degrades gracefully when no transport offer matches', async () => {
      const { service } = createRecorder({
        transportEstimate: vi.fn().mockRejectedValue(new Error('No transport offers')),
      });

      const result = await service.record({
        productId: 7,
        offer: DEFAULT_OFFER,
        observedAt: OBSERVED_AT,
      });

      expect(result.transportOfferId).toBeNull();
      expect(result.transportCostCents).toBe(0);
      expect(result.inputReliability.transport).toBe('UNAVAILABLE');
      // 200 retail + 30 excise + 26 duty + 0 transport
      expect(result.landedCostCents).toBe(256);
      // An UNAVAILABLE input forces LOW confidence — never overstated
      expect(result.confidence).toBe('LOW');
    });
  });

  describe('reliability snapshot and confidence', () => {
    it('snapshots all four inputs and derives HIGH confidence when all VERIFIED', async () => {
      const { service } = createRecorder();

      const result = await service.record({
        productId: 7,
        offer: DEFAULT_OFFER,
        observedAt: OBSERVED_AT,
      });

      expect(result.inputReliability).toEqual({
        retailPrice: 'VERIFIED',
        transport: 'VERIFIED',
        exciseRule: 'VERIFIED',
        containerDutyRule: 'VERIFIED',
      });
      expect(result.confidence).toBe('HIGH');
    });

    it('propagates STALE offer status into the retail-price input', async () => {
      const { service } = createRecorder();

      const result = await service.record({
        productId: 7,
        offer: { ...DEFAULT_OFFER, reliabilityStatus: 'STALE' },
        observedAt: OBSERVED_AT,
      });

      expect(result.inputReliability.retailPrice).toBe('STALE');
      expect(result.confidence).toBe('LOW');
    });

    it('degrades unknown legacy status values to ESTIMATED — never overstated', async () => {
      const { service } = createRecorder();

      const result = await service.record({
        productId: 7,
        offer: { ...DEFAULT_OFFER, reliabilityStatus: 'EXACT' as never },
        observedAt: OBSERVED_AT,
      });

      expect(result.inputReliability.retailPrice).toBe('ESTIMATED');
      expect(result.confidence).toBe('MEDIUM');
    });
  });

  describe('calculator-parity errors', () => {
    it('throws ProductNotFoundError and appends nothing for an unknown product', async () => {
      const { service, mocks } = createRecorder({
        productData: createMockProductDataPort({
          findProductById: vi.fn().mockResolvedValue(null),
        }),
      });

      await expect(
        service.record({ productId: 404, offer: DEFAULT_OFFER, observedAt: OBSERVED_AT }),
      ).rejects.toThrow(ProductNotFoundError);
      expect(mocks.observations.append).not.toHaveBeenCalled();
    });

    it('rejects unclassified products — never records a baseline the calculator would refuse', async () => {
      const { service, mocks } = createRecorder({
        productData: createMockProductDataPort({
          findProductById: vi.fn().mockResolvedValue({
            ...DEFAULT_PRODUCT,
            regulatoryClassification: null,
          }),
        }),
      });

      await expect(
        service.record({ productId: 7, offer: DEFAULT_OFFER, observedAt: OBSERVED_AT }),
      ).rejects.toThrow(ClassificationGateRejectionError);
      expect(mocks.observations.append).not.toHaveBeenCalled();
    });
  });

  describe('append-only persistence contract', () => {
    it('appends exactly once per recorded observation', async () => {
      const { service, mocks } = createRecorder();

      await service.record({ productId: 7, offer: DEFAULT_OFFER, observedAt: OBSERVED_AT });

      expect(mocks.observations.append).toHaveBeenCalledTimes(1);
      const appended = (mocks.observations.append as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(appended).toMatchObject({
        productId: 7,
        retailOfferId: 100,
        observedAt: OBSERVED_AT,
      });
    });
  });
});
