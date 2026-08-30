/**
 * E2E calculator-path latency baseline (task 3.9; design.md "Baseline
 * comparison method" — G3's deferred comparison).
 *
 * Measures the local p50/p95 of the full e2e calculator path (guards →
 * rate-limit admission → idempotency lookup → REAL engines over D1 →
 * calculation-record persistence → response) and prints the percentiles
 * to the suite output. The recorded run + comparison against G3's local
 * reference (p95 567 ms, local wrangler dev + local D1 — see
 * spikes/g3-vertical-slice.md) lives in tests/e2e/BASELINE.md; the
 * staging-vs-K8s artillery comparison remains task 6.6's job.
 *
 * The RATE_LIMITER binding is deliberately absent here: the middleware's
 * documented fail-open harness path keeps the burst above the 10/min
 * CALCULATOR ceiling and excludes DO round-trips from the measurement
 * (G3's load run raised the ceiling the same way). Absolute numbers are
 * plausibility evidence for THIS harness — in-process app.request has no
 * workerd/miniflare process boundary — never a production latency
 * forecast (same caveat as the G3 spike).
 *
 * @module BaselineE2E
 */

import { describe, it, expect } from 'vitest';
import { buildE2EApp, e2eEnv, openMigratedD1, percentile, postJson } from './harness';
import { seedGoldenDataset, seedGoldenTransport } from './golden-fixtures';

const AGE = { 'x-age-confirmed': 'confirmed' };
/** Sample size — sequential, unique inputs (every call a full MISS compute). */
const SAMPLES = 100;

describe('E2E calculator-path baseline', () => {
  it(`measures p50/p95 over ${SAMPLES} sequential calculations (printed to suite output)`, async () => {
    const { db, d1 } = openMigratedD1();
    seedGoldenDataset(db);
    seedGoldenTransport(db, [
      {
        id: 900,
        carrier: 'carrierA',
        originCountry: 'DE',
        destinationCountry: 'FI',
        weightBracket: { minKg: 0, maxKg: 1 },
        packageTier: 'can',
        priceCents: 150,
        sellerInvolvementIndicator: true,
      },
    ]);
    const app = buildE2EApp();
    const env = e2eEnv(d1, { RATE_LIMITER: undefined });

    const latencies: number[] = [];
    let errors = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const started = performance.now();
      const res = await postJson(
        app,
        env,
        '/api/v1/calculator',
        {
          productId: 1,
          // Unique input per call → unique idempotency key → full compute.
          quantity: i + 1,
          destination: 'FI',
          transportMethod: 'carrierA',
        },
        AGE,
      );
      latencies.push(performance.now() - started);
      if (res.status !== 200) {
        errors++;
        res.body?.cancel?.();
      }
    }

    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);
    const total = latencies.reduce((a, b) => a + b, 0);
    // Suite output IS the deliverable here (task 3.9: "record the local
    // p50/p95 … in the suite output").
    console.log(
      `[baseline] e2e calculator path — n=${SAMPLES} errors=${errors} ` +
        `p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms ` +
        `mean=${(total / latencies.length).toFixed(1)}ms ` +
        `(G3 local reference p95 567 ms — see tests/e2e/BASELINE.md)`,
    );
    // Correctness guard for the measurement itself, not a latency budget:
    // every sampled calculation must have completed.
    expect(errors).toBe(0);
  });
});
