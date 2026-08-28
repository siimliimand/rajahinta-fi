## Why

`docs/TECHNICAL-ASSESSMENT.md` (2026-08-28) reviewed the full monorepo after the Phase 2 advanced-features merge and found four launch blockers, six high-severity defects, ten structural weaknesses, and a list of polish, replacement, and addition items. This change remediates every item in that document. Nothing is deferred except where the document itself marks work as dependent on earlier items (scaling after durable state, tier transitions after real billing).

The blockers in detail:

- Foreign-currency offers are summed as euros. The Systembolaget adapter records SEK prices and the calculator adds them to EUR transport and taxes with no conversion anywhere. Seed data hides it; a real feed produces mixed-currency totals.
- Any client can impersonate any account session by sending `x-user-id`. The session cookie value is a client-generated UUID and the only secret.
- The documented `/api/v1/calculations/*` endpoints ignore the request body and calculate product ID 0. Integrators get garbage or an error while Swagger advertises them as working.
- `GET /ops/health` publishes stale-data findings, verification coverage, and compliance incidents with no authentication.

## What Changes

Remediation groups follow the document's suggested order of work. Decisions taken where the document left a choice:

- **D1**: legacy calculation endpoints are implemented against the real services, not removed.
- **D2**: FX rates come from a configurable source, ECB reference rates as the default.
- **D3**: `otherCharges` is removed from the API shape as a dead contract.
- **D4**: `price_observations` is converted to a TimescaleDB hypertable.
- **D5**: real authentication lands as email-verification groundwork behind the anonymous model; full OIDC is later work.
- **D6**: Posti is the first carrier source; Matkahuolto or an aggregator can follow on the same pipeline.
- **D7**: Alko is the second merchant feed for the domestic reference price.

### Currency integrity (finding 1, add 2)

FX rates become a first-class versioned dataset with the same governance as tax rules: dated rates with provenance, version lifecycle, and a manual-confirmation publication flow that never auto-publishes. Ingestion converts foreign-currency offers into EUR cents using the rate effective on the observation date, records the dataset version as provenance, keeps the original amount and currency for display, and rejects offers that cannot be converted. The calculator sums only converted amounts.

### Session integrity (finding 2, add 1)

Sessions are issued server-side as opaque tokens stored hashed, the backend derives the account from the token, and tokens rotate on demand. The frontend moves to a server-set httpOnly cookie. The `x-user-id` header is no longer trusted. Email verification groundwork uses the existing verified-email column, with anonymous accounts treated as disposable until verified.

### API correctness (findings 3, 4, 16; low: error envelopes, decimal coercion)

Legacy calculation endpoints honor the request body against `AlcoholExciseService` and `ContainerDutyService`. The ops dashboard sits behind an auth guard and IP allowlist. Swagger mounts only outside production or behind an env flag, and the version string leaves the health body. Error envelopes unify on the documented `ApiErrorResponse`. Decimal coercion for pg `numeric` columns happens once at the repository boundary.

### Rate limiting and durable state (findings 5, 9)

The rate limiter moves to Redis behind the existing `IRateLimiter` interface with a sliding window, and `X-Forwarded-For` is trusted only behind a configured proxy. Audit events persist to an append-only PostgreSQL table; click counters move to Redis with periodic snapshotting. In-memory implementations remain for tests only.

### Search (finding 8; low: debounce)

The `q` parameter matches products over name, brand, and manufacturer using `pg_trgm` similarity or tsvector, ranked deterministically, with existing pagination and sort orders preserved. The frontend debounces search input at 300 ms.

### Health and observability (finding 15, add 5, add 9)

Readiness verifies `SELECT 1` and a Redis ping with short timeouts and reports dependency status; liveness stays cheap and process-only. Structured request logging (pino) carries request IDs. OpenTelemetry traces export to the Grafana Cloud stack. Alerting rules page on the freshness invariants the data-quality service already computes.

### Trustworthy live data (findings 6, 7, 10; replace: merchant config; add 3)

The classification gate validates against the known enum instead of non-emptiness, and Swedish category strings normalize to canonical categories at ingestion. A database-backed merchant registry replaces static config, the scheduler enqueues one job per permitted merchant with per-merchant dedupe keys, and the catch-all job disappears. A real carrier source (Posti first) replaces the no-op transport adapter, with an alert when the newest transport offer exceeds the 7-day threshold. An Alko adapter adds the domestic reference feed through the same governance gate.

### Data lifecycle (findings 17, 18)

Calculation records partition by month and anonymous-session partitions are pruned after N days by a retention job. TimescaleDB is enabled in migrations and compose, and `price_observations` becomes a hypertable.

### Frontend UX (findings 11, 12, 13; add 7, add 8)

The age gate redirects to a neutral in-house page, renders a placeholder server-side, and gates after mount; Phase 1 confirmation is documented as self-attestation. Finnish becomes the default locale via next-intl with English secondary, and copy moves into message catalogs the content-policy lint can police. A layout-level header covers the five destinations and a footer carries the disclaimer and methodology link. Feature-flag states are inlined in the initial HTML payload so gated UI does not appear late. SEO surface: sitemap, robots, per-product pages with metadata.

### Entitlements and optimizer (findings 14, 20; low: otherCharges)

Tier resolves from the `accounts.tier` column; env vars remain only as a global test override. The basket optimizer gets a test pinning its input caps and a guard returning a clean 422 when total combinations are exceeded. `otherCharges` is removed from the API shape.

### Infra and repo hygiene (finding 19; low items)

Kubernetes deploys reference immutable SHA tags from the pipeline, and HPA plus PDB arrive once state is durable. The basket optimizer is load-tested under current resource limits. Compose loses the obsolete `version:` key. `tsx` moves out of the frontend toolchain for seeding, `LAUNCH_GATES_OVERRIDE=true` prints a loud warning, `*.tsbuildinfo` is ignored, and a LICENSE lands in the repository root.

### Additions (add 4, add 6; replace: dependency generations)

An operator console covers the three human workflows with no UI today: granting source-governance permission, confirming detected tax-rate versions, and working the correction queue. Playwright browser e2e tests cover the age gate, calculator flow, compare sorting, and account export. Next.js 14 to 15, React 18 to 19, and Vitest 2 to 3 upgrade on a deliberate schedule, with e2e and load suites run after.

## Capabilities

### New capabilities

- `fx-rate-dataset`: versioned foreign-exchange rates with provenance, manual-confirmation publication, conversion at ingestion, rejection of unconvertible offers.
- `session-authentication`: server-issued opaque tokens, backend-derived identity, rotation, email-verification groundwork.
- `product-search`: query matching over name, brand, and manufacturer with deterministic ranking and preserved pagination.
- `operator-console`: authenticated UI for governance permission grants, tax-rate confirmations, and the correction queue.
- `deployment-observability`: dependency-aware health checks, request-ID logging, OTel export, freshness alerting, immutable deploy tags.

### Modified capabilities

- `data-acquisition`: conversion at ingestion, enum-validated classification gate, SE category normalization, merchant registry, real carrier source, Alko feed.
- `product-normalization`: classification gate validates against the known enum; Swedish categories map to canonical categories.
- `landed-cost-calculator`: sums converted EUR only, excludes unconvertible offers with a visible reason, surfaces original currency, drops `otherCharges`.
- `application-api`: legacy endpoints honor request bodies, ops route authenticated, Redis rate limiting with proxy-aware keys, durable audit and analytics, unified error envelopes, centralized decimal coercion, calculation-record retention.
- `accounts-age-gate`: neutral redirect target, SSR placeholder with post-mount gating, documented self-attestation scope.
- `web-application`: shared navigation, Finnish default locale, debounced search, inlined flag bootstrap, SEO surface.
- `background-jobs`: per-merchant scheduling with dedupe keys, retention pruning, transport freshness alerting.
- `subscription-billing`: tier resolves from the account record; env override is test-only.
- `product-data-model`: `price_observations` becomes a TimescaleDB hypertable.
- `basket-optimization`: caps pinned by test, total-combinations guard with 422.
- `mvp-testing`: currency, session, search, ingestion, lifecycle, and browser-journey coverage.

## Impact

- **Code**: `packages/core-domain` (fx, calculator, normalization, entitlement, optimizer), `packages/data-platform` (schema, migrations, repositories), `packages/data-acquisition` (adapters, registry), `packages/application-api` (accounts, search, rate-limiting, audit, observability, jobs, calculations, ops console API), `apps/frontend` (session, nav, i18n, age gate, SEO, flags), `apps/backend` (logging, OTel), `infra/` (k8s, alerting), `tests/` (integration, load, browser e2e).
- **APIs**: breaking: `x-user-id` header no longer accepted (session token replaces it); `otherCharges` field removed from calculation results. Behaviour fixes: `/api/v1/calculations/*` honor the request body, `q` actually filters, health reports dependencies. New: session issuance/rotation, operator-console endpoints.
- **Dependencies**: new runtime dependencies: pino, OpenTelemetry SDK, next-intl, Playwright (dev), pg_trgm/TimescaleDB extensions (database). Major upgrades: Next.js 15, React 19, Vitest 3.
- **Data**: new tables: `fx_rate_datasets`, `fx_rates`, `sessions`, `audit_events`, merchant registry. `price_observations` converts to a hypertable; `calculation_records` and `basket_calculation_records` become monthly partitions. Existing client-UUID sessions are disposable by design.
- **Infrastructure**: Redis becomes load-bearing (rate limiting, analytics, idempotency already there). TimescaleDB image/extension in compose and migrations. k8s gains HPA and PDB.
- **Documentation**: `docs/TECHNICAL-ASSESSMENT.md` findings gain completion notes; `ARCHITECTURE.md` updated for sessions, FX dataset, merchant registry, hypertable.

## Task mapping

| Assessment finding | Change tasks |
|---|---|
| 1 currency, Add-2 FX dataset | 1.1 to 1.6 |
| 2 sessions, Add-1 auth | 2.1 to 2.5 |
| 3 legacy endpoints, 4 ops route, 16 swagger, low envelopes/decimals | 3.1 to 3.6 |
| 5 rate limiting, 9 durable state | 4.1 to 4.4 |
| 8 search, low debounce | 5.1 to 5.3 |
| 15 health, Add-5 logging/OTel, Add-9 alerting | 6.1 to 6.4 |
| 6 transport, 7 gate, 10 jobs, replace merchant config, Add-3 Alko | 7.1 to 7.6 |
| 17 retention, 18 TimescaleDB | 8.1 to 8.3 |
| 11 age gate, 12 i18n, 13 nav, Add-7 SEO, Add-8 flags | 9.1 to 9.6 |
| 14 tiers, 20 optimizer, low otherCharges | 10.1 to 10.3 |
| 19 deploy hygiene, low dev-up/gitignore/LICENSE | 11.1 to 11.5 |
| Add-4 console, Add-6 Playwright, replace dep generations | 12.1 to 12.3 |
| Cross-cutting verification | 13.1, 13.2 |
