/**
 * Composition smoke test — boots the real forRoot module composition (DB
 * faked at the repository boundary only), asserts port resolution through
 * the forRoot chain, and runs one real calculate() end-to-end.
 *
 * ## What it proves
 *
 * - ApplicationApiModule.forRoot → CoreDomainModule.forRoot →
 *   CalculatorModule.forRoot + TaxModule.forRoot chain resolves all port
 *   tokens to non-null implementations (D1 guard).
 * - LandedCostCalculatorService receives PRODUCT_DATA_PORT and
 *   CALCULATION_RECORD_PORT as non-null injectables.
 * - AlcoholExciseService receives TAX_RULE_REPOSITORY_PORT.
 * - A full calculate() call succeeds end-to-end through the real orchestrator.
 *
 * ## DB isolation
 *
 * No PostgreSQL, Redis, or external services needed.  All domain ports are
 * overridden with in-memory implementations seeded with test data.
 *
 * ## Module structure
 *
 * AppModule imports:
 *   DataAcquisitionModule + DataPlatformModule +
 *   ApplicationApiModule.forRoot({ productDataPort, calculationRecordPort })
 *
 * ApplicationApiModule.forRoot builds:
 *   DataPlatformModule + CoreDomainModule.forRoot({...}) + API/feature modules
 *
 * CoreDomainModule.forRoot builds:
 *   CalculatorModule.forRoot({...}) + TaxModule.forRoot({...}) + domain modules
 *
 * This test composes CoreDomainModule.forRoot directly, which exercises the
 * same forRoot chain.  DataPlatformModule and API/infrastructure modules are
 * tested in the integration and e2e suites respectively.
 *
 * @module CompositionSmokeTest
 */
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  LandedCostCalculatorService,
  CoreDomainModule,
  PRODUCT_DATA_PORT,
  CALCULATION_RECORD_PORT,
  TAX_RULE_REPOSITORY_PORT,
  TRANSPORT_OFFER_QUERY,
  type IProductDataPort,
  type ICalculationRecordPort,
  type CalculatorProductData,
  type CalculatorRetailOfferData,
  type CreateCalculationRecordInput,
  type ITaxRuleRepositoryPort,
  type TaxRuleRecordPort,
  type ITransportOfferQuery,
  type TransportOffer,
  TAX_TYPES,
} from '@rajahinta/core-domain';
import { ProductDataAdapter } from '../../src/adapters/product-data.adapter';
import { CalculationRecordAdapter } from '../../src/adapters/calculation-record.adapter';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOW = new Date('2025-06-01T12:00:00Z');

// ---------------------------------------------------------------------------
// In-memory port implementations
// ---------------------------------------------------------------------------

class InMemoryProductDataPort implements IProductDataPort {
  private products = new Map<number, CalculatorProductData>();
  private offers = new Map<number, CalculatorRetailOfferData[]>();

  seed(product: CalculatorProductData, productOffers: CalculatorRetailOfferData[]): void {
    this.products.set(product.id, product);
    this.offers.set(product.id, productOffers);
  }

  async findProductById(id: number): Promise<CalculatorProductData | null> {
    return this.products.get(id) ?? null;
  }

  async findRetailOffers(id: number): Promise<CalculatorRetailOfferData[]> {
    return this.offers.get(id) ?? [];
  }
}

class InMemoryCalculationRecordPort implements ICalculationRecordPort {
  private records: Array<{ id: number; input: CreateCalculationRecordInput }> = [];
  private nextId = 1001;

  get persistedCount(): number {
    return this.records.length;
  }

  get persistedRecord(): { id: number; input: CreateCalculationRecordInput } | null {
    return this.records.length > 0 ? this.records[this.records.length - 1] : null;
  }

  async create(input: CreateCalculationRecordInput): Promise<{ id: number }> {
    const id = this.nextId++;
    this.records.push({ id, input });
    return { id };
  }
}

class InMemoryTaxRuleRepository implements ITaxRuleRepositoryPort {
  private rules: TaxRuleRecordPort[] = [];

  seed(rules: TaxRuleRecordPort[]): void {
    this.rules.push(...rules);
  }

  async findApplicable(
    taxType: string,
    productCategory: string,
    _asOf: Date,
  ): Promise<TaxRuleRecordPort | null> {
    const exact = this.rules.find(
      (r) => r.taxType === taxType && r.productCategory === productCategory,
    );
    if (exact) return exact;
    return this.rules.find((r) => r.taxType === taxType) ?? null;
  }

  async findAllApplicable(
    taxType: string,
    productCategory: string,
    _asOf: Date,
  ): Promise<TaxRuleRecordPort[]> {
    return this.rules.filter(
      (r) => r.taxType === taxType && r.productCategory === productCategory,
    );
  }

  async findHistoryRates(
    taxType: string,
    productCategory: string,
    _fromDate: Date,
    _toDate: Date,
  ): Promise<TaxRuleRecordPort[]> {
    return this.rules.filter(
      (r) => r.taxType === taxType && r.productCategory === productCategory,
    );
  }

  async findActiveVersionLabels(): Promise<readonly string[]> {
    return [...new Set(this.rules.map((r) => r.versionLabel))];
  }
}

class InMemoryTransportOfferQuery implements ITransportOfferQuery {
  private offers: TransportOffer[] = [];

  seed(offers: TransportOffer[]): void {
    this.offers.push(...offers);
  }

  async findAllActive(): Promise<TransportOffer[]> {
    return this.offers;
  }

  async findByCarrier(carrierId: string): Promise<TransportOffer[]> {
    return this.offers.filter((o) => o.carrier === carrierId);
  }
}

// ---------------------------------------------------------------------------
// Seed data — matches golden dataset v1.0 values (same as e2e test)
// ---------------------------------------------------------------------------

const PRODUCT_BEER: CalculatorProductData = {
  id: 1,
  regulatoryClassification: 'beer',
  category: 'beer',
  volumeLitres: 0.5,
  alcoholByVolume: 0.05,
  containerType: 'can',
  depositSystemStatus: true,
  weightKg: 0.55,
  normalizedName: 'Premium Lager 5%',
};

const OFFER_BEER: CalculatorRetailOfferData = {
  id: 100,
  priceCents: 200,
  merchant: 'beverage-de',
  country: 'DE',
  reliabilityStatus: 'VERIFIED',
};

const TRANSPORT_OFFER: TransportOffer = {
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
  reliabilityStatus: 'VERIFIED',
};

const VERIFIED_DATE = new Date('2024-03-01');
const EFFECTIVE_FROM = new Date('2024-01-01');
const SOURCE = 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)';
const VERSION = 'v1.0-2024';

const BEER_EXEMPT: TaxRuleRecordPort = {
  id: 1,
  taxType: TAX_TYPES.excise,
  productCategory: 'beer',
  rate: '0.00',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_DEGREE_PLATO',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { maxAlcoholByVolume: 0.5 },
};

const BEER_MID: TaxRuleRecordPort = {
  id: 2,
  taxType: TAX_TYPES.excise,
  productCategory: 'beer',
  rate: '28.35',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_DEGREE_PLATO',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { minAlcoholByVolume: 0.5, maxAlcoholByVolume: 3.5 },
};

const BEER_FULL: TaxRuleRecordPort = {
  id: 3,
  taxType: TAX_TYPES.excise,
  productCategory: 'beer',
  rate: '36.20',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'PER_DEGREE_PLATO',
  officialSource: SOURCE,
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: { minAlcoholByVolume: 3.5 },
};

const CONTAINER_DUTY_RULE: TaxRuleRecordPort = {
  id: 4,
  taxType: TAX_TYPES.containerDuty,
  productCategory: 'all_beverages',
  rate: '0.51',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'FLAT_PER_LITRE',
  officialSource: 'Finnish Tax Administration — Beverage Container Duty Rate 2024 (vero.fi)',
  verificationDate: VERIFIED_DATE,
  versionLabel: VERSION,
  exemptionConditions: null,
};

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('Composition smoke — forRoot chain (CoreDomain.forRoot)', () => {
  let app: INestApplication;
  let testingModule: TestingModule;
  let calculator: LandedCostCalculatorService;

  beforeAll(async () => {
    // Build in-memory ports with seeded data
    const productDataPort = new InMemoryProductDataPort();
    const calcRecordPort = new InMemoryCalculationRecordPort();
    const taxRuleRepo = new InMemoryTaxRuleRepository();
    const transportQuery = new InMemoryTransportOfferQuery();

    productDataPort.seed(PRODUCT_BEER, [OFFER_BEER]);
    taxRuleRepo.seed([BEER_EXEMPT, BEER_MID, BEER_FULL, CONTAINER_DUTY_RULE]);
    transportQuery.seed([TRANSPORT_OFFER]);

    testingModule = await Test.createTestingModule({
      // Boot CoreDomainModule.forRoot with real port adapters. This is the
      // same forRoot chain that AppModule uses (via ApplicationApiModule.forRoot
      // → CoreDomainModule.forRoot → CalculatorModule.forRoot + TaxModule.forRoot).
      //
      // DataPlatformModule is omitted because all domain ports are overridden
      // with in-memory implementations — no Drizzle repository resolution is
      // needed.  DataPlatformModule's exclusion does not affect the forRoot
      // composition assertion: the forRoot chain is fully exercised.
      imports: [
        CoreDomainModule.forRoot({
          productDataPort: ProductDataAdapter,
          calculationRecordPort: CalculationRecordAdapter,
        }),
      ],
    })
      // Domain ports overridden with in-memory implementations seeded with
      // test data so the calculator has real data to process.
      .overrideProvider(PRODUCT_DATA_PORT)
      .useValue(productDataPort)
      .overrideProvider(CALCULATION_RECORD_PORT)
      .useValue(calcRecordPort)
      .overrideProvider(TAX_RULE_REPOSITORY_PORT)
      .useValue(taxRuleRepo)
      .overrideProvider(TRANSPORT_OFFER_QUERY)
      .useValue(transportQuery)
      .compile();

    app = testingModule.createNestApplication();
    await app.init();

    calculator = testingModule.get(LandedCostCalculatorService, { strict: false });
  });

  afterAll(async () => {
    await app?.close();
  });

  // -----------------------------------------------------------------------
  // Port resolution — asserts the forRoot chain wired ports correctly
  // -----------------------------------------------------------------------

  describe('port resolution via ModuleRef', () => {
    it('resolves PRODUCT_DATA_PORT as non-null', () => {
      const port = testingModule.get(PRODUCT_DATA_PORT, { strict: false });
      expect(port).not.toBeNull();
      expect(typeof port.findProductById).toBe('function');
    });

    it('resolves CALCULATION_RECORD_PORT as non-null', () => {
      const port = testingModule.get(CALCULATION_RECORD_PORT, { strict: false });
      expect(port).not.toBeNull();
      expect(typeof port.create).toBe('function');
    });

    it('resolves TAX_RULE_REPOSITORY_PORT as non-null', () => {
      const port = testingModule.get(TAX_RULE_REPOSITORY_PORT, { strict: false });
      expect(port).not.toBeNull();
      expect(typeof port.findAllApplicable).toBe('function');
    });

    it('resolves LandedCostCalculatorService as non-null', () => {
      expect(calculator).not.toBeNull();
      expect(calculator).toBeInstanceOf(LandedCostCalculatorService);
    });
  });

  // -----------------------------------------------------------------------
  // Real calculate() — end-to-end through the real orchestrator
  // -----------------------------------------------------------------------

  describe('calculate() end-to-end through LandedCostCalculatorService', () => {
    it('returns the expected computed values for beer (golden dataset)', async () => {
      const result = await calculator.calculate({
        productId: 1,
        quantity: 1,
        destination: 'FI',
        transportMethod: 'carrierA',
      });

      // Golden dataset assertions (same as e2e test):
      //   Beer 5% ABV, 0.5 L, depositSystemStatus=true
      //   excise = Math.round(36.20 × 0.05 × 0.5 × 100) = 91¢
      //   container: deposit exempt → 0¢
      //   transport: DE→FI, carrierA, 150¢
      //   retail: 200¢
      //   total: 200 + 150 + 91 + 0 + 0 = 441
      expect(result.foreignRetailPrice).toBe(200);
      expect(result.transportCost).toBe(150);
      expect(result.alcoholExciseEstimate).toBe(91);
      expect(result.containerDutyEstimate).toBe(0);
      // Task 10.3 removed otherCharges from the result shape — the key
      // must be absent, not zero.
      expect('otherCharges' in result).toBe(false);
      expect(result.totalCents).toBe(441);

      // New live-path fields (task 1.5) — EUR-only offers: no exclusions.
      expect(result.excludedOffers).toEqual([]);
      expect(result.originalRetailPrice).toBeUndefined();

      // Structure assertions
      expect(result.currency).toBe('EUR');
      expect(result.confidence).toBeDefined();
      expect(result.disclaimer).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.calculationRecordId).toBeGreaterThanOrEqual(1001);
      expect(result.itemizedCosts).toBeInstanceOf(Array);
      expect(result.itemizedCosts.length).toBeGreaterThanOrEqual(4);
    });
  });
});