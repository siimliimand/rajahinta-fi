/**
 * End-to-end integration test: calculator HTTP layer with guard enforcement.
 *
 * Bootstraps a NestJS application, drives requests through supertest
 * (the full HTTP layer including guards), and verifies:
 *
 * 1. Gated endpoints return 200 when launch gates are open AND an age
 *    confirmation token (`x-age-confirmed`) is sent.
 * 2. Gated endpoints return 403 when the age token is omitted.
 * 3. Gated endpoints return 403 when launch gates are closed.
 * 4. The calculation result has the correct structure and computed values
 *    (golden dataset assertions preserved).
 * 5. The calculation record is persisted via the domain port.
 *
 * All data-access ports use in-memory implementations — no PostgreSQL,
 * no Redis, no external HTTP.
 *
 * @module CalculatorE2ETests
 */
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  CoreDomainModule,
  type IProductDataPort,
  type ICalculationRecordPort,
  PRODUCT_DATA_PORT,
  CALCULATION_RECORD_PORT,
  type CalculatorProductData,
  type CalculatorRetailOfferData,
  type CreateCalculationRecordInput,
  TAX_RULE_REPOSITORY_PORT,
  type ITaxRuleRepositoryPort,
  type TaxRuleRecordPort,
  type ITransportOfferQuery,
  type TransportOffer,
} from '@rajahinta/core-domain';
import {
  CalculationRecordRepository,
  calculationRecords,
} from '@rajahinta/data-platform';
import {
  CalculatorController,
  IdempotencyModule,
  RateLimitingModule,
  RATE_LIMITER,
  FeatureFlagsModule,
  AgeGateModule,
} from '@rajahinta/application-api';

// -------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------

/** Injection token for ITransportOfferQuery — same string as the domain constant. */
const TRANSPORT_OFFER_QUERY = 'TRANSPORT_OFFER_QUERY';

const NOW = new Date('2025-06-01T12:00:00Z');

/** Permissive rate limiter — never throttles during tests. */
const NEVER_RATE_LIMIT = {
  check: () => true,
  remaining: () => 999,
  resetAt: () => Date.now() + 60_000,
};

// -------------------------------------------------------------------
// In-memory CalculationRecordRepository
// -------------------------------------------------------------------

class InMemoryCalculationRecordRepository extends CalculationRecordRepository {
  private records = new Map<number, typeof calculationRecords.$inferSelect>();
  private nextId = 1;

  /** Expose the store for test assertions. */
  get allRecords(): typeof calculationRecords.$inferSelect[] {
    return [...this.records.values()];
  }

  override async create(
    record: typeof calculationRecords.$inferInsert,
  ): Promise<typeof calculationRecords.$inferSelect> {
    const id = this.nextId++;
    const row = {
      id,
      ...record,
      calculatedAt: NOW,
    } as typeof calculationRecords.$inferSelect;
    this.records.set(id, row);
    return row;
  }

  override async findById(
    id: number,
  ): Promise<typeof calculationRecords.$inferSelect | null> {
    return this.records.get(id) ?? null;
  }

  override async findBySession(
    _sessionId: string,
  ): Promise<typeof calculationRecords.$inferSelect[]> {
    return [];
  }
}

// -------------------------------------------------------------------
// In-memory product-data port (domain-level read models)
// -------------------------------------------------------------------

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

// -------------------------------------------------------------------
// In-memory calculation-record port (domain-level persistence)
// -------------------------------------------------------------------

class InMemoryCalculationRecordPort implements ICalculationRecordPort {
  private records: Array<{ id: number; input: CreateCalculationRecordInput }> = [];
  private nextId = 1001;

  /** Expose for test assertions. */
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

// -------------------------------------------------------------------
// In-memory tax rule repository (domain-port adapter interface)
// -------------------------------------------------------------------

class InMemoryTaxRuleRepository implements ITaxRuleRepositoryPort {
  private rules: TaxRuleRecordPort[] = [];

  seed(rules: TaxRuleRecordPort[]): void {
    this.rules.push(...rules);
  }

  async findApplicable(
    taxType: string,
    productCategory: string,
  ): Promise<TaxRuleRecordPort | null> {
    // Match by type + category; prefer exact category match.
    const exact = this.rules.find(
      (r) => r.taxType === taxType && r.productCategory === productCategory,
    );
    if (exact) return exact;

    // Fallback: any rule for this tax type
    return this.rules.find((r) => r.taxType === taxType) ?? null;
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
    const now = new Date();
    return this.rules
      .filter(
        (r) =>
          r.effectiveFrom <= now &&
          (r.effectiveTo === null || r.effectiveTo > now),
      )
      .map((r) => r.versionLabel)
      .filter((v, i, a) => a.indexOf(v) === i); // distinct
  }
}

// -------------------------------------------------------------------
// In-memory transport offer query (domain-port adapter interface)
// -------------------------------------------------------------------

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

// -------------------------------------------------------------------
// Seed data — matches the golden dataset v1.0 values
// -------------------------------------------------------------------

/** Product 1 — Beer (can, 0.5 L, 5% ABV). */
const PRODUCT_BEER_DATA: CalculatorProductData = {
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

const OFFER_BEER_DATA: CalculatorRetailOfferData = {
  id: 100,
  priceCents: 200,
  merchant: 'beverage-de',
  country: 'DE',
  reliabilityStatus: 'EXACT',
};

/** Transport offer for carrierA: DE → FI, parcel up to 1 kg. */
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
  reliabilityStatus: 'EXACT',
};

/** Seeded tax rules so engines use real rates (no fallback). */
const BEER_EXCISE_RULE: TaxRuleRecordPort = {
  id: 1,
  taxType: 'excise_duty',
  productCategory: 'beer',
  rate: '33.00',
  effectiveFrom: new Date('2024-01-01'),
  effectiveTo: null,
  calculationFormulaReference: 'PROGRESSIVE_ABV',
  officialSource: 'Finnish Tax Administration — 2024',
  verificationDate: new Date('2024-03-01'),
  versionLabel: 'v1.0-2024',
};

const CONTAINER_DUTY_RULE: TaxRuleRecordPort = {
  id: 2,
  taxType: 'container_duty',
  productCategory: 'can',
  rate: '0.51',
  effectiveFrom: new Date('2024-01-01'),
  effectiveTo: null,
  calculationFormulaReference: 'FLAT_PER_LITRE',
  officialSource: 'Finnish Tax Administration — 2024',
  verificationDate: new Date('2024-03-01'),
  versionLabel: 'v1.0-2024',
};

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

/** Standard POST body for a beer calculation (quantity 1). */
const BEER_DTO = {
  productId: 1,
  quantity: 1,
  destination: 'FI',
  transportMethod: 'carrierA',
};

/** Standard POST body for beer with quantity 2. */
const BEER_DTO_QTY_2 = {
  productId: 1,
  quantity: 2,
  destination: 'FI',
  transportMethod: 'carrierA',
};

/** Build a seeded NestJS test module and return the app + in-memory stores. */
async function buildTestModule(gatesOpen: boolean): Promise<{
  app: INestApplication;
  calcRecordPort: InMemoryCalculationRecordPort;
  calcRecordRepo: InMemoryCalculationRecordRepository;
}> {
  if (gatesOpen) {
    process.env.LAUNCH_GATES_OVERRIDE = 'true';
  } else {
    // Ensure the override is absent so LaunchGateService reads all gates as false.
    delete process.env.LAUNCH_GATES_OVERRIDE;
  }

  const productDataPort = new InMemoryProductDataPort();
  const calcRecordPort = new InMemoryCalculationRecordPort();
  const calcRecordRepo = new InMemoryCalculationRecordRepository();
  const taxRuleRepo = new InMemoryTaxRuleRepository();
  const transportQuery = new InMemoryTransportOfferQuery();

  // Seed data
  productDataPort.seed(PRODUCT_BEER_DATA, [OFFER_BEER_DATA]);
  taxRuleRepo.seed([BEER_EXCISE_RULE, CONTAINER_DUTY_RULE]);
  transportQuery.seed([TRANSPORT_OFFER]);

  const moduleRef = await Test.createTestingModule({
    imports: [
      CoreDomainModule,
      IdempotencyModule,
      RateLimitingModule,
      FeatureFlagsModule,
      AgeGateModule,
    ],
    controllers: [CalculatorController],
    providers: [
      { provide: CalculationRecordRepository, useValue: calcRecordRepo },
    ],
  })
    .overrideProvider(PRODUCT_DATA_PORT)
    .useValue(productDataPort)
    .overrideProvider(CALCULATION_RECORD_PORT)
    .useValue(calcRecordPort)
    .overrideProvider(TAX_RULE_REPOSITORY_PORT)
    .useValue(taxRuleRepo)
    .overrideProvider(TRANSPORT_OFFER_QUERY)
    .useValue(transportQuery)
    .overrideProvider(RATE_LIMITER)
    .useValue(NEVER_RATE_LIMIT)
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  return { app, calcRecordPort, calcRecordRepo };
}

// -------------------------------------------------------------------
// Test suite
// -------------------------------------------------------------------

describe('Calculator e2e — HTTP layer with guard enforcement', () => {
  // ===================================================================
  // Gates open — LAUNCH_GATES_OVERRIDE=true
  // ===================================================================

  describe('gates open (LAUNCH_GATES_OVERRIDE=true)', () => {
    let app: INestApplication;
    let calcRecordPort: InMemoryCalculationRecordPort;
    let calcRecordRepo: InMemoryCalculationRecordRepository;

    beforeAll(async () => {
      const built = await buildTestModule(true);
      app = built.app;
      calcRecordPort = built.calcRecordPort;
      calcRecordRepo = built.calcRecordRepo;
    });

    afterAll(async () => {
      await app?.close();
      delete process.env.LAUNCH_GATES_OVERRIDE;
    });

    // -----------------------------------------------------------------
    // 200 — calculation with age token
    // -----------------------------------------------------------------

    describe('POST /api/v1/calculator — 200 with age token', () => {
      it('returns 200 with the correct result structure', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/v1/calculator')
          .set('x-age-confirmed', 'test-token')
          .send(BEER_DTO)
          .expect(200);

        const result = res.body;

        // --- Top-level fields ---
        expect(result).toHaveProperty('totalCents');
        expect(result).toHaveProperty('currency', 'EUR');
        expect(result).toHaveProperty('confidence');
        expect(result).toHaveProperty('confidenceBreakdown');
        expect(result).toHaveProperty('disclaimer');
        expect(result).toHaveProperty('classification');
        expect(result).toHaveProperty('metadata');
        expect(result).toHaveProperty('calculationRecordId');
        expect(result).toHaveProperty('itemizedCosts');
        expect(result).toHaveProperty('foreignRetailPrice');
        expect(result).toHaveProperty('transportCost');
        expect(result).toHaveProperty('alcoholExciseEstimate');
        expect(result).toHaveProperty('containerDutyEstimate');
        expect(result).toHaveProperty('otherCharges');

        // --- Itemized costs ---
        expect(result.itemizedCosts).toBeInstanceOf(Array);
        expect(result.itemizedCosts.length).toBeGreaterThanOrEqual(4);
        for (const item of result.itemizedCosts) {
          expect(item).toHaveProperty('label');
          expect(item).toHaveProperty('category');
          expect(item).toHaveProperty('cents');
          expect(typeof item.cents).toBe('number');
          expect(item).toHaveProperty('reliability');
        }
      });

      it('returns the expected computed values for beer (golden dataset)', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/v1/calculator')
          .set('x-age-confirmed', 'test-token')
          .send(BEER_DTO)
          .expect(200);

        const result = res.body;

        // Beer 5% ABV, 0.5 L, depositSystemStatus=true
        // progressive ABV: tier maxAbv=8.0, rate=0.435, excise=round(0.435*0.5*100)=22¢
        // container: depositSystem=true → EXEMPTED → 0¢
        // transport: DE→FI, carrierA, 150¢
        // retail: 200¢
        // total: 200 + 150 + 22 + 0 + 0 = 372
        expect(result.foreignRetailPrice).toBe(200);
        expect(result.transportCost).toBe(150);
        expect(result.alcoholExciseEstimate).toBe(22);
        expect(result.containerDutyEstimate).toBe(0);
        expect(result.otherCharges).toBe(0);
        expect(result.totalCents).toBe(372);
      });

      it('classifies the transaction', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/v1/calculator')
          .set('x-age-confirmed', 'test-token')
          .send(BEER_DTO)
          .expect(200);

        const result = res.body;
        expect(result.classification).toHaveProperty('classification');
        expect(result.classification).toHaveProperty('confidence');
        expect(result.classification.confidence).toBe('HIGH');
      });

      it('includes metadata with product info', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/v1/calculator')
          .set('x-age-confirmed', 'test-token')
          .send(BEER_DTO)
          .expect(200);

        const result = res.body;
        expect(result.metadata.productMasterId).toBe(1);
        expect(result.metadata.quantity).toBe(1);
        expect(result.metadata.destination).toBe('FI');
        expect(result.metadata.productName).toBe('Premium Lager 5%');
        expect(result.metadata.retailOfferIds).toContain(100);
        expect(result.metadata.transportOfferId).toBe(900);
      });
    });

    // -----------------------------------------------------------------
    // Persistence verification through HTTP
    // -----------------------------------------------------------------

    describe('persistence', () => {
      it('stores a calculation record via the domain port after a successful POST', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/calculator')
          .set('x-age-confirmed', 'test-token')
          .send(BEER_DTO_QTY_2)
          .expect(200);

        // The ICalculationRecordPort should have been written to
        expect(calcRecordPort.persistedCount).toBeGreaterThanOrEqual(1);

        const record = calcRecordPort.persistedRecord;
        expect(record).not.toBeNull();
        expect(record!.input.productMasterId).toBe(1);
        expect(record!.input.quantity).toBe(2);
        expect(record!.input.destination).toBe('FI');
        expect(record!.input.totalCents).toBeGreaterThan(0);
      });

      it('assigns a calculationRecordId visible in the response', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/v1/calculator')
          .set('x-age-confirmed', 'test-token')
          .send(BEER_DTO)
          .expect(200);

        const result = res.body;
        expect(result.calculationRecordId).toBeGreaterThanOrEqual(1001);

        // The port should have this record
        expect(calcRecordPort.persistedCount).toBeGreaterThanOrEqual(1);
        expect(calcRecordPort.persistedRecord?.input.productMasterId).toBe(1);
        expect(calcRecordPort.persistedRecord?.input.totalCents).toBeGreaterThan(0);
      });
    });

    // -----------------------------------------------------------------
    // Error handling through HTTP
    // -----------------------------------------------------------------

    describe('error handling', () => {
      it('returns 404 for a non-existent product', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/calculator')
          .set('x-age-confirmed', 'test-token')
          .send({ productId: 999, quantity: 1, destination: 'FI' })
          .expect(404);
      });

      it('returns 400 for invalid input', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/calculator')
          .set('x-age-confirmed', 'test-token')
          .send({ productId: -1, quantity: 1, destination: 'FI' })
          .expect(400);
      });
    });

    // -----------------------------------------------------------------
    // Guard enforcement — 403 when age token is missing
    // -----------------------------------------------------------------

    describe('guard enforcement — 403 when age token missing', () => {
      it('POST /api/v1/calculator returns 403 when x-age-confirmed is not sent', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/calculator')
          .send(BEER_DTO)
          .expect(403);
      });

      it('GET /api/v1/calculator/result/:recordId returns 403 when x-age-confirmed is not sent', async () => {
        await request(app.getHttpServer())
          .get('/api/v1/calculator/result/1')
          .expect(403);
      });
    });

    // -----------------------------------------------------------------
    // GET /api/v1/calculator/result/:recordId — with age token
    // -----------------------------------------------------------------

    describe('GET /api/v1/calculator/result/:recordId — 200 with age token', () => {
      it('returns 200 for an existing record', async () => {
        // Seed a record directly in the repository
        const seeded = await calcRecordRepo.create({
          productMasterId: 1,
          retailOfferIds: [100],
          transportOfferId: 900,
          exciseRuleVersionId: null,
          containerDutyRuleVersionId: null,
          totalCents: 372,
          breakdown: [],
          confidence: 'HIGH',
          quantity: 1,
          destination: 'FI',
          disclaimer: 'Test disclaimer',
          sessionId: null,
        });

        const res = await request(app.getHttpServer())
          .get(`/api/v1/calculator/result/${seeded.id}`)
          .set('x-age-confirmed', 'test-token')
          .expect(200);

        expect(res.body).toHaveProperty('id', seeded.id);
        expect(res.body).toHaveProperty('totalCents', 372);
        expect(res.body).toHaveProperty('productMasterId', 1);
      });

      it('returns 404 for a non-existent record', async () => {
        await request(app.getHttpServer())
          .get('/api/v1/calculator/result/99999')
          .set('x-age-confirmed', 'test-token')
          .expect(404);
      });
    });
  });

  // ===================================================================
  // Gates off — no LAUNCH_GATES_OVERRIDE
  // ===================================================================

  describe('gates off (no override)', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const built = await buildTestModule(false);
      app = built.app;
    });

    afterAll(async () => {
      await app?.close();
    });

    describe('POST /api/v1/calculator — 403 when launch gates are closed', () => {
      it('returns 403 even when age token is sent (launch gate blocks first)', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/calculator')
          .set('x-age-confirmed', 'test-token')
          .send(BEER_DTO)
          .expect(403);
      });

      it('returns 403 when both age token and launch gates are missing', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/calculator')
          .send(BEER_DTO)
          .expect(403);
      });
    });

    describe('GET /api/v1/calculator/result/:recordId — 403 when launch gates are closed', () => {
      it('returns 403 with age token', async () => {
        await request(app.getHttpServer())
          .get('/api/v1/calculator/result/1')
          .set('x-age-confirmed', 'test-token')
          .expect(403);
      });

      it('returns 403 without age token', async () => {
        await request(app.getHttpServer())
          .get('/api/v1/calculator/result/1')
          .expect(403);
      });
    });
  });
});