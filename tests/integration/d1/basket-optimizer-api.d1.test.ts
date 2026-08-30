/**
 * API integration tests for POST /api/v1/basket/optimize on D1 (task 2.7,
 * change migrate-to-cloudflare). D1 port of
 * tests/integration/basket-optimizer-api.test.ts; the pg original stays
 * untouched until cutover.
 *
 * Same proof as the original — the BasketOptimizerController constructed
 * with REAL engines, real guards, and real idempotency — with the
 * write-once record ports wired to the REAL D1 repositories (migrations
 * applied, golden-dataset convention, no vi.fn()). Guard tests, validation
 * contracts, error mapping, idempotency, and rate-limit wiring assertions
 * are identical to the pg suite.
 *
 * @module BasketOptimizerApiD1IntegrationTest
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// --- core-domain ---
import {
  type ITransportOfferQuery,
  type TransportOffer,
  type IProductDataPort,
  type ICalculationRecordPort,
  type CalculatorProductData,
  type CalculatorRetailOfferData,
  type CreateCalculationRecordInput,
  BasketOptimizerService,
} from '@rajahinta/core-domain';
import { ClassificationGateService } from '@rajahinta/core-domain/normalization/classification-gate.service';
import { AlcoholExciseService } from '@rajahinta/core-domain/tax/services/alcohol-excise.service';
import { ContainerDutyService } from '@rajahinta/core-domain/tax/services/container-duty.service';
import { TransportEstimationService } from '@rajahinta/core-domain/transport/transport-estimation.service';
import { BasketShippingCalculator } from '@rajahinta/core-domain/transport/basket-shipping-calculator.service';
import { ConfidenceFrameworkService } from '@rajahinta/core-domain/reliability/confidence-framework.service';
import { ReliabilityService } from '@rajahinta/core-domain/reliability/reliability.service';
import { TransactionClassificationService } from '@rajahinta/core-domain';
import { TransportClassificationService } from '@rajahinta/core-domain';
import { LandedCostCalculatorService } from '@rajahinta/core-domain/calculator/landed-cost-calculator.service';
import type {
  CreateBasketCalculationRecordInput,
  IBasketCalculationRecordPort,
} from '@rajahinta/core-domain/optimizer/ports/basket-calculation-record.port';
import type { IMerchantTermsPort } from '@rajahinta/core-domain/optimizer/ports/merchant-terms.port';
import type { MerchantTerms } from '@rajahinta/core-domain/optimizer/ports/merchant-terms.port';

// --- application-api ---
import {
  FeatureFlagService,
  FeatureFlagGuard,
  FeatureFlag,
} from '@rajahinta/application-api';
import { BasketOptimizerController } from '@rajahinta/application-api/basket/basket-optimizer.controller';
import type { BasketOptimizeRequest } from '@rajahinta/application-api/basket/basket.dto';
import { IdempotencyService, InMemoryIdempotencyCache, type IIdempotencyCache } from '@rajahinta/application-api/idempotency/idempotency.service';

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
// adapters perform (see basket-calculator-consistency.d1.test.ts).
// ---------------------------------------------------------------------------

class D1CalcRecordPort implements ICalculationRecordPort {
  constructor(private readonly repo: D1CalculationRecordRepository) {}

  async create(record: CreateCalculationRecordInput): Promise<{ id: number }> {
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
// Fixtures (identical to the pg suite)
// ---------------------------------------------------------------------------

const BASE_DATE = new Date('2026-08-16T12:00:00Z');

const OFFER_BEER_ALT: CalculatorRetailOfferData = {
  id: 200,
  priceCents: 250,
  merchant: 'vinos-es',
  country: 'ES',
  reliabilityStatus: 'EXACT',
};

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
// In-memory port implementations (read side)
// ---------------------------------------------------------------------------

class InMemoryTransportOfferQuery implements ITransportOfferQuery {
  async findAllActive(): Promise<TransportOffer[]> { return ALL_TRANSPORT_OFFERS; }
  async findByCarrier(carrierId: string): Promise<TransportOffer[]> {
    return ALL_TRANSPORT_OFFERS.filter((o) => o.carrier === carrierId);
  }
}

class InMemoryProductDataPort implements IProductDataPort {
  readonly product = PRODUCT_BEER;
  readonly offers = [OFFER_BEER, OFFER_BEER_ALT];

  async findProductById(id: number): Promise<CalculatorProductData | null> {
    return id === this.product.id ? this.product : null;
  }
  async findRetailOffers(productId: number): Promise<CalculatorRetailOfferData[]> {
    return productId === this.product.id ? this.offers : [];
  }
}

class InMemoryProductDataPortWithUnclassified extends InMemoryProductDataPort {
  override async findProductById(id: number): Promise<CalculatorProductData | null> {
    if (id === 4) return { id: 4, regulatoryClassification: '', category: 'unknown', volumeLitres: 0.5, alcoholByVolume: 0.0, containerType: 'plastic', depositSystemStatus: null, weightKg: 0.5, normalizedName: 'Unknown' };
    return super.findProductById(id);
  }
  override async findRetailOffers(productId: number): Promise<CalculatorRetailOfferData[]> {
    if (productId === 4) return [{ id: 103, priceCents: 100, merchant: 'unknown-merchant', country: 'DE', reliabilityStatus: 'ESTIMATED' }];
    return super.findRetailOffers(productId);
  }
}

// ---------------------------------------------------------------------------
// Shared engine wiring — D1 write ports, real engines
// ---------------------------------------------------------------------------

const { db, d1 } = openMigratedD1();

beforeAll(async () => {
  // calculation_records.product_master_id is an FK — seed the golden
  // product under its canonical id (PRODUCT_BEER.id = 1), plus the golden
  // tax-rule and fixture transport ids the persisted records reference.
  await d1
    .prepare(
      `INSERT INTO product_master (id, name, manufacturer, brand, category,
          unit_volume, container_type, regulatory_classification)
       VALUES (?, 'Premium Lager 5%', 'Golden Brewery', 'Golden', 'beer',
               0.5, 'can', 'beer')`,
    )
    .bind(PRODUCT_BEER.id)
    .run();
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

afterAll(() => {
  db.close();
});

function createRealOptimizer(productPort?: IProductDataPort): BasketOptimizerService {
  const taxRepo = new InMemoryTaxRuleRepository();
  const transportQuery = new InMemoryTransportOfferQuery();
  const productData = productPort ?? new InMemoryProductDataPort();
  const calcRecords: ICalculationRecordPort = new D1CalcRecordPort(new D1CalculationRecordRepository(d1));
  const basketCalcRecords: IBasketCalculationRecordPort = new D1BasketCalcRecordPort(
    new D1BasketCalculationRecordRepository(d1),
  );
  const merchantTerms: IMerchantTermsPort = new D1MerchantTermsPort(
    new D1MerchantTermsRepository(d1),
  );

  const gate = new ClassificationGateService();
  const transportClassification = new TransportClassificationService();
  const reliability = new ReliabilityService();
  const confidence = new ConfidenceFrameworkService(reliability);
  const classificationService = new TransactionClassificationService(transportClassification);
  const excise = new AlcoholExciseService(taxRepo);
  const container = new ContainerDutyService(taxRepo);
  const transportEstimation = new TransportEstimationService(transportQuery);
  const shippingCalc = new BasketShippingCalculator(transportQuery);

  const calculator = new LandedCostCalculatorService(
    gate, excise, container, classificationService, transportEstimation,
    confidence, productData, calcRecords,
  );

  return new BasketOptimizerService(
    gate, calculator, shippingCalc, productData, merchantTerms,
    basketCalcRecords, confidence,
  );
}

// ---------------------------------------------------------------------------
// Controller factory (identical to the pg suite)
// ---------------------------------------------------------------------------

function createController(
  optimizer?: BasketOptimizerService,
  idempotency?: IdempotencyService,
  cache?: IIdempotencyCache,
  taxRepo?: object,
): BasketOptimizerController {
  return new BasketOptimizerController(
    optimizer ?? createRealOptimizer(),
    idempotency ?? new IdempotencyService(cache ?? new InMemoryIdempotencyCache()),
    taxRepo ?? new InMemoryTaxRuleRepository(),
    cache ?? new InMemoryIdempotencyCache(),
  );
}

const VALID_REQUEST: BasketOptimizeRequest = {
  items: [{ productId: 1, quantity: 1 }],
  destination: 'FI',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/v1/basket/optimize on D1', () => {
  // =========================================================================
  // Feature flag gating
  // =========================================================================

  describe('feature flag gating', () => {
    let originalEnv: Record<string, string | undefined>;

    beforeEach(() => {
      originalEnv = { ...process.env };
      delete process.env.FF_BASKET_OPTIMIZATION;
    });

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('controller class carries the BASKET_OPTIMIZATION feature flag decorator', () => {
      const reflector = new Reflector();
      const flag = reflector.getAllAndOverride<FeatureFlag>(
        'feature_flag',
        [BasketOptimizerController.prototype.optimize, BasketOptimizerController],
      );
      expect(flag).toBe(FeatureFlag.BASKET_OPTIMIZATION);
    });

    it('FeatureFlagGuard rejects when BASKET_OPTIMIZATION is off', () => {
      const guard = new FeatureFlagGuard(new Reflector(), new FeatureFlagService());
      const ctx = {
        getHandler: () => BasketOptimizerController.prototype.optimize,
        getClass: () => BasketOptimizerController,
        switchToHttp: () => ({
          getRequest: () => ({ headers: {}, cookies: {} }),
          getResponse: () => ({ header: () => undefined }),
        }),
        getArgs: () => [],
        getType: () => 'http',
      } as any;

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('FeatureFlagGuard allows when BASKET_OPTIMIZATION is on', () => {
      process.env.FF_BASKET_OPTIMIZATION = 'true';
      const guard = new FeatureFlagGuard(new Reflector(), new FeatureFlagService());
      const ctx = {
        getHandler: () => BasketOptimizerController.prototype.optimize,
        getClass: () => BasketOptimizerController,
        switchToHttp: () => ({
          getRequest: () => ({ headers: {}, cookies: {} }),
          getResponse: () => ({ header: () => undefined }),
        }),
        getArgs: () => [],
        getType: () => 'http',
      } as any;

      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  // =========================================================================
  // Flag-on — happy path through the real controller
  // =========================================================================

  describe('valid request — real optimizer wired to D1', () => {
    it('returns 200 with shipments + disclaimer + confidence', async () => {
      const ctrl = createController();
      const result = await ctrl.optimize(VALID_REQUEST);

      expect(result).toBeDefined();
      expect(Array.isArray(result.shipments)).toBe(true);
      expect(result.shipments.length).toBeGreaterThanOrEqual(1);
      expect(result.disclaimer).toBeDefined();
      expect(result.disclaimer.text).toBeDefined();
      expect(result.confidence).toBeDefined();
      expect(result.totalCents).toBeGreaterThan(0);
      expect(result.metadata).toBeDefined();
    });

    it('persists the optimization result into basket_calculation_records (D1)', async () => {
      const before = (
        db.prepare('SELECT COUNT(*) AS n FROM basket_calculation_records').get() as { n: number }
      ).n;

      const ctrl = createController();
      const result = await ctrl.optimize(VALID_REQUEST);
      expect(result.metadata.calculationRecordId).toBeGreaterThan(0);

      const after = (
        db.prepare('SELECT COUNT(*) AS n FROM basket_calculation_records').get() as { n: number }
      ).n;
      expect(after).toBeGreaterThan(before);

      const persisted = await new D1BasketCalculationRecordRepository(d1).findById(
        result.metadata.calculationRecordId as number,
      );
      expect(persisted!.totalCents).toBe(result.totalCents);
    });

    it('returns per-shipment breakdown with items, merchant, transport', async () => {
      const ctrl = createController();
      const result = await ctrl.optimize(VALID_REQUEST);

      const shipment = result.shipments[0];
      expect(shipment.merchant).toBeDefined();
      expect(shipment.country).toBeDefined();
      expect(Array.isArray(shipment.items)).toBe(true);
      expect(shipment.consolidatedTransport).toBeDefined();
      expect(shipment.consolidatedTransport.totalCents).toBeGreaterThan(0);
      expect(shipment.retailSubtotalCents).toBeGreaterThan(0);
    });

    it('returns confidence and confidenceBreakdown', async () => {
      const ctrl = createController();
      const result = await ctrl.optimize(VALID_REQUEST);

      expect(result.confidence).toMatch(/^(HIGH|MEDIUM|LOW)$/);
      expect(Array.isArray(result.confidenceBreakdown)).toBe(true);
    });

    it('returns dataset versions in metadata', async () => {
      const ctrl = createController();
      const result = await ctrl.optimize(VALID_REQUEST);

      expect(Array.isArray(result.metadata.datasetVersions)).toBe(true);
      expect(result.metadata.datasetVersions.length).toBeGreaterThan(0);
    });

    it('sets X-Cache: MISS headers on first computation', async () => {
      const ctrl = createController();
      const res = { header: vi.fn() };

      await ctrl.optimize(VALID_REQUEST, undefined, res);

      expect(res.header).toHaveBeenCalledWith('X-Cache', 'MISS');
      expect(res.header).toHaveBeenCalledWith('X-Content-Hash', expect.any(String));
    });

    it('returns alternatives', async () => {
      const ctrl = createController();
      const result = await ctrl.optimize(VALID_REQUEST);

      expect(Array.isArray(result.alternatives)).toBe(true);
      expect(result.alternatives.length).toBeGreaterThanOrEqual(0);
    });
  });

  // =========================================================================
  // Validation errors — 400
  // =========================================================================

  describe('input validation — 400', () => {
    it('rejects empty items array', async () => {
      const ctrl = createController();
      const req: BasketOptimizeRequest = { items: [], destination: 'FI' };
      await expect(ctrl.optimize(req)).rejects.toThrow(BadRequestException);
    });

    it('rejects missing items', async () => {
      const ctrl = createController();
      const req = { destination: 'FI' } as unknown as BasketOptimizeRequest;
      await expect(ctrl.optimize(req)).rejects.toThrow(BadRequestException);
    });

    it('rejects quantity of 0', async () => {
      const ctrl = createController();
      const req = { items: [{ productId: 1, quantity: 0 }], destination: 'FI' } as unknown as BasketOptimizeRequest;
      await expect(ctrl.optimize(req)).rejects.toThrow(BadRequestException);
    });

    it('rejects negative quantity', async () => {
      const ctrl = createController();
      const req = { items: [{ productId: 1, quantity: -1 }], destination: 'FI' } as unknown as BasketOptimizeRequest;
      await expect(ctrl.optimize(req)).rejects.toThrow(BadRequestException);
    });

    it('rejects quantity > 99', async () => {
      const ctrl = createController();
      const req = { items: [{ productId: 1, quantity: 100 }], destination: 'FI' } as unknown as BasketOptimizeRequest;
      await expect(ctrl.optimize(req)).rejects.toThrow(BadRequestException);
    });

    it('rejects non-integer productId', async () => {
      const ctrl = createController();
      const req = { items: [{ productId: 1.5, quantity: 1 }], destination: 'FI' } as unknown as BasketOptimizeRequest;
      await expect(ctrl.optimize(req)).rejects.toThrow(BadRequestException);
    });

    it('rejects productId of 0', async () => {
      const ctrl = createController();
      const req = { items: [{ productId: 0, quantity: 1 }], destination: 'FI' } as unknown as BasketOptimizeRequest;
      await expect(ctrl.optimize(req)).rejects.toThrow(BadRequestException);
    });

    it('rejects missing destination', async () => {
      const ctrl = createController();
      const req = { items: [{ productId: 1, quantity: 1 }] } as unknown as BasketOptimizeRequest;
      await expect(ctrl.optimize(req)).rejects.toThrow(BadRequestException);
    });

    it('rejects non-ISO-2 destination', async () => {
      const ctrl = createController();
      const req = { items: [{ productId: 1, quantity: 1 }], destination: 'FIN' } as unknown as BasketOptimizeRequest;
      await expect(ctrl.optimize(req)).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid transportArrangement', async () => {
      const ctrl = createController();
      const req = { items: [{ productId: 1, quantity: 1 }], destination: 'FI', transportArrangement: 'INVALID' } as unknown as BasketOptimizeRequest;
      await expect(ctrl.optimize(req)).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // Error mapping — 404, 422, 500
  // =========================================================================

  describe('error mapping', () => {
    it('returns 404 for unknown productId', async () => {
      const productData = new InMemoryProductDataPort();
      const optimizer = createRealOptimizer(productData);
      const ctrl = createController(optimizer);

      const req: BasketOptimizeRequest = { items: [{ productId: 999, quantity: 1 }], destination: 'FI' };
      await expect(ctrl.optimize(req)).rejects.toThrow(NotFoundException);
    });

    it('returns 422 for product without regulatory classification', async () => {
      const productData = new InMemoryProductDataPortWithUnclassified();
      const optimizer = createRealOptimizer(productData);
      const ctrl = createController(optimizer);

      const req: BasketOptimizeRequest = { items: [{ productId: 4, quantity: 1 }], destination: 'FI' };

      try {
        await ctrl.optimize(req);
        expect.unreachable('Expected UnprocessableEntityException');
      } catch (err) {
        expect(err).toBeInstanceOf(UnprocessableEntityException);
        const ue = err as UnprocessableEntityException;
        const body = ue.getResponse() as Record<string, unknown>;
        expect(body.productId).toBe(4);
      }
    });
  });

  // =========================================================================
  // Idempotent replay
  // =========================================================================

  describe('idempotency', () => {
    it('same request twice returns the same total (idempotent)', async () => {
      const cache = new InMemoryIdempotencyCache();
      const ctrl = createController(createRealOptimizer(), undefined, cache);

      const result1 = await ctrl.optimize(VALID_REQUEST);
      const result2 = await ctrl.optimize(VALID_REQUEST);

      // Same input → same total (idempotent by business logic)
      expect(result2.totalCents).toBe(result1.totalCents);
      expect(result2.shipments).toEqual(result1.shipments);
    });

    it('idempotency-key returns consistent results across calls', async () => {
      const cache = new InMemoryIdempotencyCache();
      const ctrl = createController(createRealOptimizer(), undefined, cache);

      const res1 = { header: vi.fn() };
      const result1 = await ctrl.optimize(VALID_REQUEST, 'my-custom-key', res1);

      const res2 = { header: vi.fn() };
      const result2 = await ctrl.optimize(VALID_REQUEST, 'my-custom-key', res2);

      // Same input → same total (idempotent)
      expect(result2.totalCents).toBe(result1.totalCents);
      expect(result2.shipments).toEqual(result1.shipments);
    });

    it('different baskets produce different totals', async () => {
      const ctrl = createController();
      const r1 = await ctrl.optimize({ items: [{ productId: 1, quantity: 1 }], destination: 'FI' });
      const r2 = await ctrl.optimize({ items: [{ productId: 1, quantity: 2 }], destination: 'FI' });

      expect(r2.totalCents).not.toBe(r1.totalCents);
    });
  });

  // =========================================================================
  // Rate limiting — wiring check
  // =========================================================================

  describe('rate limiting', () => {
    it('RateLimitGuard is wired on the controller class', () => {
      const guards = Reflect.getMetadata('__guards__', BasketOptimizerController);
      expect(guards).toBeDefined();
      expect(guards.length).toBeGreaterThanOrEqual(1);
    });

    it('RateLimitGuard can be instantiated with the rate-limiting module', () => {
      const reflector = new Reflector();
      const profile = reflector.getAllAndOverride(
        'rate_limit_profile',
        [BasketOptimizerController.prototype.optimize, BasketOptimizerController],
      );
      expect(profile).toBe('BASKET');
    });
  });
});
