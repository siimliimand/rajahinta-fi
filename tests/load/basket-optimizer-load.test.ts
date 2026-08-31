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
 * per-(item, merchant) cost computation, merchant-subset shipping
 * prefetch, DFS enumeration of merchant assignments, deterministic
 * sorting, and result assembly.
 *
 * **Scenarios:**
 *   - typical:  4 items × 4 candidate merchants  (4^4   = 256
 *     assignments per call) — the expected interactive basket shape.
 *   - max-cap:  10 items (MAX_BASKET_ITEMS) × 3 shared merchants
 *     (3^10 = 59 049 assignments per call) — the documented input-cap
 *     worst case that stays feasible to enumerate.
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
 * **Flag gating note:** the HTTP route POST /api/v1/basket/optimize is
 * guarded by @FeatureFlagDec(FeatureFlag.BASKET_OPTIMIZATION) and
 * returns 403 while the flag is off. The flag is enabled server-side
 * via the `FF_BASKET_OPTIMIZATION=true` environment variable
 * (FeatureFlagService reads `FF_<FLAG>`; e.g. a wrangler var on the
 * Worker environment or the process env for local runs). This
 * service-level suite deliberately bypasses the HTTP guard layer — the
 * flag has no effect here, exactly like calculator-load.test.ts
 * bypasses rate limiting; the HTTP-level flag/rate-limit behaviour is
 * covered by tests/load/artillery/basket-optimizer-suite.yml against a
 * deployed target with the flag enabled.
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
  LandedCostCalculatorService,
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

const PRODUCTS_BY_ID: Record<number, CalculatorProductData> = Object.fromEntries(
  PRODUCTS.map((p) => [p.id, p]),
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
 *   across all 10 items → 3^10 assignments, the worst case at the
 *   input caps that still terminates).
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

function createBasketOptimizerService(offersByProduct: Record<
  number,
  CalculatorRetailOfferData[]
>): BasketOptimizerService {
  // --- Mock I/O ports ---
  const productData: IProductDataPort = {
    findProductById: vi.fn().mockImplementation(async (id: number) =>
      PRODUCTS_BY_ID[id] ?? null,
    ),
    findRetailOffers: vi.fn().mockImplementation(
      async (id: number) => offersByProduct[id] ?? [],
    ),
  };

  const calculationRecords: ICalculationRecordPort = {
    create: vi.fn().mockResolvedValue({ id: 9999 }),
  };

  const transportOfferQuery: ITransportOfferQuery = {
    findAllActive: vi.fn().mockResolvedValue(TRANSPORT_OFFERS),
    findByCarrier: vi.fn().mockImplementation(async (carrierId: string) =>
      TRANSPORT_OFFERS.filter((o) => o.carrier === carrierId),
    ),
  };

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

  const basketShipping = new BasketShippingCalculator(transportOfferQuery);

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

type ScenarioName = 'typical' | 'max-cap';

interface ScenarioSpec {
  name: ScenarioName;
  itemCount: number;
  candidatesPerItem: number;
}

const SCENARIOS: Record<ScenarioName, ScenarioSpec> = {
  typical: { name: 'typical', itemCount: 4, candidatesPerItem: 4 },
  'max-cap': { name: 'max-cap', itemCount: 10, candidatesPerItem: 3 },
};

/** Deterministic basket for a call index: cycles products, varies quantity. */
function buildBasketInput(scenario: ScenarioSpec, callIdx: number): BasketOptimizationInput {
  const items = Array.from({ length: scenario.itemCount }, (_, i) => {
    const product = PRODUCTS[(callIdx + i) % PRODUCTS.length];
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
  // Max-cap scenario — 10 items × 3 merchants (input-cap worst case)
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
        │  Assignments:    3^10 = 59 049 per call (input-cap worst case)
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
        │  before selection — peak heap scales with concurrency. This is
        │  the workload the planned total-combinations guard (422) is
        │  meant to bound at the API layer.
        └──────────────────────────────────────────────────────────────────────
      `);

      expect(totalFailure).toBe(0);
      expect(errorRate).toBeLessThan(MAX_ERROR_RATE);
      expect(worstP95).toBeLessThan(MAX_CAP_P95_THRESHOLD_MS);
    },
    600_000,
  );
});
