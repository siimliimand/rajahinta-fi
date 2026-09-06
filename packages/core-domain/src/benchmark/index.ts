/**
 * /benchmark barrel — public exports for the Alko benchmark subdomain.
 *
 * Deliberately NOT re-exported from the package root index: the
 * calculator (task 4.2) wires the benchmark into the result DTO, and the
 * root index is edited concurrently — consumers import from
 * `@rajahinta/core-domain/benchmark` until then.
 *
 * @module BenchmarkIndex
 */

// Types
export type {
  AlkoReferenceOffer,
  AlkoBenchmarkInput,
  AlkoBenchmark,
  AlkoBenchmarkAvailable,
  AlkoBenchmarkUnavailable,
  AlkoBenchmarkUnavailableReason,
} from './benchmark.types';

// Metric
export { computeAlkoBenchmark, ALKO_BENCHMARK_PERCENT_DECIMALS } from './alko-benchmark';
