/**
 * Load/performance test — Landed Cost Calculator orchestrator.
 *
 * Measures core-domain orchestrator throughput under load by calling
 * LandedCostCalculatorService directly with mocked I/O ports (product
 * data, calculation records).
 *
 * **Payload scenarios:** beer, wine, spirits, basket (mixed products).
 * **Thresholds:** p95 < 2000ms, error rate < 1%.
 *
 * **Scope:** This test exercises the orchestrator logic only. It does NOT
 * exercise the HTTP transport layer (NestJS controllers, middleware,
 * guards, serialization, rate limiting). HTTP-level load testing
 * (POST /api/v1/calculator through the full stack) is a separate concern
 * and should use tools like k6 or artillery once the backend is deployed.
 * HTTP 429 (Too Many Requests) responses can only be verified at that layer.
 *
 * Uses Promise.all for concurrency (no external tools needed).
 * All I/O-bound services are mocked so the test measures orchestrator
 * throughput, not network latency.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { LandedCostCalculatorService } from '@rajahinta/core-domain';
import type {
  CalculatorInput,
  CalculatorProductData,
  CalculatorRetailOfferData,
  IProductDataPort,
  ICalculationRecordPort,
} from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of concurrent requests per run. */
const CONCURRENCY = 50;

/** P95 latency threshold in milliseconds. */
const P95_THRESHOLD_MS = 2_000;

/** Maximum allowed error rate (fraction of total requests). */
const MAX_ERROR_RATE = 0.01;

/** Number of benchmark runs to warm up JIT before measurement. */
const WARMUP_RUNS = 5;

/** Number of measured benchmark runs. */
const MEASURED_RUNS = 3;

// ---------------------------------------------------------------------------
// Fixtures — realistic product profiles
// ---------------------------------------------------------------------------

/** Beer: can of 0.5 L, 5% ABV. */
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

const OFFERS_BEER: CalculatorRetailOfferData[] = [
  { id: 100, priceCents: 200, merchant: 'beverage-de', country: 'DE', reliabilityStatus: 'EXACT' },
];

/** Wine: bottle of 0.75 L, 13.5% ABV. */
const PRODUCT_WINE: CalculatorProductData = {
  id: 2,
  regulatoryClassification: 'wine',
  category: 'wine',
  volumeLitres: 0.75,
  alcoholByVolume: 0.135,
  containerType: 'bottle',
  depositSystemStatus: false,
  weightKg: 1.2,
  normalizedName: 'Chardonnay 13.5%',
};

const OFFERS_WINE: CalculatorRetailOfferData[] = [
  { id: 200, priceCents: 899, merchant: 'vintner-fr', country: 'FR', reliabilityStatus: 'EXACT' },
];

/** Spirits: bottle of 0.7 L, 40% ABV. */
const PRODUCT_SPIRITS: CalculatorProductData = {
  id: 3,
  regulatoryClassification: 'spirits',
  category: 'spirits',
  volumeLitres: 0.7,
  alcoholByVolume: 0.4,
  containerType: 'bottle',
  depositSystemStatus: true,
  weightKg: 1.0,
  normalizedName: 'Vodka 40%',
};

const OFFERS_SPIRITS: CalculatorRetailOfferData[] = [
  { id: 300, priceCents: 1999, merchant: 'spirits-pl', country: 'PL', reliabilityStatus: 'EXACT' },
];

// Product-id → product data lookup for the port mock
const PRODUCTS_BY_ID: Record<number, CalculatorProductData> = {
  1: PRODUCT_BEER,
  2: PRODUCT_WINE,
  3: PRODUCT_SPIRITS,
};

const OFFERS_BY_ID: Record<number, CalculatorRetailOfferData[]> = {
  1: OFFERS_BEER,
  2: OFFERS_WINE,
  3: OFFERS_SPIRITS,
};

// ---------------------------------------------------------------------------
// Percentile helper
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

// ---------------------------------------------------------------------------
// Service factory — creates a LandedCostCalculatorService with mocked I/O
// ---------------------------------------------------------------------------

function createCalculatorService(): LandedCostCalculatorService {
  // --- Pure-logic services (real instances, zero I/O) ---
  const classificationGate = {
    checkProductGate: vi.fn().mockReturnValue({ passed: true }),
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

  // --- Mock I/O services (return deterministic results per product) ---
  const alcoholExcise = {
    calculate: vi.fn().mockImplementation(
      async (category: string, abv: number, volumeLitres: number) => {
        // Beer: 30¢, wine: 95¢, spirits: 560¢ per unit
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
      async (volumeLitres: number, _containerType: string, _depositSystemStatus: boolean | null) => {
        // 51¢ per litre container duty
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

  const transportEstimation = {
    estimate: vi.fn().mockResolvedValue({
      offer: { id: 200, priceCents: 150, sellerInvolvementIndicator: false },
      matchedWeightBracket: { minKg: 0, maxKg: 1 },
      reliabilityStatus: 'EXACT' as const,
    }),
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

  // --- Port mocks (dispatch by productId) ---
  const productData: IProductDataPort = {
    findProductById: vi.fn().mockImplementation(
      async (id: number) => PRODUCTS_BY_ID[id] ?? null,
    ),
    findRetailOffers: vi.fn().mockImplementation(
      async (id: number) => OFFERS_BY_ID[id] ?? [],
    ),
  };

  const calculationRecords: ICalculationRecordPort = {
    create: vi.fn().mockResolvedValue({ id: 9999 }),
  };

  // --- Construct service ---
  return new LandedCostCalculatorService(
    classificationGate as never,
    alcoholExcise as never,
    containerDuty as never,
    transactionClassification as never,
    transportEstimation as never,
    confidenceFramework as never,
    productData,
    calculationRecords,
  );
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

async function runConcurrentBenchmark(
  service: LandedCostCalculatorService,
  concurrency: number,
  scenario: 'single-product' | 'basket' = 'single-product',
): Promise<BenchmarkResult> {
  const durations: number[] = [];
  let successCount = 0;
  let failureCount = 0;

  const tasks = Array.from({ length: concurrency }, async (_, i) => {
    // Cycle through product types for basket scenario, else use beer
    const productId = scenario === 'basket' ? (i % 3) + 1 : 1;

    const input: CalculatorInput = {
      productId,
      quantity: (i % 5) + 1, // vary quantity 1–5 to avoid cache effects
      destination: 'FI',
      sessionId: `load-test-${scenario}-${i}`,
    };

    const start = performance.now();
    try {
      const result = await service.calculate(input);
      const elapsed = performance.now() - start;
      durations.push(elapsed);
      successCount++;
      // Sanity-check: total should exceed retail price alone
      expect(result.totalCents).toBeGreaterThan(input.quantity * 200);
    } catch {
      failureCount++;
    }
  });

  await Promise.all(tasks);

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

describe('LandedCostCalculator — load/performance', () => {
  let service: LandedCostCalculatorService;

  beforeAll(() => {
    service = createCalculatorService();
  });

  // -----------------------------------------------------------------------
  // Single-product scenarios
  // -----------------------------------------------------------------------

  it('produces correct result for beer', async () => {
    const result = await service.calculate({
      productId: 1,
      quantity: 1,
      destination: 'FI',
    });
    expect(result.totalCents).toBeGreaterThan(0);
    expect(result.metadata.productName).toBe('Premium Lager 5%');
  });

  it('produces correct result for wine', async () => {
    const result = await service.calculate({
      productId: 2,
      quantity: 1,
      destination: 'FI',
    });
    expect(result.totalCents).toBeGreaterThan(0);
    expect(result.metadata.productName).toBe('Chardonnay 13.5%');
  });

  it('produces correct result for spirits', async () => {
    const result = await service.calculate({
      productId: 3,
      quantity: 1,
      destination: 'FI',
    });
    expect(result.totalCents).toBeGreaterThan(0);
    expect(result.metadata.productName).toBe('Vodka 40%');
  });

  // -----------------------------------------------------------------------
  // Basket scenario — mixed products, concurrent
  // -----------------------------------------------------------------------

  it('handles basket scenario (beer + wine + spirits mix)', async () => {
    const result = await runConcurrentBenchmark(service, CONCURRENCY, 'basket');

    // eslint-disable-next-line no-console
    console.log(`
      ┌─ Basket Load Test ─────────────────────────────────────
      │  Calls:      ${result.successCount + result.failureCount}
      │  Success:    ${result.successCount}
      │  Failure:    ${result.failureCount}
      │  p50:        ${result.p50.toFixed(2)} ms
      │  p95:        ${result.p95.toFixed(2)} ms
      │  p99:        ${result.p99.toFixed(2)} ms
      └────────────────────────────────────────────────────────
    `);

    expect(result.failureCount).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Throughput benchmark — full concurrency test with thresholds
  // -----------------------------------------------------------------------

  it(
    `handles ${CONCURRENCY} concurrent requests ` +
    `with p95 < ${P95_THRESHOLD_MS} ms and error rate < ${(MAX_ERROR_RATE * 100).toFixed(0)}%`,
    async () => {
      // --- Warmup: let JIT settle ---
      for (let i = 0; i < WARMUP_RUNS; i++) {
        await runConcurrentBenchmark(service, CONCURRENCY);
      }

      // --- Measured rounds ---
      const results: BenchmarkResult[] = [];
      for (let i = 0; i < MEASURED_RUNS; i++) {
        const result = await runConcurrentBenchmark(service, CONCURRENCY);
        results.push(result);
      }

      // Aggregate: take the worst p95 across rounds
      const worstP95 = Math.max(...results.map((r) => r.p95));
      const worstP99 = Math.max(...results.map((r) => r.p99));
      const combinedDurations = results.flatMap((r) => r.durations).sort((a, b) => a - b);
      const totalSuccess = results.reduce((s, r) => s + r.successCount, 0);
      const totalFailure = results.reduce((s, r) => s + r.failureCount, 0);
      const totalCalls = totalSuccess + totalFailure;
      const errorRate = totalCalls > 0 ? totalFailure / totalCalls : 0;

      // Log results for CI visibility
      // eslint-disable-next-line no-console
      console.log(`
        ┌─ Landed-Cost Calculator Load Test ──────────────────────────
        │  Concurrency:    ${CONCURRENCY} × ${MEASURED_RUNS} rounds
        │  Scenario:       single-product (beer)
        │  Total calls:    ${combinedDurations.length}
        │  Successful:     ${totalSuccess}
        │  Failed:         ${totalFailure}
        │  Error rate:     ${(errorRate * 100).toFixed(2)}%   (threshold: ${(MAX_ERROR_RATE * 100).toFixed(0)}%)
        │
        │  p50 (median):   ${percentile(combinedDurations, 50).toFixed(2)} ms
        │  p95:            ${worstP95.toFixed(2)} ms    (threshold: ${P95_THRESHOLD_MS} ms)
        │  p99:            ${worstP99.toFixed(2)} ms
        │  min:            ${combinedDurations[0].toFixed(2)} ms
        │  max:            ${combinedDurations[combinedDurations.length - 1].toFixed(2)} ms
        │  mean:           ${(combinedDurations.reduce((s, d) => s + d, 0) / combinedDurations.length).toFixed(2)} ms
        │
        │  Note: HTTP 429 (rate-limit) responses can only be verified at
        │  the HTTP transport layer. Run artillery/k6 against the deployed
        │  endpoint to test that threshold.
        └──────────────────────────────────────────────────────────────
      `);

      expect(totalFailure).toBe(0);
      expect(errorRate).toBeLessThan(MAX_ERROR_RATE);
      expect(worstP95).toBeLessThan(P95_THRESHOLD_MS);
    },
  );
});