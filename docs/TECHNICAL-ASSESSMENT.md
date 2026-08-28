# Technical assessment: what to fix, improve, replace, and add

Assessment date: 2026-08-28. Scope: the full monorepo (apps, packages, infra, tests, CI) as it exists on master after the Phase 2 advanced-features merge. Each finding names the file and line where the issue lives, why it matters, and a concrete recommendation. Severity reflects risk to correctness, users, or compliance, not effort.

## Strengths worth keeping

The codebase does several things unusually well, and any refactor should preserve them:

- The five-layer architecture is real, not aspirational. Ports and adapters keep core-domain free of HTTP and Drizzle; the composition test boots the actual AppModule with in-memory ports.
- Neutrality is enforced three ways: a closed input type, a runtime unknown-property guard, and compliance tests that fail the build on violations. Billing is structurally isolated from ranking.
- Tax rules are versioned with effective windows and never auto-published; the daily review job only creates a human confirmation task.
- The reliability status model (VERIFIED, ESTIMATED, STALE, UNAVAILABLE) flows from ingestion to the UI, and the disclaimer is part of every persisted result.
- The test pyramid is deep: unit, golden dataset per category, data-quality invariants, compliance, e2e, composition smoke, integration on real Postgres, and load tests with a p95 assertion, all wired into CI.
- Idempotency is version-aware: cache entries invalidate when a tax-dataset version changes, not on a timer.

## Critical: fix before public launch

### 1. Foreign-currency prices are summed as euros

The Systembolaget adapter maps prices in SEK and records them with `currency: 'SEK'` (`packages/data-acquisition/src/adapters/systembolaget.adapter.ts:135`). The calculator adds `priceCents` from retail offers to EUR transport and taxes and labels the total `currency: 'EUR'` (`packages/core-domain/src/calculator/landed-cost-calculator.service.ts:171-209`). There is no exchange-rate code anywhere in core-domain. Seed data happens to use EUR prices, so tests pass while a real Systembolaget feed produces totals that mix Swedish öre with euro cents.

Recommendation: convert at ingestion into EUR cents using a dated, versioned FX rate stored with provenance (the same "every number is explainable" treatment as tax rules), keep the original amount and currency for display, and reject offers whose currency cannot be converted rather than summing silently.

### 2. Any client can impersonate any account session

Account routes authenticate with the `x-user-id` header, which the frontend fills from a client-generated UUID cookie (`packages/application-api/src/accounts/account.controller.ts:93` and `apps/frontend/src/lib/api.ts:140`). Anyone who knows or guesses a session ID can read that session's history, scenarios, and GDPR export, and modify or delete them. The session cookie value is the only secret, and it is transmitted on every request and visible in the cookie jar.

Recommendation: issue the session token server-side (opaque ID kept in Redis/Postgres, or a signed value such as an HMAC or JWT), have the backend derive the user from the token instead of trusting a header, and rotate on demand. The accounts schema and controllers otherwise support this change cleanly.

### 3. Legacy calculation endpoints return wrong numbers

`POST /api/v1/calculations/excise` and `/calculations/landed-cost` are wired through `TaxCalculationEngineAdapter`, which ignores the request body and calls `calculate({ productId: 0, ... })` (`packages/application-api/src/adapters/tax-calculation-engine.adapter.ts:33-101`). The endpoints either throw (no product with ID 0) or return a calculation of an unrelated product, while Swagger advertises them as working. Anyone integrating against the documented API gets garbage.

Recommendation: either implement them directly against `AlcoholExciseService` and `ContainerDutyService`, which already expose the right math, or remove the routes and the adapter until they are real.

### 4. Ops dashboard is unauthenticated

`GET /ops/health` (`packages/application-api/src/observability/ops-dashboard.controller.ts:6-15`) has no guard and publishes stale-data findings, verification coverage, and compliance incidents. This is internal operational information.

Recommendation: put the route behind an auth guard and an IP allowlist, or bind it to a separate internal port.

## High: fix soon

### 5. Rate limiting is in-memory and trusts X-Forwarded-For

`InMemoryRateLimiter` (`packages/application-api/src/rate-limiting/rate-limiting.service.ts:91`) keeps windows in a process-local Map: limits reset on every deploy and are not shared between replicas, so the effective limit multiplies with horizontal scaling. The `IRateLimiter` interface was designed for a Redis backend, and a Redis client is already provided by `RedisModule`, but the limiter does not use it. Separately, `extractKey` (`rate-limiting.service.ts:196-203`) takes the first `X-Forwarded-For` value unconditionally, so a direct-to-origin client can spoof its key or frame another IP once a proxy is in front.

Recommendation: implement the Redis backend behind `IRateLimiter` (a sliding window with sorted sets or a fixed-window counter both fit), and trust forwarded headers only when configured behind a known proxy (Express `trust proxy` setting).

### 6. Transport-rate ingestion is a no-op

The 6-hourly transport-refresh job calls `PipelineTransportRateAdapter.refreshCarrierRates`, which logs a warning and returns zero (`packages/data-acquisition/src/adapters/pipeline-transport-rate.adapter.ts:29-37`). All transport offers come from seed data, so their `observedAt` ages and reliability decays toward STALE over time, degrading every calculation's confidence while nothing in operations refreshes the source.

Recommendation: implement at least one real carrier source (Posti, Matkahuolto, or a freight aggregator) with the same governance-gated pipeline used for prices, and alert when the newest transport offer exceeds the 7-day threshold.

### 7. Classification gate accepts the literal string "unknown"

The gate only checks that `regulatoryClassification` is a non-empty, non-whitespace string (`packages/core-domain/src/normalization/classification-gate.service.ts:60-73`). The Systembolaget adapter sets `regulatoryClassification: 'unknown'` for every record (`systembolaget.adapter.ts:131`), which passes the gate. Downstream, the excise engine keys off the product category, and the Swedish category strings ("Öl", "Vin") do not match the Finnish/English category keys the tax rules use, so live-feed products fall into fallback rates.

Recommendation: validate against the known classification enum instead of checking for non-emptiness, and add a category-normalization step (SE group string to canonical category) at ingestion so gate-passing data is also tax-meaningful.

### 8. Search ignores the query string

`GET /api/v1/products?q=` documents the query parameter as a "Phase 2 placeholder" and discards it (`packages/application-api/src/search/search.controller.ts:83-129`). The UI sends real queries, so users typing "karhu" get the alphabetical product list filtered by nothing. This is the most visible functional gap in the product.

Recommendation: implement matching in PostgreSQL with `pg_trgm` similarity or tsvector full-text search over name, brand, and manufacturer, ranked deterministically, with the existing pagination and sort orders preserved.

### 9. In-memory state that should be durable

Three services keep data only in process memory: the audit repository (`packages/application-api/src/audit/in-memory-audit.repository.ts`), click analytics (`click-analytics.service.ts`), and the in-memory idempotency fallback used when Redis is absent. Restarts lose audit trail exactly when incidents are investigated, and the k8s deployment would wipe analytics on every rollout.

Recommendation: persist audit events to PostgreSQL (append-only table) and click counters to Redis with periodic snapshotting; keep in-memory versions only for tests.

### 10. Hourly ingestion enqueues one catch-all job

The scheduler enqueues `{ merchantId: '*', sourceUrl: '' }` once per hour and the comment admits the merchant registry is future work (`packages/application-api/src/jobs/jobs-scheduler.service.ts:53-65`). The catch-all relies on a single registered adapter, so adding a second merchant silently does nothing for it, and one slow feed delays the others.

Recommendation: drive the schedule from the merchant config (one job per permitted merchant with a per-merchant dedupe key), which also enables per-merchant backoff and monitoring.

## Medium: structural improvements

### 11. Age gate is a soft gate in both directions

Findings: the "No" path redirects to `https://www.google.com` (`apps/frontend/src/app/components/AgeGate.tsx:43`), which looks broken and leaks a referrer; during SSR and before hydration the wrapper renders children unconditionally (`AgeGate.tsx:47`), so restricted content is present in the DOM and in any no-JS scrape; the backend's `SimpleConfirmationProvider` accepts any non-empty token, so the gate proves only that a header was sent.

Recommendation: redirect to a neutral in-house page, render a placeholder server-side and gate after mount (or move gate state to a cookie the server can read), and keep the provider interface for the planned stronger verification. Document explicitly that Phase 1 confirmation is self-attestation.

### 12. UI language does not match the audience

The root layout declares `lang="fi"` (`apps/frontend/src/app/layout.tsx:12`) but every user-facing string is English. The product targets Finnish consumers, and Finnish legal terms (excise types, deposit system) are the natural vocabulary.

Recommendation: introduce next-intl or an equivalent, make Finnish the default locale with English secondary, and move the copy that currently lives in components into message catalogs so the existing content-policy lint can police both languages.

### 13. No shared navigation

Each page hand-rolls a "Back to Home" link (`compare/page.tsx:145`, `account/page.tsx:104`, and others). Users must return home to move between calculator, compare, basket, account, and ranking.

Recommendation: add a layout-level header with the five destinations and a footer with the disclaimer and methodology link.

### 14. Entitlement tiers via environment variables

`resolveUserTier` builds env var names from user IDs (`ENTITLEMENT_TIER_<USERID>`, `packages/core-domain/src/entitlement/entitlement.service.ts:69-86`). This cannot scale past a handful of users, and the accounts table already has a `tier` column (`packages/data-platform/src/schema.ts:409`) that nothing reads.

Recommendation: read the tier from the account record, keep env vars only as a global override for testing, and implement the tier transitions when the subscription billing service becomes real.

### 15. Health endpoint checks nothing

`/api/v1/health` returns a static `{ status: 'ok' }` (`packages/application-api/src/index.ts:152-164`). Kubernetes liveness, readiness, startup probes, and the Docker healthcheck all key off it, so the orchestrator will report a pod ready with a dead database or dead Redis.

Recommendation: make readiness verify `SELECT 1` and a Redis ping with short timeouts, keep liveness cheap and process-only, and expose dependency status in the body.

### 16. Swagger and version detail exposed in production

Swagger UI is mounted unconditionally at `/api/docs` (`apps/backend/src/main.ts:17-18`), and health leaks the version string. Not a vulnerability by itself, but it invites probing and contradicts the otherwise conservative posture.

Recommendation: mount Swagger only when `NODE_ENV !== 'production'` or behind an env flag.

### 17. Unbounded growth of calculation records

Every calculation writes an immutable row to `calculation_records` (`landed-cost-calculator.service.ts:182-195`), and basket runs write `basket_calculation_records`. Nothing prunes them; the account-retention worker covers account rows only. Anonymous sessions compound the growth because every curious visitor creates records.

Recommendation: add a retention policy (partition by month, drop old partitions of anonymous-session records after N days), and consider only persisting results when the client will fetch them again (history, reports, declaration).

### 18. Schema comment claims TimescaleDB; nothing uses it

`schema.ts` documents "PostgreSQL 16 + TimescaleDB 2.16" (`packages/data-platform/src/schema.ts:2`) but there are no hypertables, and the aggregation job reads raw observations with standard SQL. The claim misleads operators sizing the database.

Recommendation: either convert `price_observations` to a hypertable (a good fit for the append-only time series and the watermark scan) and add the extension to the migrations and compose file, or delete the mention.

### 19. Deployment hygiene

- `docker-compose.yml:2` carries the obsolete `version:` key.
- The k8s deployment pins `image: ...:latest` with `IfNotPresent` (`infra/k8s/base/deployment.yaml:36-37`), so rollouts are not reproducible. Use immutable SHA tags from the deploy pipeline (it already builds them).
- Replicas are fixed at 1 with no HPA or PDB. The in-memory state in findings 5 and 9 blocks scaling anyway; fix those first, then add both.
- `resources` limits (256m CPU / 512Mi) look low for the basket optimizer's combinatorics; load-test under those limits before production.

### 20. Basket optimizer combinatorics

The optimizer enumerates subset masks per merchant (`packages/core-domain/src/optimizer/services/basket-optimizer.service.ts:188`). Input caps (10 items, 8 merchants per item) bound it today, but the caps are enforced in one place only. Add a test that pins the caps, and a guard on total combinations (for example 2^10 per merchant is fine, but 10 merchants each covering all 10 items reaches 10 × 1024 shipping prefetches) with a clean 422 when exceeded.

## Low: polish

- `otherCharges` is hardcoded to zero with a Phase 1 comment (`landed-cost-calculator.service.ts:176`). Either wire it or remove the field from the API shape to avoid dead contract.
- Frontend search has an in-flight ref but no debounce (`apps/frontend/src/app/calculator/page.tsx:66-92`); rapid submits still queue. Add a 300 ms debounce.
- `apps/frontend/tsconfig.tsbuildinfo` and `.next/` dev caches sit in the working tree; extend the frontend `.gitignore` with `*.tsbuildinfo`.
- No LICENSE file in the repository root.
- `dev-up.sh` runs the seed via `tsx` borrowed from the frontend package's devDependencies with a cross-package tsconfig flag (`scripts/dev-up.sh:66-70`). Move `tsx` to the data-platform package (or root) so the seeding path does not depend on an unrelated app's toolchain.
- `dev-up.sh` sets `LAUNCH_GATES_OVERRIDE=true` silently. Print a loud warning so the flag never migrates into a real environment by copy-paste.
- Error envelopes differ between the legacy and current controllers; unify on the documented `ApiErrorResponse` shape.
- `pg` returns `numeric` columns as strings. Parsing exists in the tax services (`parseDecimal`) but each consumer re-implements it; centralize decimal coercion at the repository boundary.

## Replace

- The in-memory rate limiter, audit repository, and click analytics with the Redis/PostgreSQL implementations described above. The interfaces to swap behind already exist.
- Static merchant configuration (`packages/data-acquisition/src/config/merchants.config.ts`) with a database-backed merchant registry so onboarding a merchant does not require a deploy, aligned with the governance records that already live in the database.
- The `:latest` image reference in k8s with immutable digests.
- Dependency generations, on a deliberate schedule rather than opportunistically: Next.js 14 to 15 (App Router improvements, React 19 support), React 18 to 19, Vitest 2 to 3. NestJS 11 and Node 22 are current. Each is a mechanical upgrade here because the frontend is small and has no exotic Next features, but run the e2e and load suites after.

## Add

1. Real authentication (email or OIDC) behind the existing anonymous-session model, with the verified email column on `accounts` finally used. Until then, treat account data as disposable.
2. Foreign-exchange rate ingestion as a first-class versioned dataset, alongside tax rules, with the same manual-confirmation publication flow.
3. At least one more merchant feed (Alko for the domestic reference price, or a German shipper) to make the comparison meaningful; the adapter interface and governance gate are ready for it.
4. An operator console for the three human workflows that currently have no UI: granting source-governance permission, confirming detected tax-rate versions, and working the correction queue.
5. Structured request logging with request IDs (pino), and OpenTelemetry traces exporting to the Grafana Cloud stack, replacing the in-memory KPI sampler for anything production.
6. Browser-level e2e tests (Playwright) covering the age gate, calculator flow, compare sorting, and account export. The current e2e suite is HTTP-level only; the frontend has component tests but no user-journey tests.
7. SEO surface: sitemap, robots, per-product pages with metadata. The product data is a natural long-tail catalog.
8. A frontend feature-flag bootstrap that does not flash: flags are fetched client-side after hydration, so gated UI can appear late. Inline the flag states in the initial HTML payload.
9. Alerting rules on the freshness invariants the data-quality service already computes (stale price share, transport age), so degradation is paged rather than discovered.

## Suggested order of work

1. Findings 1 to 4 (currency, session integrity, legacy endpoints, ops route): correctness and abuse vectors, small diffs, all launch blockers.
2. Findings 5, 8, 15 (Redis rate limiting, real search, real health checks): user-visible and operationally load-bearing.
3. Findings 6, 7, 10 (transport ingestion, classification hardening, per-merchant jobs): makes live data trustworthy instead of seeded.
4. Findings 11 to 13 (age gate polish, Finnish UI, navigation): pre-launch UX.
5. The Add list, starting with the operator console and FX ingestion, since both unblock other items.

## Completion notes

Remediation change: `openspec/changes/technical-assessment-remediation` (branch `feature/technical-assessment-remediation`, 56 tasks). Task references below are group/task IDs in that change's `tasks.md`. Verification gate (task 13.1) is green: typecheck, lint, unit (2337 tests), golden (35), compliance (31), data-quality (205), integration (104), e2e (17), browser e2e (8 journeys), load (9), and production build all exit 0.

### Findings

| # | Finding | Resolution | Tasks |
| --- | --- | --- | --- |
| 1 | Foreign-currency prices summed as euros | `fx_rate_datasets`/`fx_rates` tables (dated, versioned, provenance, effective window); `FxModule` domain service with manual-confirmation publication (`PENDING_CONFIRMATION` → `PUBLISHED` only via operator confirmation, never auto-published); ECB reference rates as default source; SEK converted to EUR cents at Systembolaget ingestion with provenance on `retail_offers` (`original_price_cents`, `original_currency`, `fx_dataset_version`); calculator excludes unconvertible offers with a visible reason; idempotency cache keys include the FX dataset version | 1.1–1.6 |
| 2 | Any client can impersonate any session | Server-issued opaque session tokens in a `sessions` table, SHA-256 hashed at rest, delivered as the httpOnly cookie `rajahinta_session`; `SessionAuthGuard` derives the account from the token and rejects the `x-user-id` header outright; rotation via `POST /api/v1/account/session/rotate`; email-verification groundwork (`accounts.email` placeholder derivation, `POST /api/v1/account/verify-email`) | 2.1–2.5 |
| 3 | Legacy calculation endpoints return wrong numbers | `/api/v1/calculations/excise` and `/calculations/landed-cost` implemented directly against `AlcoholExciseService` and `ContainerDutyService`, honoring the request body; `TaxCalculationEngineAdapter` deleted | 3.1 |
| 4 | Ops dashboard unauthenticated | `OpsAccessGuard`: env-configured operator bearer token plus IP allowlist, fails closed when unconfigured | 3.2 |
| 5 | In-memory rate limiting trusts X-Forwarded-For | Redis sliding-window limiter (Lua script) behind the existing `IRateLimiter` interface; forwarded headers trusted only when `RATE_LIMIT_TRUST_PROXY=true` | 4.1 |
| 6 | Transport-rate ingestion is a no-op | Posti carrier source through the governance-gated pipeline (fixture-pinned tests); alert hook when the newest transport offer exceeds the 7-day threshold | 7.4 |
| 7 | Classification gate accepts the literal string "unknown" | Gate validates against the known classification enum; SE-to-canonical category normalization at ingestion | 7.1 |
| 8 | Search ignores the query string | `pg_trgm` similarity over name, brand, and manufacturer; deterministic ranked order; existing pagination and sort orders preserved | 5.1, 5.3 |
| 9 | In-memory state that should be durable | Audit events persisted to the append-only `audit_events` table; click analytics moved to Redis counters with periodic PostgreSQL snapshots (`click_counter_snapshots`); in-memory implementations kept for tests only | 4.2, 4.3 |
| 10 | Hourly ingestion enqueues one catch-all job | Database-backed merchant registry (`merchant_registry` table, repository, seed); scheduler enqueues one job per permitted merchant with per-merchant dedupe keys (`price-ingestion-<merchantId>-<hour>`); catch-all `*` removed | 7.2, 7.3 |
| 11 | Age gate is a soft gate in both directions | Neutral in-house declined page; SSR placeholder with gating after mount; Phase 1 confirmation documented as self-attestation | 9.1 |
| 12 | UI language does not match the audience | next-intl 4.14, Finnish default with English secondary, copy moved to message catalogs, content-policy lint covers both locales, `lang` follows the active locale | 9.2 |
| 13 | No shared navigation | Layout-level header (calculator, compare, basket, account, ranking) and footer (disclaimer, methodology); per-page back-links removed | 9.3 |
| 14 | Entitlement tiers via environment variables | Tier resolved from `accounts.tier`; environment variables demoted to a non-production test override | 10.1 |
| 15 | Health endpoint checks nothing | `GET /api/v1/health/ready` verifies `SELECT 1` plus a Redis ping with short timeouts and dependency status in the body; liveness stays process-only | 6.1 |
| 16 | Swagger and version detail exposed in production | Swagger gated to non-production or an env flag; version string stripped from the health body | 3.3 |
| 17 | Unbounded growth of calculation records | `calculation_records` and `basket_calculation_records` partitioned monthly; retention worker prunes anonymous-session partitions after the configured window (30 days pending operator input) | 8.1 |
| 18 | Schema comment claims TimescaleDB; nothing uses it | `price_observations` converted to a TimescaleDB hypertable with 7-day chunks; extension added to migrations and compose (`timescale/timescaledb:2.16.1-pg16`); aggregation and watermark semantics unchanged | 8.2, 8.3 |
| 19 | Deployment hygiene | Obsolete `version:` key removed; k8s image tags set to the commit SHA by the deploy pipeline; HPA and PDB added; optimizer load-tested under the 256m/512Mi limits (`tests/load/basket-load-results.md`) | 11.1–11.3 |
| 20 | Basket optimizer combinatorics | Input caps pinned by test; total-combinations guard returns a clean 422 when exceeded | 10.2 |

### Low: polish

- `otherCharges`: removed from the API shape (breaking change, decision D3). Task 10.3.
- Search debounce: 300 ms debounce on the frontend search input. Task 5.2.
- `*.tsbuildinfo` ignored; LICENSE file added. Task 11.5.
- `dev-up.sh`: `tsx` moved to the data-platform toolchain; loud warning printed when `LAUNCH_GATES_OVERRIDE=true`. Task 11.4.
- Error envelopes unified on the documented `ApiErrorResponse` across legacy and current controllers. Task 3.4.
- Decimal coercion centralized at the repository boundary for pg `numeric` columns. Task 3.5.

### Replace

- In-memory rate limiter, audit repository, and click analytics: replaced (tasks 4.1–4.3, see finding 9).
- Static merchant configuration: `merchants.config.ts` deleted, replaced by the database-backed registry (task 7.2).
- `:latest` image reference: replaced with immutable SHA tags set by the deploy pipeline (task 11.1).
- Dependency generations: Next.js 15.5, React 19.2, next-intl 4.14, Vitest 3.2 (task 12.3). Browser e2e and load suites run after the upgrade (tasks 12.2, 13.1).

### Add

1. Real authentication: groundwork done with durable server-issued sessions and email-verification scaffolding (tasks 2.1–2.4). A real email/OIDC provider is still not wired; account data is documented as disposable until verification completes.
2. FX rate ingestion as a first-class versioned dataset: done, including the manual-confirmation publication flow (tasks 1.1–1.3).
3. Alko merchant feed: adapter implemented with a golden fixture, through the governance gate (task 7.5).
4. Operator console: implemented at `/ops` behind the `OPERATOR_CONSOLE` flag (default off), covering governance grants, dataset confirmations including FX publish with cache invalidation, and the correction queue, with every action audited (task 12.1).
5. Structured logging and tracing: pino request logging with request IDs; OpenTelemetry traces exported to Grafana Cloud via env configuration (tasks 6.2, 6.3).
6. Browser-level e2e tests: Playwright suite in `tests/e2e-browser/` with 8 journeys (age gate, calculator flow, compare sorting, account export including session issue), CI workflow boots the real stack (task 12.2).
7. SEO surface: sitemap, robots, per-product pages with metadata (task 9.5).
8. Feature-flag bootstrap without flash: flag states inlined in the initial HTML payload (task 9.4).
9. Alerting on freshness invariants: freshness gauges exposed via prom-client on `METRICS_PORT`; PrometheusRule alerts on stale price share and transport age (tasks 6.4, 6.1).

### Open items

- **ECB redistribution terms (legal):** whether ECB reference rates may be redistributed in a commercial service is an open legal question. The pipeline is source-configurable; dataset publication stays behind operator confirmation regardless.
- **Durable governance and rate-review stores:** the operator console reads governance grants, rate-review entries, and the correction queue from Phase 1 in-memory repositories. Every console action is written to the durable append-only `audit_events` table, but the stores themselves are restart-volatile; durable tables are a noted follow-up.
- **Staging cluster deferral:** per `ARCHITECTURE.md` §15.2, no staging cluster exists; the blocking promotion of the artillery load gate and the staging verification walk remain deferred until one is provisioned.
- **Integration suite not in CI:** `tests/integration/` (104 tests) runs locally against `TEST_DATABASE_URL`; CI covers build, lint, unit, golden, data-quality, compliance, e2e, and composition smoke.
- **Anonymous calculation-record retention window:** 30 days configured; final value pending operator input.
- **Email delivery:** verification endpoints exist but no mail transport is wired.
