/**
 * Load/performance test — Basket Optimizer engine (task 11.2, change
 * technical-assessment-remediation).
 *
 * Measures the basket optimization engine's throughput under load by
 * calling BasketOptimizerService.optimize directly with mocked I/O
 * ports (product data, merchant terms, transport offers), a REAL
 * LandedCostCalculatorService with mocked tax/transport engines (same
 * pattern as calculator-load.test.ts), and a REAL
 * BasketShippingCalculator over a mocked transport-offer query — so the
 * measurement covers the optimizer's full CPU cost: candidate building,
 * per-(item, merchant) cost computation, DFS enumeration of merchant
 * assignments with lazy merchant-subset shipping memoization,
 * deterministic sorting, and result assembly.
 *
 * **Scenarios:**
 *   - typical:  4 items × 4 candidate merchants  (4^4   = 256
 *     assignments per call) — the expected interactive basket shape.
 *   - max-cap:  10 items × 3 shared merchants (3^10 = 59 049
 *     assignments per call) — the enumeration-heaviest shape measured
 *     at the pre-cap-30 input cap, retained as the regression
 *     reference for the DFS cost.
 *   - cap-30 feasible: 30 items (MAX_BASKET_ITEMS since change
 *     client-experience-improvement) × distinct single-candidate
 *     merchants — the raised input cap exercised end-to-end within the
 *     combinations guard.
 *   - cap-30 guard: 30 items × 3 shared merchants → 3^30 combinations,
 *     rejected by the MAX_TOTAL_COMBINATIONS guard before enumeration;
 *     the test pins the fast-fail bound.
 *   - cap-30 single-merchant: 30 items covered by ONE merchant — the
 *     Cartesian product is 1 (guard passes) and shipping is computed
 *     lazily inside the DFS, so exactly ONE shipping call serves the
 *     whole optimization. The earlier powerset prefetch would have
 *     attempted 2^30 awaited calls here; the test pins the bounded
 *     behaviour with a counting shipping calculator.
 *
 *   **Guard coverage note:** MAX_TOTAL_COMBINATIONS bounds the whole
 *   optimization — the merchant-assignment DFS and every shipping
 *   computation. Shipping is memoized per (merchant, item-subset) key on
 *   first need inside the guarded DFS (basket-optimizer.service.ts), so
 *   no shipping key can exist outside a guarded leaf and the guard
 *   bounds total work.
 *
 * **Thresholds** (explicit; measured against the historical K8s-era
 * resource envelope, kept as the regression reference — see the run
 * method notes in this header):
 *   - typical: p95 < 2 000 ms, error rate < 1 % (aligns with the
 *     artillery calculator suite's p95 target).
 *   - max-cap: p95 < 20 000 ms, error rate < 1 %. Measured envelope
 *     under that envelope (Docker --cpus=0.256 --memory=512m): a
 *     single max-cap call takes ~4.2 s and 5 concurrent max-cap calls
 *     settle at p95 ≈ 17 s on a quarter-core CPU budget — the suite
 *     pins 20 s as the regression tripwire for that envelope.
 *
 * **Guard note:** this service-level suite deliberately bypasses the
 * HTTP guard layer — exactly like calculator-load.test.ts bypasses
 * rate limiting; the HTTP-level guard/rate-limit behaviour is
 * covered by tests/load/artillery/basket-optimizer-suite.yml against a
 * deployed target.
 *
 * **Resource-limits method (256m CPU / 512Mi mem):** the K8s manifests
 * that pinned these limits were deleted at decommission (task 6.7,
 * migrate-to-cloudflare); the envelope below remains the historical
 * reference the thresholds were measured against. To reproduce it, run
 * this file inside Docker with matching constraints:
 *
 *   docker run --rm --cpus=0.256 --memory=512m \
 *     -v "$PWD":/work -w /work node:22-alpine \
 *     node_modules/.bin/vitest run --config tests/load/vitest.config.ts \
 *     tests/load/basket-optimizer-load.test.ts
 *
 * (see the load-suite run notes for the executed command and results).
 *
 * Uses Promise.all for concurrency (no external tools needed).
 * All I/O-bound services are mocked so the test measures optimizer
 * throughput, not network latency.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  BasketOptimizerService,
  BasketShippingCalculator,
  BasketCombinationLimitError,
  LandedCostCalculatorService,
  MAX_BASKET_ITEMS,
  MAX_TOTAL_COMBINATIONS,
} from '@rajahinta/core-domain';
import type {
  BasketOptimizationInput,
  BasketOptimizationResult,
  MerchantTerms,
} from '@rajahinta/core-domain';
import type {
  CalculatorProductData,
  CalculatorRetailOfferData,
  IProductDataPort,
  ICalculationRecordPort,
} from '@rajahinta/core-domain';
import type {
  ITransportOfferQuery,
  TransportOffer,
} from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Constants — scenario shapes and thresholds
// ---------------------------------------------------------------------------

/** Concurrency for the typical scenario (matches calculator-load.test.ts). */
const TYPICAL_CONCURRENCY = 50;

/**
 * Concurrency for the max-cap scenario. Deliberately lower than the
 * typical scenario: each call enumerates 59 049 assignments and holds
 * them in memory until selection, so the peak heap scales with
 * concurrency × assignments. 5 concurrent max-cap calls ≈ 300 MB of
 * assignment objects — the honest ceiling under a 512Mi container
 * limit once the Node/Vitest baseline (~150–250 MB) is included.
 */
const MAX_CAP_CONCURRENCY = 5;

/** P95 latency thresholds in milliseconds. */
const TYPICAL_P95_THRESHOLD_MS = 2_000;
const MAX_CAP_P95_THRESHOLD_MS = 20_000;

/** Maximum allowed error rate (fraction of total requests). */
const MAX_ERROR_RATE = 0.01;

/** Warmup / measured rounds. */
const TYPICAL_WARMUP_RUNS = 3;
const TYPICAL_MEASURED_RUNS = 3;
const MAX_CAP_WARMUP_RUNS = 1;
const MAX_CAP_MEASURED_RUNS = 3;

/** Cap-30 feasible scenario: concurrency, threshold, and rounds. The
 * shape is light (distinct single-candidate merchants → 1 assignment),
 * so the typical-class p95 threshold applies. */
const CAP30_CONCURRENCY = 10;
const CAP30_P95_THRESHOLD_MS = 2_000;
const CAP30_WARMUP_RUNS = 1;
const CAP30_MEASURED_RUNS = 3;

/** Bound for the guard fast-fail at 30 items × 3 merchants: the guard
 * check itself is a 30-factor multiplication before any enumeration, so
 * even slow CI finishes in milliseconds — a full enumeration of 3^30
 * would not finish in years. */
const CAP30_GUARD_FAIL_BOUND_MS = 1_000;

// ---------------------------------------------------------------------------
// Fixtures — merchants, products, offers
// ---------------------------------------------------------------------------

/**
 * Shared merchant pool with mixed origin countries, mirroring the
 * calculator suite's fixture merchants (DE/FR/PL) plus two more so
 * typical baskets see 4–5 distinct stores.
 */
const MERCHANTS = [
  { id: 'beverage-de', country: 'DE' },
  { id: 'vintner-fr', country: 'FR' },
  { id: 'spirits-pl', country: 'PL' },
  { id: 'beverage-nl', country: 'NL' },
  { id: 'alcoshop-ee', country: 'EE' },
] as const;

/** Product profiles (same shapes as the calculator load suite). */
const PRODUCTS: CalculatorProductData[] = [
  {
    id: 1,
    regulatoryClassification: 'beer',
    category: 'beer',
    volumeLitres: 0.5,
    alcoholByVolume: 0.05,
    containerType: 'can',
    depositSystemStatus: true,
    weightKg: 0.55,
    normalizedName: 'Premium Lager 5%',
  },
  {
    id: 2,
    regulatoryClassification: 'wine',
    category: 'wine',
    volumeLitres: 0.75,
    alcoholByVolume: 0.135,
    containerType: 'bottle',
    depositSystemStatus: false,
    weightKg: 1.2,
    normalizedName: 'Chardonnay 13.5%',
  },
  {
    id: 3,
    regulatoryClassification: 'spirits',
    category: 'spirits',
    volumeLitres: 0.7,
    alcoholByVolume: 0.4,
    containerType: 'bottle',
    depositSystemStatus: true,
    weightKg: 1.0,
    normalizedName: 'Vodka 40%',
  },
];

/**
 * 30 distinct products for the raised input cap (MAX_BASKET_ITEMS).
 * Attributes cycle the three base profiles; ids are unique per line so
 * the basket matches the spec's "30 distinct items" scenario.
 */
const CAP30_PRODUCTS: CalculatorProductData[] = Array.from(
  { length: MAX_BASKET_ITEMS },
  (_, i) => ({ ...PRODUCTS[i % PRODUCTS.length], id: i + 1 }),
);

/** Deterministic offer price per (product, merchant) — varied but stable. */
function offerPriceCents(productId: number, merchantIdx: number): number {
  return 180 + productId * 37 + merchantIdx * 53;
}

/**
 * Offers per product for a scenario.
 *
 * - typical: every product is offered by the first 4 merchants of the
 *   pool (4 candidates per item, mixed countries → multi-store splits).
 * - max-cap: every product is offered by the first 3 merchants (shared
 *   across all items — 3^itemCount assignments, the heaviest shape
 *   measured at the pre-cap-30 input cap that still terminates).
 */
function buildOffersByProduct(candidatesPerItem: number): Record<
  number,
  CalculatorRetailOfferData[]
> {
  const map: Record<number, CalculatorRetailOfferData[]> = {};
  for (const product of PRODUCTS) {
    map[product.id] = MERCHANTS.slice(0, candidatesPerItem).map((m, idx) => ({
      id: product.id * 100 + idx,
      priceCents: offerPriceCents(product.id, idx),
      merchant: m.id,
      country: m.country,
      reliabilityStatus: 'EXACT',
    }));
  }
  return map;
}

const TYPICAL_OFFERS = buildOffersByProduct(4);
const MAX_CAP_OFFERS = buildOffersByProduct(3);

/**
 * Cap-30 guard-shape offers: all 30 products share the first 3 pool
 * merchants → the Cartesian product is 3^30, far above
 * MAX_TOTAL_COMBINATIONS, so the guard must fire before enumeration.
 */
function buildCap30Offers(candidatesPerItem: number): Record<
  number,
  CalculatorRetailOfferData[]
> {
  const map: Record<number, CalculatorRetailOfferData[]> = {};
  for (const product of CAP30_PRODUCTS) {
    map[product.id] = MERCHANTS.slice(0, candidatesPerItem).map((m, idx) => ({
      id: product.id * 100 + idx,
      priceCents: offerPriceCents(product.id, idx),
      merchant: m.id,
      country: m.country,
      reliabilityStatus: 'EXACT',
    }));
  }
  return map;
}

const CAP30_GUARD_OFFERS = buildCap30Offers(3);

/**
 * Cap-30 feasible-shape offers: 30 products, each from its own distinct
 * merchant (one candidate per item). The Cartesian product is 1, well
 * inside the guard, and the per-merchant shipping prefetch stays at one
 * subset per merchant — the basket shape the caps + guard demonstrably
 * bound at the raised input cap. Merchant countries cycle the pool so
 * the transport fixtures cover every origin.
 */
function buildCap30DisjointOffers(): Record<number, CalculatorRetailOfferData[]> {
  const map: Record<number, CalculatorRetailOfferData[]> = {};
  for (const product of CAP30_PRODUCTS) {
    const pool = MERCHANTS[(product.id - 1) % MERCHANTS.length];
    map[product.id] = [
      {
        id: product.id * 10,
        priceCents: offerPriceCents(product.id, 0),
        merchant: `cap30-shop-${product.id}`,
        country: pool.country,
        reliabilityStatus: 'EXACT',
      },
    ];
  }
  return map;
}

const CAP30_FEASIBLE_OFFERS = buildCap30DisjointOffers();

/**
 * Cap-30 single-merchant worst-case offers: 30 products, ALL from one
 * shared merchant. The Cartesian product is 1 — the guard passes — so
 * every shipping key the DFS can ever need is the full 30-item subset of
 * that merchant: exactly ONE shipping computation per optimize call once
 * shipping is lazily memoized (the removed powerset prefetch attempted
 * 2^30 here).
 */
const CAP30_SINGLE_OFFERS: Record<number, CalculatorRetailOfferData[]> =
  Object.fromEntries(
    CAP30_PRODUCTS.map((product) => [
      product.id,
      [
        {
          id: product.id * 10,
          priceCents: offerPriceCents(product.id, 0),
          merchant: 'solo-merchant',
          country: 'DE',
          reliabilityStatus: 'EXACT',
        },
      ],
    ]),
  );

// ---------------------------------------------------------------------------
// Fixtures — transport offers for the (real) BasketShippingCalculator
// ---------------------------------------------------------------------------

/** One carrier, two weight brackets, for every (origin, package tier) used. */
function buildTransportOffers(): TransportOffer[] {
  const offers: TransportOffer[] = [];
  let id = 0;
  const brackets = [
    { minKg: 0, maxKg: 1 },
    { minKg: 1, maxKg: 11 },
    { minKg: 11, maxKg: null },
  ];
  for (const { id: _mId, country } of MERCHANTS) {
    for (const packageTier of ['can', 'bottle'] as const) {
      for (const bracket of brackets) {
        offers.push({
          id: ++id,
          carrier: 'dhl',
          originCountry: country,
          destinationCountry: 'FI',
          weightBracket: bracket,
          packageTier,
          priceCents: 490 + id * 11,
          currency: 'EUR',
          sellerInvolvementIndicator: false,
          observedAt: new Date(),
          refreshedAt: new Date(),
          reliabilityStatus: 'VERIFIED',
        });
      }
    }
  }
  return offers;
}

const TRANSPORT_OFFERS = buildTransportOffers();

// ---------------------------------------------------------------------------
// Service factory — real optimizer + real shipping + mocked engines/ports
// ---------------------------------------------------------------------------

/** Mocked transport-offer query backing the (real) shipping calculator. */
function createTransportQueryMock(): ITransportOfferQuery {
  return {
    findAllActive: vi.fn().mockResolvedValue(TRANSPORT_OFFERS),
    findByCarrier: vi.fn().mockImplementation(async (carrierId: string) =>
      TRANSPORT_OFFERS.filter((o) => o.carrier === carrierId),
    ),
  };
}

/**
 * Real shipping behaviour with a call counter — the counter proves the
 * shipping computation is bounded (never a powerset) without changing
 * what is computed.
 */
class CountingShippingCalculator extends BasketShippingCalculator {
  calculateBasketCalls = 0;

  constructor(query: ITransportOfferQuery) {
    super(query);
  }

  override async calculateBasket(
    ...args: Parameters<BasketShippingCalculator['calculateBasket']>
  ): Promise<Awaited<ReturnType<BasketShippingCalculator['calculateBasket']>>> {
    this.calculateBasketCalls += 1;
    return super.calculateBasket(...args);
  }
}

function createBasketOptimizerService(
  offersByProduct: Record<number, CalculatorRetailOfferData[]>,
  products: CalculatorProductData[] = PRODUCTS,
  shipping?: BasketShippingCalculator,
): BasketOptimizerService {
  // --- Mock I/O ports ---
  const productsById: Record<number, CalculatorProductData> = Object.fromEntries(
    products.map((p) => [p.id, p]),
  );
  const productData: IProductDataPort = {
    findProductById: vi.fn().mockImplementation(async (id: number) =>
      productsById[id] ?? null,
    ),
    findRetailOffers: vi.fn().mockImplementation(
      async (id: number) => offersByProduct[id] ?? [],
    ),
  };

  const calculationRecords: ICalculationRecordPort = {
    create: vi.fn().mockResolvedValue({ id: 9999 }),
  };

  const transportOfferQuery = createTransportQueryMock();

  // No minimum-order thresholds — every merchant assignment stays
  // feasible so the DFS enumerates the full combination space.
  const merchantTerms = {
    getTerms: vi.fn().mockImplementation(async (merchantId: string) => ({
      merchantId,
      minimumOrderValueCents: null,
      currency: 'EUR',
      reliabilityStatus: 'VERIFIED' as const,
      observedAt: new Date(),
    }) satisfies MerchantTerms | null),
  };

  // --- Real services, mocked leaf engines (calculator-load pattern) ---
  const classificationGate = {
    checkProductGate: vi.fn().mockReturnValue({ passed: true }),
  };

  const alcoholExcise = {
    calculate: vi.fn().mockImplementation(
      async (category: string, abv: number, volumeLitres: number) => {
        const taxMap: Record<string, number> = {
          beer: 30,
          wine: 95,
          spirits: 560,
        };
        return {
          category,
          abv,
          volumeLitres,
          rateApplied: 0.0,
          taxCents: taxMap[category] ?? 50,
          taxDatasetVersion: 'v1',
          reliability: 'VERIFIED' as const,
        };
      },
    ),
  };

  const containerDuty = {
    calculate: vi.fn().mockImplementation(
      async (volumeLitres: number, _containerType: string, _deposit: boolean | null) => {
        return {
          volumeLitres,
          ratePerLitre: 0.51,
          dutyCents: Math.round(volumeLitres * 0.51 * 100),
          taxDatasetVersion: 'v1',
          reliability: 'VERIFIED' as const,
        };
      },
    ),
  };

  const transactionClassification = {
    classify: vi.fn().mockResolvedValue({
      classification: 'DistanceBuying' as const,
      confidence: 'HIGH' as const,
      evidence: [
        {
          observation: 'Buyer arranged transport',
          supportingData: 'carrier: dhl',
          source: 'TransportClassification',
        },
      ],
      evidenceSummary: 'The buyer arranged transport via an independent carrier.',
    }),
  };

  const transportEstimation = {
    estimate: vi.fn().mockResolvedValue({
      offer: { id: 200, priceCents: 150, sellerInvolvementIndicator: false },
      matchedWeightBracket: { minKg: 0, maxKg: 1 },
      reliabilityStatus: 'EXACT' as const,
    }),
  };

  const confidenceFramework = {
    buildReport: vi.fn().mockReturnValue({
      overall: 'HIGH' as const,
      breakdown: [
        { status: 'VERIFIED' as const, detail: '[productPrice] Verified' },
        { status: 'VERIFIED' as const, detail: '[transport] Verified' },
        { status: 'VERIFIED' as const, detail: '[excise] Verified' },
        { status: 'VERIFIED' as const, detail: '[containerDuty] Verified' },
        { status: 'VERIFIED' as const, detail: '[classification] Verified' },
      ],
    }),
  };

  const calculator = new LandedCostCalculatorService(
    classificationGate as never,
    alcoholExcise as never,
    containerDuty as never,
    transactionClassification as never,
    transportEstimation as never,
    confidenceFramework as never,
    productData,
    calculationRecords,
  );

  const basketShipping = shipping ?? new BasketShippingCalculator(transportOfferQuery);

  // calculationRecordPort is Optional and null by default — persistence
  // stays out of the measured path (matching the module's null default).
  return new BasketOptimizerService(
    classificationGate as never,
    calculator,
    basketShipping,
    productData,
    merchantTerms as never,
    null,
    confidenceFramework as never,
  );
}

// ---------------------------------------------------------------------------
// Percentile helper (same estimator as calculator-load.test.ts)
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

interface BenchmarkResult {
  p99: number;
  p95: number;
  p50: number;
  min: number;
  max: number;
  mean: number;
  durations: number[];
  successCount: number;
  failureCount: number;
}

type ScenarioName = 'typical' | 'max-cap' | 'cap-30-feasible' | 'cap-30-guard';

interface ScenarioSpec {
  name: ScenarioName;
  itemCount: number;
  candidatesPerItem: number;
}

const SCENARIOS: Record<ScenarioName, ScenarioSpec> = {
  typical: { name: 'typical', itemCount: 4, candidatesPerItem: 4 },
  'max-cap': { name: 'max-cap', itemCount: 10, candidatesPerItem: 3 },
  'cap-30-feasible': {
    name: 'cap-30-feasible',
    itemCount: MAX_BASKET_ITEMS,
    candidatesPerItem: 1,
  },
  'cap-30-guard': {
    name: 'cap-30-guard',
    itemCount: MAX_BASKET_ITEMS,
    candidatesPerItem: 3,
  },
}

/** Whether the scenario draws its lines from the 30-product cap set. */
function isCap30Scenario(name: ScenarioName): boolean {
  return name === 'cap-30-feasible' || name === 'cap-30-guard';
}

/** Deterministic basket for a call index: cycles products, varies quantity. */
function buildBasketInput(scenario: ScenarioSpec, callIdx: number): BasketOptimizationInput {
  const catalog = isCap30Scenario(scenario.name) ? CAP30_PRODUCTS : PRODUCTS;
  const items = Array.from({ length: scenario.itemCount }, (_, i) => {
    const product = catalog[i % catalog.length];
    return {
      productId: product.id,
      quantity: ((callIdx + i) % 5) + 1, // 1–5, varied to defeat caching
    };
  });
  return {
    items,
    destination: 'FI',
    transportArrangement: 'SELLER_ARRANGED',
    sessionId: `basket-load-${scenario.name}-${callIdx}`,
  };
}

async function runConcurrentBenchmark(
  service: BasketOptimizerService,
  scenario: ScenarioSpec,
  concurrency: number,
): Promise<BenchmarkResult> {
  const durations: number[] = [];
  let successCount = 0;
  let failureCount = 0;
  let firstError: unknown = null;

  const tasks = Array.from({ length: concurrency }, async (_, i) => {
    const input = buildBasketInput(scenario, i);
    const start = performance.now();
    try {
      const result: BasketOptimizationResult = await service.optimize(input);
      const elapsed = performance.now() - start;
      durations.push(elapsed);
      successCount++;
      // Sanity-check: a feasible split with itemized shipments and a
      // positive grand total was returned.
      expect(result.shipments.length).toBeGreaterThan(0);
      expect(result.totalCents).toBeGreaterThan(0);
      expect(result.shipments.every((s) => s.items.length > 0)).toBe(true);
    } catch (err) {
      failureCount++;
      if (firstError === null) firstError = err;
    }
  });

  await Promise.all(tasks);

  if (firstError !== null) {
    console.error('FIRST FAILURE:', firstError instanceof Error ? `${firstError.name}: ${firstError.message}` : String(firstError));
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const mean = durations.reduce((s, d) => s + d, 0) / durations.length;

  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean,
    durations: sorted,
    successCount,
    failureCount,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BasketOptimizer — load/performance under 256m/512Mi-shaped load', () => {
  const typicalService = createBasketOptimizerService(TYPICAL_OFFERS);
  const maxCapService = createBasketOptimizerService(MAX_CAP_OFFERS);
  const cap30FeasibleService = createBasketOptimizerService(
    CAP30_FEASIBLE_OFFERS,
    CAP30_PRODUCTS,
  );
  const cap30GuardService = createBasketOptimizerService(
    CAP30_GUARD_OFFERS,
    CAP30_PRODUCTS,
  );

  beforeAll(() => {
    // Services are constructed synchronously in the describe body;
    // nothing to warm here — JIT warmup happens per scenario below.
  });

  // -----------------------------------------------------------------------
  // Correctness spot-checks (fast, single calls)
  // -----------------------------------------------------------------------

  it('produces a feasible optimal split for a typical basket', async () => {
    const result = await typicalService.optimize(
      buildBasketInput(SCENARIOS.typical, 0),
    );
    expect(result.totalCents).toBeGreaterThan(0);
    expect(result.shipments.length).toBeGreaterThanOrEqual(1);
    expect(result.shipments.length).toBeLessThanOrEqual(4); // ≤ candidate merchants
    expect(result.confidence).toBe('HIGH');
  });

  it('produces a feasible optimal split for a max-cap basket (10 items)', async () => {
    const result = await maxCapService.optimize(
      buildBasketInput(SCENARIOS['max-cap'], 0),
    );
    expect(result.totalCents).toBeGreaterThan(0);
    expect(result.shipments.length).toBeGreaterThanOrEqual(1);
    expect(result.metadata.input.items.length).toBe(10);
  });

  // -----------------------------------------------------------------------
  // Raised input cap (MAX_BASKET_ITEMS = 30, change
  // client-experience-improvement): the full item cap optimizes inside
  // the combinations guard, and guard-exceeding shapes fail fast.
  // -----------------------------------------------------------------------

  it('produces a feasible optimal split for a full-cap basket (30 distinct items)', async () => {
    const result = await cap30FeasibleService.optimize(
      buildBasketInput(SCENARIOS['cap-30-feasible'], 0),
    );
    expect(result.metadata.input.items.length).toBe(MAX_BASKET_ITEMS);
    expect(result.totalCents).toBeGreaterThan(0);
    expect(result.shipments.length).toBeGreaterThanOrEqual(1);
    expect(result.shipments.every((s) => s.items.length > 0)).toBe(true);
  });

  it('fails fast at the full cap when the combinations guard trips: 30 items × 3 merchants', async () => {
    // 3^30 ≈ 2.06e14 assignments — the guard must reject BEFORE any
    // enumeration work (and long before this bound could be mistaken
    // for a completed enumeration).
    const start = performance.now();
    const err = await cap30GuardService
      .optimize(buildBasketInput(SCENARIOS['cap-30-guard'], 0))
      .then(() => null, (e: unknown) => e);
    const elapsed = performance.now() - start;

    expect(err).toBeInstanceOf(BasketCombinationLimitError);
    const limitError = err as BasketCombinationLimitError;
    expect(limitError.totalCombinations).toBe(3 ** MAX_BASKET_ITEMS);
    expect(limitError.limit).toBe(MAX_TOTAL_COMBINATIONS);
    expect(elapsed).toBeLessThan(CAP30_GUARD_FAIL_BOUND_MS);
  });

  it('bounds shipping for the single-merchant worst case: 30 items, one merchant, ONE shipping call', async () => {
    // 2^30 ≈ 1.07e9 subsets — the shape the removed powerset prefetch
    // would have enumerated before the DFS (the Cartesian product is 1,
    // so the combinations guard passes). With lazy memoization the DFS
    // needs exactly one (merchant, item-subset) key: the full basket.
    const shipping = new CountingShippingCalculator(createTransportQueryMock());
    const singleMerchantService = createBasketOptimizerService(
      CAP30_SINGLE_OFFERS,
      CAP30_PRODUCTS,
      shipping,
    );

    const input: BasketOptimizationInput = {
      items: CAP30_PRODUCTS.map((p) => ({ productId: p.id, quantity: 1 })),
      destination: 'FI',
      transportArrangement: 'SELLER_ARRANGED',
      sessionId: 'basket-load-cap-30-single-merchant',
    };

    const start = performance.now();
    const result = await singleMerchantService.optimize(input);
    const elapsed = performance.now() - start;

    // Feasible, single-store result.
    expect(result.totalCents).toBeGreaterThan(0);
    expect(result.shipments).toHaveLength(1);
    expect(result.shipments[0].merchant).toBe('solo-merchant');
    // Shipment items are itemized cost lines (retail, excise, container
    // duty, import VAT) across all 30 lines — every basket line assigned.
    expect(result.shipments[0].items.length).toBeGreaterThanOrEqual(MAX_BASKET_ITEMS);

    // The bound: one merchant covering all 30 items needs exactly one
    // shipping computation — not 2^30, and not even one per item.
    expect(shipping.calculateBasketCalls).toBe(1);

    // Wall time stays in the interactive class (a second optimize call
    // reuses nothing across calls — the memo is per-call — so the bound
    // holds for cold requests).
    expect(elapsed).toBeLessThan(CAP30_P95_THRESHOLD_MS);
  });

  // -----------------------------------------------------------------------
  // Typical scenario — 4 items × 4 merchants, 50 concurrent
  // -----------------------------------------------------------------------

  it(
    `typical: ${TYPICAL_CONCURRENCY} concurrent 4-item baskets ` +
    `with p95 < ${TYPICAL_P95_THRESHOLD_MS} ms and error rate < ${(MAX_ERROR_RATE * 100).toFixed(0)}%`,
    async () => {
      for (let i = 0; i < TYPICAL_WARMUP_RUNS; i++) {
        await runConcurrentBenchmark(typicalService, SCENARIOS.typical, TYPICAL_CONCURRENCY);
      }

      const results: BenchmarkResult[] = [];
      for (let i = 0; i < TYPICAL_MEASURED_RUNS; i++) {
        results.push(
          await runConcurrentBenchmark(typicalService, SCENARIOS.typical, TYPICAL_CONCURRENCY),
        );
      }

      const worstP95 = Math.max(...results.map((r) => r.p95));
      const worstP99 = Math.max(...results.map((r) => r.p99));
      const combined = results.flatMap((r) => r.durations).sort((a, b) => a - b);
      const totalSuccess = results.reduce((s, r) => s + r.successCount, 0);
      const totalFailure = results.reduce((s, r) => s + r.failureCount, 0);
      const totalCalls = totalSuccess + totalFailure;
      const errorRate = totalCalls > 0 ? totalFailure / totalCalls : 0;

      console.log(`
        ┌─ Basket Optimizer Load Test — typical (4 items × 4 merchants) ──────
        │  Concurrency:    ${TYPICAL_CONCURRENCY} × ${TYPICAL_MEASURED_RUNS} rounds
        │  Assignments:    4^4 = 256 per call
        │  Total calls:    ${combined.length}
        │  Successful:     ${totalSuccess}
        │  Failed:         ${totalFailure}
        │  Error rate:     ${(errorRate * 100).toFixed(2)}%   (threshold: ${(MAX_ERROR_RATE * 100).toFixed(0)}%)
        │
        │  p50 (median):   ${percentile(combined, 50).toFixed(2)} ms
        │  p95:            ${worstP95.toFixed(2)} ms    (threshold: ${TYPICAL_P95_THRESHOLD_MS} ms)
        │  p99:            ${worstP99.toFixed(2)} ms
        │  min:            ${combined[0].toFixed(2)} ms
        │  max:            ${combined[combined.length - 1].toFixed(2)} ms
        │  mean:           ${(combined.reduce((s, d) => s + d, 0) / combined.length).toFixed(2)} ms
        └──────────────────────────────────────────────────────────────────────
      `);

      expect(totalFailure).toBe(0);
      expect(errorRate).toBeLessThan(MAX_ERROR_RATE);
      expect(worstP95).toBeLessThan(TYPICAL_P95_THRESHOLD_MS);
    },
    120_000,
  );

  // -----------------------------------------------------------------------
  // Max-cap scenario — 10 items × 3 merchants (pre-cap-30 reference shape
  // for the enumeration-heaviest feasible load)
  // -----------------------------------------------------------------------

  it(
    `max-cap: ${MAX_CAP_CONCURRENCY} concurrent 10-item baskets ` +
    `with p95 < ${MAX_CAP_P95_THRESHOLD_MS} ms and error rate < ${(MAX_ERROR_RATE * 100).toFixed(0)}%`,
    async () => {
      for (let i = 0; i < MAX_CAP_WARMUP_RUNS; i++) {
        await runConcurrentBenchmark(maxCapService, SCENARIOS['max-cap'], MAX_CAP_CONCURRENCY);
      }

      const results: BenchmarkResult[] = [];
      for (let i = 0; i < MAX_CAP_MEASURED_RUNS; i++) {
        results.push(
          await runConcurrentBenchmark(maxCapService, SCENARIOS['max-cap'], MAX_CAP_CONCURRENCY),
        );
      }

      const worstP95 = Math.max(...results.map((r) => r.p95));
      const worstP99 = Math.max(...results.map((r) => r.p99));
      const combined = results.flatMap((r) => r.durations).sort((a, b) => a - b);
      const totalSuccess = results.reduce((s, r) => s + r.successCount, 0);
      const totalFailure = results.reduce((s, r) => s + r.failureCount, 0);
      const totalCalls = totalSuccess + totalFailure;
      const errorRate = totalCalls > 0 ? totalFailure / totalCalls : 0;

      console.log(`
        ┌─ Basket Optimizer Load Test — max-cap (10 items × 3 merchants) ─────
        │  Concurrency:    ${MAX_CAP_CONCURRENCY} × ${MAX_CAP_MEASURED_RUNS} rounds
        │  Assignments:    3^10 = 59 049 per call (pre-cap-30 reference shape)
        │  Total calls:    ${combined.length}
        │  Successful:     ${totalSuccess}
        │  Failed:         ${totalFailure}
        │  Error rate:     ${(errorRate * 100).toFixed(2)}%   (threshold: ${(MAX_ERROR_RATE * 100).toFixed(0)}%)
        │
        │  p50 (median):   ${percentile(combined, 50).toFixed(2)} ms
        │  p95:            ${worstP95.toFixed(2)} ms    (threshold: ${MAX_CAP_P95_THRESHOLD_MS} ms)
        │  p99:            ${worstP99.toFixed(2)} ms
        │  min:            ${combined[0].toFixed(2)} ms
        │  max:            ${combined[combined.length - 1].toFixed(2)} ms
        │  mean:           ${(combined.reduce((s, d) => s + d, 0) / combined.length).toFixed(2)} ms
        │
        │  Memory note: each call materialises all 59 049 assignments
        │  before selection — peak heap scales with concurrency. The
        │  total-combinations guard (422) bounds this enumeration at
        │  the API layer.
        └──────────────────────────────────────────────────────────────────────
      `);

      expect(totalFailure).toBe(0);
      expect(errorRate).toBeLessThan(MAX_ERROR_RATE);
      expect(worstP95).toBeLessThan(MAX_CAP_P95_THRESHOLD_MS);
    },
    600_000,
  );

  // -----------------------------------------------------------------------
  // Cap-30 feasible scenario — 30 items × distinct single-candidate
  // merchants: the raised input cap under concurrent load, inside the
  // combinations guard (guard-trip timing pinned separately above).
  // -----------------------------------------------------------------------

  it(
    `cap-30 feasible: ${CAP30_CONCURRENCY} concurrent ${MAX_BASKET_ITEMS}-item baskets ` +
    `with p95 < ${CAP30_P95_THRESHOLD_MS} ms and error rate < ${(MAX_ERROR_RATE * 100).toFixed(0)}%`,
    async () => {
      for (let i = 0; i < CAP30_WARMUP_RUNS; i++) {
        await runConcurrentBenchmark(
          cap30FeasibleService, SCENARIOS['cap-30-feasible'], CAP30_CONCURRENCY,
        );
      }

      const results: BenchmarkResult[] = [];
      for (let i = 0; i < CAP30_MEASURED_RUNS; i++) {
        results.push(
          await runConcurrentBenchmark(
            cap30FeasibleService, SCENARIOS['cap-30-feasible'], CAP30_CONCURRENCY,
          ),
        );
      }

      const worstP95 = Math.max(...results.map((r) => r.p95));
      const worstP99 = Math.max(...results.map((r) => r.p99));
      const combined = results.flatMap((r) => r.durations).sort((a, b) => a - b);
      const totalSuccess = results.reduce((s, r) => r.successCount, 0);
      const totalFailure = results.reduce((s, r) => r.failureCount, 0);
      const totalCalls = totalSuccess + totalFailure;
      const errorRate = totalCalls > 0 ? totalFailure / totalCalls : 0;

      console.log(`
        ┌─ Basket Optimizer Load Test — cap-30 feasible (${MAX_BASKET_ITEMS} items × 1 merchant) ─
        │  Concurrency:    ${CAP30_CONCURRENCY} × ${CAP30_MEASURED_RUNS} rounds
        │  Assignments:    1 per call (single-candidate shape, guard slack)
        │  Total calls:    ${combined.length}
        │  Successful:     ${totalSuccess}
        │  Failed:         ${totalFailure}
        │  Error rate:     ${(errorRate * 100).toFixed(2)}%   (threshold: ${(MAX_ERROR_RATE * 100).toFixed(0)}%)
        │
        │  p50 (median):   ${percentile(combined, 50).toFixed(2)} ms
        │  p95:            ${worstP95.toFixed(2)} ms    (threshold: ${CAP30_P95_THRESHOLD_MS} ms)
        │  p99:            ${worstP99.toFixed(2)} ms
        │  max:            ${combined[combined.length - 1]?.toFixed(2) ?? '0'} ms
        └──────────────────────────────────────────────────────────────────────
      `);

      expect(totalFailure).toBe(0);
      expect(errorRate).toBeLessThan(MAX_ERROR_RATE);
      expect(worstP95).toBeLessThan(CAP30_P95_THRESHOLD_MS);
    },
    120_000,
  );
});
