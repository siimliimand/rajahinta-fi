# Migrate to Cloudflare

## Why

The platform currently runs on Kubernetes (GHCR images, kustomize overlays, migrate Jobs) backed by PostgreSQL 16 + TimescaleDB, Redis 7, and BullMQ, with metrics scraped via ServiceMonitor. Operating this surface spans multiple vendors and requires cluster care (upgrades, HPA/PDB hygiene, migrate Jobs per deploy) that is unrelated to the product.

Cloudflare now offers every primitive this platform needs under one vendor: Workers compute, D1 (SQLite) storage, Durable Objects, Queues + Workflows + Cron Triggers, and an email sending service (Email Service, `send_email` binding with SPF/DKIM managed by Cloudflare). Consolidating removes cluster operations entirely, adds per-PR preview environments, and replaces hand-rolled retry/dedupe plumbing with managed primitives.

Verified portability (exploration, 2026-08-29) makes the cost tractable:

- `packages/core-domain` — the tax engines, calculator, optimizer, ranking, reliability, compliance logic — is pure TypeScript and ports unchanged.
- `packages/data-platform` uses Drizzle ORM 0.38, which ships a D1 driver, and all money is stored as INTEGER cents, so there is no DECIMAL translation problem.
- `packages/data-acquisition` is fetch-based and Workers-native by construction.

The actual rewrite surface is `packages/application-api`'s infrastructure glue (NestJS runtime wiring, Redis Lua, BullMQ, prom-client) plus the D1 data layer and the delivery pipeline. The user's acceptance bar is explicit: **it must work as good as or better than today** — no capability regressions.

## What Changes

Full re-platform, phased behind three go/no-go gates:

- **Storage**: PostgreSQL 16 + TimescaleDB → D1 (SQLite). Hypertable becomes an indexed append-only table with the watermark pattern preserved; `pg_trgm` search becomes FTS5 + `LIKE` hybrid gated on golden-fixture parity; partition-based retention becomes scheduled batch deletes; pg-numeric coercion at the repository boundary is dropped (D1 returns typed integers).
- **API runtime**: NestJS long-running server → a Workers application (`apps/api-worker`). HTTP layer re-hosted on Hono (decision D1, ratified by spike G3); guards, DTO validation, unified error envelope, and all endpoint contracts preserved verbatim. The NestJS app stays intact until cutover for dual-run parity.
- **Redis services → Durable Objects**: `RateLimiterDO` (exact sliding window — stronger than the current Redis approximation), `IdempotencyDO` (version-aware keys preserved), `ClickCounterDO` (SQLite storage with periodic D1 flush, mirroring today's snapshot design).
- **Jobs**: BullMQ (7 worker types) → Cloudflare Queues (per-merchant ingestion fan-out, dedupe semantics preserved), Workflows (multi-step ingestion pipeline with durable step retries), and Cron Triggers (transport refresh, tax review, FX review, aggregation, retention sweeps). `ConfigBackedRateChangeSource` snapshot file moves to R2.
- **Frontend**: Next.js 15 → Workers via the official OpenNext Cloudflare adapter; next-intl, age gate, and the inlined feature-flag bootstrap are unchanged.
- **Email**: NEW email Worker (`apps/email-worker`) on the Cloudflare Email Service `send_email` binding with a token-authenticated internal send contract. Transactional email *features* (verification mail, digests) remain future scope; this change delivers the platform and its first consumer — operational freshness alerts.
- **Observability**: prom-client `/metrics` + ServiceMonitor → Workers Analytics Engine (request counters, freshness gauges); OpenTelemetry traces keep flowing to Grafana Cloud; PrometheusRule freshness paging is replaced by a Cron checker that alerts through the email Worker.
- **CI/CD**: GHCR + kubectl deploys → wrangler deploys (staging automatic on `master` after D1 migrations + seed; production manually gated). EU placement configured for D1, KV, and DO.
- **Decommission**: K8s overlays, production Dockerfile path, migrate Jobs, ServiceMonitor/PrometheusRule removed only after cutover succeeds.

### Gates (spike go/no-go, group 1)

- **G1 — D1 capacity**: projected observation/record volume must fit D1 limits (10 GB, row-write ceilings) with ≥2× headroom; otherwise observations fall back to R2 (still all-Cloudflare).
- **G2 — Search parity**: FTS5 + `LIKE` candidate search must reproduce golden-fixture expectations (same product in top-k for every golden query).
- **G3 — Vertical slice**: calculator endpoint end-to-end on Workers must hold p95 ≤ 1.25× the current K8s baseline with identical correctness; also ratifies Hono vs Nest-adapter.

No missing engineer specializations: `platform-engineer` (TypeScript, SQLite, background jobs, Next.js) and `devops-engineer` (CI/CD, observability) cover all 35 tasks.
