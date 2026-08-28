# Technical Assessment Remediation — Tasks

> Derived from `docs/TECHNICAL-ASSESSMENT.md` (2026-08-28), full coverage: findings 1 to 20, all low-polish items, all replace items, all add items.
> Decisions D1 to D7 recorded in `design.md`. Groups follow the document's suggested order of work.
> Agents: `platform-engineer` (TypeScript, NestJS, Drizzle, React), `devops-engineer` (k8s, CI, observability). No missing specializations.

---

## 1. Currency integrity (finding 1, add 2)

- [x] 1.1 Add `fx_rate_datasets` and `fx_rates` tables to `packages/data-platform/src/schema.ts` — dated, versioned, provenance, effective window, currency pair; repository + Drizzle migration <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/schema.ts, packages/data-platform/drizzle/**, packages/data-platform/src/repositories/**] -->
- [x] 1.2 Create FX dataset domain service at `packages/core-domain/src/fx/` — version lifecycle, manual-confirmation publication flow (never auto-publish), rate resolution by effective date <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [packages/core-domain/src/fx/**] -->
- [x] 1.3 Add FX ingestion job + review workflow — recurring check creates a confirmation task per the governance pattern; configurable source, ECB reference rates default (D2) <!-- agent: platform-engineer.build, depends_on: [1.2], touches: [packages/application-api/src/jobs/**, packages/data-acquisition/src/**] -->
- [x] 1.4 Convert at ingestion in the Systembolaget adapter — SEK to EUR cents via the rate effective on the observation date, dataset version recorded as provenance, original amount/currency kept for display, unconvertible offers rejected with reason <!-- agent: platform-engineer.build, depends_on: [1.2], touches: [packages/data-acquisition/src/adapters/systembolaget.adapter.ts] -->
- [x] 1.5 Calculator sums only converted EUR cents — unconvertible offers excluded with a visible reason on the result; original currency surfaced for display <!-- agent: platform-engineer.build, depends_on: [1.4], touches: [packages/core-domain/src/calculator/**] -->
- [x] 1.6 FX tests — provenance traceability, unconvertible rejection, mixed-currency golden case, cache invalidation on FX dataset version change <!-- agent: platform-engineer.build, depends_on: [1.4, 1.5], touches: [packages/core-domain/src/fx/__tests__/**, packages/data-acquisition/src/adapters/__tests__/**] -->

## 2. Session integrity (finding 2, add 1)

- [x] 2.1 Server-issued opaque session tokens — `sessions` table with tokens hashed at rest, repository, rotation support; backend derives account from token <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/schema.ts, packages/data-platform/src/repositories/**, packages/application-api/src/accounts/**] -->
- [x] 2.2 Migrate authentication off `x-user-id` — auth guard resolves the session token (httpOnly cookie), account controller + GDPR paths moved over, legacy header rejected outright <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [packages/application-api/src/accounts/**, packages/application-api/src/index.ts] -->
- [x] 2.3 Frontend session handling — server-set httpOnly cookie, drop the client-generated UUID cookie from `apps/frontend/src/lib/api.ts` <!-- agent: platform-engineer.build, depends_on: [2.2], touches: [apps/frontend/src/lib/api.ts, apps/frontend/src/app/account/**] -->
- [x] 2.4 Email verification groundwork (D5) — use the existing verified-email column, anonymous-upgrade path, account data documented disposable until verified <!-- agent: platform-engineer.build, depends_on: [2.2], touches: [packages/application-api/src/accounts/**] -->
- [x] 2.5 Session tests — token forge/guess denied, cross-account access denied, rotation invalidates the old token atomically <!-- agent: platform-engineer.build, depends_on: [2.2, 2.3], touches: [packages/application-api/src/accounts/__tests__/**] -->

## 3. API correctness (findings 3, 4, 16; low: error envelopes, decimal coercion)

- [x] 3.1 Implement `POST /api/v1/calculations/excise` and `/calculations/landed-cost` against `AlcoholExciseService` and `ContainerDutyService` honoring the request body (D1); delete the broken adapter path <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/adapters/tax-calculation-engine.adapter.ts, packages/application-api/src/calculations/**] -->
- [x] 3.2 Put the ops dashboard behind an auth guard plus IP allowlist configuration <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/observability/ops-dashboard.controller.ts] -->
- [x] 3.3 Gate Swagger to non-production or an env flag; strip the version string from the health body <!-- agent: platform-engineer.fast, depends_on: [], touches: [apps/backend/src/main.ts, packages/application-api/src/index.ts] -->
- [x] 3.4 Unify error envelopes on the documented `ApiErrorResponse` across legacy and current controllers <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/**] -->
- [x] 3.5 Centralize decimal coercion for pg `numeric` at the repository boundary; remove per-consumer `parseDecimal` duplication <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/**] -->
- [x] 3.6 API correctness tests — legacy endpoints honor the body, ops route denies outside the allowlist, envelope conformance suite <!-- agent: platform-engineer.build, depends_on: [3.1, 3.2, 3.4], touches: [packages/application-api/src/**/__tests__/**] -->

## 4. Rate limiting + durable state (findings 5, 9)

- [x] 4.1 Implement the Redis `IRateLimiter` backend (sliding window via sorted sets) using the existing `RedisModule` client; make `extractKey` trust `X-Forwarded-For` only behind a configured proxy <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/rate-limiting/**] -->
- [x] 4.2 Persist audit events to an append-only PostgreSQL table + repository; in-memory audit repository kept for tests only <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/schema.ts, packages/application-api/src/audit/**] -->
- [x] 4.3 Move click analytics to Redis counters with periodic snapshotting; in-memory version kept for tests only <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/audit/**] -->
- [x] 4.4 Durability tests — limits shared across two app instances, audit and analytics survive restart <!-- agent: platform-engineer.build, depends_on: [4.1, 4.2, 4.3], touches: [tests/integration/**] -->

## 5. Search (finding 8; low: debounce)

- [x] 5.1 Implement the `q` parameter — `pg_trgm` similarity or tsvector over name, brand, manufacturer; deterministic ranking; existing pagination and sort orders preserved <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/search/**, packages/data-platform/drizzle/**] -->
- [x] 5.2 Add a 300 ms debounce to the frontend search input <!-- agent: platform-engineer.fast, depends_on: [], touches: [apps/frontend/src/app/calculator/page.tsx] -->
- [x] 5.3 Search tests — "karhu" matches, deterministic order, pagination interplay, blank query passthrough <!-- agent: platform-engineer.build, depends_on: [5.1], touches: [packages/application-api/src/search/__tests__/**] -->

## 6. Health + observability (finding 15, add 5, add 9)

- [x] 6.1 Readiness checks `SELECT 1` + Redis ping with short timeouts and dependency status in the body; liveness stays cheap process-only; re-point probes <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/index.ts, packages/application-api/src/observability/**] -->
- [x] 6.2 Structured request logging with pino — request IDs, redaction; retire the in-memory KPI sampler on production paths <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/backend/src/main.ts, packages/application-api/src/observability/**] -->
- [x] 6.3 OpenTelemetry traces exported to the Grafana Cloud stack via env-configured exporter <!-- agent: devops-engineer.build, depends_on: [6.2], touches: [apps/backend/src/**, infra/**] -->
- [x] 6.4 Alerting rules on the freshness invariants the data-quality service computes (stale price share, transport age) <!-- agent: devops-engineer.build, depends_on: [], touches: [infra/**] -->

## 7. Trustworthy live data (findings 6, 7, 10; replace merchant config; add 3)

- [x] 7.1 Classification gate validates against the known classification enum (literal "unknown" rejected); add SE-to-canonical category normalization at ingestion <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/core-domain/src/normalization/**, packages/data-acquisition/src/adapters/systembolaget.adapter.ts] -->
- [x] 7.2 Replace static `merchants.config.ts` with a database-backed merchant registry aligned with governance records <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/schema.ts, packages/data-acquisition/src/**] -->
- [x] 7.3 Scheduler enqueues one job per permitted merchant from the registry with per-merchant dedupe keys, backoff, and monitoring; remove the catch-all `*` job <!-- agent: platform-engineer.build, depends_on: [7.2], touches: [packages/application-api/src/jobs/**] -->
- [x] 7.4 Implement a real carrier transport source (Posti first, D6) through the governance-gated pipeline replacing the no-op adapter; alert when the newest transport offer exceeds the 7-day threshold <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-acquisition/src/adapters/pipeline-transport-rate.adapter.ts, packages/application-api/src/jobs/**] -->
- [x] 7.5 Add the Alko adapter (D7) — domestic reference feed through the governance gate with a golden dataset <!-- agent: platform-engineer.build, depends_on: [7.2], touches: [packages/data-acquisition/src/adapters/**] -->
- [x] 7.6 Ingestion tests — gate rejection of placeholder classifications, SE category mapping, per-merchant scheduling, carrier fixtures, Alko golden dataset <!-- agent: platform-engineer.build, depends_on: [7.1, 7.3, 7.4, 7.5], touches: [packages/data-acquisition/src/**/__tests__/**] -->

## 8. Data lifecycle (findings 17, 18)

- [x] 8.1 Calculation-record retention — monthly partitions for `calculation_records` and `basket_calculation_records`, prune anonymous-session partitions after the configured window, retention job <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/**, packages/application-api/src/jobs/**] -->
- [x] 8.2 Enable TimescaleDB (D4) — extension in migrations and compose, convert `price_observations` to a hypertable, aggregation and watermark semantics unchanged <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/schema.ts, packages/data-platform/drizzle/**, docker-compose.yml] -->
- [x] 8.3 Lifecycle tests — partition pruning correctness, hypertable query parity, watermark scan <!-- agent: platform-engineer.build, depends_on: [8.1, 8.2], touches: [tests/integration/**] -->

## 9. Frontend UX + i18n (findings 11, 12, 13; add 7, add 8)

- [x] 9.1 Age gate hardening — neutral in-house redirect page, SSR placeholder with gating after mount (or a server-readable cookie), document Phase 1 as self-attestation <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/frontend/src/app/components/AgeGate.tsx, apps/frontend/src/app/**] -->
- [x] 9.2 Introduce next-intl — Finnish default, English secondary, copy moved into message catalogs, content-policy lint covers both locales, `lang` follows the active locale <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/frontend/src/**] -->
- [x] 9.3 Add the layout-level header (calculator, compare, basket, account, ranking) and footer (disclaimer, methodology); remove per-page back-links <!-- agent: platform-engineer.build, depends_on: [9.2], touches: [apps/frontend/src/app/**] -->
- [x] 9.4 Inline feature-flag states in the initial HTML payload so gated UI does not appear late <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/frontend/src/**] -->
- [x] 9.5 SEO surface — sitemap, robots, per-product pages with metadata <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/frontend/src/app/**] -->
- [x] 9.6 Frontend tests — navigation on all pages, age gate leaks nothing in SSR output, flag no-flash, catalog completeness in both locales <!-- agent: platform-engineer.build, depends_on: [9.1, 9.3, 9.4], touches: [apps/frontend/src/**/__tests__/**] -->

## 10. Entitlements, optimizer, dead contract (findings 14, 20; low: otherCharges)

- [x] 10.1 Resolve tier from the `accounts.tier` column; env vars demoted to a global test override; tier-transition groundwork for billing <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/core-domain/src/entitlement/entitlement.service.ts] -->
- [x] 10.2 Basket optimizer — test pinning the input caps plus a total-combinations guard returning a clean 422 when exceeded <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/core-domain/src/optimizer/services/basket-optimizer.service.ts] -->
- [x] 10.3 Remove the `otherCharges` dead field from the API shape (D3) <!-- agent: platform-engineer.fast, depends_on: [1.5], touches: [packages/core-domain/src/calculator/landed-cost-calculator.service.ts] -->

## 11. Infra + repo hygiene (finding 19; low items)

- [x] 11.1 k8s — immutable SHA image tags from the deploy pipeline; add HPA and PDB once state is durable (after 4.x) <!-- agent: devops-engineer.build, depends_on: [4.1, 4.2, 4.3], touches: [infra/k8s/**, .github/workflows/**] -->
- [x] 11.2 Load-test the basket optimizer under the current 256m/512Mi limits; document or adjust <!-- agent: devops-engineer.build, depends_on: [], touches: [tests/load/**, infra/k8s/**] -->
- [x] 11.3 Remove the obsolete `version:` key from `docker-compose.yml` <!-- agent: devops-engineer.fast, depends_on: [8.2], touches: [docker-compose.yml] -->
- [x] 11.4 `dev-up.sh` — move `tsx` to the data-platform (or root) toolchain; print a loud warning when `LAUNCH_GATES_OVERRIDE=true` <!-- agent: platform-engineer.fast, depends_on: [], touches: [scripts/dev-up.sh, packages/data-platform/package.json] -->
- [x] 11.5 Repo polish — ignore `*.tsbuildinfo`, add a LICENSE file <!-- agent: platform-engineer.fast, depends_on: [], touches: [.gitignore, apps/frontend/.gitignore, LICENSE] -->

## 12. Additions: console, browser e2e, upgrades (add 4, add 6; replace: dependency generations)

- [x] 12.1 Operator console — authenticated UI + API for governance permission grants, tax-rate version confirmation, and the correction queue, every action audited <!-- agent: platform-engineer.build, depends_on: [7.2], touches: [apps/frontend/src/app/ops/**, packages/application-api/src/**] -->
- [x] 12.2 Playwright browser e2e — age gate, calculator flow, compare sorting, account export journeys in CI <!-- agent: platform-engineer.build, depends_on: [9.1, 9.3], touches: [tests/e2e-browser/**] -->
- [x] 12.3 Dependency upgrades — Next.js 14 to 15, React 18 to 19, Vitest 2 to 3; run e2e and load suites after <!-- agent: platform-engineer.build, depends_on: [12.2], touches: [package.json, apps/frontend/package.json, apps/frontend/**] -->

## 13. Verification

- [x] 13.1 Full gate — typecheck, lint, unit, golden-dataset, compliance, integration, e2e, browser e2e, load; fix fallout <!-- agent: platform-engineer.fast, depends_on: [1.6, 2.5, 3.6, 4.4, 5.3, 6.4, 7.6, 8.3, 9.6, 10.2, 11.5, 12.3], touches: [] -->
- [x] 13.2 Update `docs/TECHNICAL-ASSESSMENT.md` with completion notes and `ARCHITECTURE.md` for sessions, FX dataset, merchant registry, and the hypertable <!-- agent: platform-engineer.fast, depends_on: [13.1], touches: [docs/**] -->

---

## Summary

| Group | Tasks | Agent |
|-------|-------|-------|
| 1. Currency integrity | 6 | platform-engineer |
| 2. Session integrity | 5 | platform-engineer |
| 3. API correctness | 6 | platform-engineer |
| 4. Rate limiting + durable state | 4 | platform-engineer |
| 5. Search | 3 | platform-engineer |
| 6. Health + observability | 4 | 3 platform, 1 devops |
| 7. Trustworthy live data | 6 | platform-engineer |
| 8. Data lifecycle | 3 | platform-engineer |
| 9. Frontend UX + i18n | 6 | platform-engineer |
| 10. Entitlements + optimizer | 3 | platform-engineer |
| 11. Infra + repo hygiene | 5 | 2 platform, 3 devops |
| 12. Additions | 3 | platform-engineer |
| 13. Verification | 2 | platform-engineer |
| **Total** | **56** | |

### Indicative wave order

```
Wave 1 (independent roots): 1.1, 2.1, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 5.1, 5.2, 6.1, 6.2, 6.4, 7.1, 7.2, 7.4, 8.1, 8.2, 9.1, 9.2, 9.4, 9.5, 10.1, 10.2, 11.2, 11.4, 11.5
Wave 2+: 1.2, 2.2, 3.6, 5.3, 6.3, 7.3, 7.5, 9.3, 11.1, 11.3, 12.1 ... then dependents in order
Terminal: 13.1, 13.2
```

`ob-plan-apply` recomputes exact waves from the annotations; the sketch is indicative only. Same-file serialization via `touches` (e.g. 1.5/10.3 share `landed-cost-calculator.service.ts`; 4.2/4.3 share the audit area; 9.2/9.3/9.5 share the frontend tree) is enforced regardless of `depends_on`.
