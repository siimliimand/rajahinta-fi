# G3 — Vertical slice spike (task 1.3)

**Question:** does the calculator endpoint run end-to-end in a scratch
Cloudflare Worker — Hono + a translated D1 schema subset + the real
core-domain engines + a DO rate limiter — with golden-correct results and
plausible latency?

**Verdict below.** Spike code:
`scripts/spikes/cloudflare/vertical-slice/` (throwaway, outside the pnpm
workspace; own package.json, npm-installed: hono, drizzle-orm,
@nestjs/common (shimmed, see findings), reflect-metadata; dev: wrangler
4.127.1, @cloudflare/workers-types, typescript).

## What was built

| Piece | File | Notes |
|---|---|---|
| Worker entry, `POST /api/v1/calculator` | `src/index.ts` | Hono app; mirrors the `CalculateRequest` DTO of `packages/application-api/src/calculator/calculator.dto.ts` (productId, quantity, destination, transportMethod?, transportArrangement?, sessionId?) and returns the core-domain `CalculatorResult` shape; error mapping mirrors `CalculatorController.calculate` (404 product/offers, 422 `ClassificationGateRejection` envelope, 500) |
| Schema subset on D1 | `src/schema.ts` + `seed.sql` | `products`, `retail_offers`, `tax_rules`, `transport_offers`, `calculation_records` via drizzle-orm/d1 `sqliteTable` — INTEGER cents, decimal-TEXT numerics (pg `numeric` parity), ISO-8601 TEXT timestamps, tri-state nullable deposit status |
| D1 adapters | `src/adapters.ts` | `IProductDataPort` + `ITaxRuleRepositoryPort` + `ITransportOfferQuery` + write-once `ICalculationRecordPort`; product/offer mapping is a faithful copy of the production `apps/backend/src/adapters/product-data.adapter.ts` (ABV null→0, `weightKg = litres × 1.0`, name→normalizedName, legacy 'EXACT' reliability→ESTIMATED, null provenance columns omitted) |
| Calculator wiring | `src/calculator.ts` | The REAL `LandedCostCalculatorService` from `packages/core-domain/src/` imported directly (source-to-source relative import; no dist build, no workspace changes), wired exactly like the golden suite's `createGoldenService`: real ClassificationGate, AlcoholExcise, ContainerDuty, TransactionClassification, TransportEstimation, ConfidenceFramework over the D1 ports |
| Rate limiter | `src/rate-limiter.ts` | `RateLimiterDO` Durable Object — per-client in-memory sliding-window log (stub level; exact-window parity is task 3.3) |
| Seed + smoke | `seed.sql`, `scripts/smoke.mjs` | Self-contained: seeds local D1 (`wrangler d1 execute --local`), boots `wrangler dev`, runs the golden cases as HTTP requests, burst-checks the limiter, writes `results/smoke-results.json` |
| Load | `scripts/load.mjs` | 30 s concurrent fetch loop (12 workers), p50/p95/p99 + error rate, and a correctness diff of EVERY 200 response against the closed-form golden total for its (product, quantity) |

**Golden expectations source:** `tests/golden/golden-dataset.test.ts` +
`tests/golden/data/products.ts` (v2.1) and the v1.0-2024 tax rule seed of
`tests/golden/helpers/in-memory-tax-rule.repository.ts` (all 25 rules,
vero.fi rates, loaded into the `tax_rules` D1 table — exercising the real
SQL lookup path instead of the in-memory repo).

## Correctness — diff vs golden

`scripts/smoke.mjs` (wrangler dev + local D1 + DO), exit code 0:

| Case | Request | Golden expectation | Worker result |
|---|---|---|---|
| 1 | beer qty=1 carrierA | total 441 = 200 + 150 + 91 + 0; DistanceSelling HIGH; MEDIUM confidence; no `otherCharges` | PASS — itemized lines and reliability statuses identical |
| 2 | wine qty=3 carrierB | retail 900, excise 1026, transport 200 (unscaled), total 2126, DistanceBuying | PASS |
| 3 | spirits qty=1, no transport | total 2034, transport 0, `transportOfferId` null, LOW confidence | PASS |
| 4 | unclassified product | 422 `ClassificationGateRejection`, productId 4, reason mentions classification | PASS |
| 5 | mixed currency (SEK + EUR + rogue SEK offer) | converted SEK offer wins (offerIds [112]), total 441 EUR, rogue offer 114 excluded `NO_VALID_EUR_CONVERSION` with 900 SEK provenance, `originalRetailPrice {2264 SEK}`, FX dataset `ecb-2026-08-27.1` in datasetVersions, HIGH confidence | PASS |
| — | DO rate limiter burst | engages above the per-minute ceiling | PASS — 200×54, 429×16 under 70-request burst (window shared with the golden cases) |

**Load-path correctness:** 1502 requests under concurrent load —
**0 total-cents mismatches** against the closed-form golden totals.

The endpoint returned the production response shape throughout:
`itemizedCosts[]` (label/category/cents/reliability), `excludedOffers`,
`originalRetailPrice`, `totalCents`, `currency`, `confidence`,
`confidenceBreakdown`, `classification`, `metadata` (datasetVersions,
offer ids, product facts), `calculationRecordId` (persisted to the D1
`calculation_records` table per request).

## Load results (this machine — local wrangler dev / workerd + local D1)

`npm run load` (30 s, 12 concurrent workers, rate limiter ceiling raised;
exit 0):

| Metric | Value |
|---|---|
| calls | 1502 (all 200 OK) |
| error rate | 0.00 % |
| correctness mismatches | **0 / 1502** |
| p50 | 200 ms |
| **p95** | **567 ms** |
| p99 | 827 ms |
| min / mean / max | 21 / 243 / 891 ms |
| throughput | 50.1 req/s |

## Baseline situation

- `tests/load/calculator-load.test.ts` measures the **orchestrator only**
  (in-process, mocked ports, no HTTP) against a committed p95 < 2 000 ms
  budget; no measured value is recorded in the repo.
- `docs/staging-verification.md` defines HTTP-level thresholds
  (p95 < 2 000 ms, errors < 1 %) but its artillery suite is explicitly
  non-blocking "until a performance baseline is established" — no K8s
  baseline number exists.
- `tests/load/basket-load-results.md` records service-level numbers for
  the **basket optimizer**, not the calculator, under docker CPU
  constraints (typical p95 ≈ 0.7 s at 50 concurrent on 0.256 CPU).

**No runnable K8s/docker-compose baseline exists here** (booting the full
stack was out of scope for this spike), so no p95 ratio against a real
K8s replica can be computed yet. Provisional comparison against the
committed 2 000 ms budget: spike p95 567 ms ≈ **0.28 × budget (3.5×
headroom)**. Task 1.4 (gate review) must finalize the comparison method
(same-machine artillery against staging vs a Worker preview, or
constrained-docker parity as in `basket-load-results.md`).

Caveats: local `wrangler dev` numbers include miniflare's D1
*simulator* (single local SQLite) and no production D1 replication/placement
effects — treat the absolute values as plausibility evidence, not a
production latency forecast.

## Findings

1. **core-domain ports to a Worker unmodified.** The calculator path
   (orchestrator + tax + classification + transport + confidence
   engines) bundled and ran from TypeScript sources with zero logic
   changes; all golden expectations pass through real SQL rule lookup.
2. **The NestJS runtime does not port for free.** core-domain carries
   `@Injectable`/`@Inject` decorators, and the `@nestjs/common` barrel
   re-exports drag `stream`/`util`/`url`, rxjs, class-validator and
   class-transformer into the bundle. The spike aliases `@nestjs/common`
   to a no-op decorator shim (`src/nestjs-compat.ts`) — engines are
   constructed manually, so DI metadata is dead weight. Alternatives:
   `nodejs_compat` + optional peers installed, or (cleanest, aligned with
   task 3.x) stripping decorator imports when the Nest runtime is
   dropped. Task 1.4 should record this as a decision input.
3. **D1 schema translation is mechanical for this subset** — INTEGER
   cents, decimal-TEXT numerics, ISO-8601 TEXT compare correctly
   (lexicographic) for effective-date windows; the only open choice is
   REAL vs decimal-TEXT for kg brackets (task 2.1).
4. **Process hygiene lesson for the test harness:** wrangler dev spawns
   workerd in a process tree that survives plain `child.kill()` — the
   scripts kill the whole detached process group (orphaned workerd
   otherwise survives and skews subsequent runs).
5. **Rate limiting works as a DO round-trip** in front of the route with
   per-client windows; idempotency cache was intentionally skipped
   (X-Cache always MISS) — that is task 3.3/3.4 work.

## VERDICT

G3: GO
