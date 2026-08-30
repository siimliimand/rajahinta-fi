# Tasks: migrate-to-cloudflare

## 1. Spikes & go/no-go gates (Phase 0)

- [x] 1.1 G1 capacity spike: project price-observation and calculation-record volumes from ingestion forecasts against D1 limits (10 GB database, row-write ceilings); write verdict with headroom math and an R2-fallback recommendation if headroom < 2× <!-- agent: platform-engineer.fast, depends_on: [], touches: [openspec/changes/migrate-to-cloudflare/spikes/g1-sizing.md] -->
- [x] 1.2 G2 search parity spike: seed a local D1 with product fixtures, implement the FTS5 + LIKE candidate query, run the golden-fixture search queries, and record top-k overlap results <!-- agent: platform-engineer.build, depends_on: [], touches: [scripts/spikes/cloudflare/**, openspec/changes/migrate-to-cloudflare/spikes/g2-search-parity.md] -->
- [x] 1.3 G3 vertical slice spike: calculator endpoint end-to-end in a scratch Worker (Hono skeleton + translated schema subset + D1 + DO rate limit), load-tested against the current K8s baseline with a p95 ratio and correctness diff <!-- agent: platform-engineer.build, depends_on: [], touches: [scripts/spikes/cloudflare/**, openspec/changes/migrate-to-cloudflare/spikes/g3-vertical-slice.md] -->
- [x] 1.4 Gate review: resolve G1–G3 go/no-go, record the final Hono-vs-Nest-adapter decision and any design amendments (incl. D4 R2 fallback if G1 fails) <!-- agent: platform-engineer.fast, depends_on: [1.1, 1.2, 1.3], touches: [openspec/changes/migrate-to-cloudflare/design.md] -->

## 2. Data platform on D1 (Phase 1)

- [x] 2.1 Translate the canonical schema: 20 pgTable definitions → sqliteTable under packages/data-platform/src/d1 (INTEGER cents, ISO-8601 TEXT timestamps, CHECK-constrained enums, nullable tri-state deposit status) plus the drizzle-kit SQLite config <!-- agent: platform-engineer.build, depends_on: [1.4], touches: [packages/data-platform/src/d1/schema.ts, packages/data-platform/drizzle.d1.config.ts] -->
- [x] 2.2 FTS5 product search: external-content virtual table over product names with sync triggers, search repository with MATCH + LIKE fallback, proven against the golden fixture queries from 1.2 <!-- agent: platform-engineer.build, depends_on: [1.2, 2.1], touches: [packages/data-platform/src/d1/schema.ts, packages/data-platform/src/repositories/d1/product-search.repository.ts] -->
- [x] 2.3 Time-series translation: append-only priceObservations table with composite (productId, observedAt) index, summary materialization via strftime bucketing, watermark-scan queries preserved <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [packages/data-platform/src/d1/schema.ts, packages/data-platform/src/repositories/d1/price-observation.repository.ts, packages/data-platform/src/repositories/d1/price-history-summary.repository.ts] -->
- [x] 2.4 D1 connection provider (drizzle-orm/d1) + migrations pipeline wired to `wrangler d1 migrations` <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [packages/data-platform/src/db/d1.provider.ts, packages/data-platform/src/db/d1.module.ts, wrangler.jsonc] -->
- [x] 2.5 Port pg-specific repositories to D1 (sessions, audit, aggregation watermarks, merchant registry), drop the pg-numeric coercion layer, and reimplement retention as bounded batch DELETE <!-- agent: platform-engineer.build, depends_on: [2.4], touches: [packages/data-platform/src/repositories/d1/**] -->
- [x] 2.6 Seed pipeline for D1: versioned tax rules and staging data via wrangler d1 import/execute <!-- agent: platform-engineer.build, depends_on: [2.4], touches: [packages/data-platform/src/seed/d1/**, scripts/seed-d1.ts] -->
- [x] 2.7 Port the real-Postgres suites onto D1: integration, data-quality, and golden suites under miniflare/vitest-pool-workers; unit suites untouched <!-- agent: platform-engineer.build, depends_on: [2.5, 2.6], touches: [vitest.config.workers.ts, tests/integration/**, packages/data-platform/src/repositories/d1/__tests__/**] -->

## 3. API Worker (Phase 2)

- [x] 3.1 Worker entry + Hono application skeleton: router, unified error envelope middleware, request-ID structured logging, zod DTO layer <!-- agent: platform-engineer.build, depends_on: [1.4], touches: [apps/api-worker/src/index.ts, apps/api-worker/src/middleware/**] -->
- [x] 3.2 Port guards as middleware: session auth against D1 sessions, entitlement, launch gate, age gate, ops access with IP allowlist from CF-Connecting-IP, feature flag service with inlined bootstrap parity <!-- agent: platform-engineer.build, depends_on: [3.1, 2.7], touches: [apps/api-worker/src/middleware/**] -->
- [x] 3.3 RateLimiterDO (exact sliding window) + IdempotencyDO (version-aware keys) with parity tests against current Redis behavior; remove RATE_LIMIT_TRUST_PROXY semantics <!-- agent: platform-engineer.build, depends_on: [3.1], touches: [apps/api-worker/src/do/**] -->
- [x] 3.4 ClickCounterDO with SQLite storage and alarm-driven flush into clickCounterSnapshots (D1) <!-- agent: platform-engineer.build, depends_on: [3.1, 2.5], touches: [apps/api-worker/src/do/**] -->
- [x] 3.5 Port calculator, calculations, search, and declaration endpoints with contract parity tests <!-- agent: platform-engineer.build, depends_on: [3.2, 3.3], touches: [apps/api-worker/src/routes/**] -->
- [x] 3.6 Port basket optimizer, historical, reports, and merchants endpoints with contract parity tests <!-- agent: platform-engineer.build, depends_on: [3.2, 3.3], touches: [apps/api-worker/src/routes/**] -->
- [x] 3.7 Port accounts endpoints (sessions, history, scenarios, export/GDPR, subscription/billing) and click analytics endpoints <!-- agent: platform-engineer.build, depends_on: [3.2, 3.4], touches: [apps/api-worker/src/routes/**] -->
- [x] 3.8 Port ops console API with append-only D1 audit_events writes and OpsAccessGuard semantics <!-- agent: platform-engineer.build, depends_on: [3.2], touches: [apps/api-worker/src/routes/**] -->
- [x] 3.9 E2E API suite and golden-dataset suite running against the Worker runtime (vitest-pool-workers or deployed preview) <!-- agent: platform-engineer.build, depends_on: [3.5, 3.6, 3.7, 3.8], touches: [apps/api-worker/tests/**] -->

## 4. Background jobs (Phase 3)

- [x] 4.1 Queues: scheduled producer from the merchant registry (one message per permitted merchant, dedupe keys preserved) + consumer with idempotent skip <!-- agent: platform-engineer.build, depends_on: [2.7], touches: [apps/api-worker/src/queues/**, wrangler.jsonc] -->
- [x] 4.2 Ingestion pipeline as a Cloudflare Workflow (fetch → data-quality → mapping → upsert, per-step retries) and Workers-fetch compatibility for the data-acquisition adapters <!-- agent: platform-engineer.build, depends_on: [4.1], touches: [apps/api-worker/src/workflows/**, packages/data-acquisition/src/adapters/**] -->
- [x] 4.3 Cron Triggers for transport-rate refresh, tax-dataset review, FX-dataset review, time-series aggregation, and retention sweeps replacing BullMQ repeat schedules <!-- agent: platform-engineer.build, depends_on: [2.7], touches: [apps/api-worker/src/cron/**, wrangler.jsonc] -->
- [x] 4.4 Rate-snapshot source reading from R2, replacing the ConfigBackedRateChangeSource file input <!-- agent: platform-engineer.build, depends_on: [4.3], touches: [packages/data-acquisition/src/adapters/rate-snapshot.r2.ts, wrangler.jsonc] -->

## 5. Frontend + email (Phase 4)

- [x] 5.1 OpenNext Cloudflare adapter: frontend Worker build, wrangler config, per-PR preview URLs <!-- agent: platform-engineer.build, depends_on: [3.9], touches: [apps/frontend/open-next.config.ts, apps/frontend/wrangler.jsonc, package.json] -->
- [x] 5.2 Frontend→API connection: same-zone routing or service binding, per-environment cookie domain and API base, secure cookie flags verified on Workers <!-- agent: platform-engineer.build, depends_on: [5.1], touches: [apps/frontend/src/lib/**, apps/frontend/wrangler.jsonc] -->
- [x] 5.3 Email Worker: send_email binding, MIME construction, POST /internal/email/send behind a shared-secret header, and the SPF/DKIM domain-verification runbook <!-- agent: platform-engineer.build, depends_on: [1.4], touches: [apps/email-worker/**] -->
- [ ] 5.4 Playwright browser journeys running against Workers previews/staging instead of the docker-compose stack <!-- agent: platform-engineer.build, depends_on: [5.2], touches: [tests/e2e-browser/**] -->

## 6. Observability, CI/CD, cutover (Phase 5)

- [x] 6.1 Analytics Engine metrics: request counters by route/status class and freshness gauges via writeDataPoint <!-- agent: platform-engineer.build, depends_on: [3.1], touches: [apps/api-worker/src/observability/**] -->
- [x] 6.2 OTLP trace export from the Workers to Grafana Cloud via environment configuration <!-- agent: platform-engineer.build, depends_on: [3.1], touches: [apps/api-worker/src/observability/**] -->
- [x] 6.3 Freshness Cron checker evaluating stale-price-share and transport-age invariants and alerting through the email Worker (replaces PrometheusRule paging) <!-- agent: platform-engineer.build, depends_on: [4.3, 5.3, 6.1], touches: [apps/api-worker/src/cron/freshness-alert.ts] -->
- [x] 6.4 Health endpoints: ready = D1 roundtrip + DO ping with short timeouts and dependency status; liveness cheap and process-only <!-- agent: platform-engineer.build, depends_on: [2.4, 3.3], touches: [apps/api-worker/src/routes/health.ts] -->
- [x] 6.5 CI/CD rework: PR checks unchanged; staging wrangler deploy on master (migrate → seed → deploy); production gated deploy with Workers rollback availability; EU placement (D1 primary, DO hint, KV jurisdiction) in committed config <!-- agent: devops-engineer.build, depends_on: [3.9, 4.3, 5.1], touches: [.github/workflows/deploy-staging.yml, .github/workflows/deploy-production.yml, infra/environments/**, wrangler.jsonc] -->
- [ ] 6.6 Cutover: one-time ETL script (Postgres → D1 transform + wrangler d1 import), dual-run parity harness diffing calculator outputs on sampled traffic, low-TTL DNS cutover and rollback runbook <!-- agent: devops-engineer.build, depends_on: [6.5], touches: [scripts/etl-pg-to-d1.ts, scripts/dual-run-parity.ts, docs/cutover-runbook.md] -->
- [ ] 6.7 Decommission after the rollback window: delete K8s overlays, production Dockerfile path, migrate Jobs, ServiceMonitor/PrometheusRule; update ARCHITECTURE.md and docs to the Cloudflare architecture <!-- agent: devops-engineer.fast, depends_on: [6.6], touches: [infra/k8s/**, Dockerfile, docker-compose.yml, ARCHITECTURE.md, docs/tech-stack.md] -->
