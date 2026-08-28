# Basket optimizer load test — method and results (task 11.2)

Change: `technical-assessment-remediation`, task 11.2 — *"Load-test the
basket optimizer under the current 256m/512Mi limits; document or
adjust."*

## What was measured

`BasketOptimizerService.optimize` end-to-end (product resolution,
classification gate, candidate building, per-(item, merchant) cost
computation, merchant-subset shipping prefetch over a real
`BasketShippingCalculator`, DFS enumeration of merchant assignments,
deterministic sort, result assembly) with mocked I/O ports — the same
service-level pattern as `tests/load/calculator-load.test.ts`.

Suite: `tests/load/basket-optimizer-load.test.ts`
(vitest, `tests/load/vitest.config.ts`).

| Scenario | Shape | Assignments/call | Concurrency |
|---|---|---|---|
| typical | 4 items × 4 candidate merchants | 4⁴ = 256 | 50 |
| max-cap | 10 items (`MAX_BASKET_ITEMS`) × 3 shared merchants | 3¹⁰ = 59 049 | 5 |

## Method — resource limits

No local cluster exists, so the k8s limits were approximated with
Docker constraints matching the base deployment's container limits
(`infra/k8s/base/deployment.yaml`: cpu `256m`, memory `512Mi`; the
staging overlay pins the same values — production uses 512m/1Gi):

```sh
docker run --rm --cpus=0.256 --memory=512m \
  -v "$PWD":/work -w /work node:22-slim \
  sh -c "node_modules/.bin/vitest run \
    --config tests/load/vitest.config.ts \
    tests/load/basket-optimizer-load.test.ts"
```

Caveats of the approximation: cgroup CPU quota and memory ceiling match
the k8s values, but k8s CPU *limits* are enforced via CFS quota the same
way Docker does here; single-pod network/IO interference is not modelled
(I/O is mocked anyway), and the measurement excludes the HTTP layer
(guards, serialization, rate limiting) — the artillery suite
(`tests/load/artillery/basket-optimizer-suite.yml`) covers that level
against a deployed target.

## Results

Host reference (unconstrained, 8-core dev box, Node 22.18):

| Scenario | p50 | p95 | errors |
|---|---|---|---|
| typical (50 conc.) | ~60 ms | **64.8 ms** | 0 |
| max-cap (5 conc.) | ~2.4 s | **2 678 ms** | 0 |
| max-cap single call | ~0.5 s | — | 0 |

Constrained (0.256 CPU / 512 Mi, node:22-slim, all 4 tests pass):

| Scenario | p50 | p95 | errors | OOM |
|---|---|---|---|---|
| typical (50 conc., 150 calls) | 612.8 ms | **695.7 ms** | 0 | no |
| max-cap (5 conc., 15 calls) | 16 210 ms | **17 494 ms** | 0 | no |
| max-cap single call | 3 705 ms | — | 0 | no |

Committed thresholds (regression tripwires, in the test file):
typical p95 < 2 000 ms; max-cap p95 < 20 000 ms; error rate < 1 %.

## Findings

1. **Typical interactive baskets fit the current limits comfortably.**
   At 50 concurrent 4-item baskets on a quarter-core budget, p95 stays
   ≈ 0.7 s — well inside the 2 s API latency budget used by the
   calculator suite.
2. **The input-cap worst case is enumeration-bound, not memory-bound.**
   A single 10-item × 3-merchant basket takes ≈ 4 s under the CPU quota
   (≈ 0.5 s unconstrained — a ×8 CPU-throttling factor), and 5
   concurrent worst-case baskets settle at p95 ≈ 17 s. Peak memory
   (all 59 049 assignments materialised per call, ×5 concurrent) stayed
   within 512 Mi with no OOM.
3. **This is the workload the total-combinations guard exists for.**
   The pathological shape is bounded at the API layer by the planned
   422 guard on total combinations (task 10.2,
   `basket-optimization` spec: *Total combinations guard*), not by
   adding CPU.

## Decision — limits kept as-is

**No adjustment to the k8s resource limits.** Measurements do not
justify a bump: the typical path has ≈ 3× headroom under the 2 s
budget at 50 concurrent, and the worst case is a combinatorial
explosion that more CPU would only mask (and which the 422 guard
should reject outright). Revisit only if staging HTTP-level runs
(`artillery --basket`) show the p95 budget breached through the full
stack.

## HTTP-level suite

`tests/load/artillery/basket-optimizer-suite.yml` (run via
`bash tests/load/artillery/run.sh --basket`) exercises
`POST /api/v1/basket/optimize` against a deployed target with the
feature flag enabled. **Flag:** the endpoint is guarded by
`@FeatureFlagDec(FeatureFlag.BASKET_OPTIMIZATION)`; enable on the
target with `FF_BASKET_OPTIMIZATION=true` (k8s ConfigMap
`rajahinta-config` entry, or process env for local runs) — a 403 flood
means the flag is off. Its p95 threshold (5 000 ms) is provisional
until the first staging baseline; request bodies randomise `sessionId`
so the idempotency cache serves MISSes and the suite measures compute.
