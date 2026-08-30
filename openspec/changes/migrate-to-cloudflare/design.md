# Design: Migrate to Cloudflare

## Context

The current stack targets long-running containers: a NestJS composition root (`apps/backend`) hosting the `application-api` package, PostgreSQL 16 + TimescaleDB via Drizzle, Redis 7 (Lua sliding-window limiter, idempotency, click counters), BullMQ workers, and prom-client metrics on a second port. Workers is a request-scoped runtime: no listening server, no second port, no long-running processes. The migration therefore maps every mechanism onto a Cloudflare-native primitive while preserving observable behavior and API contracts.

The load-bearing discovery: `packages/core-domain` is framework-free TypeScript and `packages/data-platform` runs Drizzle 0.38 (D1 driver available) with INTEGER-cents money. The rewrite surface is infrastructure glue, not domain logic. The NestJS app remains runnable until cutover so dual-run parity can be measured on real traffic.

## Target architecture

```
                   ┌────────────────────────────────────────┐
                   │           CLOUDFLARE (all of it)       │
 rajahinta.fi ────▶│  DNS / CDN / WAF                       │
                   │                                        │
       ┌───────────┼──────────────┬───────────────┐         │
       ▼           ▼              ▼               ▼         │
 ┌──────────┐ ┌───────────┐ ┌────────────┐ ┌─────────────┐  │
 │ Frontend │ │ API       │ │ Email      ││ Cron/Queues/ │ │
 │ OpenNext │ │ Worker    │ │ Worker     ││ Workflows    │ │
 │ (Next15) │ │ (Hono)    │ │ send_email ││ (7 jobs)     │ │
 └────┬─────┘ └─────┬─────┘ └─────┬──────┘ └──────┬───────┘  │
      │       ┌─────┴─────────────┼───────────────┴────┐     │
      │       │  D1 (SQLite)      Durable Objects      │     │
      │       │  20 tables        RateLimiterDO        │     │
      │       │  FTS5 search      IdempotencyDO        │     │
      │       │  observation log  ClickCounterDO       │     │
      │       │  + KV / R2 (rate snapshots, config)    │     │
      │       └────────────────────────────────────────┘     │
      └── OTLP traces ──▶ Grafana Cloud (retained)           │
                   └────────────────────────────────────────┘
```

## Decisions

### D1 — HTTP layer: Hono on Workers (ratified by G3)

Re-hosting the HTTP layer on Hono preserves the contracts that matter — DTO shapes (zod), guard semantics, the unified error envelope, route paths — while the Nest DI plumbing is rewritten once. Running Nest on Workers via a community adapter was the fallback: it fights the runtime permanently (no second metrics port, no long-running anything, adapter breakage risk on Nest minors). G3 ratified the default with data: real core-domain engines ran in a Worker with 5/5 golden correctness (`spikes/g3-vertical-slice.md`). The NestJS app stays buildable until cutover (dual-run).

Bundle note for phases 2–3 (G3 finding): importing core-domain into a Worker bundle drags the `@nestjs/common` barrel (Node built-ins, rxjs, class-validator) in with it. The validated approach is a bundler alias of `@nestjs/common` to a minimal no-op decorator shim for the Workers build; `nodejs_compat` is the fallback.

### D2 — D1 schema translation rules

- 20 `pgTable` definitions → `sqliteTable` under `packages/data-platform/src/d1/schema.ts`; money stays INTEGER cents (already true); timestamps become ISO-8601 TEXT (UTC); booleans as INTEGER 0/1 via Drizzle's SQLite mapping; pg enums → TEXT + CHECK constraints; tri-state `depositSystemStatus` → nullable INTEGER.
- Migrations: drizzle-kit SQLite dialect, applied via `wrangler d1 migrations` in the deploy pipeline (staging automatic, production gated) — preserving the existing migrate-before-rollout ordering.
- The pg-numeric decimal-coercion layer (`db/pg-numeric.ts`) is not ported: D1 returns typed integers.

### D3 — Search: FTS5 + LIKE hybrid with a parity gate

FTS5 external-content virtual table over `productMaster` names, kept in sync by triggers. Query strategy: FTS5 MATCH with prefix queries first; `LIKE '%q%'` fallback over the (small, ~10⁴-row) product set for substring matches trigram search used to catch. Golden-fixture queries (e.g. "karhu") must produce the expected product in top-k — G2 turns this from hope into a build gate.

### D4 — Time-series: append-only R2 log + watermark, no hypertable

Amended by gate review G1 (NO-GO for D1-only storage, see Gate review outcomes): `priceObservations` moves to R2 as append-only JSONL objects partitioned by date, batch-read for aggregation, while the relational core (offers, current prices, summaries, calculation records) stays in D1. The 7-day-chunk hypertable partitioning is replaced by range scans over the date-partitioned log; the watermark scan pattern applies to R2 objects unchanged. Summaries still materialize into D1 with `strftime` bucketing and remain the long-term analytical record.

Retention is amended with the same review: all calculation records are age-capped by configuration (default 180 days) — anonymous rows keep the existing 30-day window, and the cap replaces "session-bearing rows are never pruned". Retention becomes scheduled batch `DELETE` via Cron — simpler than today's `DROP PARTITION` choreography. With observations in R2 and the age cap in place, the ≥2× byte headroom G1 requires is restored.

### D5 — Durable Objects replace Redis

- `RateLimiterDO`: sliding-window log with lazily pruned timestamps — exact, strongly consistent, an upgrade over the current Redis approximation. Kills `RATE_LIMIT_TRUST_PROXY`: `CF-Connecting-IP` is trustworthy by construction.
- `IdempotencyDO`: version-aware cache keys preserved (tax/transport/FX dataset versions remain part of the key); strong consistency where KV's eventual consistency would allow duplicate calculations.
- `ClickCounterDO`: SQLite-backed storage with `alarm()`-driven periodic flush into `clickCounterSnapshots` (D1) — mirrors the current Redis-counter + snapshot design almost one-to-one.

### D6 — Jobs: Queues + Workflows + Cron

- Per-merchant ingestion: hourly Cron reads the merchant registry and enqueues one message per permitted merchant; dedupe keys (`price-ingestion-<merchantId>-<hour>`) carry over as consumer-side idempotency checks.
- The ingestion pipeline (fetch → data-quality → mapping → upsert) becomes a Cloudflare Workflow with durable per-step retries; governance gating (`SourceGovernanceService`) is unchanged. Data-acquisition adapters are fetch-based already; subrequest limits are respected by paging one Workflow step at a time.
- Cron Triggers replace the BullMQ repeat schedules for transport-rate refresh, tax-dataset review, FX-dataset review, time-series aggregation, and retention sweeps.
- `ConfigBackedRateChangeSource` reads its snapshot from R2 instead of a file.

### D7 — Email: Cloudflare Email Service

A dedicated Worker (`apps/email-worker`) wraps the `send_email` binding: builds MIME (HTML + text), exposes `POST /internal/email/send` behind a shared-secret header, and is the only sender in the system. Domain verification (SPF/DKIM) is handled through Cloudflare Email Service setup; a runbook documents it. First consumer is the ops freshness alert (D8); transactional email *features* (verification mail, digests) are explicitly future scope.

### D8 — Observability rework

- Metrics: Workers Analytics Engine `writeDataPoint` for request counters and freshness gauges (stale price share, transport age); queryable via the GraphQL API; Grafana dashboards re-pointed.
- Traces: Workers' OTLP export keeps Grafana Cloud as the trace destination — no vendor change for APM.
- Logs: Workers Logs with request-ID fields replacing pino-to-stdout.
- Health: `GET /api/v1/health/ready` verifies a D1 roundtrip plus a DO ping (dependency-aware, short timeouts); liveness stays process-only and cheap.
- Alerting: a Cron checker evaluates freshness invariants and calls the email Worker — replacing PrometheusRule paging.

### D9 — Environments and EU residency

wrangler environments `dev` / `staging` / `production`; each gets its own D1 database, KV namespace, R2 bucket, and Queues; secrets via `wrangler secret put` per environment. EU placement is deliberate, not default: D1 primary location hint, DO location hint, KV jurisdiction EU — documented for the legal/tax review this platform already undergoes.

### D10 — Cutover and rollback

One-time ETL: Postgres dump → transform (types, epoch → ISO-8601) → `wrangler d1 import`. Dual-run window: both stacks receive sampled traffic; a parity harness diffs calculator outputs (golden dataset plus live samples) until error-free. Cutover is a low-TTL DNS switch; rollback is switching DNS back while the K8s cluster is kept warm for an agreed window. Decommission (task 6.7) happens last, after the rollback window closes.

## Risks

| Risk | Mitigation |
|---|---|
| D1 write/size ceilings invalidate the plan | Resolved by G1: observations move to R2 (D4 amended) and calculation records are age-capped, restoring ≥2× byte headroom — see Gate review outcomes |
| FTS5 ≠ trigram quality on real queries | Gate G2 against golden fixtures before any port work starts |
| Hono port misses guard semantics | Guards ported as middleware with parity tests; G3 vertical slice proves the pattern on one endpoint before the rest |
| e2e-browser suite depends on docker-compose stack | Rewired to Workers previews/staging (task 5.4) |
| Compliance/neutrality regressions during rehost | Domain package untouched; compliance suite runs unchanged; dual-run parity adds an output-level net |
| Data residency drift | EU placement hints are explicit config reviewed in task 6.5 |

## Gate review outcomes (G1–G3)

Task 1.4 resolves the three go/no-go gates against their spike reports.

| Gate | Verdict | Evidence |
|---|---|---|
| G1 — D1 capacity | **NO-GO** for D1-only storage → R2 fallback triggers (D4 amended) | `spikes/g1-sizing.md` — bytes headroom 0.42× (≈24 GB projected vs 10 GB D1 limit at 10× growth); writes 4.5× and reads ~82× pass |
| G2 — search parity | **GO** | `spikes/g2-search-parity.md` — 13/13 golden queries within top-5 on FTS5+LIKE; `remove_diacritics=0` pinned for parity; LIKE merge covers mid-token recall; Finnish collation stays app-side |
| G3 — vertical slice | **GO** | `spikes/g3-vertical-slice.md` — real core-domain engines in a Worker, 5/5 golden correctness, 0 mismatches, p95 567 ms (local wrangler dev + local D1); RateLimiterDO engaged (429s under burst) |

Recorded decisions:

1. **D1 ratified**: Hono on Workers; G3 is the evidence. The Nest adapter fallback is retired.
2. **D4 amended**: `priceObservations` → R2, structured as append-only JSONL objects partitioned by date and batch-read for aggregation; summaries still materialize into D1; the watermark pattern applies to R2 objects.
3. **Age-capped calculation records** (new): all calculation records get a config-driven age cap, default 180 days — anonymous rows keep the existing 30-day window; the cap replaces "session-bearing rows are never pruned". `priceHistorySummaries` remains the long-term analytical record.
4. **`@nestjs/common` bundle handling** (G3 finding): bundler-alias `@nestjs/common` to a minimal no-op decorator shim for the Workers build; `nodejs_compat` is the fallback. This is the approach for phases 2–3.
5. **Baseline comparison method** (resolves G3's deferred comparison; no runnable K8s baseline exists in-repo, so G3 records absolute numbers): finalized at task 3.9 — run the existing artillery/load profile against the Worker on staging and compare against the K8s stack during dual-run (task 6.6), using the G3 absolute numbers as the local reference.
