/**
 * Load/performance test — AllowanceFillService (task 8.1, change
 * trust-and-reach-roadmap).
 *
 * Measures the allowance-fill objective's throughput under load by
 * calling AllowanceFillService.fill directly with mocked I/O ports (an
 * in-memory product-data port and an in-memory traveller-allowance port
 * resolving over half-open effective windows) — so the measurement
 * covers the fill's full CPU cost: input validation, date-resolved
 * allowance lookup, candidate building with cheapest-offer selection,
 * the bounded branch-and-bound search over per-line quantities, and
 * result assembly with headroom/provenance.
 *
 * **Scenarios:**
 *   - typical:  4 candidate lines (the expected interactive trip-fill
 *     shape), 50 concurrent calls.
 *   - max-cap:  10 lines (MAX_FILL_ITEMS) × maxQuantity 99 against a
 *     mixed volume/quantity cap set — the documented input-cap worst
 *     case for the search's branching factor.
 *
 * **Thresholds** (explicit; the fill search prunes via a validated
 * branch-and-bound bound, so even the max-cap shape stays far below the
 * basket optimizer's envelope — the thresholds pin that property):
 *   - typical: p95 < 2 000 ms, error rate < 1 % (aligns with the other
 *     service-level load suites).
 *   - max-cap: p95 < 5 000 ms, error rate < 1 %. A request whose search
 *     exceeded the exploration budget would surface as a typed
 *     AllowanceFillError and count against the error rate — the guard is
 *     exercised, not bypassed.
 *
 * **Guard note:** this service-level suite deliberately bypasses the
 * HTTP guard layer — exactly like calculator-load.test.ts and
 * basket-optimizer-load.test.ts; route-level rate limiting and the
 * entitlement check are task 8.2's concern.
 *
 * Uses Promise.all for concurrency (no external tools needed).
 */

import { describe, it, expect, vi } from 'vitest';
import { AllowanceFillService } from '@rajahinta/core-domain/optimizer/services/allowance-fill.service';
import { ClassificationGateService } from '@rajahinta/core-domain/normalization/classification-gate.service';
import { AllowanceFillError } from '@rajahinta/core-domain/optimizer/allowance-fill.types';
import type {
  AllowanceFillInput,
  AllowanceFillResult,
} from '@rajahinta/core-domain/optimizer/allowance-fill.types';
import type {
  CalculatorProductData,
  CalculatorRetailOfferData,
  IProductDataPort,
} from '@rajahinta/core-domain/calculator/calculator.types';
import type { ITravellerAllowancePort } from '@rajahinta/core-domain/optimizer/ports/traveller-allowance.port';
import type {
  TripAllowanceLimitRow,
  TripResolvedAllowances,
} from '@rajahinta/core-domain/tripcalc/tripcalc.types';

// ---------------------------------------------------------------------------
// Constants — scenario shapes and thresholds
// ---------------------------------------------------------------------------

/** Concurrency for the typical scenario (matches the other load suites). */
const TYPICAL_CONCURRENCY = 50;

/**
 * Concurrency for the max-cap scenario: each call runs a branch-and-bound
 * search over 10 lines × up to 99 quantities — CPU-bound, so the
 * concurrency stays low like basket-optimizer-load's max-cap tier.
 */
const MAX_CAP_CONCURRENCY = 5;

/** P95 latency thresholds in milliseconds. */
const TYPICAL_P95_THRESHOLD_MS = 2_000;
const MAX_CAP_P95_THRESHOLD_MS = 5_000;

/** Maximum allowed error rate (fraction of total calls). */
const MAX_ERROR_RATE = 0.01;

/** Warmup / measured rounds. */
const TYPICAL_WARMUP_RUNS = 3;
const TYPICAL_MEASURED_RUNS = 3;
const MAX_CAP_WARMUP_RUNS = 1;
const MAX_CAP_MEASURED_RUNS = 3;

// ---------------------------------------------------------------------------
// Fixtures — products, offers, allowance datasets
// ---------------------------------------------------------------------------

/**
 * Ten product profiles spanning every allowance category (raw category
 * strings the excise engine's normaliser maps to the canonical keys).
 */
const LOAD_PRODUCTS: CalculatorProductData[] = [
  { id: 1, category: 'beer', volumeLitres: 0.33, alcoholByVolume: 0.047, containerType: 'can', depositSystemStatus: true, weightKg: 0.36, regulatoryClassification: 'beer', normalizedName: 'Lager 4.7% 33cl' },
  { id: 2, category: 'beer', volumeLitres: 0.5, alcoholByVolume: 0.05, containerType: 'can', depositSystemStatus: true, weightKg: 0.55, regulatoryClassification: 'beer', normalizedName: 'Lager 5% 50cl' },
  { id: 3, category: 'wine', volumeLitres: 0.75, alcoholByVolume: 0.125, containerType: 'bottle', depositSystemStatus: false, weightKg: 1.2, regulatoryClassification: 'wine', normalizedName: 'Red 12.5% 75cl' },
  { id: 4, category: 'wine', volumeLitres: 1.0, alcoholByVolume: 0.13, containerType: 'bottle', depositSystemStatus: false, weightKg: 1.5, regulatoryClassification: 'wine', normalizedName: 'White 13% 100cl' },
  { id: 5, category: 'sparkling', volumeLitres: 0.75, alcoholByVolume: 0.115, containerType: 'bottle', depositSystemStatus: false, weightKg: 1.3, regulatoryClassification: 'sparkling-wine', normalizedName: 'Sparkling 11.5% 75cl' },
  { id: 6, category: 'intermediate', volumeLitres: 0.5, alcoholByVolume: 0.18, containerType: 'bottle', depositSystemStatus: false, weightKg: 0.9, regulatoryClassification: 'fortified-wine', normalizedName: 'Fortified 18% 50cl' },
  { id: 7, category: 'spirits', volumeLitres: 0.5, alcoholByVolume: 0.4, containerType: 'bottle', depositSystemStatus: true, weightKg: 0.9, regulatoryClassification: 'spirits', normalizedName: 'Vodka 40% 50cl' },
  { id: 8, category: 'spirits', volumeLitres: 0.7, alcoholByVolume: 0.4, containerType: 'bottle', depositSystemStatus: true, weightKg: 1.2, regulatoryClassification: 'spirits', normalizedName: 'Whisky 40% 70cl' },
  { id: 9, category: 'cider', volumeLitres: 0.5, alcoholByVolume: 0.055, containerType: 'can', depositSystemStatus: true, weightKg: 0.55, regulatoryClassification: 'cider', normalizedName: 'Cider 5.5% 50cl' },
  { id: 10, category: 'rtd', volumeLitres: 0.33, alcoholByVolume: 0.055, containerType: 'can', depositSystemStatus: true, weightKg: 0.36, regulatoryClassification: 'long-drink', normalizedName: 'Long Drink 5.5% 33cl' },
];

const PRODUCTS_BY_ID: Record<number, CalculatorProductData> = Object.fromEntries(
  LOAD_PRODUCTS.map((p) => [p.id, p]),
);

/** Deterministic offer price per (product, merchant) — varied but stable. */
function offerPriceCents(productId: number, merchantIdx: number): number {
  return 199 + productId * 137 + merchantIdx * 53;
}

const LOAD_MERCHANTS = ['beverage-de', 'vintner-fr', 'spirits-pl'] as const;

function buildOffersByProduct(): Record<number, CalculatorRetailOfferData[]> {
  const map: Record<number, CalculatorRetailOfferData[]> = {};
  for (const product of LOAD_PRODUCTS) {
    map[product.id] = LOAD_MERCHANTS.map((merchant, idx) => ({
      id: product.id * 100 + idx,
      priceCents: offerPriceCents(product.id, idx),
      merchant,
      country: idx === 0 ? 'DE' : idx === 1 ? 'FR' : 'PL',
      reliabilityStatus: 'VERIFIED' as const,
    }));
  }
  return map;
}

const LOAD_OFFERS = buildOffersByProduct();

function cap(
  category: string,
  volumeCapLitres: number | null,
  quantityCap: number | null,
): TripAllowanceLimitRow {
  return { category, volumeCapLitres, quantityCap };
}

/**
 * The load dataset — mixed volume-only and quantity-only caps so both
 * bound dimensions are exercised. Fixed, open-ended version: resolution
 * correctness is covered by unit tests; load measures throughput.
 */
const LOAD_ALLOWANCE_PORT: ITravellerAllowancePort = {
  resolveForTravelDate: vi.fn().mockImplementation(
    async (travelDate: string): Promise<TripResolvedAllowances | null> => {
      void travelDate;
      return {
        dataset: { versionLabel: 'load-eu-indicative-2026.1' },
        limits: [
          cap('beer', 20, null),
          cap('wine_still', 12, null),
          cap('wine_sparkling', 5, null),
          cap('intermediate_products', 5, null),
          cap('spirits', null, 4),
          cap('other_fermented', 10, null),
        ],
      };
    },
  ),
};

// ---------------------------------------------------------------------------
// Service factory — real gate, mocked ports
// ---------------------------------------------------------------------------

function createAllowanceFillService(): AllowanceFillService {
  const gate = new ClassificationGateService();
  const productData: IProductDataPort = {
    findProductById: vi.fn().mockImplementation(async (id: number) => PRODUCTS_BY_ID[id] ?? null),
    findRetailOffers: vi.fn().mockImplementation(async (id: number) => LOAD_OFFERS[id] ?? []),
  };
  return new AllowanceFillService(gate, productData, LOAD_ALLOWANCE_PORT);
}

// ---------------------------------------------------------------------------
// Percentile helper (same estimator as the other load suites)
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
  lineCount: number;
}

const SCENARIOS: Record<ScenarioName, ScenarioSpec> = {
  typical: { name: 'typical', lineCount: 4 },
  'max-cap': { name: 'max-cap', lineCount: 10 },
};

/** Deterministic fill request for a call index: cycles products, varies quantity. */
function buildFillInput(scenario: ScenarioSpec, callIdx: number): AllowanceFillInput {
  const items = Array.from({ length: scenario.lineCount }, (_, i) => {
    const product = LOAD_PRODUCTS[(callIdx + i) % LOAD_PRODUCTS.length];
    return {
      productId: product.id,
      maxQuantity: 90 + ((callIdx + i) % 10), // 90–99, varied to defeat caching
    };
  });
  return {
    items,
    travelDate: '2026-09-08',
    sessionId: `allowance-fill-load-${scenario.name}-${callIdx}`,
  };
}

/** Sanity invariants every fill result must satisfy under load. */
function assertResultInvariants(result: AllowanceFillResult): void {
  expect(result.status).toBe('FILLED');
  expect(result.allowanceDatasetVersion.length).toBeGreaterThan(0);
  expect(result.filledValueCents).toBeGreaterThan(0);
  expect(result.filledUnits).toBeGreaterThan(0);

  let valueSum = 0;
  let unitSum = 0;
  for (const line of result.lines) {
    expect(line.valueContributionCents).toBe(line.filledQuantity * line.unitPriceCents);
    expect(line.consumedVolumeLitres).toBeCloseTo(line.filledQuantity * line.unitVolumeLitres, 9);
    valueSum += line.valueContributionCents;
    unitSum += line.filledQuantity;
  }
  expect(valueSum).toBe(result.filledValueCents);
  expect(unitSum).toBe(result.filledUnits);

  for (const headroom of result.categoryHeadroom) {
    if (headroom.remainingLitres !== null) {
      expect(headroom.remainingLitres).toBeGreaterThanOrEqual(0);
    }
    if (headroom.remainingUnits !== null) {
      expect(headroom.remainingUnits).toBeGreaterThanOrEqual(0);
    }
  }
}

async function runConcurrentBenchmark(
  service: AllowanceFillService,
  scenario: ScenarioSpec,
  concurrency: number,
): Promise<BenchmarkResult> {
  const durations: number[] = [];
  let successCount = 0;
  let failureCount = 0;
  let firstError: unknown = null;

  const tasks = Array.from({ length: concurrency }, async (_, i) => {
    const input = buildFillInput(scenario, i);
    const start = performance.now();
    try {
      const result: AllowanceFillResult = await service.fill(input);
      const elapsed = performance.now() - start;
      durations.push(elapsed);
      successCount++;
      assertResultInvariants(result);
    } catch (err) {
      failureCount++;
      if (firstError === null) firstError = err;
    }
  });

  await Promise.all(tasks);

  if (firstError !== null) {
    const reason =
      firstError instanceof AllowanceFillError
        ? firstError.reason
        : firstError instanceof Error
          ? `${firstError.name}: ${firstError.message}`
          : String(firstError);
    console.error('FIRST FAILURE:', reason);
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

describe('AllowanceFillService — load/performance', () => {
  const service = createAllowanceFillService();

  // -----------------------------------------------------------------------
  // Correctness spot-checks (fast, single calls)
  // -----------------------------------------------------------------------

  it('produces a filled, provenance-carrying result for a typical request', async () => {
    const result = await service.fill(buildFillInput(SCENARIOS.typical, 0));
    expect(result.status).toBe('FILLED');
    expect(result.lines).toHaveLength(4);
    expect(result.allowanceDatasetVersion).toBe('load-eu-indicative-2026.1');
    assertResultInvariants(result);
  });

  it('produces a filled result for the max-cap request (10 lines × maxQuantity 99)', async () => {
    const result = await service.fill(buildFillInput(SCENARIOS['max-cap'], 0));
    expect(result.status).toBe('FILLED');
    expect(result.lines).toHaveLength(10);
    expect(result.metadata.input.items.length).toBe(10);
    assertResultInvariants(result);
  });

  // -----------------------------------------------------------------------
  // Typical scenario — 4 lines, 50 concurrent
  // -----------------------------------------------------------------------

  it(
    `typical: ${TYPICAL_CONCURRENCY} concurrent 4-line fills ` +
    `with p95 < ${TYPICAL_P95_THRESHOLD_MS} ms and error rate < ${(MAX_ERROR_RATE * 100).toFixed(0)}%`,
    async () => {
      for (let i = 0; i < TYPICAL_WARMUP_RUNS; i++) {
        await runConcurrentBenchmark(service, SCENARIOS.typical, TYPICAL_CONCURRENCY);
      }

      const results: BenchmarkResult[] = [];
      for (let i = 0; i < TYPICAL_MEASURED_RUNS; i++) {
        results.push(await runConcurrentBenchmark(service, SCENARIOS.typical, TYPICAL_CONCURRENCY));
      }

      const worstP95 = Math.max(...results.map((r) => r.p95));
      const worstP99 = Math.max(...results.map((r) => r.p99));
      const combined = results.flatMap((r) => r.durations).sort((a, b) => a - b);
      const totalSuccess = results.reduce((s, r) => s + r.successCount, 0);
      const totalFailure = results.reduce((s, r) => s + r.failureCount, 0);
      const totalCalls = totalSuccess + totalFailure;
      const errorRate = totalCalls > 0 ? totalFailure / totalCalls : 0;

      console.log(`
        ┌─ Allowance Fill Load Test — typical (4 lines) ──────────────────────
        │  Concurrency:    ${TYPICAL_CONCURRENCY} × ${TYPICAL_MEASURED_RUNS} rounds
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
  // Max-cap scenario — 10 lines × maxQuantity 99 (input-cap worst case)
  // -----------------------------------------------------------------------

  it(
    `max-cap: ${MAX_CAP_CONCURRENCY} concurrent 10-line fills (maxQuantity 99) ` +
    `with p95 < ${MAX_CAP_P95_THRESHOLD_MS} ms and error rate < ${(MAX_ERROR_RATE * 100).toFixed(0)}%`,
    async () => {
      for (let i = 0; i < MAX_CAP_WARMUP_RUNS; i++) {
        await runConcurrentBenchmark(service, SCENARIOS['max-cap'], MAX_CAP_CONCURRENCY);
      }

      const results: BenchmarkResult[] = [];
      for (let i = 0; i < MAX_CAP_MEASURED_RUNS; i++) {
        results.push(await runConcurrentBenchmark(service, SCENARIOS['max-cap'], MAX_CAP_CONCURRENCY));
      }

      const worstP95 = Math.max(...results.map((r) => r.p95));
      const worstP99 = Math.max(...results.map((r) => r.p99));
      const combined = results.flatMap((r) => r.durations).sort((a, b) => a - b);
      const totalSuccess = results.reduce((s, r) => s + r.successCount, 0);
      const totalFailure = results.reduce((s, r) => s + r.failureCount, 0);
      const totalCalls = totalSuccess + totalFailure;
      const errorRate = totalCalls > 0 ? totalFailure / totalCalls : 0;

      console.log(`
        ┌─ Allowance Fill Load Test — max-cap (10 lines × maxQuantity 99) ────
        │  Concurrency:    ${MAX_CAP_CONCURRENCY} × ${MAX_CAP_MEASURED_RUNS} rounds
        │  Search space:   up to 100^10 quantity vectors (bound-pruned)
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
        │  Guard note: a search that exceeded its exploration budget would
        │  fail here as AllowanceFillError(SEARCH_BUDGET_EXCEEDED) — the
        │  bound keeping this scenario solvable is itself under test.
        └──────────────────────────────────────────────────────────────────────
      `);

      expect(totalFailure).toBe(0);
      expect(errorRate).toBeLessThan(MAX_ERROR_RATE);
      expect(worstP95).toBeLessThan(MAX_CAP_P95_THRESHOLD_MS);
    },
    300_000,
  );
});
