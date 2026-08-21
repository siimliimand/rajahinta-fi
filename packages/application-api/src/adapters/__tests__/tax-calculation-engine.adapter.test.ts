/**
 * TaxCalculationEngineAdapter tests.
 *
 * Verifies correct delegation from the adapter surface (calculateExcise,
 * calculateContainerDuty, calculateLandedCost) to the underlying
 * LandedCostCalculatorService.
 *
 * These are high-liability tests because the adapter is the bridge between
 * the abstract TaxCalculationEngine interface and the concrete calculator.
 * Any mismatch in field extraction or default construction would propagate
 * silently to consumers (CalculationController, legacy engine clients).
 *
 * @module TaxCalculationEngineAdapterTest
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaxCalculationEngineAdapter } from '../tax-calculation-engine.adapter';
import type {
  LandedCostCalculatorService,
  CalculatorResult,
  ExciseBase,
  ContainerDutyRequest,
  TransactionClass,
  ExciseCategory,
  ContainerType,
} from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEFAULT_EXCISE_BASE: ExciseBase = {
  category: 'beer' as ExciseCategory,
  volumeLitres: 0.5,
  alcoholByVolume: 0.05,
};

const DEFAULT_CONTAINER_DUTY_REQUEST: ContainerDutyRequest = {
  containerType: 'can' as ContainerType,
  volumeLitres: 0.5,
  depositSystemVerified: true,
};

const DEFAULT_TRANSACTION_CLASS: TransactionClass = 'distance-selling';

/** Template result that the mock calculator returns. */
function createMockCalculatorResult(overrides?: Partial<CalculatorResult>): CalculatorResult {
  return {
    itemizedCosts: [],
    foreignRetailPrice: 200,
    transportCost: 150,
    alcoholExciseEstimate: 30,
    containerDutyEstimate: 26,
    otherCharges: 0,
    totalCents: 406,
    currency: 'EUR',
    confidence: 'HIGH',
    confidenceBreakdown: [],
    disclaimer: { text: '', language: 'fi', version: '1.0' },
    classification: {
      classification: 'DistanceSelling',
      confidence: 'HIGH',
      evidence: [],
      evidenceSummary: '',
    },
    metadata: {
      input: { productId: 0, quantity: 1, destination: 'FI' },
      calculationTimestamp: new Date().toISOString(),
      productMasterId: 0,
      retailOfferIds: [],
      quantity: 1,
      destination: 'FI',
      productName: '',
      volumeLitres: 0.5,
      alcoholByVolume: 0.05,
      category: '',
      datasetVersions: [],
      transportOfferId: null,
    },
    calculationRecordId: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock LandedCostCalculatorService with controlled return values. */
function createMockCalculator(
  result?: CalculatorResult,
): LandedCostCalculatorService {
  return {
    calculate: vi.fn().mockResolvedValue(result ?? createMockCalculatorResult()),
  } as unknown as LandedCostCalculatorService;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('TaxCalculationEngineAdapter', () => {
  let adapter: TaxCalculationEngineAdapter;

  beforeEach(() => {
    const mockCalculator = createMockCalculator();
    adapter = new TaxCalculationEngineAdapter(mockCalculator);
  });

  // -----------------------------------------------------------------------
  // calculateExcise
  // -----------------------------------------------------------------------

  describe('calculateExcise', () => {
    it('delegates to calculator.calculate', async () => {
      const calculator = createMockCalculator();
      const adapter = new TaxCalculationEngineAdapter(calculator);

      await adapter.calculateExcise(DEFAULT_EXCISE_BASE);

      expect(calculator.calculate).toHaveBeenCalledTimes(1);
      expect(calculator.calculate).toHaveBeenCalledWith({
        productId: 0,
        quantity: 1,
        destination: 'FI',
      });
    });

    it('extracts alcoholExciseEstimate as exciseAmountCents', async () => {
      const result = createMockCalculatorResult({ alcoholExciseEstimate: 75 });
      const adapter = new TaxCalculationEngineAdapter(
        createMockCalculator(result),
      );

      const output = await adapter.calculateExcise(DEFAULT_EXCISE_BASE);

      expect(output.exciseAmountCents).toBe(75);
    });

    it('forwards the category from ExciseBase', async () => {
      const output = await adapter.calculateExcise({
        category: 'wine' as ExciseCategory,
        volumeLitres: 0.75,
        alcoholByVolume: 0.12,
      });

      expect(output.category).toBe('wine');
    });

    it('sets rateVersionId to "resolved"', async () => {
      const output = await adapter.calculateExcise(DEFAULT_EXCISE_BASE);

      expect(output.rateVersionId).toBe('resolved');
    });

    it('returns a calculatedAt Date', async () => {
      const output = await adapter.calculateExcise(DEFAULT_EXCISE_BASE);

      expect(output.calculatedAt).toBeInstanceOf(Date);
      // Should be recent (within the last few seconds)
      const now = Date.now();
      expect(output.calculatedAt.getTime()).toBeGreaterThanOrEqual(now - 5000);
      expect(output.calculatedAt.getTime()).toBeLessThanOrEqual(now + 5000);
    });

    it('includes evidence with volume and ABV from base', async () => {
      const output = await adapter.calculateExcise({
        category: 'spirits' as ExciseCategory,
        volumeLitres: 1.0,
        alcoholByVolume: 0.40,
      });

      expect(output.evidence.volumeLitres).toBe(1.0);
      expect(output.evidence.alcoholByVolume).toBe(0.40);
    });

    it('computes rateAppliedCentsPerUnit = exciseAmount / volumeLitres', async () => {
      const result = createMockCalculatorResult({ alcoholExciseEstimate: 100 });
      const adapter = new TaxCalculationEngineAdapter(
        createMockCalculator(result),
      );

      const output = await adapter.calculateExcise({
        category: 'beer' as ExciseCategory,
        volumeLitres: 2.0,
        alcoholByVolume: 0.05,
      });

      expect(output.evidence.rateAppliedCentsPerUnit).toBe(50);
    });

    it('handles zero excise amount', async () => {
      const result = createMockCalculatorResult({ alcoholExciseEstimate: 0 });
      const adapter = new TaxCalculationEngineAdapter(
        createMockCalculator(result),
      );

      const output = await adapter.calculateExcise(DEFAULT_EXCISE_BASE);

      expect(output.exciseAmountCents).toBe(0);
      expect(output.evidence.rateAppliedCentsPerUnit).toBe(0);
    });

    it('handles zero volume (division edge case)', async () => {
      const result = createMockCalculatorResult({ alcoholExciseEstimate: 50 });
      const adapter = new TaxCalculationEngineAdapter(
        createMockCalculator(result),
      );

      const output = await adapter.calculateExcise({
        category: 'beer' as ExciseCategory,
        volumeLitres: 0,
        alcoholByVolume: 0.05,
      });

      // Division by zero yields Infinity — the adapter does no special handling
      expect(output.evidence.rateAppliedCentsPerUnit).toBe(Infinity);
    });
  });

  // -----------------------------------------------------------------------
  // calculateContainerDuty
  // -----------------------------------------------------------------------

  describe('calculateContainerDuty', () => {
    it('delegates to calculator.calculate', async () => {
      const calculator = createMockCalculator();
      const adapter = new TaxCalculationEngineAdapter(calculator);

      await adapter.calculateContainerDuty(DEFAULT_CONTAINER_DUTY_REQUEST);

      expect(calculator.calculate).toHaveBeenCalledTimes(1);
      expect(calculator.calculate).toHaveBeenCalledWith({
        productId: 0,
        quantity: 1,
        destination: 'FI',
      });
    });

    it('extracts containerDutyEstimate as dutyAmountCents', async () => {
      const result = createMockCalculatorResult({ containerDutyEstimate: 42 });
      const adapter = new TaxCalculationEngineAdapter(
        createMockCalculator(result),
      );

      const output = await adapter.calculateContainerDuty(
        DEFAULT_CONTAINER_DUTY_REQUEST,
      );

      expect(output.dutyAmountCents).toBe(42);
    });

    it('sets reliability to ESTIMATED', async () => {
      const output = await adapter.calculateContainerDuty(
        DEFAULT_CONTAINER_DUTY_REQUEST,
      );

      expect(output.reliability).toBe('ESTIMATED');
    });

    it('includes evidence with containerType and volumeLitres from request', async () => {
      const output = await adapter.calculateContainerDuty({
        containerType: 'glass' as ContainerType,
        volumeLitres: 0.75,
        depositSystemVerified: false,
      });

      expect(output.evidence.containerType).toBe('glass');
      expect(output.evidence.volumeLitres).toBe(0.75);
    });

    it('computes rateAppliedCentsPerLitre = dutyAmount / volumeLitres', async () => {
      const result = createMockCalculatorResult({ containerDutyEstimate: 102 });
      const adapter = new TaxCalculationEngineAdapter(
        createMockCalculator(result),
      );

      const output = await adapter.calculateContainerDuty({
        containerType: 'plastic' as ContainerType,
        volumeLitres: 2.0,
        depositSystemVerified: true,
      });

      expect(output.evidence.rateAppliedCentsPerLitre).toBe(51);
    });

    it('sets depositExemptionApplied to true when depositSystemVerified is false', async () => {
      const output = await adapter.calculateContainerDuty({
        containerType: 'can' as ContainerType,
        volumeLitres: 0.5,
        depositSystemVerified: false,
      });

      expect(output.evidence.depositExemptionApplied).toBe(true);
    });

    it('sets depositExemptionApplied to false when depositSystemVerified is true', async () => {
      const output = await adapter.calculateContainerDuty({
        containerType: 'can' as ContainerType,
        volumeLitres: 0.5,
        depositSystemVerified: true,
      });

      expect(output.evidence.depositExemptionApplied).toBe(false);
    });

    it('handles zero duty amount', async () => {
      const result = createMockCalculatorResult({ containerDutyEstimate: 0 });
      const adapter = new TaxCalculationEngineAdapter(
        createMockCalculator(result),
      );

      const output = await adapter.calculateContainerDuty(
        DEFAULT_CONTAINER_DUTY_REQUEST,
      );

      expect(output.dutyAmountCents).toBe(0);
      expect(output.evidence.rateAppliedCentsPerLitre).toBe(0);
    });

    it('handles zero volume (division edge case)', async () => {
      const result = createMockCalculatorResult({ containerDutyEstimate: 30 });
      const adapter = new TaxCalculationEngineAdapter(
        createMockCalculator(result),
      );

      const output = await adapter.calculateContainerDuty({
        containerType: 'metal' as ContainerType,
        volumeLitres: 0,
        depositSystemVerified: true,
      });

      expect(output.evidence.rateAppliedCentsPerLitre).toBe(Infinity);
    });
  });

  // -----------------------------------------------------------------------
  // calculateLandedCost
  // -----------------------------------------------------------------------

  describe('calculateLandedCost', () => {
    const LANDED_COST_PARAMS = {
      retailPriceCents: 500,
      transportCostCents: 200,
      exciseBase: DEFAULT_EXCISE_BASE,
      containerDutyRequest: DEFAULT_CONTAINER_DUTY_REQUEST,
      transactionClass: DEFAULT_TRANSACTION_CLASS,
    };

    it('delegates to calculator.calculate', async () => {
      const calculator = createMockCalculator();
      const adapter = new TaxCalculationEngineAdapter(calculator);

      await adapter.calculateLandedCost(LANDED_COST_PARAMS);

      expect(calculator.calculate).toHaveBeenCalledTimes(1);
      expect(calculator.calculate).toHaveBeenCalledWith({
        productId: 0,
        quantity: 1,
        destination: 'FI',
      });
    });

    it('maps foreignRetailPrice to retailPriceCents', async () => {
      const result = createMockCalculatorResult({ foreignRetailPrice: 999 });
      const adapter = new TaxCalculationEngineAdapter(
        createMockCalculator(result),
      );

      const output = await adapter.calculateLandedCost(LANDED_COST_PARAMS);

      expect(output.retailPriceCents).toBe(999);
    });

    it('maps transportCost to transportCostCents', async () => {
      const result = createMockCalculatorResult({ transportCost: 75 });
      const adapter = new TaxCalculationEngineAdapter(
        createMockCalculator(result),
      );

      const output = await adapter.calculateLandedCost(LANDED_COST_PARAMS);

      expect(output.transportCostCents).toBe(75);
    });

    it('maps totalCents to totalCostCents', async () => {
      const result = createMockCalculatorResult({ totalCents: 1234 });
      const adapter = new TaxCalculationEngineAdapter(
        createMockCalculator(result),
      );

      const output = await adapter.calculateLandedCost(LANDED_COST_PARAMS);

      expect(output.totalCostCents).toBe(1234);
    });

    it('sets exciseDuty to null', async () => {
      const output = await adapter.calculateLandedCost(LANDED_COST_PARAMS);

      expect(output.exciseDuty).toBeNull();
    });

    it('sets containerDuty to null', async () => {
      const output = await adapter.calculateLandedCost(LANDED_COST_PARAMS);

      expect(output.containerDuty).toBeNull();
    });

    it('returns currency EUR', async () => {
      const output = await adapter.calculateLandedCost(LANDED_COST_PARAMS);

      expect(output.currency).toBe('EUR');
    });

    it('includes a disclaimer object', async () => {
      const output = await adapter.calculateLandedCost(LANDED_COST_PARAMS);

      expect(output.disclaimer).toBeDefined();
      expect(output.disclaimer).toHaveProperty('text');
      expect(output.disclaimer).toHaveProperty('language');
      expect(output.disclaimer).toHaveProperty('version');
    });

    it('returns a calculationTimestamp Date', async () => {
      const output = await adapter.calculateLandedCost(LANDED_COST_PARAMS);

      expect(output.calculationTimestamp).toBeInstanceOf(Date);
      const now = Date.now();
      expect(output.calculationTimestamp.getTime()).toBeGreaterThanOrEqual(
        now - 5000,
      );
      expect(output.calculationTimestamp.getTime()).toBeLessThanOrEqual(
        now + 5000,
      );
    });

    it('forwards transactionClass from params', async () => {
      const output = await adapter.calculateLandedCost({
        ...LANDED_COST_PARAMS,
        transactionClass: 'traveller-import' as TransactionClass,
      });

      expect(output.transactionClass).toBe('traveller-import');
    });

    it('handles null exciseBase and null containerDutyRequest', async () => {
      const output = await adapter.calculateLandedCost({
        ...LANDED_COST_PARAMS,
        exciseBase: null,
        containerDutyRequest: null,
      });

      // Null params are ignored — the adapter still delegates to calculator
      // with hardcoded values regardless
      expect(output.totalCostCents).toBe(406);
    });

    it('preserves params not used by the calculator stub (retailPriceCents, transportCostCents)', async () => {
      // The adapter currently ignores the retailPriceCents and transportCostCents
      // params — it delegates to calculator.calculate with hardcoded values.
      // This test documents current behaviour; the result fields come from the
      // calculator result, not from the input params.
      const result = createMockCalculatorResult({
        foreignRetailPrice: 100,
        transportCost: 50,
      });
      const adapter = new TaxCalculationEngineAdapter(
        createMockCalculator(result),
      );

      const output = await adapter.calculateLandedCost({
        retailPriceCents: 9999,
        transportCostCents: 9999,
        exciseBase: null,
        containerDutyRequest: null,
        transactionClass: 'distance-buying' as TransactionClass,
      });

      // Values come from the calculator mock, not from params
      expect(output.retailPriceCents).toBe(100);
      expect(output.transportCostCents).toBe(50);
      expect(output.transactionClass).toBe('distance-buying');
    });
  });
});