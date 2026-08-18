/**
 * End-to-end integration test: calculator request → persisted record.
 *
 * Bootstraps a NestJS test module with all real domain services and registers
 * in-memory implementations for every data-access port.  Seeds known product,
 * tax, and transport data, then makes a calculation through the HTTP
 * controller and verifies:
 *
 * 1. The result is returned with the correct structure and computed values.
 * 2. A calculation record is persisted in the in-memory store.
 *
 * No PostgreSQL, no Redis, no external HTTP — every external call is
 * backed by an in-memory equivalent.
 *
 * @module CalculatorE2ETests
 */
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CoreDomainModule,
  LandedCostCalculatorService,
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
  productMaster,
  calculationRecords,
} from '@rajahinta/data-platform';
import {
  CalculatorController,
  IdempotencyModule,
  RateLimitingModule,
} from '@rajahinta/application-api';

// -------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------

/** Injection token for ITransportOfferQuery — same string as the domain constant. */
const TRANSPORT_OFFER_QUERY = 'TRANSPORT_OFFER_QUERY';

const NOW = new Date('2025-06-01T12:00:00Z');

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
// Test suite
// -------------------------------------------------------------------

describe('Calculator e2e — controller → real engines → persisted record', () => {
  let app: INestApplication;
  let controller: CalculatorController;
  let calcRecordPort: InMemoryCalculationRecordPort;
  let calcRecordRepo: InMemoryCalculationRecordRepository;

  beforeAll(async () => {
    // --- In-memory instances (shared so assertions can inspect them) ---
    const productDataPort = new InMemoryProductDataPort();
    calcRecordPort = new InMemoryCalculationRecordPort();
    calcRecordRepo = new InMemoryCalculationRecordRepository();
    const taxRuleRepo = new InMemoryTaxRuleRepository();
    const transportQuery = new InMemoryTransportOfferQuery();

    // --- Seed data ---
    productDataPort.seed(PRODUCT_BEER_DATA, [OFFER_BEER_DATA]);
    taxRuleRepo.seed([BEER_EXCISE_RULE, CONTAINER_DUTY_RULE]);
    transportQuery.seed([TRANSPORT_OFFER]);

    // --- Build NestJS test module ---
    const moduleRef = await Test.createTestingModule({
      imports: [CoreDomainModule, IdempotencyModule, RateLimitingModule],
      providers: [
        CalculatorController,
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
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    controller = app.get(CalculatorController);
  });

  afterAll(async () => {
    await app?.close();
  });

  // -------------------------------------------------------------------
  // Test: POST /api/v1/calculator — full calculation flow
  // -------------------------------------------------------------------

  describe('POST /api/v1/calculator', () => {
    it('returns a result with the correct structure', async () => {
      const dto = {
        productId: 1,
        quantity: 1,
        destination: 'FI',
        transportMethod: 'carrierA',
      };

      const result = await controller.calculate(dto, undefined);

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
      const dto = {
        productId: 1,
        quantity: 1,
        destination: 'FI',
        transportMethod: 'carrierA',
      };

      const result = await controller.calculate(dto, undefined);

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
      const dto = {
        productId: 1,
        quantity: 1,
        destination: 'FI',
        transportMethod: 'carrierA',
      };

      const result = await controller.calculate(dto, undefined);
      expect(result.classification).toHaveProperty('classification');
      expect(result.classification).toHaveProperty('confidence');
      expect(result.classification.confidence).toBe('HIGH');
    });

    it('includes metadata with product info', async () => {
      const dto = {
        productId: 1,
        quantity: 1,
        destination: 'FI',
        transportMethod: 'carrierA',
      };

      const result = await controller.calculate(dto, undefined);
      expect(result.metadata.productMasterId).toBe(1);
      expect(result.metadata.quantity).toBe(1);
      expect(result.metadata.destination).toBe('FI');
      expect(result.metadata.productName).toBe('Premium Lager 5%');
      expect(result.metadata.retailOfferIds).toContain(100);
      expect(result.metadata.transportOfferId).toBe(900);
    });
  });

  // -------------------------------------------------------------------
  // Test: Persistence verification
  // -------------------------------------------------------------------

  describe('persistence', () => {
    it('stores a calculation record via the domain port', async () => {
      // Make a fresh calculation so we can verify the count
      const dto = {
        productId: 1,
        quantity: 2,
        destination: 'FI',
        transportMethod: 'carrierA',
      };

      await controller.calculate(dto, undefined);
      expect(calcRecordPort.persistedCount).toBeGreaterThanOrEqual(1);

      const record = calcRecordPort.persistedRecord;
      expect(record).not.toBeNull();
      expect(record!.input.productMasterId).toBe(1);
      expect(record!.input.quantity).toBe(2);
      expect(record!.input.destination).toBe('FI');
      expect(record!.input.totalCents).toBeGreaterThan(0);
    });

    it('assigns a calculationRecordId and the record is accessible via the port', async () => {
      const dto = {
        productId: 1,
        quantity: 1,
        destination: 'FI',
        transportMethod: 'carrierA',
      };

      const result = await controller.calculate(dto, undefined);
      expect(result.calculationRecordId).toBeGreaterThanOrEqual(1001);

      // Verify the port knows about this record
      expect(calcRecordPort.persistedCount).toBeGreaterThanOrEqual(1);
      expect(calcRecordPort.persistedRecord?.input.productMasterId).toBe(1);
      expect(calcRecordPort.persistedRecord?.input.totalCents).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------
  // Test: Error handling via controller
  // -------------------------------------------------------------------

  describe('error handling', () => {
    it('throws NotFoundException for a non-existent product', async () => {
      const dto = {
        productId: 999,
        quantity: 1,
        destination: 'FI',
      };

      await expect(controller.calculate(dto, undefined)).rejects.toThrow();
    });

    it('rejects invalid input', async () => {
      const invalidDto = {
        productId: -1,
        quantity: 1,
        destination: 'FI',
      };

      await expect(controller.calculate(invalidDto, undefined)).rejects.toThrow();
    });
  });
});