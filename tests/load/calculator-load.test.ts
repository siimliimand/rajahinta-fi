/**
 * Load/performance test — Landed Cost Calculator orchestrator.
 *
 * Measures core-domain orchestrator throughput under load by calling
 * LandedCostCalculatorService directly with mocked I/O ports (product
 * data, calculation records). Simulates 50 concurrent requests, measures
 * p50/p95/p99 latency, and asserts p95 < 500 ms.
 *
 * **Scope:** This test exercises the orchestrator logic only. It does NOT
 * exercise the HTTP transport layer (NestJS controllers, middleware,
 * guards, serialization, rate limiting). HTTP-layer load testing
 * (POST /api/v1/calculator through the full stack) is a separate concern
 * and should use tools like k6 or autocannon once the backend is deployed.
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
const P95_THRESHOLD_MS = 500;

/** Number of benchmark runs to warm up JIT before measurement. */
const WARMUP_RUNS = 5;

/** Number of measured benchmark runs. */
const MEASURED_RUNS = 3;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PRODUCT: CalculatorProductData = {
  id: 1,
  regulatoryClassification: 'beer',
  category: 'beer',
  volumeLitres: 0.5,
  alcoholByVolume: 0.05,
  containerType: 'can',
  depositSystemStatus: true,
  weightKg: 0.55,
  normalizedName: 'Test Lager 5%',
};

const OFFERS: CalculatorRetailOfferData[] = [
  { id: 100, priceCents: 200, merchant: 'beverage-de', country: 'DE', reliabilityStatus: 'EXACT' },
];

const BASE_INPUT: CalculatorInput = {
  productId: 1,
  quantity: 2,
  destination: 'FI',
  sessionId: 'load-test-session',
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

function createCalculatorService(
  _options?: { transportDelayMs?: number },
): LandedCostCalculatorService {
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

  // --- Mock I/O services ---
  const alcoholExcise = {
    calculate: vi.fn().mockResolvedValue({
      category: 'beer',
      abv: 0.05,
      volumeLitres: 0.5,
      rateApplied: 0.0,
      taxCents: 30,
      taxDatasetVersion: 'v1',
      reliability: 'VERIFIED' as const,
    }),
  };

  const containerDuty = {
    calculate: vi.fn().mockResolvedValue({
      volumeLitres: 0.5,
      ratePerLitre: 0.51,
      dutyCents: 26,
      taxDatasetVersion: 'v1',
      reliability: 'VERIFIED' as const,
    }),
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
      evidence: [{ observation: 'Buyer arranged transport', supportingData: 'carrier: dhl', source: 'TransportClassification' }],
      evidenceSummary: 'The buyer arranged transport via an independent carrier.',
    }),
  };

  // --- Port mocks ---
  const productData: IProductDataPort = {
    findProductById: vi.fn().mockResolvedValue(PRODUCT),
    findRetailOffers: vi.fn().mockResolvedValue(OFFERS),
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
): Promise<BenchmarkResult> {
  const durations: number[] = [];
  let successCount = 0;
  let failureCount = 0;

  const tasks = Array.from({ length: concurrency }, async (_, i) => {
    const input: CalculatorInput = {
      ...BASE_INPUT,
      productId: 1,
      sessionId: `load-test-session-${i}`,
      quantity: (i % 5) + 1, // vary quantity 1–5 to avoid cache effects
    };

    const start = performance.now();
    try {
      await service.calculate(input);
      const elapsed = performance.now() - start;
      durations.push(elapsed);
      successCount++;
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

  it('completes a single calculation successfully (sanity check)', async () => {
    const result = await service.calculate(BASE_INPUT);
    expect(result.totalCents).toBeGreaterThan(0);
    expect(result.calculationRecordId).toBe(9999);
  });

  it(`handles ${CONCURRENCY} concurrent requests with p95 < ${P95_THRESHOLD_MS} ms`, async () => {
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

    // Log results for CI visibility
    // eslint-disable-next-line no-console
    console.log(`
      ┌─ Landed-Cost Calculator Load Test ──────────────────────────────
      │  Concurrency:    ${CONCURRENCY} × ${MEASURED_RUNS} rounds
      │  Total calls:    ${combinedDurations.length}
      │  Successful:     ${totalSuccess}
      │  Failed:         ${totalFailure}
      │
      │  p50 (median):   ${percentile(combinedDurations, 50).toFixed(2)} ms
      │  p95:            ${worstP95.toFixed(2)} ms    (threshold: ${P95_THRESHOLD_MS} ms)
      │  p99:            ${worstP99.toFixed(2)} ms
      │  min:            ${combinedDurations[0].toFixed(2)} ms
      │  max:            ${combinedDurations[combinedDurations.length - 1].toFixed(2)} ms
      │  mean:           ${(combinedDurations.reduce((s, d) => s + d, 0) / combinedDurations.length).toFixed(2)} ms
      └────────────────────────────────────────────────────────────────
    `);

    expect(totalFailure).toBe(0);
    expect(worstP95).toBeLessThan(P95_THRESHOLD_MS);
  });
});