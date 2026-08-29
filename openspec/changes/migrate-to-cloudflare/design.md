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

### D1 — HTTP layer: Hono on Workers (default), Nest adapter only if G3 demands

Re-hosting the HTTP layer on Hono preserves the contracts that matter — DTO shapes (zod), guard semantics, the unified error envelope, route paths — while the Nest DI plumbing is rewritten once. Running Nest on Workers via a community adapter is the fallback: it fights the runtime permanently (no second metrics port, no long-running anything, adapter breakage risk on Nest minors). Spike G3 decides with data; the default is Hono. Either way the NestJS app stays buildable until cutover (dual-run).

### D2 — D1 schema translation rules

- 20 `pgTable` definitions → `sqliteTable` under `packages/data-platform/src/d1/schema.ts`; money stays INTEGER cents (already true); timestamps become ISO-8601 TEXT (UTC); booleans as INTEGER 0/1 via Drizzle's SQLite mapping; pg enums → TEXT + CHECK constraints; tri-state `depositSystemStatus` → nullable INTEGER.
- Migrations: drizzle-kit SQLite dialect, applied via `wrangler d1 migrations` in the deploy pipeline (staging automatic, production gated) — preserving the existing migrate-before-rollout ordering.
- The pg-numeric decimal-coercion layer (`db/pg-numeric.ts`) is not ported: D1 returns typed integers.

### D3 — Search: FTS5 + LIKE hybrid with a parity gate

FTS5 external-content virtual table over `productMaster` names, kept in sync by triggers. Query strategy: FTS5 MATCH with prefix queries first; `LIKE '%q%'` fallback over the (small, ~10⁴-row) product set for substring matches trigram search used to catch. Golden-fixture queries (e.g. "karhu") must produce the expected product in top-k — G2 turns this from hope into a build gate.

### D4 — Time-series: append-only table + watermark, no hypertable

`priceObservations` becomes a single append-only D1 table with a composite `(productId, observedAt)` index. The 7-day-chunk hypertable partitioning is replaced by `WHERE observedAt >= …` range scans; the watermark scan pattern survives unchanged. Summaries aggregate with `strftime` bucketing. Retention (calculation records, anonymous sessions) becomes scheduled batch `DELETE` via Cron — simpler than today's `DROP PARTITION` choreography. G1 validates capacity: if projected row/byte volume leaves <2× headroom against D1 limits (10 GB database size, row-write ceilings), observations move to R2 (JSONL, batch-queried) while the relational core stays D1 — still fully Cloudflare.

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
| D1 write/size ceilings invalidate the plan | Gate G1 first; R2 fallback keeps the plan viable either way |
| FTS5 ≠ trigram quality on real queries | Gate G2 against golden fixtures before any port work starts |
| Hono port misses guard semantics | Guards ported as middleware with parity tests; G3 vertical slice proves the pattern on one endpoint before the rest |
| e2e-browser suite depends on docker-compose stack | Rewired to Workers previews/staging (task 5.4) |
| Compliance/neutrality regressions during rehost | Domain package untouched; compliance suite runs unchanged; dual-run parity adds an output-level net |
| Data residency drift | EU placement hints are explicit config reviewed in task 6.5 |
