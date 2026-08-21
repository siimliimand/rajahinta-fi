# ARCHITECTURE.md

## Architecture Overview

Rajahinta.fi is a **cross-border beverage price index and Finnish landed-cost intelligence platform**. It is a calculator, not a shop: there is no checkout, no payment collection for alcohol, and no physical-goods order management — the only commercial transaction is a software subscription.

The architecture is a **modular monolith** organized into clearly bounded packages (core-domain, application-api, data-acquisition, data-platform) with a NestJS 11 composition root and a Next.js 14 frontend. Every module is wired through explicit port/adapter interfaces so any module can later be extracted into a separate service without redesigning domain logic. The technology stack is TypeScript/Node.js with PostgreSQL 16 (Drizzle ORM), Redis, and BullMQ.

## 1. Project Structure

```
rajahinta/
├── AGENTS.md                          # Agent operating contract
├── ARCHITECTURE.md                    # This document
├── DESIGN.md                          # Design-system documentation
├── Dockerfile                         # Multi-stage production image
├── docker-compose.yml                 # Local full-stack (PostgreSQL + Redis + backend)
├── eslint.config.mjs                  # ESLint flat config
├── package.json                       # Root workspace (pnpm workspaces)
├── apps/
│   └── backend/                       # NestJS composition root
│       └── src/
│           ├── app.module.ts          # AppModule — wires all packages + domain port adapters
│           ├── main.ts                # Bootstrap
│           └── adapters/              # Composition-root adapters (product-data, calculation-record)
├── packages/
│   ├── core-domain/                   # Domain logic: tax engines, classification, ranking, calculator
│   │   └── src/
│   │       ├── tax/                   # AlcoholExciseService, ContainerDutyService, TaxRuleQueryService
│   │       │   ├── services/          # Pure math functions, deposit-checker
│   │       │   └── ports/             # ITaxRuleRepositoryPort (domain port)
│   │       ├── classification/        # TransactionClassificationService, ClassificationRuleEngine
│   │       ├── normalization/         # ProductNormalizer, ClassificationGate, ManualReview
│   │       ├── transport/             # TransportEstimationService, BasketShippingCalculator
│   │       ├── calculator/            # LandedCostCalculatorService (orchestrator)
│   │       ├── reliability/           # ConfidenceFrameworkService, ReliabilityService
│   │       ├── ranking/               # RankingService (neutrality-enforced sorting)
│   │       ├── declaration/           # ExciseDeclarationService (read-only, never submits)
│   │       ├── correction/            # CorrectionService, CorrectionModule
│   │       ├── entitlement/           # EntitlementService (free/premium gating)
│   │       ├── audit/                 # AuditService, AuditModule
│   │       └── governance/            # SourceGovernanceService (merchant permission gating)
│   ├── data-platform/                 # Drizzle ORM repositories, schema, seed data
│   │   └── src/
│   │       ├── schema.ts              # Canonical Drizzle schema (productMaster, retailOffers, taxRules, transportOffers, calculationRecords)
│   │       ├── abstracts.ts           # Abstract repository classes (ProductRepository, TaxRateRepository, etc.)
│   │       ├── db/
│   │       │   ├── drizzle.provider.ts  # DRIZZLE token, pg.Pool + Drizzle factory (DATABASE_URL)
│   │       │   └── drizzle.module.ts    # @Global DrizzleModule
│   │       ├── repositories/          # Concrete Drizzle implementations
│   │       │   ├── product.repository.ts
│   │       │   ├── tax-rate.repository.ts  # Includes TaxRuleRepositoryAdapter
│   │       │   ├── transport-offer.repository.ts
│   │       │   └── calculation-record.repository.ts
│   │       ├── data-platform.module.ts # DataPlatformModule — registers concrete repos + TAX_RULE_REPOSITORY_PORT
│   │       └── seed/tax-rules.seed.ts # Versioned Finnish excise duty rates (v1.0-2024 … v3.0-2026)
│   ├── data-acquisition/              # Merchant feed ingestion pipeline
│   │   └── src/
│   │       ├── adapters/
│   │       │   ├── systembolaget.adapter.ts  # Systembolaget JSON feed adapter
│   │       │   ├── pipeline-price-ingestion.adapter.ts
│   │       │   ├── pipeline-transport-rate.adapter.ts
│   │       │   └── pipeline-tax-dataset-review.adapter.ts
│   │       ├── services/              # FeedIngestion, DataQuality, RateReviewScheduler, DataMapping
│   │       └── config/merchants.config.ts  # Merchant registry (Alko, Systembolaget)
│   └── application-api/               # API layer: controllers, DTOs, guards, jobs
│       └── src/
│           ├── calculator/            # CalculatorController, CalculatorDto
│           ├── search/                # SearchController
│           ├── declaration/           # DeclarationController (read-only)
│           ├── adapters/              # TaxCalculationEngineAdapter (wires LandedCostCalculatorService)
│           ├── feature-flags/         # FeatureFlagService, LaunchGateService, LaunchGateGuard
│           ├── rate-limiting/         # RateLimitGuard, RateLimitingService
│           ├── idempotency/           # IdempotencyService
│           ├── age-gate/              # AgeGateService, SimpleConfirmationProvider
│           ├── entitlement/           # EntitlementGuard
│           ├── billing/               # BillingService, BillingModule
│           ├── accounts/              # AccountService, DataExportService, AccountRetentionService
│           ├── jobs/                  # BullMQ workers: price-ingestion, transport-rate-refresh, tax-dataset-review, time-series-aggregation
│           ├── audit/                 # AuditRepositoryAdapter (bridges to core-domain)
│           └── observability/         # KpiService, OpsDashboardController, CostAttributionService, InstrumentationService
├── infra/
│   └── jobs/
│       ├── docker-compose.jobs.yml    # Dev hot-reload stack
│       └── Dockerfile.dev             # Dev Dockerfile for job workers
├── tests/
│   └── golden/                        # Golden-dataset regression tests (real engines, no vi.fn mocks)
│       ├── golden-dataset.test.ts
│       ├── per-category.test.ts
│       └── data/products.ts           # Fixed product/offer fixtures
├── docs/
│   ├── Rajahinta-FI.docx              # Business plan (Finnish)
│   ├── rajahinta-fi-implementation-plan.md  # Engineering implementation plan
│   ├── tasks.md                       # Task checkboxes (Phase 0–3)
│   └── tech-stack.md                  # Technology decisions
└── openspec/
    ├── config.yaml
    ├── changes/archive/
    └── specs/
```

## 2. High-Level System Diagram

Application architecture (NestJS modular monolith):

```mermaid
flowchart LR
    subgraph Users
        Consumer[Consumer web app]
        APIUser[API customers (Phase 2/3)]
    end

    subgraph Presentation
        Calculator[Landed-Cost Calculator]
        Comparison[Comparison views]
        Charts[Historical charts]
        Account[Account / subscription]
    end

    subgraph Application Layer
        API[Calculation / search / comparison API]
    end

    subgraph Core Domain
        Normalization[Product Normalization]
        Classification[Transaction Classification]
        Tax[Tax & Duty Calculation]
        Transport[Transport Estimation]
        Landed[Landed-Cost / Excise Assistant]
    end

    subgraph Data Platform
        DB[(Product / merchant / transport / tax DB)]
        TS[(Historical time-series store)]
    end

    subgraph Acquisition
        Scrapers[Price / product ingestion]
        Rates[Tax-rate dataset sync]
        Shipping[Transport-rate refresh]
    end

    External[External merchants / carriers / tax authority]

    External --> Acquisition
    Acquisition --> Data Platform
    Data Platform --> Core Domain
    Consumer --> Presentation --> API --> Core Domain
    APIUser --> API
```

The planned **Compliance & Governance layer** runs across all layers (neutrality enforcement, reliability labeling, audit logging) rather than as a separate service.

## 3. Core Components

### 3.1 Implemented Backend / Server / API

The application is a **NestJS modular monolith** with four bounded layers:

| Package                     | Responsibility                                                                                                                                        | Key modules / files                                                                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core-domain`      | Domain logic — tax engines, classification, ranking, calculator orchestrator, confidence framework, correction, entitlement, audit, source governance | `tax/`, `classification/`, `normalization/`, `transport/`, `calculator/`, `reliability/`, `ranking/`, `declaration/`, `correction/`, `entitlement/`, `audit/`, `governance/` |
| `packages/data-platform`    | Drizzle ORM schema, concrete repositories, connection provider, seed data                                                                             | `schema.ts`, `abstracts.ts`, `repositories/`, `db/drizzle.provider.ts`, `data-platform.module.ts`, `seed/tax-rules.seed.ts`                                                  |
| `packages/data-acquisition` | Merchant feed ingestion pipeline, data-quality checks, rate-review scheduler                                                                          | `adapters/systembolaget.adapter.ts`, `services/`, `config/merchants.config.ts`                                                                                               |
| `packages/application-api`  | API controllers, DTOs, guards (rate limiting, idempotency, age gate, entitlement, launch gate), background job workers, observability                 | `calculator/`, `search/`, `ranking/`, `declaration/`, `feature-flags/`, `rate-limiting/`, `age-gate/`, `jobs/`, `observability/`                                                         |
| `apps/backend`              | Composition root — AppModule wires all packages and provides domain-port adapters                                                                     | `app.module.ts`, `adapters/product-data.adapter.ts`, `adapters/calculation-record.adapter.ts`                                                                                |

**Connection provider**: `DRIZZLE` token in `packages/data-platform/src/db/drizzle.provider.ts` creates a `pg.Pool` from `DATABASE_URL` and returns a fully-typed Drizzle ORM instance. The `DrizzleModule` is `@Global()`, making the connection available application-wide.

**DataPlatformModule** (`packages/data-platform/src/data-platform.module.ts`) registers concrete Drizzle repositories under abstract class tokens and exports them:

- `ProductRepository` → `DrizzleProductRepository`
- `TaxRateRepository` → `DrizzleTaxRateRepository`
- `TransportOfferRepository` → `DrizzleTransportOfferRepository`
- `CalculationRecordRepository` → `DrizzleCalculationRecordRepository`

No `useValue: null` providers for data repos — all have concrete implementations.

**TaxRuleRepositoryAdapter** (in `tax-rate.repository.ts`) bridges the Drizzle repository to the domain-layer `ITaxRuleRepositoryPort`. It is registered in `DataPlatformModule` under the `TAX_RULE_REPOSITORY_PORT` token consumed by `AlcoholExciseService` and `ContainerDutyService`.

**Composition root adapters** (`apps/backend/src/app.module.ts`):

- `ProductDataAdapter` → `PRODUCT_DATA_PORT` (domain port for product/offer lookup)
- `CalculationRecordAdapter` → `CALCULATION_RECORD_PORT` (domain port for calculation persistence)

**TaxCalculationEngine** is now wired via `TaxCalculationEngineAdapter` in `packages/application-api/src/adapters/`, which delegates to `LandedCostCalculatorService`.

**Deposit status is tri-state**: `depositSystemStatus` is `boolean | null` (nullable boolean in the schema). `checkDepositExemption()` returns `VERIFIED` for `true`/`false`, and `ESTIMATED` when `null` (unknown). The container-duty engine uses this to flag uncertain exemptions.

**No plausible fallback rates**: `DEFAULT_RATES` in `alcohol-excise.math.ts` contains zero-rate placeholders per category — when no rule is found in the repository, the result is zero duty with reliability `ESTIMATED` (`taxDatasetVersion: FALLBACK`), never a silently substituted plausible number. `DEFAULT_CONTAINER_DUTY_RATE` in `container-duty.math.ts` remains the official general container-duty rate (€0.51/l).

### 3.2 Frontend / User Interface

| Component            | Responsibility                                                                              | Key files                                                          |
| -------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Home page**        | Navigation hub linking to calculator, compare, ranking, account                             | `apps/frontend/src/app/page.tsx`                                   |
| **Calculator page**  | Product search, product selector, quantity selector, result display with itemized breakdown | `apps/frontend/src/app/calculator/`                                |
| **Comparison page**  | Side-by-side product comparison with sort controls                                          | `apps/frontend/src/app/compare/`                                   |
| **Ranking page**     | Explanation of ranking methodology (neutrality enforcement); structured JSON via `GET /api/v1/ranking/methodology` | `apps/frontend/src/app/ranking/page.tsx`, `packages/application-api/src/ranking/ranking.controller.ts` |
| **Account page**     | Account management, saved baskets                                                           | `apps/frontend/src/app/account/`                                   |
| **Age Gate**         | Age verification wrapper (renders in root layout)                                           | `apps/frontend/src/app/age-gate/`                                  |
| **DisclaimerBanner** | Structural disclaimer rendered on every calculation result                                  | `apps/frontend/src/app/calculator/components/DisclaimerBanner.tsx` |

**Technology:** Next.js 14.2 (App Router, standalone output), React 18.3, Tailwind CSS 3.4, Vitest + Testing Library.

### 3.3 Agent infrastructure

| Component           | Responsibility                                                                    | Key files                 |
| ------------------- | --------------------------------------------------------------------------------- | ------------------------- |
| Agent skill library | Instructions that govern agent behavior (planning, guardrails, codegen, evidence) | `.agents/skills/`         |
| Slash commands      | User-facing entry points for init, planning, shipping, verification               | `.opencode/commands/*.md` |
| OpenCode config     | Model selection, MCP servers (codegraph, agentmemory), plugin wiring, permissions | `opencode.jsonc`          |
| OpenSpec workspace  | Specification-driven change management                                            | `openspec/`               |
| Documentation       | Business + engineering plans + task tracking                                      | `docs/`                   |

## 4. Data Flow

The implemented primary user journey:

1. **Data Acquisition** → Systembolaget adapter fetches product assortment JSON, maps to `RawFeedRecord`, pipeline orchestrator runs data-quality checks, `DataMappingService` normalizes fields, `UpsertPortAdapter` persists via `ProductRepository.upsertByEan()`.
2. **User selects product + quantity + destination** → `CalculatorController` receives request.
3. **Transport Estimation** → `TransportEstimationService` queries `ITransportOfferQuery` for applicable carrier rates by route/weight/package tier; `BasketShippingCalculator` handles multi-item baskets.
4. **Transaction Classification** → `TransactionClassificationService` determines Distance Selling / Distance Buying / Traveller Import with evidence summary.
5. **Tax & Duty Calculation** → `AlcoholExciseService` resolves versioned tax rules via `ITaxRuleRepositoryPort.findApplicable()` (no plausible numeric fallback — a missing rule yields zero duty flagged `ESTIMATED`), computes excise duty. `ContainerDutyService` evaluates deposit-return exemption via `checkDepositExemption()` (tri-state: true/false/null) then applies container duty.
6. **Confidence Framework** → `ConfidenceFrameworkService` computes result confidence as a pure function of underlying data statuses (HIGH/MEDIUM/LOW).
7. **Landed-Cost Calculator** → `LandedCostCalculatorService` orchestrates the above, assembles itemized result with structural disclaimer.
8. **Calculation Record** → Persisted via `ICalculationRecordPort` for auditability.
9. **Excise Declaration Assistant** → `ExciseDeclarationService` packages calculation into structured summary, links to MyTax (never submits).

## 5. Data Stores

| Store          | Purpose                                                                                                             | Implementation                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| PostgreSQL 16  | Primary structured data store — products, retail offers, transport offers, versioned tax rules, calculation records | `docker-compose.yml` (postgres:16-alpine), Drizzle ORM via `DRIZZLE` token |
| Redis 7        | Caching, BullMQ job queues, session store                                                                           | `docker-compose.yml` (redis:7-alpine)                                      |
| Drizzle schema | Canonical table definitions — `productMaster`, `retailOffers`, `taxRules`, `transportOffers`, `calculationRecords`  | `packages/data-platform/src/schema.ts`                                     |

Schema design principles applied:

- Data minimization at schema level — no optional fields "for later"
- Versioned tax rules are append-only (never mutated in place)
- `depositSystemStatus` is tri-state (`boolean | null`) — unknown is explicitly represented
- Reliability status per data point (`VERIFIED`/`ESTIMATED`/`STALE`/`UNAVAILABLE`)
- Structural disclaimer text stored on every `calculationRecords` row (not UI-only)

## 6. External Integrations / APIs

| Integration                            | Status                                 | Implementation                                                                                                                               |
| -------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Systembolaget JSON assortment API      | Adapter implemented                    | `packages/data-acquisition/src/adapters/systembolaget.adapter.ts` — fetches, maps to `RawFeedRecord`, handles pagination and per-item errors |
| Finnish Tax Administration rate tables | Seed data (v1.0-2024 … v3.0-2026) + snapshot-based rate review  | `packages/data-platform/src/seed/tax-rules.seed.ts`, `packages/core-domain/src/tax/services/alcohol-excise.math.ts`, `packages/data-acquisition/src/services/rate-review-scheduler.service.ts` — `ConfigBackedRateChangeSource` reads a configured snapshot file, computes a SHA-256 hash, and compares against the last-reviewed entry to detect rate changes; review entries require manual/legal confirmation before promoting dataset versions |
| Alko (Finnish retailer)                | Registered, adapter pending            | `merchants.config.ts` — empty feedUrl, skipped by pipeline until adapter is built                                                            |

Merchant ingestion is gated by `SourceGovernanceService` — a merchant must have `GRANTED` permission status before the pipeline will fetch or persist its data. New merchants default to `PENDING` (off) until compliance review.

## 7. Key Technologies

| Technology              | Role                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| TypeScript              | Primary language — all packages and apps                                                            |
| Node.js                 | Runtime (NestJS framework)                                                                          |
| NestJS                  | Modular monolith framework — DI, modules, guards, controllers                                       |
| PostgreSQL 16           | Primary data store (via `pg` pool)                                                                  |
| Drizzle ORM             | Type-safe SQL ORM — schema in `packages/data-platform/src/schema.ts`                                |
| Redis 7                 | Caching, BullMQ job queues, session store                                                           |
| BullMQ                  | Background job processing (price ingestion, transport refresh, tax review, time-series aggregation) |
| Vitest                  | Test runner — unit tests, golden-dataset regression tests                                           |
| ESLint                  | Linting (flat config in `eslint.config.mjs`)                                                        |
| Docker / docker-compose | Local development and production deployment                                                         |
| OpenCode                | Agent runtime and developer interface                                                               |
| OpenSpec                | Change/specification management                                                                     |
| CodeGraph               | Code intelligence / indexing MCP server                                                             |
| AgentMemory             | Cross-session memory MCP server                                                                     |

## 8. Deployment & Infrastructure

| Component                   | Status      | Details                                                                                                                                                                                                                                 |
| --------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker Compose (production) | Implemented | `docker-compose.yml` — PostgreSQL 16, Redis 7, NestJS backend (multi-stage build)                                                                                                                                                       |
| Docker Compose (dev jobs)   | Implemented | `infra/jobs/docker-compose.jobs.yml` + `Dockerfile.dev` — hot-reload for background workers                                                                                                                                             |
| Dockerfile                  | Implemented | Monorepo-root multi-stage production image                                                                                                                                                                                              |
| K8s manifests               | Implemented | Kustomize overlays in `infra/k8s/` — base deployment, service, ingress, configmap, secrets, serviceaccount; staging (2 replicas) and production (3 replicas) overlays with health probes, security context, and rolling update strategy |
| Feature flags               | Implemented | `FeatureFlagService`, `LaunchGateService`, `LaunchGateGuard` in `application-api/feature-flags/`                                                                                                                                        |
| Background jobs             | Implemented | BullMQ workers: price-ingestion, transport-rate-refresh, tax-dataset-review, time-series-aggregation                                                                                                                                    |

The promotion path is development → staging → production, with staging carrying its own tax-rule and merchant data copies, and feature flags gating new merchant sources, tax rulesets, and UI ranking behavior.

## 9. Security Architecture

Implemented measures:

- **Rate limiting**: `RateLimitGuard` + `RateLimitingService` on public-facing calculation endpoints.
- **Idempotency**: `IdempotencyService` ensures calculation endpoints are idempotent for identical inputs.
- **Age gate**: `AgeGateService` with `SimpleConfirmationProvider` — lightweight confirmation, not identity verification.
- **Entitlement gating**: `EntitlementGuard` enforces free vs. premium feature access.
- **Launch gate**: `LaunchGateGuard` keeps alcohol features behind a flag until legal/tax review is confirmed.
- **Data minimization**: Schema-level enforcement — no optional fields "for later"; identity document storage deferred.
- **Neutrality enforcement**: `RankingService` structurally rejects any input with billing-related fields; no code path allows paid/manual boost.

Non-negotiable constraints from the implementation plan:

- Minimal personal data: default to anonymous usage; identity/age-verification (only if legally required) is a separate, isolated subsystem.
- Tax data is versioned, never overwritten; historical calculations resolve against the effective rate version.
- No code path may allow paid/manual boost of a merchant's position (neutrality enforced in code).

Agent infrastructure constraints: credentials stay out of logs and committed files; `.env` files are write-only.

## 10. Monitoring & Observability

Implemented in `packages/application-api/src/observability/`:

| Service                  | Purpose                                                                    |
| ------------------------ | -------------------------------------------------------------------------- |
| `KpiService`             | Tracks four KPI categories (product, commercial, data, compliance metrics) |
| `OpsDashboardController` | Exposes operational health signals on an internal endpoint                 |
| `CostAttributionService` | Per-calculation cost attribution tied to commercial metrics                |
| `InstrumentationService` | OpenTelemetry instrumentation setup                                        |

Every externally sourced fact carries a reliability status and timestamp surfaced to the user.

## 11. Performance & Scalability

Implemented:

- **Background jobs separate from request/response path**: BullMQ workers handle price ingestion, transport-rate refresh, tax-dataset review, and time-series aggregation — a slow scrape never blocks a user's calculation.
- **Basket-level transport estimation**: `BasketShippingCalculator` handles non-linear shipping thresholds for multi-item baskets.
- **Idempotent calculation endpoints**: results are reproducible and cacheable for identical inputs given the same dataset versions.

Planned: Redis-backed caching keyed by (product, quantity, destination, transport assumption, tax-dataset version, transport-dataset version).

## 12. Development Workflow

The repository is an agentic workspace with a working application build. Commands:

| Command                     | Purpose                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docker compose up --build` | Full local stack (PostgreSQL + Redis + backend)                                                                                                                          |
| `pnpm test`                 | Run all Vitest test suites                                                                                                                                               |
| `pnpm test:e2e`             | End-to-end API tests (NestJS app booted via `vitest.config.e2e.ts`)                                                                                                      |
| `pnpm lint`                 | ESLint check                                                                                                                                                             |
| Agent tooling               | `/init` (repo initialization), `/plan-*` (OpenSpec planning), `/make-*` (doc/engineer generation), `/repo-*` (audit, onboard, verify), `/ops-*` (ship, evidence, review) |

## 13. Testing Strategy

| Test type                  | Status      | Location                                                                                                                                                                          |
| -------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tax formula unit tests     | Implemented | `packages/core-domain/src/tax/__tests__/alcohol-excise.math.test.ts`, `container-duty.math.test.ts`, `deposit-checker.test.ts`                                                    |
| Tax service tests          | Implemented | `packages/core-domain/src/tax/__tests__/alcohol-excise.service.test.ts`, `container-duty.service.test.ts`, `tax-rule-query.service.test.ts`                                       |
| Confidence framework tests | Implemented | `packages/core-domain/src/reliability/__tests__/confidence-framework.service.test.ts`, `reliability.service.test.ts`                                                              |
| Classification tests       | Implemented | `packages/core-domain/src/classification/__tests__/transaction-classification.service.test.ts`, `classification-rule-engine.service.test.ts`                                      |
| Transport tests            | Implemented | `packages/core-domain/src/transport/__tests__/transport-estimation.service.test.ts`, `transport-classification.service.test.ts`, `basket-shipping-calculator.service.test.ts`     |
| Ranking isolation tests    | Implemented | `packages/core-domain/src/ranking/__tests__/ranking.service.test.ts`, `packages/application-api/src/__tests__/billing-ranking-isolation.test.ts`                                  |
| Golden-dataset regression  | Implemented | `tests/golden/golden-dataset.test.ts`, `tests/golden/per-category.test.ts` — uses plain in-memory implementations, not `vi.fn()` mocks                                            |
| End-to-end API tests       | Implemented | `apps/backend/tests/e2e/calculator.test.ts` via `vitest.config.e2e.ts` — full NestJS app with real engines, official-rate expectations, TravellerImport case |
| Data acquisition tests     | Implemented | `packages/data-acquisition/src/__tests__/feed-ingestion.service.test.ts`, `data-mapping.service.test.ts`, `data-quality.service.test.ts`, `pipeline-orchestrator.service.test.ts` |
| API-layer tests            | Implemented | `packages/application-api/src/__tests__/rate-limiting.service.test.ts`, `age-gate.service.test.ts`, `idempotency.service.test.ts`, `launch-gate.service.test.ts`                  |

**Testing principle**: golden-dataset tests use real engine implementations (plain classes implementing ports), not `vi.fn()` mocks. This ensures the tested behavior matches production behavior exactly.

## 14. Architectural Decisions & Rationale

| Decision                            | Rationale                                                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modular monolith for MVP            | Calculation, classification, and data platform are tightly coupled; microservices would add latency and consistency risk without MVP-scale benefit |
| Calculator, not a shop              | Per business plan; only transaction is the software subscription                                                                                   |
| Versioned, reviewed tax datasets    | Tax calculations carry legal risk; rates are never auto-published, never overwritten                                                               |
| Transaction Classification isolated | Most important proprietary logic; independently testable, versioned rule sets subject to legislative change                                        |
| Neutrality enforced in code         | Ranking must be objective and deterministic; no paid/manual boost path                                                                             |
| Data freshness first-class          | Every external fact carries reliability status + timestamp surfaced to the user                                                                    |
| Compliance layer across all layers  | Neutrality, reliability labeling, and audit at each boundary, not a separate service                                                               |

## 15. Constraints, Risks, and Technical Debt

- **In-memory services:** Rate-limiting, idempotency, and audit repositories are in-memory — data loss on restart. Acceptable for MVP, must migrate to Redis/PostgreSQL before production. **Note:** Account data (profiles, saved baskets, history) was migrated from in-memory to PostgreSQL in Phase 1 completeness fix — the `accounts` and `savedBaskets` tables now provide persistence across restarts.
- **No authentication/authorization:** Account module exists but no auth provider is wired. Age-gate is a UI wrapper, not a verified identity check.
- **Alko adapter not yet implemented** — registered in merchant config but skipped by pipeline.
- **No centralized error tracking or APM:** Application-level observability exists but no external monitoring service is integrated.
- **Billing is simulated:** Subscription billing module uses in-memory state with no payment provider. Real third-party billing integration (Stripe or equivalent) is explicitly deferred to Phase 2 — `BillingService` interface remains stable. See `docs/tasks.md` T1.56.
- **Legal review tasks incomplete** (5 external tasks marked `agent: none`): Finnish legal opinion, tax counsel validation, compliance review.
- **Classification rules subject to legislative change** (e.g., 1 September 2024 joint-liability change) require versioned, dated rule sets.
- **Deposit-return system status per product/packaging is tri-state** (`boolean | null`); null means ESTIMATED — the container-duty engine flags uncertain exemptions, never silently assumes.
- **Small-brewery relief (pienpanimoalennus) UNAVAILABLE:** The official vero.fi scheme is a progressive 10–50 % discount by annual production volume (ceiling 15 000 000 l/year, HE 106/2024). The current rule evaluator cannot express production-volume tiers, so only the general beer rate is shipped. Small-brewery treatment is documented as `UNAVAILABLE` pending Phase 2 evaluator support. See vero.fi pienpanimoalennus guidance; rationale in `docs/phase-0-1-verification-fix-plan.md` §3 C1.
- **GDPR integration tests require `TEST_DATABASE_URL`:** `packages/application-api/src/accounts/__tests__/gdpr-integration.test.ts` runs against a real PostgreSQL instance. There is no always-on Postgres harness in CI; these tests are skipped unless `TEST_DATABASE_URL` is set.
- **HTTP-level load test pending baseline:** resolved in the runtime composition fix — `tests/load/artillery/` provides the HTTP suite (ramp 1→50 over 60 s, steady 50 for 120 s, p95 < 2 s, error < 1 %, zero 429s in the steady window) and `deploy-staging.yml` runs it as a non-blocking post-deploy step. Residual: promote to blocking once a staging baseline exists (`docs/staging-verification.md` §5). Staging deploys are deferred (§15.2), so no baseline can exist until the cluster does.
- **E2E suite relies on decorator-metadata transform + single-instance pin:** `vitest.config.e2e.ts` uses a custom TypeScript transpile plugin to emit `emitDecoratorMetadata` and pins `@nestjs/core` to a single physical path. Root cause: pnpm instantiates `@nestjs/core` twice (two peer-set variants), giving two `Reflector`/class identities and breaking NestJS DI. A durable fix would resolve the dependency-side duplication; the current workaround is functional but fragile.
- **Idempotency controller ordering follow-up:** `CalculatorController` calls `getCacheKey(input)` before `findActiveVersionLabels()`, but `hashInput()` now includes dataset versions in the hash. Since the versions are fetched after the key is computed, the caller must populate `datasetVersions` on the input object before calling `getCacheKey`. Currently the versions are only passed to `lookup()` as `currentVersions`, so the hash key does not reflect dataset versions — the lookup-time version comparison serves as defence in depth, but the cache key itself is version-blind. See task 5.5 follow-up.
- **Transport EXACT→VERIFIED bridge removed (resolved, task 4.3):** `TransportEstimationService` now emits canonical `ReliabilityStatus` (`'VERIFIED'` for exact weight match, `'ESTIMATED'` for closest bracket); the ad-hoc `EXACT → VERIFIED` mapping in `LandedCostCalculatorService` is deleted. `BasketShippingResult.reliability` retains a local `'EXACT' | 'ESTIMATED' | 'PARTIAL'` type scoped to basket-level computation (not the canonical reliability union) — acceptable as an internal transport-layer signal. `DataReliability` is retained as a deprecated type alias (`= ReliabilityStatus`) in `core-domain/src/index.ts` for backward compatibility.

### 15.1 Schema source-of-truth decision

> **Decision recorded by task 6.2; implemented by task 6.3.**

**Context:** The database schema is defined in two places — the Drizzle ORM file `packages/data-platform/src/schema.ts` and a hand-written DDL file `infra/staging-data/schema.sql`. No Drizzle-generated migrations exist. These files can drift: `schema.ts` drives the type system, repository queries, and seed-data structures; `schema.sql` is applied directly to the staging database via `psql`. Any change to one without the other produces a schema mismatch.

**Decision:** Drizzle `packages/data-platform/src/schema.ts` is the **single source of truth** for the database schema. Committed Drizzle migrations are generated from it (`drizzle-kit generate`). `infra/staging-data/schema.sql` is removed from the deploy path.

**Consequences:**

- All schema changes flow through `schema.ts` → `drizzle-kit generate` → committed migration files.
- The staging deploy applies generated migrations instead of a hand-written SQL file.
- `schema.ts` is the authoritative reference for repositories, seed data, and type inference — no parallel maintenance burden.
- Generated SQL remains reviewable in git (migration files are plain SQL).
- `infra/staging-data/schema.sql` is deleted once the migration path is wired into the staging deploy pipeline.

### 15.2 Staging cluster deferral decision

> **Decision recorded 2026-08-22, repo owner; delivery work in PRs #22–#25.**

**Context:** The deploy workflows authenticate to the cluster with a `KUBE_CONFIG` secret that was never set — the repo held no secrets at all, so every `Deploy Staging` run on `master` failed at the first `kubectl` step (the auth step `echo`-writes the secret and exits 0 even when it is empty). No staging cluster exists and no kubeconfig for one is available. The registry side works: `deploy-staging.yml` and `deploy-production.yml` push to `ghcr.io/siimliimand/rajahinta` with the workflow-scoped `GITHUB_TOKEN` (verified by a pushed image, run 32529902593).

**Decision:** Kubernetes is deferred until traffic justifies it. `deploy-staging.yml` triggers on `workflow_dispatch` only, so `master` pushes no longer run a known-red deploy. The three-tier promotion path (development → staging → production) resumes when a cluster is provisioned.

**Resume steps:**

- Provision the staging cluster; set the `KUBE_CONFIG` repo secret.
- Make `ghcr.io/siimliimand/rajahinta` public (Actions-pushed packages are private by default) or wire an `imagePullSecrets` entry — the cluster currently has no registry credentials.
- Restore the `push: master` trigger on `deploy-staging.yml` or dispatch manually.
- Run the deferred OpenSpec gates recorded in the archived `phase0-1-delivery-cleanup` change (`openspec/changes/archive/2026-08-21-phase0-1-delivery-cleanup/tasks.md`): the 1.2 staging-verification walk, the 1.3 artillery blocking promotion, and the staging half of 5.1.

## 16. Future Considerations

Per the implementation plan's delivery phases:

- **Basket Optimizer** (Phase 2) building on basket-level transport estimation
- **API customer offering** (Phase 2/3) — disclaimer must be a structural part of result objects so API consumers inherit it
- **Persistent stores for cross-cutting concerns** — replace in-memory rate-limiting, idempotency, and audit with Redis/PostgreSQL
- **External feed adapter implementation** — connect real merchant APIs, carrier rate feeds, and tax authority datasets
- **Authentication & authorization** — wire real auth provider into AccountModule
- **Production roll-out** — apply `infra/k8s/overlays/production` to a live cluster, wire cert-manager/Let's Encrypt, configure horizontal pod autoscaling
- **Potential module extraction** — Data Acquisition, then Data Platform, into separate services without redesigning domain logic

## 17. Project Identification

| Field              | Value                                                                         |
| ------------------ | ----------------------------------------------------------------------------- |
| **Name**           | Rajahinta.fi                                                                  |
| **Language**       | TypeScript (ES2022, strict mode)                                              |
| **Type**           | Cross-border beverage price index + Finnish landed-cost intelligence platform |
| **Runtime**        | Node.js 22 (backend), Next.js 14 (frontend)                                   |
| **Database**       | PostgreSQL 16 (Drizzle ORM)                                                   |
| **Cache/Queue**    | Redis 7 (BullMQ)                                                              |
| **Date of review** | 2026-08-19                                                                    |
| **Maintainer**     | Not evident from the repository                                               |

## 18. Glossary / Acronyms

| Term             | Meaning                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| Landed cost      | Total cost of a foreign-purchased item delivered to Finland, incl. retail price, transport, excise, container duty |
| Excise           | Alcohol duty levied by the Finnish Tax Administration based on category, ABV, and volume                           |
| Container duty   | Beverage-container duty (general rate €0.51/litre), with deposit-return exemptions                                 |
| Distance Selling | Transaction classified where the merchant arranges delivery to Finland                                             |
| Distance Buying  | Transaction classified where the buyer arranges transport independently                                            |
| Traveller Import | Personal import excluded from landed-cost calculation                                                              |
| MyTax            | Finnish Tax Administration's online tax service                                                                    |
| ABV              | Alcohol by volume                                                                                                  |

<!-- Last updated: 2026-08-21 — Phase 0+1 verification fix (official tax datasets, CI on master, e2e repair, GDPR erasure) -->
