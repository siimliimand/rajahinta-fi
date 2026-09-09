/**
 * Golden-dataset regression tests — v2.0.
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
 * @version 3.0 — import-VAT vectors (task 4.4, change
 *   alks-feed-and-import-vat): foreign-seller cases (Cases 1, 2, 3, 5)
 *   carry the itemised import-VAT line with traceable provenance
 *   (rate version, base breakdown, datasetVersions); Case 6 pins
 *   effective-date resolution via CalculatorInput.transactionDate;
 *   Case 7 pins the domestic result byte-for-byte to the pre-change
 *   engine shape.  Previous: v2.0 aligned with v1.0-2024 seed (see
 *   source-mapping tables below for rate → vero.fi citation per
 *   expectation)
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
  OFFER_BEER_DOMESTIC,
  PRODUCT_WINE,
  OFFER_WINE,
  PRODUCT_SPIRITS,
  OFFER_SPIRITS,
  PRODUCT_UNCLASSIFIED,
  OFFER_UNCLASSIFIED,
  PRODUCT_BEER_MULTI_OFFER,
  OFFER_BEER_MULTI_A,
  OFFER_BEER_MULTI_B,
  OFFER_BEER_MULTI_C,
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
 * Assert the result carries exactly one import-VAT line, positioned LAST
 * in the itemised array, whose every figure is traceable: rate version,
 * per-component base breakdown (in rule order, summing to the base), the
 * rate application itself, the flat convenience field, the headline total,
 * and dataset-version provenance.
 */
function expectTraceableImportVat(
  result: Awaited<ReturnType<LandedCostCalculatorService['calculate']>>,
  expected: {
    rateVersionId: string;
    ratePercent: number;
    retailCents: number;
    transportCents: number;
    exciseCents: number;
    containerDutyCents: number;
  },
): void {
  const { itemizedCosts, totalCents } = result;
  const vatLines = itemizedCosts.filter(
    (l) => l.category === 'importVatEstimate',
  );
  expect(vatLines).toHaveLength(1);

  const vat = vatLines[0];
  // VAT is appended last in the itemised array.
  expect(itemizedCosts[itemizedCosts.length - 1]).toBe(vat);

  // Rate-version provenance and a parseable computation timestamp.
  expect(vat.rateVersionId).toBe(expected.rateVersionId);
  expect(vat.label).toBe('Import VAT (estimated)');
  expect(vat.reliability).toBe('VERIFIED');
  expect(Number.isNaN(Date.parse(vat.calculatedAt ?? ''))).toBe(false);

  // Base breakdown: the four named components, in rule order, with their
  // own amounts; the base is the consignment aggregate (transport enters
  // once, not × quantity) and the breakdown sums to it exactly.
  const breakdown = vat.breakdown ?? [];
  expect(breakdown.map((b) => b.category)).toEqual([
    'foreignRetailPrice',
    'transportCost',
    'alcoholExciseEstimate',
    'containerDutyEstimate',
  ]);
  expect(breakdown.map((b) => b.cents)).toEqual([
    expected.retailCents,
    expected.transportCents,
    expected.exciseCents,
    expected.containerDutyCents,
  ]);
  const baseCents = breakdown.reduce((sum, b) => sum + b.cents, 0);
  expect(baseCents).toBe(
    expected.retailCents +
      expected.transportCents +
      expected.exciseCents +
      expected.containerDutyCents,
  );

  // The rate application: HALF-UP rounding of base × rate.
  expect(vat.cents).toBe(Math.round((baseCents * expected.ratePercent) / 100));

  // Flat convenience field and headline total include VAT exactly when
  // the line is present; the dataset version travels in metadata.
  expect(result.importVatEstimate).toBe(vat.cents);
  // The VAT base is the whole consignment aggregate, so the headline
  // total is exactly base + VAT — the calculator total identity.
  expect(totalCents).toBe(baseCents + vat.cents);
  expect(result.metadata.datasetVersions).toContain(expected.rateVersionId);
}


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
// Expected value computation reference (v2.0, seeded rates v1.0-2024):
//
// ── Case 1: Beer (5% ABV, 0.5 L) ──────────────────────────────────────────
//   Category 'beer' → normaliseCategory → 'beer'
//   ABV 5.0 % → matches BEER_FULL (minAlcoholByVolume: 3.5)
//   Rate: 36.20 €/hl per degree Plato (= 36.20 snt/cl ethanol)
//   Formula: PER_DEGREE_PLATO (calcPerDegreePlato)
//     excise = Math.round(36.20 × 0.05 × 0.5 × 100) = Math.round(90.5) = 91 ¢
//   Container: depositSystemStatus=true → EXEMPTED → 0 ¢
//   Total: 200(retail) + 150(transport) + 91(excise) + 0(container) = 441
//   Source: vero.fi alcohol table → beer > 3.5 %ABV at 36.20 snt/cl ethanol
//     https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/alkoholijuomavero/alkoholi-ja-alkoholijuomaverotaulukko/
//
// ── Case 2: Wine (12% ABV, 0.75 L) × 3 ────────────────────────────────────
//   Category 'wine' → normaliseCategory → 'wine_still'
//   ABV 12.0 % → matches WINE_BAND_4 (min: 8, max: 15)
//   Rate: 4.56 €/l of product
//   Formula: PER_LITRE_OF_PRODUCT (calcPerLitreOfProduct)
//     excise per unit = Math.round(4.56 × 0.75 × 100) = Math.round(342.0) = 342 ¢
//     excise × 3 = 1026 ¢
//   Container: depositSystemStatus=true → EXEMPTED → 0 ¢
//   Total: 900(retail) + 200(transport) + 1026(excise) + 0 = 2126
//   Source: vero.fi alcohol table → wine > 8–15 %ABV at 4.56 €/l
//
// ── Case 3: Spirits (40% ABV, 0.7 L) ─────────────────────────────────────
//   Category 'spirits' → normaliseCategory → 'spirits'
//   ABV 40.0 % → matches SPIRITS_FULL (minAlcoholByVolume: 2.8)
//   Rate: 54.80 €/l of pure alcohol (= 54.80 snt/cl ethanol)
//   Formula: PER_LITRE_OF_ALCOHOL (calcPerLitreOfAlcohol)
//     excise = Math.round(54.80 × 0.4 × 0.7 × 100) = Math.round(1534.4) = 1534 ¢
//     (Official: €15.34)
//   Container: depositSystemStatus=true → EXEMPTED → 0 ¢
//   Total: 500(retail) + 0(transport) + 1534(excise) + 0 = 2034
//   Source: vero.fi alcohol table → spirits > 2.8 %ABV at 54.80 €/l pure alcohol
//
// ── Container duty (all cases w/ depositSystemStatus=true) ─────────────────
//   Verified deposit → EXEMPTED → 0 ¢
//   Source: vero.fi beverage container duty page
//     https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-beverage-containers/
//
// ── Import VAT (foreign-seller cases, task 4.4) ────────────────────────────
//   Gate: offer.country !== destination → line present for DE/ES/PL → FI.
//   Base = consignment aggregate: retail + transport (ONCE, not ×qty) +
//   excise + container duty.  Amounts rounded HALF-UP.
//   Version import-vat-2024.2 (25.5 %, from 2024-09-01) — today's rate:
//     Case 1: base 441 → VAT round(441 × 0.255) = 112 ¢ → total 553
//     Case 2: base 2126 (transport counted once) → VAT round(542.13) = 542
//             → total 2668
//     Case 3: base 2034 (transport 0, unavailable) → VAT round(518.67) = 519
//             → total 2553
//     Case 5: base 441 → VAT 112 ¢ → total 553
//   Version import-vat-2024.1 (24 %, until 2024-08-31) — Case 6 pins it:
//     base 441 → VAT round(441 × 0.24) = 106 ¢ → total 547
//   Domestic (Case 7): offer.country === destination → NO VAT line; the
//   result equals the pre-change engine byte-for-byte (pinned vector).
//   Source: vero.fi value-added tax rates (25.5 % general rate from
//   2024-09-01, 24 % before)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Golden dataset version guard
// ---------------------------------------------------------------------------

describe('Golden dataset', () => {
  it(`has dataset version ${GOLDEN_DATASET_VERSION}`, () => {
    expect(GOLDEN_DATASET_VERSION).toBe('3.0');
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
      // retail(200) + transport(150) + excise(91) + container(0)
      //   = base 441; + VAT 25.5 % (import-vat-2024.2) = 112 → 553
      expect(result.totalCents).toBe(553);
    });

    it('includes traceable import VAT in the total (DE → FI)', async () => {
      const result = await service.calculate(INPUT);
      expectTraceableImportVat(result, {
        rateVersionId: 'import-vat-2024.2',
        ratePercent: 25.5,
        retailCents: 200,
        transportCents: 150,
        exciseCents: 91,
        containerDutyCents: 0,
      });
    });

    it('applies correct itemized costs', async () => {
      const result = await service.calculate(INPUT);
      expect(result.foreignRetailPrice).toBe(200);
      expect(result.transportCost).toBe(150);
      expect(result.alcoholExciseEstimate).toBe(91);
      expect(result.containerDutyEstimate).toBe(0);
      // otherCharges was removed from the API shape (task 10.3, design
      // D3) — the serialized payload must not carry the dead contract.
      expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty(
        'otherCharges',
      );
    });

    it('classifies as DistanceSelling (retailer-arranged)', async () => {
      const result = await service.calculate(INPUT);
      expect(result.classification.classification).toBe('DistanceSelling');
      expect(result.classification.confidence).toBe('HIGH');
    });

    it('has MEDIUM confidence (product price ESTIMATED)', async () => {
      const result = await service.calculate(INPUT);
      // excise is VERIFIED (seed data with verificationDate);
      // product price is ESTIMATED (reliabilityStatus:'EXACT' → ESTIMATED)
      expect(result.confidence).toBe('MEDIUM');
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
      // excise 342 × 3, container 0 × 3
      expect(result.alcoholExciseEstimate).toBe(1026);
      expect(result.containerDutyEstimate).toBe(0);
    });

    it('returns correct total cost', async () => {
      const result = await service.calculate(INPUT);
      // retail(900) + transport(200) + excise(1026) + container(0)
      //   = base 2126; + VAT 25.5 % = 542 → 2668
      expect(result.totalCents).toBe(2668);
    });

    it('includes traceable import VAT — transport enters the base once', async () => {
      const result = await service.calculate(INPUT);
      // qty=3 scales retail and excise, but the VAT base is the
      // consignment aggregate: transport 200 once, not 200 × 3.
      expectTraceableImportVat(result, {
        rateVersionId: 'import-vat-2024.2',
        ratePercent: 25.5,
        retailCents: 900,
        transportCents: 200, // once — not 600
        exciseCents: 1026,
        containerDutyCents: 0,
      });
    });

    it('classifies as DistanceBuying (independent carrier)', async () => {
      const result = await service.calculate(INPUT);
      expect(result.classification.classification).toBe('DistanceBuying');
    });

    it('has MEDIUM confidence (product price ESTIMATED)', async () => {
      const result = await service.calculate(INPUT);
      // Same reason as Case 1: productPrice reliabilityStatus:'EXACT' → ESTIMATED
      expect(result.confidence).toBe('MEDIUM');
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
      // retail(500) + transport(0) + excise(1534) + container(0)
      //   = base 2034; + VAT 25.5 % = 519 → 2553
      expect(result.totalCents).toBe(2553);
    });

    it('still includes traceable import VAT when transport is unavailable', async () => {
      const result = await service.calculate(INPUT);
      // No transport context → the transport base component is 0, never
      // a guess; the VAT line remains fully traceable.
      expectTraceableImportVat(result, {
        rateVersionId: 'import-vat-2024.2',
        ratePercent: 25.5,
        retailCents: 500,
        transportCents: 0,
        exciseCents: 1534,
        containerDutyCents: 0,
      });
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

  // -----------------------------------------------------------------------
  // Case 5: Multiple EUR offers (design D3, EUR-only)
  //
  // Product 13 (beer, same tax shape as Case 1) is offered by three EUR
  // merchants:
  //   - 112: 200 cents (DE) — cheapest
  //   - 113: 260 cents (DE)
  //   - 114: 210 cents (EE)
  //
  // Expected: the cheapest EUR offer wins the price race. Offers are
  //   EUR-only by construction (the currency union is the 'EUR' literal),
  //   so no exclusion path exists and every stored cent is EUR.
  //   Total: 200(retail) + 150(transport DE→FI) + 91(excise) + 0 = 441
  // -----------------------------------------------------------------------

  describe('Case 5 — Multiple EUR offers, cheapest wins (design D3)', () => {
    const INPUT: CalculatorInput = {
      productId: 13,
      quantity: 1,
      destination: 'FI',
      transportMethod: 'carrierA',
    };

    const service = createGoldenService({
      product: PRODUCT_BEER_MULTI_OFFER,
      offers: [
        OFFER_BEER_MULTI_C,
        OFFER_BEER_MULTI_A,
        OFFER_BEER_MULTI_B,
      ],
      transportOffers: [OFFER_CARRIER_A],
    });

    it('selects the cheapest EUR offer — total is a pure EUR sum', async () => {
      const result = await service.calculate(INPUT);

      expect(result.metadata.retailOfferIds).toEqual([112]);
      expect(result.foreignRetailPrice).toBe(200);
      // retail(200) + transport(150) + excise(91) + container(0)
      //   = base 441; + VAT 25.5 % = 112 → 553 (winner offer is DE → FI)
      expect(result.totalCents).toBe(553);
      expect(result.currency).toBe('EUR');
      // EUR-only means the exclusion concept is gone from the result.
      expect('excludedOffers' in result).toBe(false);
      expect('originalRetailPrice' in result).toBe(false);
    });

    it('carries no FX dataset version in datasetVersions (no FX provenance)', async () => {
      const result = await service.calculate(INPUT);

      expect(result.metadata.datasetVersions).not.toContain('ecb-2026-08-27.1');
    });

    it('names the import-VAT rate version in datasetVersions', async () => {
      const result = await service.calculate(INPUT);
      // Winning offer is EE → FI — still an import, so the VAT figure is
      // traceable to the dataset version that produced it.
      expect(result.metadata.datasetVersions).toContain('import-vat-2024.2');
      expect(result.importVatEstimate).toBe(112);
    });

    it('classifies as DistanceSelling (seller-arranged cross-border)', async () => {
      const result = await service.calculate(INPUT);

      expect(result.classification.classification).toBe('DistanceSelling');
      expect(result.confidence).toBe('HIGH');
    });
  });

  // -----------------------------------------------------------------------
  // Case 6: Import-VAT effective-date resolution (design D5)
  //
  // CalculatorInput.transactionDate is the effective-date lookup for the
  // versioned import-VAT dataset:
  //   import-vat-2024.1  24 %   until 2024-08-31 (inclusive)
  //   import-vat-2024.2  25.5 % from 2024-09-01
  // Same tax shape as Case 1 (base 441 ¢), so the two rates are directly
  // comparable: 106 ¢ vs 112 ¢.
  // -----------------------------------------------------------------------

  describe('Case 6 — transactionDate resolves the rate version', () => {
    const SERVICE = createGoldenService({
      product: PRODUCT_BEER,
      offers: [OFFER_BEER],
      transportOffers: [OFFER_CARRIER_A],
    });

    it('a pre-2024-09-01 transaction resolves import-vat-2024.1 at 24 %', async () => {
      const result = await SERVICE.calculate({
        productId: 1,
        quantity: 1,
        destination: 'FI',
        transportMethod: 'carrierA',
        transactionDate: '2024-06-15T12:00:00.000Z',
      });

      // base 441 × 24 % = 105.84 → 106 (HALF-UP)
      expectTraceableImportVat(result, {
        rateVersionId: 'import-vat-2024.1',
        ratePercent: 24,
        retailCents: 200,
        transportCents: 150,
        exciseCents: 91,
        containerDutyCents: 0,
      });
      expect(result.totalCents).toBe(547);

      // Provenance: the line's computed-at IS the transaction date, not
      // the wall clock of the calculation run.
      const vatLine = result.itemizedCosts[result.itemizedCosts.length - 1];
      expect(vatLine.calculatedAt).toBe('2024-06-15T12:00:00.000Z');
    });

    it('2024-08-31 (last inclusive day) still resolves import-vat-2024.1', async () => {
      const result = await SERVICE.calculate({
        productId: 1,
        quantity: 1,
        destination: 'FI',
        transportMethod: 'carrierA',
        transactionDate: '2024-08-31T23:59:59.000Z',
      });
      expect(result.importVatEstimate).toBe(106);
      expect(result.metadata.datasetVersions).toContain('import-vat-2024.1');
    });

    it('2024-09-01 resolves import-vat-2024.2 at 25.5 %', async () => {
      const result = await SERVICE.calculate({
        productId: 1,
        quantity: 1,
        destination: 'FI',
        transportMethod: 'carrierA',
        transactionDate: '2024-09-01T00:00:00.000Z',
      });
      expect(result.importVatEstimate).toBe(112);
      expect(result.totalCents).toBe(553);
      expect(result.metadata.datasetVersions).toContain('import-vat-2024.2');
    });

    it('a present-day transaction without transactionDate resolves import-vat-2024.2', async () => {
      // Cases 1–5 already pin this path; here it is explicit next to the
      // historical resolutions so the two-era coverage is visible.
      const result = await SERVICE.calculate({
        productId: 1,
        quantity: 1,
        destination: 'FI',
        transportMethod: 'carrierA',
      });
      expect(result.metadata.datasetVersions).toContain('import-vat-2024.2');
      expect(result.importVatEstimate).toBe(112);
    });
  });

  // -----------------------------------------------------------------------
  // Case 7: Domestic seller — byte-identity with the pre-change engine
  //
  // offer.country === destination ('FI' → 'FI') fails the import-VAT gate,
  // so the result must be EXACTLY the shape the engine produced before the
  // VAT change: no importVatEstimate key, no VAT line, no VAT dataset
  // version — absence, not a displayed zero.  Identity is proven
  // mechanically: the complete serialized result (the only volatile field,
  // metadata.calculationTimestamp, normalised to a sentinel) is compared
  // byte-for-byte against the pinned pre-change vector below.
  //
  // Pinned-vector derivation (v1.0-2024 seed, all verified):
  //   retail 340 ('EXACT' → ESTIMATED), transport 0 UNAVAILABLE (no
  //   offers), excise 91 VERIFIED (36.20 × 0.05 × 0.5, HALF-UP),
  //   container 0 VERIFIED (deposit verified → EXEMPTED), total 431.
  //   Classification: no transport context → carrierId = offer.merchant
  //   → INDEPENDENT_CARRIER → DistanceBuying HIGH (seller known).
  //   Confidence: UNAVAILABLE input → LOW.
  // -----------------------------------------------------------------------

  describe('Case 7 — Domestic (FI → FI), byte-identical to pre-change engine', () => {
    const INPUT: CalculatorInput = {
      productId: 1,
      quantity: 1,
      destination: 'FI',
    };

    const service = createGoldenService({
      product: PRODUCT_BEER,
      offers: [OFFER_BEER_DOMESTIC],
      transportOffers: [], // domestic walk-in context — no carrier query
    });

    /** Pre-change engine output, pinned key-for-key in engine insertion order. */
    const PRE_CHANGE_VECTOR = {
      itemizedCosts: [
        {
          label: 'Retail price',
          category: 'foreignRetailPrice',
          cents: 340,
          reliability: 'ESTIMATED',
          breakdown: [
            {
              label: 'Unit price (x1)',
              category: 'foreignRetailPrice',
              cents: 340,
              reliability: 'ESTIMATED',
            },
          ],
        },
        {
          label: 'Transport',
          category: 'transportCost',
          cents: 0,
          reliability: 'UNAVAILABLE',
        },
        {
          label: 'Alcohol excise',
          category: 'alcoholExciseEstimate',
          cents: 91,
          reliability: 'VERIFIED',
        },
        {
          label: 'Container duty',
          category: 'containerDutyEstimate',
          cents: 0,
          reliability: 'VERIFIED',
        },
      ],
      foreignRetailPrice: 340,
      transportCost: 0,
      alcoholExciseEstimate: 91,
      containerDutyEstimate: 0,
      totalCents: 431,
      currency: 'EUR',
      confidence: 'LOW',
      confidenceBreakdown: [
        {
          status: 'ESTIMATED',
          detail:
            '[productPrice] Data point is estimated from incomplete or indirect data.',
        },
        {
          status: 'UNAVAILABLE',
          detail: '[transport] No data is available for this data point.',
        },
        {
          status: 'VERIFIED',
          detail:
            '[excise] Data point is verified against an authoritative source.',
        },
        {
          status: 'VERIFIED',
          detail:
            '[containerDuty] Data point is verified against an authoritative source.',
        },
        {
          status: 'VERIFIED',
          detail:
            '[classification] Data point is verified against an authoritative source.',
        },
      ],
      disclaimer: {
        text:
          'Arvioitu kokonaiskustannus Suomessa. Ei ole lopullinen verovelvollisuuden määrä. ' +
          'Lopullinen verovelvollisuus määräytyy Tullin ja Verohallinnon vahvistamien ' +
          'verokantojen ja säännösten mukaan.',
        language: 'fi',
        version: '1.0',
      },
      classification: {
        classification: 'DistanceBuying',
        confidence: 'HIGH',
        evidence: [
          {
            observation: 'Buyer arranged transport via independent carrier',
            supportingData: 'carrier: beverage-fi',
            source: 'carrierId',
          },
          {
            observation: 'Seller did not arrange transport',
            supportingData: 'seller country: FI, buyer country: FI',
            source: 'sellerInvolvementIndicator',
          },
          {
            observation: 'Seller identity confirmed',
            supportingData: 'seller: beverage-fi',
            source: 'sellerId',
          },
        ],
        evidenceSummary:
          'Classification based on the following evidence:\n' +
          '- Based on: Buyer arranged transport via independent carrier (carrier: beverage-fi)\n' +
          '- Based on: Seller did not arrange transport (seller country: FI, buyer country: FI)\n' +
          '- Based on: Seller identity confirmed (seller: beverage-fi)',
      },
      metadata: {
        input: {
          productId: 1,
          quantity: 1,
          destination: 'FI',
        },
        calculationTimestamp: '<ISO-TIMESTAMP>',
        productMasterId: 1,
        retailOfferIds: [115],
        quantity: 1,
        destination: 'FI',
        productName: 'Premium Lager 5%',
        volumeLitres: 0.5,
        alcoholByVolume: 0.05,
        category: 'beer',
        datasetVersions: ['v1.0-2024', 'EXEMPTED'],
        transportOfferId: null,
      },
      calculationRecordId: 9000,
    };

    /** Normalise the single run-volatile field (documented sentinel swap). */
    function normalizeForPin(serialized: string): string {
      return serialized.replace(
        /"calculationTimestamp":"[^"]*"/,
        '"calculationTimestamp":"<ISO-TIMESTAMP>"',
      );
    }

    it('serialized result is byte-identical to the pre-change pinned vector', async () => {
      const result = await service.calculate(INPUT);

      // A single string comparison proves NO key was added, removed, or
      // reordered anywhere in the result — the mechanical identity pin.
      expect(normalizeForPin(JSON.stringify(result))).toBe(
        JSON.stringify(PRE_CHANGE_VECTOR),
      );
    });

    it('carries no VAT surface anywhere — absence, not a displayed zero', async () => {
      const result = await service.calculate(INPUT);

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('importVatEstimate');
      expect(serialized).not.toContain('import-vat-');
      expect(result.totalCents).toBe(431);
    });
  });
});