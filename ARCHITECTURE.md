# ARCHITECTURE.md

## Architecture Overview

Rajahinta.fi is a **cross-border beverage price index and Finnish landed-cost intelligence platform**. It is a calculator, not a shop: there is no checkout, no payment collection for alcohol, and no physical-goods order management — the only commercial transaction is a software subscription.

The architecture is a **modular monolith** organized into clearly bounded packages (core-domain, application-api, data-acquisition, data-platform) with a NestJS 11 composition root and a Next.js 14 frontend. Every module is wired through explicit port/adapter interfaces so any module can later be extracted into a separate service without redesigning domain logic.

## 1. Project Structure

```
rajahinta/
├── AGENTS.md                          # Agent operating contract (repo-wide workflow rules)
├── ARCHITECTURE.md                    # This document
├── DESIGN.md                          # Design system documentation
├── opencode.jsonc                     # OpenCode configuration
├── package.json                       # Root workspace package (pnpm workspace)
├── pnpm-workspace.yaml                # Workspace definition: apps/* + packages/*
├── tsconfig.base.json                 # Shared TS config (ES2022, commonjs, decorators)
├── vitest.config.ts                   # Root vitest config
├── Dockerfile                         # Multi-stage production Dockerfile (NestJS backend)
├── .dockerignore                      # Dev/CI artifact exclusion for Docker
│
├── apps/
│   ├── backend/                       # @rajahinta/backend — NestJS 11 composition root
│   │   ├── nest-cli.json              # NestJS CLI config
│   │   ├── src/
│   │   │   ├── main.ts                # Bootstrap + Swagger + CORS
│   │   │   └── app.module.ts          # Root module wiring all packages
│   │   ├── vitest.config.ts
│   │   └── tsconfig.json
│   │
│   └── frontend/                      # @rajahinta/frontend — Next.js 14 App Router
│       ├── next.config.mjs
│       ├── tailwind.config.ts         # Tailwind CSS 3.4 config
│       ├── src/
│       │   ├── app/                   # App Router routes
│       │   │   ├── layout.tsx         # Root layout with AgeGate wrapper
│       │   │   ├── page.tsx           # Home page
│       │   │   ├── calculator/        # Landed-cost calculator UI
│       │   │   ├── compare/           # Product comparison views
│       │   │   ├── ranking/           # Methodology explanation
│       │   │   ├── account/           # Account & saved baskets
│       │   │   └── age-gate/          # Age verification
│       │   ├── lib/                   # api.ts, types.ts, content-policy.ts
│       │   └── setupTests.ts
│       ├── vitest.config.ts
│       └── tsconfig.json
│
├── packages/
│   ├── core-domain/                   # @rajahinta/core-domain — pure domain logic
│   │   ├── src/
│   │   │   ├── tax/                   # TaxModule — excise + container duty calculation
│   │   │   ├── calculator/            # CalculatorModule — landed-cost orchestrator
│   │   │   ├── classification/        # ClassificationModule — transaction classification
│   │   │   ├── normalization/         # NormalizationModule + ProductMatcher + ManualReview
│   │   │   ├── transport/             # TransportEstimationModule — carrier rate matching
│   │   │   ├── reliability/           # ReliabilityModule — data freshness & confidence
│   │   │   ├── ranking/               # RankingModule — neutral sort orders
│   │   │   ├── declaration/           # DeclarationModule — excise declaration assistant
│   │   │   ├── correction/            # CorrectionModule — human-review flagging
│   │   │   ├── entitlement/           # EntitlementModule — feature tier management
│   │   │   ├── audit/                 # AuditModule — immutable domain audit log
│   │   │   └── governance/            # SourceGovernanceModule — data-source provenance
│   │   ├── vitest.config.ts
│   │   └── tsconfig.json
│   │
│   ├── application-api/               # @rajahinta/application-api — HTTP API layer
│   │   ├── src/
│   │   │   ├── calculator/            # CalculatorController + DTOs
│   │   │   ├── search/                # SearchController + DTOs
│   │   │   ├── declaration/           # DeclarationController + DTOs
│   │   │   ├── accounts/              # AccountModule (account, basket, data-export)
│   │   │   ├── age-gate/              # AgeGateModule
│   │   │   ├── billing/               # BillingModule (simulated subscription)
│   │   │   ├── feature-flags/         # FeatureFlagsModule + LaunchGate
│   │   │   ├── idempotency/           # IdempotencyModule (in-memory cache)
│   │   │   ├── rate-limiting/         # RateLimitingModule (in-memory + guard)
│   │   │   ├── observability/         # ObservabilityModule (KPI, OpsDashboard)
│   │   │   ├── jobs/                  # JobsModule — BullMQ workers & scheduler
│   │   │   └── audit/                 # InMemoryAuditRepository
│   │   ├── vitest.config.ts
│   │   └── tsconfig.json
│   │
│   ├── data-acquisition/              # @rajahinta/data-acquisition — data ingestion
│   │   ├── src/
│   │   │   ├── services/              # PipelineOrchestrator, FeedIngestion, DataQuality, RateReview
│   │   │   ├── config/                # merchants.config.ts
│   │   │   ├── interfaces/            # IDataSourceRegistry, IFeedAdapter, IUpsertRepository
│   │   │   └── index.ts               # DataAcquisitionModule — BullMQ queues
│   │   ├── vitest.config.ts
│   │   └── tsconfig.json
│   │
│   └── data-platform/                 # @rajahinta/data-platform — persistence layer
│       ├── src/
│       │   ├── index.ts               # Drizzle ORM schemas (5 tables) + repository interfaces
│       │   ├── interfaces/            # IRepositoryRegistry
│       │   └── seed/                  # tax-rules.seed.ts
│       ├── vitest.config.ts
│       └── tsconfig.json
│
├── tests/
│   ├── golden/                        # Golden-dataset regression tests
│   │   ├── data/                      # Fixture products/offers
│   │   ├── golden-dataset.test.ts     # 12 pre-calculated scenarios
│   │   └── vitest.config.ts
│   ├── compliance/                    # Neutrality & compliance tests
│   │   ├── neutrality-compliance.test.ts
│   │   └── vitest.config.ts
│   └── load/                          # Calculator load/performance tests
│       ├── calculator-load.test.ts    # 50 concurrent, p95<500ms assertion
│       └── vitest.config.ts
│
├── infra/
│   ├── environments/                  # Environment configs (dev.yaml, staging.yaml, prod.yaml)
│   ├── staging-data/                  # schema.sql, seed.sql, setup.sh
│   └── jobs/                          # docker-compose.jobs.yml (Redis 7.2)
│
├── scripts/
│   ├── test-golden-dataset.sh         # Golden-dataset CI test runner
│   ├── test-data-quality.sh           # Data-quality CI test runner
│   └── test-compliance.sh             # Compliance CI test runner
│
├── .github/workflows/
│   ├── ci.yml                         # 6-stage CI pipeline
│   ├── deploy.yml                     # 3-tier deployment pipeline
│   └── load-tests.yml                 # PR-gating load test
│
├── docs/                              # Business & engineering plans
├── .agents/skills/                    # Agent skill library
├── .opencode/                         # OpenCode configuration
└── openspec/                          # OpenSpec change management
```

## 2. High-Level System Diagram

```mermaid
flowchart LR
    subgraph Users
        Consumer[Consumer web app<br/>Next.js 14 / React 18]
        APIUser[API customers<br/>Phase 2/3]
    end

    subgraph Presentation
        Calculator[Landed-Cost Calculator]
        Comparison[Comparison views]
        Ranking[Ranking methodology]
        Account[Account / subscription]
    end

    subgraph Application Layer
        Controllers[Calc / Search / Declaration controllers]
        CrossCutting[Feature flags, rate limiting,<br/>idempotency, observability]
        Jobs[BullMQ workers]
    end

    subgraph Core Domain
        Tax[Tax & Duty Calculation]
        Classification[Transaction Classification]
        Normalization[Product Normalization]
        Transport[Transport Estimation]
        Landed[Landed-Cost Orchestrator]
        Reliability[Data-Reliability Framework]
        RankingSort[Ranking & Sorting]
    end

    subgraph Data Platform
        DB[(PostgreSQL 16<br/>TimescaleDB)]
    end

    subgraph Acquisition
        Ingest[Price / transport ingestion]
        DataQuality[Data-quality pipeline]
        RateReview[Tax-rate dataset review]
    end

    subgraph Infrastructure
        Cache[(Redis 7.2<br/>BullMQ + rate-limiting)]
    end

    External[External merchants / carriers / tax authority]

    External --> Ingest
    Ingest --> DB
    DataQuality --> DB
    RateReview --> DB
    DB --> Core Domain
    Consumer --> Presentation --> Controllers --> Core Domain
    Controllers --> Cache
    CoreDomain --> DB
    Jobs --> Cache
    APIUser --> Controllers
```

The **Compliance & Governance layer** runs across all layers (neutrality enforcement, reliability labeling, audit logging, structured disclaimer).

## 3. Core Components

### 3.1 Frontend / User Interface

| Component | Responsibility | Key files |
|---|---|---|
| **Home page** | Navigation hub linking to calculator, compare, ranking, account | `apps/frontend/src/app/page.tsx` |
| **Calculator page** | Product search, product selector, quantity selector, result display with itemized breakdown | `apps/frontend/src/app/calculator/` |
| **Comparison page** | Side-by-side product comparison with sort controls | `apps/frontend/src/app/compare/` |
| **Ranking page** | Explanation of ranking methodology (neutrality enforcement) | `apps/frontend/src/app/ranking/page.tsx` |
| **Account page** | Account management, saved baskets | `apps/frontend/src/app/account/` |
| **Age Gate** | Age verification wrapper (renders in root layout) | `apps/frontend/src/app/components/AgeGate.tsx` |
| **DisclaimerBanner** | Structural disclaimer rendered on every calculation result | `apps/frontend/src/app/calculator/components/DisclaimerBanner.tsx` |

**Technology:** Next.js 14.2 (App Router, standalone output), React 18.3, Tailwind CSS 3.4, Vitest + Testing Library.

### 3.2 Backend / Server / API

| Component | Responsibility | Key files |
|---|---|---|
| **Composition root** | Wires all packages, starts HTTP server, Swagger docs | `apps/backend/src/main.ts`, `app.module.ts` |
| **Calculation API** | POST `api/v1/calculations/excise`, `api/v1/calculations/landed-cost` | `packages/application-api/src/calculator/` |
| **Search API** | Product search/discovery | `packages/application-api/src/search/` |
| **Declaration API** | Excise declaration assistant endpoints | `packages/application-api/src/declaration/` |
| **Feature flags** | Launch-gating flag for pre-launch compliance review | `packages/application-api/src/feature-flags/` |
| **Idempotency** | In-memory idempotency cache | `packages/application-api/src/idempotency/` |
| **Rate limiting** | In-memory rate limiter + NestJS guard | `packages/application-api/src/rate-limiting/` |
| **Jobs / workers** | BullMQ queue definitions: price-ingestion, transport-refresh, tax-dataset-review, time-series-aggregation | `packages/application-api/src/jobs/` |
| **Observability** | KPI tracking, ops dashboard, cost attribution | `packages/application-api/src/observability/` |
| **Billing** | Simulated subscription billing | `packages/application-api/src/billing/` |
| **Accounts** | Account management, data export, retention | `packages/application-api/src/accounts/` |
| **Age Gate** | Age verification provider interface | `packages/application-api/src/age-gate/` |

**Technology:** NestJS 11, TypeScript (ES2022), Zod DTOs, Swagger/OpenAPI via `@nestjs/swagger`.

### 3.3 Shared Libraries / Domain Packages

| Package | Responsibility | Key modules |
|---|---|---|
| **core-domain** | Pure domain logic — no I/O, no framework coupling beyond decorators | TaxModule, CalculatorModule, ClassificationModule, NormalizationModule, TransportEstimationModule, ReliabilityModule, RankingModule, DeclarationModule, CorrectionModule, EntitlementModule, AuditModule, SourceGovernanceModule |
| **application-api** | HTTP API layer — controllers, DTOs, cross-cutting concerns | CalculatorController, SearchController, DeclarationController, FeatureFlagsModule, RateLimitingModule, IdempotencyModule, JobsModule, ObservabilityModule, BillingModule |
| **data-acquisition** | External data ingestion pipeline | PipelineOrchestratorService, FeedIngestionService, DataMappingService, DataQualityService, RateReviewSchedulerService |
| **data-platform** | Persistence — Drizzle ORM schemas, repository abstractions, seed data | 5 tables (productMaster, retailOffers, taxRules, transportOffers, calculationRecords), IRepositoryRegistry |

### 3.4 CLI / Scripts / Automation

| Script | Purpose |
|---|---|
| `scripts/test-golden-dataset.sh` | Seeds database from schema.sql + seed.sql, runs golden-dataset regression tests |
| `scripts/test-data-quality.sh` | Loads schema + seed, checks table existence and null violations, runs data-quality vitest suite |
| `scripts/test-compliance.sh` | Seeds database, runs neutrality and compliance vitest suite |

## 4. Data Flow

### Primary user journey: landed-cost calculation

1. **User selects product** via search or category browser → `SearchController`
2. **Calculator page** dispatches POST `/api/v1/calculations/landed-cost` with product ID, quantity, destination, optional transport method
3. **LandedCostCalculatorService** (orchestrator) coordinates:
   - Product normalization → resolve canonical product
   - Tax calculation → resolve effective tax-rate version, compute alcohol excise + container duty
   - Transport estimation → match carrier rates, compute basket shipping
   - Transaction classification → determine Distance Selling / Distance Buying / Traveller Import
   - Reliability check → status of every external input
4. **Result assembled** with itemized breakdown, confidence levels, provenance metadata, structural disclaimer
5. **CalculationRecord persisted** for auditability
6. **Result returned** to frontend and rendered with freshness indicators

### Background job flow

- BullMQ workers consume queues: `price-ingestion`, `transport-refresh`, `tax-dataset-review`, `time-series-aggregation`
- Jobs run off the request/response path, scheduled via `@nestjs/bull`
- Rate review produces pending-change records that require manual approval before effective

## 5. Data Stores

| Store | Type | Purpose | Schema location |
|---|---|---|---|
| **PostgreSQL 16** | Primary database | productMaster, retailOffers, taxRules (versioned), transportOffers, calculationRecords (immutable) | `packages/data-platform/src/index.ts` (Drizzle ORM) |
| **TimescaleDB 2.16** | Time-series extension | Historical product prices, rate versions (via PostgreSQL extension) | `infra/staging-data/schema.sql` |
| **Redis 7.2** | In-memory cache | BullMQ job queues, rate-limiting state, idempotency cache, in-memory audit | `infra/jobs/docker-compose.jobs.yml` |

**Migration approach:** Drizzle Kit (`drizzle-kit`) for schema generation; idempotent SQL scripts (`schema.sql`, `seed.sql`, `setup.sh`) for CI/staging environments. Tax rules are never mutated in place — new versions create new rows with effective date ranges.

## 6. External Integrations / APIs

| Integration | Method | Config location | Notes |
|---|---|---|---|
| External merchants (product/price feeds) | Planned via permitted APIs (not broad scraping) | `packages/data-acquisition/src/config/merchants.config.ts` | Off-by-default: new sources inactive until permission recorded |
| Carriers (transport rates) | Planned via carrier rate APIs | Data-acquisition pipeline | Reliability status attached to every rate |
| Finnish Tax Administration | Official tax-rate datasets (manual review pipeline) | `packages/data-platform/src/seed/tax-rules.seed.ts` | Never auto-published; manual review gate |

No external integrations are actively connected in the current state — all data sources are simulated/planned, with port abstractions ready for real adapters.

## 7. Key Technologies

| Technology | Version | Role | Architectural relevance |
|---|---|---|---|
| NestJS | 11 | Backend framework, composition root | DI container, module system, lifecycle hooks |
| Next.js | 14.2 | Frontend framework | App Router, standalone output, server-side rendering |
| React | 18.3 | UI library | Component model, hooks |
| TypeScript | 5.x | Language | Strict mode, ES2022 target, decorators |
| PostgreSQL | 16 | Primary database | JSONB for rate exemptions/acquisition metadata |
| TimescaleDB | 2.16 | Time-series extension | Historical price/rate tracking for reproducibility |
| Drizzle ORM | 0.38 | Type-safe SQL ORM | Schema-first, migration generation |
| BullMQ | 5 | Job queue | Background ingestion, refresh, review jobs |
| Redis | 7.2 | Cache / queue backend | BullMQ broker, rate-limiting store, idempotency cache |
| Vitest | 2.1 | Test framework | In-source tests, per-package configs, cross-package suites |
| Zod | Recent | Schema validation | DTO validation in API controllers |
| Tailwind CSS | 3.4 | Utility-first CSS | Design system via config tokens |
| pnpm | 9 | Package manager | Workspace monorepo, strict dependency resolution |

## 8. Deployment & Infrastructure

### Build artifacts
- **Backend:** Single Docker image (multi-stage, `node:22-alpine`) containing compiled NestJS app + all package `dist/` directories
- **Frontend:** Next.js standalone build (static/serverless)

### Environments
| Environment | Config | Trigger | Notes |
|---|---|---|---|
| **DEV** | `infra/environments/dev.yaml` | Push to `feature/*` | Build + Docker Compose health check |
| **STAGING** | `infra/environments/staging.yaml` | PR to `master` or manual | Full test + Docker push to `ghcr.io` |
| **PRODUCTION** | `infra/environments/prod.yaml` | Tag `v*` or manual | Compliance checks + DB migration + deploy + smoke test + GitHub Release |

### CI/CD
- **CI pipeline** (`.github/workflows/ci.yml`): 6-stage DAG — lint → build → unit-tests → golden-dataset → data-quality → compliance → aggregate gate
- **Deploy pipeline** (`.github/workflows/deploy.yml`): 3-tier with environment protection; production requires manual approval gate
- **Load tests** (`.github/workflows/load-tests.yml`): PR-gating, p95 < 500ms assertion

### Containerization
- Multi-stage Dockerfile (deps → builder → runner) with production non-root user
- Frontend deployed separately (static site / serverless function — not Dockerized)

## 9. Security Architecture

- **Minimal personal data:** Default to anonymous usage; age-verification is isolated subsystem
- **Data minimization:** Schema enforces no optional fields "for later" unless a shipped feature uses them
- **Versioned tax data:** Never overwritten; historical calculations resolve against effective rate version
- **Neutrality in code:** No code path may allow paid/manual boost of any merchant's position (enforced in compliance tests)
- **Feature gating:** LaunchGate flag controls production release of new merchants, rate versions, and features
- **Disclaimer as structure:** Every calculation result includes structural disclaimer — not decorative
- **Secrets management:** `.env` files are gitignored; credentials stay out of logs and committed files

## 10. Monitoring & Observability

- **In-app observability module:** KPI tracking, ops dashboard endpoints, cost attribution per feature
- **Data freshness:** Every externally sourced fact carries reliability status (VERIFIED / STALE / UNAVAILABLE / ESTIMATED) and timestamp surfaced to the user
- **Audit logging:** Immutable calculation record persisted per calculation
- **CI test observability:** Golden-dataset, data-quality, and compliance suites run in CI as regression guards
- **Load testing:** p95 < 500ms assertion in PR-gating load test

Not evident from the repository: external APM, centralized logging, error tracking service.

## 11. Performance & Scalability

- **Background jobs:** BullMQ workers run price ingestion, transport refresh, and tax review off the request/response path — a slow scrape never blocks a user's calculation
- **Basket-level transport estimation:** Handles non-linear shipping thresholds (per implementation plan)
- **Rate limiting:** In-memory rate limiter prevents API abuse per consumer
- **Idempotency:** In-memory cache prevents duplicate calculation submissions
- **Known bottleneck:** In-memory implementations for rate-limiting, idempotency, and audit are suitable for MVP scale but should be backed by Redis/PostgreSQL for production

## 12. Development Workflow

```bash
pnpm install                  # Install all workspace dependencies
pnpm dev                      # Start all apps in parallel (backend :3000, frontend :3001)
pnpm build                    # Build all packages (generates dist/ for cross-package resolution)
pnpm test                     # Run all unit tests
pnpm test:golden              # Run golden-dataset regression tests (requires PostgreSQL)
pnpm test:data-quality        # Run data-quality checks (requires PostgreSQL)
pnpm test:compliance          # Run compliance/neutrality tests (requires PostgreSQL)
pnpm test:load                # Run calculator load tests
pnpm lint                     # Lint all packages
pnpm typecheck                # Type-check all packages
pnpm clean                    # Clean all dist/ directories
pnpm format                   # Format code with Prettier
```

**Agent tooling:** OpenCode slash commands — `/init`, `/plan-*` (OpenSpec planning), `/make-*` (documentation generation), `/repo-*` (audit, onboard, verify), `/ops-*` (ship, evidence).

## 13. Testing Strategy

| Test suite | Location | What it covers | Dependencies |
|---|---|---|---|
| **Unit tests** | `packages/*/src/__tests__/` | Individual module/service behavior in isolation | None (mocked I/O) |
| **Golden-dataset** | `tests/golden/` | 12 pre-calculated landed-cost scenarios as regression tests | PostgreSQL, fixture data |
| **Data-quality** | `packages/data-acquisition/src/__tests__/` | Table conformance, null violations, freshness pipeline | PostgreSQL |
| **Compliance** | `tests/compliance/` | Ranking neutrality, structural disclaimer presence | PostgreSQL |
| **Load tests** | `tests/load/` | p95 < 500ms at 50 concurrent requests | Full app stack |
| **Content policy** | `apps/frontend/src/__tests__/` | Promotional-language detection in copy | None |

**CI integration:** All test suites run in CI as separate jobs. Golden-dataset, data-quality, and compliance tests share a PostgreSQL 16 service container.

## 14. Architectural Decisions & Rationale

| Decision | Rationale |
|---|---|
| **Modular monolith** (NestJS packages) | Calculation, classification, and data platform are tightly coupled; microservices would add latency and consistency risk without MVP-scale benefit. Package boundaries map directly to future service extraction points. |
| **Port/adapter pattern** | Each module exports abstract port interfaces; the composition root wires concrete implementations. Enables test isolation and future service extraction without domain-logic changes. |
| **Drizzle ORM over Prisma** | Type-safe SQL with schema-first approach; lighter than Prisma for CI; supports TimescaleDB natively. |
| **BullMQ for background jobs** | Redis-backed, NestJS-native integration, supports delayed/retry/cron scheduling. |
| **Versioned, reviewed tax datasets** | Tax calculations carry legal risk; rates are never auto-published, never overwritten — new versions create new rows. |
| **Transaction Classification isolated** | Most important proprietary logic; independently testable, versioned rule sets subject to legislative change. |
| **Neutrality enforced in code + tests** | Ranking must be objective and deterministic; compliance tests serve as regression guards against manipulation. |
| **Data freshness first-class** | Every external fact carries reliability status + timestamp surfaced to the user, not buried in metadata. |
| **Calculator, not a shop** | Per business plan; only transaction is the software subscription. |
| **In-memory cross-cutting concerns** | Rate limiting, idempotency, and audit are in-memory for MVP speed; Redis-backed upgrades are isolated behind the same port interfaces. |

## 15. Constraints, Risks, and Technical Debt

- **In-memory services:** Rate-limiting, idempotency, and audit repositories are in-memory — data loss on restart. Acceptable for MVP, must migrate to Redis/PostgreSQL before production.
- **No authentication/authorization:** Account module exists but no auth provider is wired. Age-gate is a UI wrapper, not a verified identity check.
- **No real external integrations:** All data sources are simulated; port abstractions exist but no feed adapters are connected to real merchant/carrier APIs.
- **ESLint not configured:** Lint step in CI has `continue-on-error: true`; no ESLint config exists anywhere.
- **Legal review tasks incomplete** (5 external tasks marked `agent: none`): Finnish legal opinion, tax counsel validation, compliance review.
- **No centralized error tracking or APM:** Application-level observability exists but no external monitoring service is integrated.
- **Billing is simulated:** Subscription billing module uses in-memory state with no payment provider.

## 16. Future Considerations

Per the implementation plan's delivery phases:

- **Basket Optimizer** (Phase 2) building on basket-level transport estimation
- **API customer offering** (Phase 2/3) — disclaimer must be a structural part of result objects so API consumers inherit it
- **Persistent stores for cross-cutting concerns** — replace in-memory rate-limiting, idempotency, and audit with Redis/PostgreSQL
- **External feed adapter implementation** — connect real merchant APIs, carrier rate feeds, and tax authority datasets
- **Authentication & authorization** — wire real auth provider into AccountModule
- **ESLint configuration** — add project-wide lint rules
- **Potential module extraction** — Data Acquisition, then Data Platform, into separate services without redesigning domain logic

## 17. Project Identification

| Field | Value |
|---|---|
| **Name** | Rajahinta.fi |
| **Language** | TypeScript (ES2022, strict mode) |
| **Type** | Cross-border beverage price index + Finnish landed-cost intelligence platform |
| **Runtime** | Node.js 22 (backend), Next.js 14 (frontend) |
| **Date of review** | 2026-08-16 |
| **Maintainer** | Not evident from the repository |

## 18. Glossary / Acronyms

| Term | Meaning |
|---|---|
| **Landed cost** | Total cost of a foreign-purchased item delivered to Finland, incl. retail price, transport, excise, container duty |
| **Excise** | Alcohol duty levied by the Finnish Tax Administration based on category, ABV, and volume |
| **Container duty** | Beverage-container duty (general rate €0.51/litre), with deposit-return exemptions |
| **Distance Selling** | Transaction classified where the merchant arranges delivery to Finland |
| **Distance Buying** | Transaction classified where the buyer arranges transport independently |
| **Traveller Import** | Personal import excluded from landed-cost calculation |
| **BullMQ** | Redis-backed job queue for background processing |
| **Drizzle ORM** | Type-safe SQL ORM used for database access and schema definition |
| **MyTax** | Finnish Tax Administration's online tax service |
| **ABV** | Alcohol by volume |
| **VERIFIED / STALE / UNAVAILABLE / ESTIMATED** | Four-tier data reliability status attached to every external fact |
| **LaunchGate** | Feature flag that gates production availability of merchants, rate versions, and features pending compliance sign-off |

<!-- Last updated: 2026-08-16 -->