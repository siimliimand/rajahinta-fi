# E2E calculator-path baseline — task 3.9 (change migrate-to-cloudflare)

Recorded local numbers for the **e2e calculator path** of the Worker app
(`apps/api-worker`), per the design.md gate-review follow-up ("Baseline
comparison method"): G3's absolute numbers are the local reference; the
staging-vs-K8s artillery comparison remains **task 6.6's** job.

## What was measured

The `baseline` suite (`tests/e2e/baseline.e2e.test.ts`) drives
`SAMPLES = 100` sequential `POST /api/v1/calculator` requests through the
REAL app composition (`createApp()`: guards → rate-limit admission →
idempotency lookup → REAL core-domain engines over the fake-D1 harness →
calculation-record persistence → response). Every call is a full MISS
compute (unique `quantity` → unique idempotency key). Run:

```
pnpm --filter @rajahinta/api-worker test:e2e
```

The RATE_LIMITER binding is absent in this suite (the middleware's
documented fail-open harness path), keeping the burst above the CALCULATOR
10/min ceiling and excluding DO round-trips — G3's load run raised the
ceiling the same way.

## Results (this machine, 2026-08-30)

| Run | n | errors | p50 | p95 | p99 | mean |
|---|---|---|---|---|---|---|
| 1 | 100 | 0 | 1.8 ms | 4.0 ms | 8.3 ms | 2.2 ms |
| 2 | 100 | 0 | 1.3 ms | 2.6 ms | 4.6 ms | 1.7 ms |
| 3 | 100 | 0 | 1.0 ms | 1.9 ms | 4.8 ms | 1.3 ms |

**Recorded local reference: p50 ≈ 1–2 ms, p95 ≈ 2–4 ms** (in-process).

## Comparison against G3

| Metric | G3 spike (local wrangler dev + local D1, 12-concurrent, 30 s) | This harness (in-process, sequential) |
|---|---|---|
| p50 | 200 ms | 1.0–1.8 ms |
| p95 | **567 ms** | **1.9–4.0 ms** |
| Correctness | 0 / 1502 total-cents mismatches | 14/14 golden-over-HTTP cases exact |

The ~two-orders-of-magnitude gap is the **process boundary**, not a
regression or an improvement: G3 measured full workerd (miniflare) +
its D1 *simulator* over real sockets; this harness runs the same app in
the Node test process over `app.request()` with node:sqlite. The numbers
are **plausibility evidence for this harness only** — the same caveat the
G3 spike records for its own absolute values ("not a production latency
forecast"). Useful invariants that DO carry over:

- 0 correctness mismatches under load (G3: 1502 calls) and 0 here
  (every golden case matches its closed-form expectation through HTTP).
- No pathological tails: p99 < 2.5 × p95 in all runs.

## Follow-ups

- Task 6.6 (dual-run): run the existing artillery/load profile against a
  deployed Worker preview and the K8s stack; compare p95 against **both**
  references above with the harness difference in mind.
- If a wrangler-dev-based measurement of THIS suite shape is wanted, run
  `pnpm dev` + the G3 spike's `scripts/load.mjs` — not this harness.
