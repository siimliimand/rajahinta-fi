# ARCHITECTURE.md

## Architecture Overview

Rajahinta.fi is a **cross-border beverage price index and Finnish landed-cost intelligence platform**. It is a calculator, not a shop: there is no checkout, no payment collection for alcohol, and no physical-goods order management — the only commercial transaction is a software subscription.

The architecture is a **modular monolith** organized into clearly bounded packages (core-domain, application-api, data-acquisition, data-platform) with a NestJS 11 composition root and a Next.js 15 frontend (Finnish default locale, English secondary, via next-intl). Every module is wired through explicit port/adapter interfaces so any module can later be extracted into a separate service without redesigning domain logic. The technology stack is TypeScript/Node.js with PostgreSQL 16 + TimescaleDB 2.16 (Drizzle ORM), Redis, and BullMQ.

## 1. Project Structure

```
rajahinta/
├── AGENTS.md                          # Agent operating contract
├── ARCHITECTURE.md                    # This document
├── DESIGN.md                          # Design-system documentation
├── Dockerfile                         # Multi-stage production image
├── docker-compose.yml                 # Local full-stack (TimescaleDB + Redis + backend)
├── eslint.config.mjs                  # ESLint flat config
├── package.json                       # Root workspace (pnpm workspaces)
├── apps/
│   └── backend/                       # NestJS composition root
│       └── src/
│           ├── app.module.ts          # AppModule — wires all packages + domain port adapters
│           ├── main.ts                # Bootstrap
│           └── adapters/              # Composition-root adapters (product-data, calculation-record, merchant-terms, basket-calculation-record, transport-offer-query)
├── packages/
│   ├── core-domain/                   # Domain logic: tax engines, classification, ranking, calculator
│   │   └── src/
│   │       ├── tax/                   # AlcoholExciseService, ContainerDutyService, TaxRuleQueryService
│   │       │   ├── services/          # Pure math functions, deposit-checker
│   │       │   └── ports/             # ITaxRuleRepositoryPort (domain port)
│   │       ├── classification/        # TransactionClassificationService, ClassificationRuleEngine
│   │       ├── normalization/         # ProductNormalizer, ClassificationGate, ManualReview
│   │       ├── transport/             # TransportEstimationService, BasketShippingCalculator, bracket-selection
│   │       ├── calculator/            # LandedCostCalculatorService (orchestrator, shared offer-constrained core)
│   │       ├── optimizer/             # BasketOptimizerService — bounded exhaustive multi-store search (ports: merchant-terms, basket-calculation-record)
    │       │       ├── reliability/           # ConfidenceFrameworkService, ReliabilityService, MerchantReliabilityScoreService
│   │       ├── ranking/               # RankingService (neutrality-enforced sorting)
│   │       ├── declaration/           # ExciseDeclarationService (read-only, never submits)
│   │       ├── correction/            # CorrectionService, CorrectionModule
│   │       ├── entitlement/           # EntitlementService (free/premium gating, tier from account record)
│   │       ├── audit/                 # AuditService, AuditModule
│   │       ├── governance/            # SourceGovernanceService (merchant permission gating)
│   │       ├── fx/                    # FxModule: versioned FX datasets, manual-confirmation publication, rate resolution by effective date
│   │       └── history/               # PriceObservationRecorderService, TaxChangeAttributionService
│   ├── data-platform/                 # Drizzle ORM repositories, schema, seed data
│   │   └── src/
    │       │       ├── schema.ts              # Canonical Drizzle schema (productMaster, retailOffers, taxRules, transportOffers, calculationRecords, priceObservations, priceHistorySummaries, aggregationWatermarks, merchantTerms, basketCalculationRecords, savedScenarios, accounts, savedBaskets, fxRateDatasets, fxRates, sessions, auditEvents, clickCounterSnapshots, merchantRegistry)
│   │       ├── abstracts.ts           # Abstract repository classes (ProductRepository, TaxRateRepository, etc.)
│   │       ├── drizzle/               # Committed Drizzle migrations (schema.ts is the source of truth, §15.1)
│   │       ├── db/
│   │       │   ├── drizzle.provider.ts  # DRIZZLE token, pg.Pool + Drizzle factory (DATABASE_URL)
│   │       │   └── drizzle.module.ts    # @Global DrizzleModule
│   │       ├── repositories/          # Concrete Drizzle implementations
│   │       │   ├── product.repository.ts
│   │       │   ├── tax-rate.repository.ts  # Includes TaxRuleRepositoryAdapter
│   │       │   ├── transport-offer.repository.ts
│   │       │   ├── price-observation.repository.ts    # Append-only observation log (IPriceObservationPort adapter)
│   │       │   ├── price-history-summary.repository.ts # Idempotent summary upsert + range reads
│   │       │   ├── aggregation-watermark.repository.ts # Aggregation watermark persistence
│   │       │   ├── calculation-record.repository.ts
│   │       │   ├── merchant-terms.repository.ts        # Minimum-order thresholds with provenance (IMerchantTermsPort adapter)
    │       │       │   ├── basket-calculation-record.repository.ts # Optimizer result persistence (IBasketCalculationRecordPort adapter)
    │       │       │   ├── saved-scenario.repository.ts        # Named calculator input sets per account
    │       │       │   ├── fx-rate.repository.ts               # Versioned FX datasets + rates (FxModule port adapter)
    │       │       │   ├── session.repository.ts               # Server-issued sessions, tokens hashed at rest
    │       │       │   ├── audit-event.repository.ts           # Append-only audit trail
    │       │       │   ├── click-counter-snapshot.repository.ts # Click analytics PostgreSQL snapshots
    │       │       │   ├── merchant-registry.repository.ts     # Database-backed merchant registry
    │       │       │   └── merchant-reliability.repository.ts  # Merchant data-reliability aggregation reads
│   │       ├── data-platform.module.ts # DataPlatformModule — registers concrete repos + TAX_RULE_REPOSITORY_PORT
│   │       └── seed/tax-rules.seed.ts # Versioned Finnish excise duty rates (v1.0-2024 … v3.0-2026)
│   ├── data-acquisition/              # Merchant feed ingestion pipeline
│   │   └── src/
│   │       ├── adapters/
│   │       │   ├── systembolaget.adapter.ts  # Systembolaget JSON feed adapter (SEK→EUR converted at ingestion via published FX dataset)
│   │       │   ├── alko.adapter.ts           # Alko domestic reference feed (golden-fixture tested)
│   │       │   ├── posti-rate.source.ts      # Posti carrier rate source (governance-gated, fixture-pinned)
│   │       │   ├── ecb-rate.source.ts        # ECB reference rates (default FX source)
│   │       │   ├── pipeline-price-ingestion.adapter.ts
│   │       │   ├── pipeline-transport-rate.adapter.ts
│   │       │   ├── pipeline-tax-dataset-review.adapter.ts
│   │       │   ├── rate-review-repository.adapter.ts
│   │       │   ├── transport-offer-write.adapter.ts
│   │       │   └── upsert-port.adapter.ts
│   │       ├── __fixtures__/            # Golden fixtures (Alko assortment, Posti rates)
│   │       └── services/                # FeedIngestion, DataQuality, RateReviewScheduler, DataMapping, FxDatasetReview
│   └── application-api/               # API layer: controllers, DTOs, guards, jobs
│       └── src/
│           ├── calculator/            # CalculatorController, CalculatorDto
│           ├── calculations/          # Legacy /api/v1/calculations/*: direct AlcoholExciseService / ContainerDutyService calls honoring the body
│           ├── basket/                # BasketOptimizerController, basket DTOs (POST /api/v1/basket/optimize)
│           ├── search/                # SearchController: pg_trgm ranked q with deterministic order
│           ├── declaration/           # DeclarationController (read-only)
│           ├── reports/               # ReportsController, ReportExportService — GET /api/v1/reports/:recordId?format=json|csv|html (flag-gated, premium)
│           ├── merchants/             # MerchantsController, MerchantReliabilityService — GET /api/v1/merchants/reliability (flag-gated)
│           ├── analytics/             # ClickAnalyticsService (Redis counters + PG snapshots), OutboundRedirectController
│           ├── ops/                   # Operator console API (flag-gated OPERATOR_CONSOLE): governance grants, dataset confirmations incl. FX publish, correction queue; fully audited
│           ├── redis/                 # RedisModule client shared by rate limiting, idempotency, analytics
│           ├── common/                # Unified ApiErrorResponse envelope (api-error.filter.ts); decimal coercion at the repository boundary (data-platform db/pg-numeric.ts)
│           ├── feature-flags/         # FeatureFlagService, LaunchGateService, LaunchGateGuard
│           ├── rate-limiting/         # RateLimitGuard, RateLimitingService (Redis sliding window, Lua)
│           ├── idempotency/           # IdempotencyService (version-aware cache keys)
│           ├── age-gate/              # AgeGateService, SimpleConfirmationProvider
│           ├── entitlement/           # EntitlementGuard
│           ├── billing/               # BillingService, BillingModule
│           ├── accounts/              # AccountService, DataExportService, AccountRetentionService, SessionAuthGuard, session issue/rotate endpoints (/api/v1/account/session*)
│           ├── historical/            # HistoricalDataController — GET /api/v1/products/:id/price-history (flag-gated)
│           ├── jobs/                  # BullMQ workers: price-ingestion (per-merchant), transport-rate-refresh, tax-dataset-review, fx-dataset-review, time-series-aggregation, calculation-record-retention, account-retention
│           ├── audit/                 # AuditRepositoryAdapter (bridges to core-domain, durable audit_events store)
│           └── observability/         # ReadinessService, MetricsService (prom-client /metrics on METRICS_PORT), KpiService, OpsDashboardController + OpsAccessGuard, CostAttributionService, InstrumentationService
├── infra/
│   └── jobs/
│       ├── docker-compose.jobs.yml    # Dev hot-reload stack
│       └── Dockerfile.dev             # Dev Dockerfile for job workers
├── tests/
│   ├── golden/                        # Golden-dataset regression tests (real engines, no vi.fn mocks)
│   │   ├── golden-dataset.test.ts
│   │   ├── per-category.test.ts
│   │   └── data/products.ts           # Fixed product/offer fixtures
│   ├── compliance/                    # Neutrality + ranking-lockstep compliance suite (fails the build on violations)
│   ├── integration/                   # Real-Postgres suite: durability, data lifecycle, optimizer/calculator parity (TEST_DATABASE_URL)
│   ├── e2e-browser/                   # Playwright browser journeys (age gate, calculator, compare sorting, account export)
│   └── load/                          # Optimizer/calculator load tests + artillery HTTP suite
├── docs/
│   ├── Rajahinta-FI.docx              # Business plan (Finnish)
│   ├── rajahinta-fi-implementation-plan.md  # Engineering implementation plan
│   ├── tasks.md                       # Task checkboxes (Phase 0–3)
│   ├── tech-stack.md                  # Technology decisions
│   ├── TECHNICAL-ASSESSMENT.md        # Codebase assessment with completion notes
│   └── USER-GUIDE.md                  # End-user guide
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
| `packages/core-domain`      | Domain logic — tax engines, classification, ranking, calculator orchestrator, basket optimizer, confidence framework, merchant reliability scoring, correction, entitlement, audit, source governance, price-history recording and attribution | `tax/`, `classification/`, `normalization/`, `transport/`, `calculator/`, `optimizer/`, `reliability/`, `ranking/`, `declaration/`, `correction/`, `entitlement/`, `audit/`, `governance/`, `history/` |
| `packages/data-platform`    | Drizzle ORM schema, concrete repositories, connection provider, seed data                                                                             | `schema.ts`, `abstracts.ts`, `repositories/`, `db/drizzle.provider.ts`, `data-platform.module.ts`, `seed/tax-rules.seed.ts`                                                  |
| `packages/data-acquisition` | Merchant feed ingestion pipeline (Systembolaget, Alko), FX and carrier sources (ECB, Posti), data-quality checks, rate-review scheduler | `adapters/`, `services/`, `__fixtures__/` |
| `packages/application-api`  | API controllers, DTOs, guards (session auth, rate limiting, idempotency, age gate, entitlement, launch gate, ops access), operator console API, analytics, background job workers, observability | `calculator/`, `calculations/`, `basket/`, `search/`, `ranking/`, `declaration/`, `historical/`, `ops/`, `analytics/`, `feature-flags/`, `rate-limiting/`, `age-gate/`, `jobs/`, `observability/` |
| `apps/backend`              | Composition root — AppModule wires all packages and provides domain-port adapters                                                                     | `app.module.ts`, `adapters/product-data.adapter.ts`, `adapters/calculation-record.adapter.ts`, `adapters/merchant-terms.adapter.ts`, `adapters/basket-calculation-record.adapter.ts`, `adapters/transport-offer-query.adapter.ts`                |

**Connection provider**: `DRIZZLE` token in `packages/data-platform/src/db/drizzle.provider.ts` creates a `pg.Pool` from `DATABASE_URL` and returns a fully-typed Drizzle ORM instance. The `DrizzleModule` is `@Global()`, making the connection available application-wide.

**DataPlatformModule** (`packages/data-platform/src/data-platform.module.ts`) registers concrete Drizzle repositories under abstract class tokens and exports them:

- `ProductRepository` → `DrizzleProductRepository`
- `TaxRateRepository` → `DrizzleTaxRateRepository`
- `TransportOfferRepository` → `DrizzleTransportOfferRepository`
- `CalculationRecordRepository` → `DrizzleCalculationRecordRepository`
- Plus durable stores added in the technical-assessment remediation: `SessionRepository` (hashed session tokens), `AuditEventRepository` (append-only audit trail), `ClickCounterSnapshotRepository`, `MerchantRegistryRepository`, and `FxRateRepository` (exposed to core-domain through the `FxModule` port adapter).

No `useValue: null` providers for data repos — all have concrete implementations.

**TaxRuleRepositoryAdapter** (in `tax-rate.repository.ts`) bridges the Drizzle repository to the domain-layer `ITaxRuleRepositoryPort`. It is registered in `DataPlatformModule` under the `TAX_RULE_REPOSITORY_PORT` token consumed by `AlcoholExciseService` and `ContainerDutyService`.

**Composition root adapters** (`apps/backend/src/app.module.ts`):

- `ProductDataAdapter` → `PRODUCT_DATA_PORT` (domain port for product/offer lookup)
- `CalculationRecordAdapter` → `CALCULATION_RECORD_PORT` (domain port for calculation persistence)

**Legacy calculation endpoints** (`POST /api/v1/calculations/excise`, `/calculations/landed-cost`) are implemented directly in `packages/application-api/src/calculations/` against `AlcoholExciseService` and `ContainerDutyService`, honoring the request body. The former `TaxCalculationEngineAdapter`, which ignored the body and calculated a fixed product, is deleted.

**Deposit status is tri-state**: `depositSystemStatus` is `boolean | null` (nullable boolean in the schema). `checkDepositExemption()` returns `VERIFIED` for `true`/`false`, and `ESTIMATED` when `null` (unknown). The container-duty engine uses this to flag uncertain exemptions.

**No plausible fallback rates**: `DEFAULT_RATES` in `alcohol-excise.math.ts` contains zero-rate placeholders per category — when no rule is found in the repository, the result is zero duty with reliability `ESTIMATED` (`taxDatasetVersion: FALLBACK`), never a silently substituted plausible number. `DEFAULT_CONTAINER_DUTY_RATE` in `container-duty.math.ts` remains the official general container-duty rate (€0.51/l).

### 3.2 Frontend / User Interface

| Component            | Responsibility                                                                              | Key files                                                          |
| -------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Layout**           | Shared header (calculator, compare, basket, account, ranking) with active-page indicator, logo link home, and keyboard-operable mobile menu; footer carries the disclaimer and methodology link; per-page back-links removed | `apps/frontend/src/app/[locale]/layout.tsx`, `apps/frontend/src/app/[locale]/components/SiteHeader.tsx`, `apps/frontend/src/app/[locale]/components/SiteFooter.tsx` |
| **Design system**    | Semantic token layer (status palette, gray scale, radii, shadows as CSS variables mapped into Tailwind), Inter via `next/font`, shared UI primitives (Button, Badge, Card, Input, EmptyState, ErrorState, LoadingSkeleton), and the canonical status module that replaces every per-component color map | `apps/frontend/src/app/globals.css`, `apps/frontend/tailwind.config.ts`, `apps/frontend/src/lib/design/status.ts`, `apps/frontend/src/components/ui/` |
| **Home page**        | Hero with a one-sentence value proposition and calculator CTA, plus a static trust row (data sources, reliability model, methodology link); no backend calls from the page | `apps/frontend/src/app/[locale]/page.tsx`                           |
| **Calculator page**  | Product search (300 ms debounce), product selector, quantity selector, result display with itemized breakdown | `apps/frontend/src/app/[locale]/calculator/`                      |
| **Comparison page**  | Side-by-side product comparison with sort controls; flag-gated store-grouped multi-store comparison                          | `apps/frontend/src/app/[locale]/compare/`                          |
| **Basket page**      | Basket builder (items, quantities, destination, transport arrangement) and optimization results with neutral cost-ordered alternatives (flag-gated) | `apps/frontend/src/app/[locale]/basket/`                          |
| **Ranking page**     | Explanation of ranking methodology (neutrality enforcement); structured JSON via `GET /api/v1/ranking/methodology` | `apps/frontend/src/app/[locale]/ranking/page.tsx`, `packages/application-api/src/ranking/ranking.controller.ts` |
| **Account page**     | Account management, saved baskets, session-linked history      | `apps/frontend/src/app/[locale]/account/`                          |
| **Product pages**    | SEO surface: per-product pages with metadata, plus sitemap and robots       | `apps/frontend/src/app/[locale]/products/`, `apps/frontend/src/app/sitemap.ts`, `apps/frontend/src/app/robots.ts` |
| **Operator console** | Flag-gated (`OPERATOR_CONSOLE`, default off): governance grants, dataset confirmations including FX publish, correction queue | `apps/frontend/src/app/[locale]/ops/`, `packages/application-api/src/ops/` |
| **Age Gate**         | Age verification wrapper (renders in root layout); honest gate: SSR placeholder, gating after mount, in-house declined page; Phase 1 confirmation is self-attestation | `apps/frontend/src/app/[locale]/age-gate/` (incl. `declined/`), `apps/frontend/src/app/[locale]/components/AgeGate.tsx` |
| **DisclaimerBanner** | Structural disclaimer rendered on every calculation result                                  | `apps/frontend/src/app/[locale]/calculator/components/DisclaimerBanner.tsx` |

**Technology:** Next.js 15.5 (App Router, `[locale]` segment via next-intl 4.14 with Finnish default and English secondary, message catalogs under content lint), React 19.2, Tailwind CSS 3.4, Vitest 3.2 + Testing Library, Playwright for browser e2e. Feature-flag states are inlined in the initial HTML payload so gated UI does not appear late.

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

1. **Data Acquisition** → Systembolaget adapter fetches product assortment JSON, maps to `RawFeedRecord` (SEK prices converted to EUR cents at ingestion via the published FX dataset, original amount and currency kept as provenance), pipeline orchestrator runs data-quality checks, `DataMappingService` normalizes fields, `UpsertPortAdapter` persists via `ProductRepository.upsertByEan()`.
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
| PostgreSQL 16 + TimescaleDB 2.16 | Primary structured data store: products, retail offers, transport offers, versioned tax rules, FX datasets, calculation records, sessions, audit trail, merchant registry | `docker-compose.yml` (timescale/timescaledb:2.16.1-pg16), Drizzle ORM via `DRIZZLE` token |
| Redis 7        | Caching, BullMQ job queues, sliding-window rate limiting, idempotency, click analytics counters                      | `docker-compose.yml` (redis:7-alpine)                                      |
| Drizzle schema | Canonical table definitions: `productMaster`, `retailOffers`, `taxRules`, `transportOffers`, `calculationRecords`, `priceObservations`, `priceHistorySummaries`, `aggregationWatermarks`, `merchantTerms`, `basketCalculationRecords`, `savedScenarios`, `accounts`, `savedBaskets`, `fxRateDatasets`, `fxRates`, `sessions`, `auditEvents`, `clickCounterSnapshots`, `merchantRegistry` | `packages/data-platform/src/schema.ts`                                     |

Schema design principles applied:

- Data minimization at schema level — no optional fields "for later"
- Versioned tax rules are append-only (never mutated in place); FX datasets follow the same discipline (`PENDING_CONFIRMATION` → `PUBLISHED` only through explicit operator confirmation)
- `priceObservations` is a TimescaleDB hypertable partitioned into 7-day chunks (append-only time series, watermark-scanned access pattern); `calculationRecords` and `basketCalculationRecords` are partitioned monthly, with a retention worker pruning anonymous-session partitions after the configured window (30 days)
- `sessions` stores server-issued opaque tokens SHA-256 hashed at rest; the plaintext token exists only in the httpOnly cookie
- `auditEvents` is append-only (durable audit trail); click counters live in Redis with periodic snapshots into `clickCounterSnapshots`
- `depositSystemStatus` is tri-state (`boolean | null`) — unknown is explicitly represented
- Reliability status per data point (`VERIFIED`/`ESTIMATED`/`STALE`/`UNAVAILABLE`)
- Structural disclaimer text stored on every `calculationRecords` row (not UI-only)

## 6. External Integrations / APIs

| Integration                            | Status                                 | Implementation                                                                                                                               |
| -------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Systembolaget JSON assortment API      | Adapter implemented                    | `packages/data-acquisition/src/adapters/systembolaget.adapter.ts`: fetches, maps to `RawFeedRecord`, handles pagination and per-item errors; SEK prices converted to EUR cents at ingestion via the published FX dataset, with `original_price_cents`, `original_currency`, and `fx_dataset_version` stored as provenance on `retail_offers`; unconvertible offers are rejected |
| ECB reference rates                    | Default FX source                      | `packages/data-acquisition/src/adapters/ecb-rate.source.ts` → `FxModule` (`packages/core-domain/src/fx/`): dated, versioned datasets; publication requires operator confirmation; redistribution terms are an open legal question (see §15) |
| Posti carrier rates                    | Source implemented (fixture-pinned)    | `packages/data-acquisition/src/adapters/posti-rate.source.ts`: governance-gated transport pipeline; 7-day freshness alert hook |
| Alko (Finnish retailer)                | Adapter implemented                    | `packages/data-acquisition/src/adapters/alko.adapter.ts`: domestic reference feed through the governance gate, golden-fixture tested |
| Finnish Tax Administration rate tables | Seed data (v1.0-2024 … v3.0-2026) + snapshot-based rate review  | `packages/data-platform/src/seed/tax-rules.seed.ts`, `packages/core-domain/src/tax/services/alcohol-excise.math.ts`, `packages/data-acquisition/src/services/rate-review-scheduler.service.ts` — `ConfigBackedRateChangeSource` reads a configured snapshot file, computes a SHA-256 hash, and compares against the last-reviewed entry to detect rate changes; review entries require manual/legal confirmation before promoting dataset versions |

Merchant ingestion is driven by the **database-backed merchant registry** (`merchant_registry` table + `MerchantRegistryRepository`): the scheduler enqueues one job per permitted merchant with per-merchant dedupe keys (`price-ingestion-<merchantId>-<hour>`), so onboarding a merchant does not require a deploy. Ingestion is gated by `SourceGovernanceService`: a merchant must have `GRANTED` permission status before the pipeline will fetch or persist its data. New merchants default to `PENDING` (off) until compliance review.

## 7. Key Technologies

| Technology              | Role                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| TypeScript              | Primary language — all packages and apps                                                            |
| Node.js                 | Runtime (NestJS framework)                                                                          |
| NestJS                  | Modular monolith framework — DI, modules, guards, controllers                                       |
| PostgreSQL 16 + TimescaleDB 2.16 | Primary data store (via `pg` pool); hypertable for the price-observation time series |
| Drizzle ORM             | Type-safe SQL ORM — schema in `packages/data-platform/src/schema.ts`                                |
| Redis 7                 | Caching, BullMQ job queues, rate limiting, idempotency, analytics counters                          |
| BullMQ                  | Background job processing (price ingestion per merchant, transport refresh, tax review, FX review, time-series aggregation, retention sweeps) |
| Next.js 15 + next-intl 4.14 | Frontend (App Router, `[locale]` routing, Finnish default / English secondary)                 |
| Vitest 3.2 / Playwright | Test runners: unit/golden/integration/e2e and browser-level journeys                               |
| pino                    | Structured request logging with request IDs (JSON to stdout)                                        |
| OpenTelemetry           | Trace export to Grafana Cloud (env-configured exporter)                                             |
| prom-client             | `/metrics` endpoint on `METRICS_PORT` (default 9464) with freshness gauges                          |
| ESLint                  | Linting (flat config in `eslint.config.mjs`)                                                        |
| Docker / docker-compose | Local development and production deployment                                                         |
| OpenCode                | Agent runtime and developer interface                                                               |
| OpenSpec                | Change/specification management                                                                     |
| CodeGraph               | Code intelligence / indexing MCP server                                                             |
| AgentMemory             | Cross-session memory MCP server                                                                     |

## 8. Deployment & Infrastructure

| Component                   | Status      | Details                                                                                                                                                                                                                                 |
| --------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker Compose (production) | Implemented | `docker-compose.yml`: TimescaleDB 2.16 (pg16), Redis 7, NestJS backend (multi-stage build)                                                                                                                                             |
| Docker Compose (dev jobs)   | Implemented | `infra/jobs/docker-compose.jobs.yml` + `Dockerfile.dev` — hot-reload for background workers                                                                                                                                             |
| Dockerfile                  | Implemented | Monorepo-root multi-stage production image                                                                                                                                                                                              |
| K8s manifests               | Implemented | Kustomize overlays in `infra/k8s/`: base deployment, service, ingress, configmap, secrets, serviceaccount, HPA (2-4 replicas, owns the replica count), PDB, ServiceMonitor, PrometheusRule, migrate job; staging and production overlays with health probes, security context, and rolling update strategy; image tags set to the commit SHA by the deploy pipeline (no `:latest`) |
| Metrics endpoint            | Implemented | prom-client `/metrics` on `METRICS_PORT` (default 9464, opt-in): request counters, freshness gauges; scraped via ServiceMonitor, alerting via PrometheusRule (stale price share, transport age)                                         |
| Feature flags               | Implemented | `FeatureFlagService`, `LaunchGateService`, `LaunchGateGuard` in `application-api/feature-flags/`; frontend bootstrap inlines flag states in the initial HTML payload                                                                     |
| Background jobs             | Implemented | BullMQ workers: price-ingestion (per-merchant, dedupe-keyed), transport-rate-refresh, tax-dataset-review, fx-dataset-review, time-series-aggregation, calculation-record-retention, account-retention                                    |

The promotion path is development → staging → production, with staging carrying its own tax-rule and merchant data copies, and feature flags gating new merchant sources, tax rulesets, UI ranking behavior, historical price intelligence (`enable_historical_price_intelligence`, default off), basket optimization (`enable_basket_optimization`, default off), and advanced features (`enable_advanced_features` — saved scenarios, report exports, merchant freshness, declaration guidance; default off).

## 9. Security Architecture

Implemented measures:

- **Session authentication**: server-issued opaque session tokens (`packages/application-api/src/accounts/session-token.service.ts`, `session.repository.ts`), SHA-256 hashed at rest in the `sessions` table, delivered as the httpOnly `rajahinta_session` cookie. `SessionAuthGuard` derives the account from the token; the legacy `x-user-id` header is rejected outright, and sessions rotate via `POST /api/v1/account/session/rotate`. Email-verification groundwork exists (`POST /api/v1/account/verify-email`); until verification completes, account data is documented as disposable.
- **Rate limiting**: Redis sliding-window limiter (Lua script) behind `RateLimitGuard` + `RateLimitingService` on public-facing calculation endpoints; shared across replicas. `X-Forwarded-For` is trusted only when `RATE_LIMIT_TRUST_PROXY=true`.
- **Ops dashboard guard**: `OpsAccessGuard` on the ops endpoints: env-configured operator bearer token plus IP allowlist, fails closed when unconfigured.
- **Idempotency**: `IdempotencyService` ensures calculation endpoints are idempotent for identical inputs; cache keys are version-aware (tax, transport, and FX dataset versions).
- **Age gate**: `AgeGateService` with `SimpleConfirmationProvider`: self-attestation, not identity verification (documented as such).
- **Entitlement gating**: `EntitlementGuard` enforces free vs. premium feature access; tier resolves from `accounts.tier` (environment override is a non-production test mechanism).
- **Launch gate**: `LaunchGateGuard` keeps alcohol features behind a flag until legal/tax review is confirmed.
- **Audit trail**: append-only `audit_events` table; governance actions, dataset confirmations, and operator-console actions are durably recorded.
- **Data minimization**: Schema-level enforcement — no optional fields "for later"; identity document storage deferred.
- **Neutrality enforcement**: `RankingService` structurally rejects any input with billing-related fields; no code path allows paid/manual boost.

Non-negotiable constraints from the implementation plan:

- Minimal personal data: default to anonymous usage; identity/age-verification (only if legally required) is a separate, isolated subsystem.
- Tax data is versioned, never overwritten; historical calculations resolve against the effective rate version.
- No code path may allow paid/manual boost of a merchant's position (neutrality enforced in code).

Agent infrastructure constraints: credentials stay out of logs and committed files; `.env` files are write-only.

## 10. Monitoring & Observability

Implemented in `packages/application-api/src/observability/` and `apps/backend/src/main.ts`:

| Service                  | Purpose                                                                    |
| ------------------------ | -------------------------------------------------------------------------- |
| `ReadinessService`       | `GET /api/v1/health/ready` verifies `SELECT 1` plus a Redis ping with short timeouts and reports dependency status; liveness (`/api/v1/health`) stays cheap and process-only |
| `MetricsService`         | prom-client `/metrics` endpoint on `METRICS_PORT` (default 9464, opt-in): request counters and freshness gauges (stale price share, transport age) |
| `pino` (bootstrap)       | Structured JSON request logging with request IDs to stdout (`apps/backend/src/main.ts`) |
| OpenTelemetry            | Trace export to Grafana Cloud via env-configured exporter (`InstrumentationService`) |
| `KpiService`             | Tracks four KPI categories (product, commercial, data, compliance metrics) |
| `OpsDashboardController` | Exposes operational health signals behind `OpsAccessGuard` (bearer + IP allowlist, fails closed) |
| `CostAttributionService` | Per-calculation cost attribution tied to commercial metrics                |

Alerting: `infra/k8s/base/prometheusrule.yaml` pages on the freshness invariants the data-quality service computes (stale price share, transport age); the Posti carrier pipeline also hooks a 7-day transport-freshness alert.

Every externally sourced fact carries a reliability status and timestamp surfaced to the user.

## 11. Performance & Scalability

Implemented:

- **Background jobs separate from request/response path**: BullMQ workers handle per-merchant price ingestion, transport-rate refresh, tax-dataset review, FX-dataset review, time-series aggregation, and retention sweeps; a slow scrape never blocks a user's calculation.
- **Basket-level transport estimation**: `BasketShippingCalculator` handles non-linear shipping thresholds for multi-item baskets.
- **Idempotent calculation endpoints**: results are reproducible and cacheable for identical inputs given the same dataset versions. Cache keys are version-aware: tax, transport, and FX dataset versions are part of the key, so entries invalidate when a dataset version changes, not on a timer. The basket optimizer enforces input caps with a total-combinations guard (clean 422 when exceeded).

## 12. Development Workflow

The repository is an agentic workspace with a working application build. Commands:

| Command                     | Purpose                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docker compose up --build` | Full local stack (TimescaleDB + Redis + backend)                                                                                                                          |
| `pnpm test`                 | Run all Vitest test suites (per package)                                                                                                                                 |
| `pnpm test:golden`          | Golden-dataset regression suite (real Postgres)                                                                                                                          |
| `pnpm test:data-quality`   | Data-quality invariants (real Postgres)                                                                                                                                  |
| `pnpm test:compliance`     | Neutrality and ranking-lockstep compliance (fails the build on violations)                                                                                               |
| `pnpm test:integration`    | Real-Postgres integration suite (durability, data lifecycle, parity; requires `TEST_DATABASE_URL`)                                                                       |
| `pnpm test:e2e`             | End-to-end API tests (NestJS app booted via `vitest.config.e2e.ts`)                                                                                                      |
| `pnpm test:e2e-browser`    | Playwright browser journeys (`tests/e2e-browser/`; boots the real stack)                                                                                                  |
| `pnpm test:load`            | Optimizer/calculator load tests (`tests/load/`); artillery HTTP suite via `pnpm load:http`                                                                               |
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
| Historical-price flow tests | Implemented | `tests/integration/historical-price-flow.test.ts` — observation append → aggregation → API response with attribution, real engines + in-memory ports (`pnpm test:integration`); unit tests in `core-domain/src/history/__tests__/`, `application-api/src/jobs/__tests__/`, `data-platform/src/repositories/__tests__/` |
| Basket optimizer tests | Implemented | `packages/core-domain/src/optimizer/__tests__/basket-optimizer.service.test.ts` (search, thresholds, tie-breaking, neutrality), `packages/application-api/src/basket/__tests__/basket-optimizer.controller.test.ts`, `tests/integration/basket-optimizer-api.test.ts`, `tests/integration/basket-calculator-consistency.test.ts` (optimizer/calculator equivalence for identical inputs) |
| Advanced-features tests | Implemented | `packages/core-domain/src/reliability/__tests__/merchant-reliability-score.service.test.ts`, `packages/core-domain/src/ranking/__tests__/reliability-ranking-isolation.test.ts` (ranking accepts no score input), `packages/core-domain/src/declaration/__tests__/excise-declaration-guidance.test.ts`, `packages/application-api/src/reports/__tests__/`, `packages/application-api/src/merchants/__tests__/`, `packages/application-api/src/accounts/__tests__/account-scenarios.controller.test.ts` + `gdpr-scenario-lifecycle.test.ts`, `packages/data-platform/src/repositories/__tests__/saved-scenario-repository.test.ts`, `tests/integration/reports-api.test.ts` |
| Session integrity tests | Implemented | `packages/application-api/src/accounts/__tests__/`: token forge/guess denied, cross-account access denied, rotation invalidates the old token atomically, `x-user-id` rejected |
| FX dataset tests | Implemented | `packages/core-domain/src/fx/__tests__/` (lifecycle, publication gate, rate resolution), `packages/data-acquisition/src/__tests__/fx-dataset-review.service.test.ts`, `ecb-rate.source.test.ts`, mixed-currency golden cases, cache invalidation on FX dataset version change |
| Search tests | Implemented | `packages/application-api/src/search/__tests__/`: "karhu" matches, deterministic ranked order, pagination interplay, blank query passthrough |
| Compliance suite | Implemented | `tests/compliance/`: neutrality-compliance, ranking-lockstep; runs with `COMPLIANCE_ENFORCED=true` so violations fail the build |
| Data-quality suite | Implemented | Data-quality invariants over seeded data (`scripts/test-data-quality.sh`) |
| Durability tests | Implemented | `tests/integration/durability-restart.test.ts`: rate limits shared across two app instances, audit and analytics survive restart |
| Data-lifecycle tests | Implemented | `tests/integration/data-lifecycle.test.ts`: partition pruning, hypertable query parity, watermark scan |
| Browser e2e tests | Implemented | `tests/e2e-browser/` (Playwright): 8 journeys across age gate (2), calculator flow (2), compare sorting (3), account export incl. session issue (1); CI workflow boots the real stack |
| Load tests | Implemented | `tests/load/`: optimizer and calculator under the k8s resource limits, artillery HTTP suite (`tests/load/artillery/`); results in `tests/load/basket-load-results.md` |

Suite sizes at the technical-assessment remediation gate (task 13.1): unit 2337, golden 35, compliance 31, data-quality 205, integration 104, e2e 17, browser e2e 8 journeys, load 9, all exit 0 alongside typecheck, lint, and production build. CI runs build, lint, unit, golden, data-quality, compliance, e2e, and composition smoke; the integration suite runs locally against `TEST_DATABASE_URL` (see §15).

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

- **Durable cross-cutting state (resolved in the technical-assessment remediation):** rate limiting is Redis-backed (sliding window, shared across replicas), audit events persist to the append-only `audit_events` table, click analytics live in Redis with PostgreSQL snapshots, sessions are durable server-issued tokens, and anonymous calculation records are pruned by the retention worker. In-memory implementations remain for tests only. **Residual:** the operator console's governance and rate-review stores (`packages/application-api/src/ops/*/in-memory-*.repository.ts`) and the correction repository (`packages/application-api/src/correction/in-memory-correction.repository.ts`) are still Phase 1 in-memory: every console action is durably audited, but the stores themselves are restart-volatile; durable tables are a noted follow-up.
- **Authentication is session-based but not identity-based:** server-issued opaque sessions (hashed at rest, httpOnly cookie, rotation) replaced the spoofable `x-user-id` header, and email-verification groundwork exists. No real email/OIDC provider is wired; account data is documented as disposable until verification completes. Age-gate is self-attestation, not a verified identity check.
- **FX redistribution terms open (legal):** ECB reference rates are the default FX source. Whether they may be redistributed in a commercial service is an unresolved legal question; the source is configurable and publication stays behind operator confirmation either way.
- **Integration suite not wired into CI:** `tests/integration/` (104 tests, incl. durability and data lifecycle) runs locally against `TEST_DATABASE_URL`. CI covers build, lint, unit, golden, data-quality, compliance, e2e, and composition smoke; the browser e2e and load suites run in their own workflows (`e2e-browser.yml`, `load-tests.yml`).
- **Anonymous calculation-record retention window:** 30 days configured; the final value is pending operator input.
- **No centralized error tracking:** tracing and metrics export exist (OTel to Grafana Cloud, prom-client `/metrics`), but no error-tracking service (Sentry-class) is integrated.
- **Billing is simulated:** Subscription billing module uses in-memory state with no payment provider. Real third-party billing integration (Stripe or equivalent) is explicitly deferred to Phase 2 — `BillingService` interface remains stable. See `docs/tasks.md` T1.56.
- **Legal review tasks incomplete** (5 external tasks marked `agent: none`): Finnish legal opinion, tax counsel validation, compliance review.
- **Classification rules subject to legislative change** (e.g., 1 September 2024 joint-liability change) require versioned, dated rule sets.
- **Deposit-return system status per product/packaging is tri-state** (`boolean | null`); null means ESTIMATED — the container-duty engine flags uncertain exemptions, never silently assumes.
- **Small-brewery relief (pienpanimoalennus) UNAVAILABLE:** The official vero.fi scheme is a progressive 10–50 % discount by annual production volume (ceiling 15 000 000 l/year, HE 106/2024). The current rule evaluator cannot express production-volume tiers, so only the general beer rate is shipped. Small-brewery treatment is documented as `UNAVAILABLE` pending Phase 2 evaluator support. See vero.fi pienpanimoalennus guidance; rationale in `docs/phase-0-1-verification-fix-plan.md` §3 C1.
- **GDPR integration tests require `TEST_DATABASE_URL`:** `packages/application-api/src/accounts/__tests__/gdpr-integration.test.ts` runs against a real PostgreSQL instance. There is no always-on Postgres harness in CI; these tests are skipped unless `TEST_DATABASE_URL` is set.
- **HTTP-level load test pending baseline:** resolved in the runtime composition fix — `tests/load/artillery/` provides the HTTP suite (ramp 1→50 over 60 s, steady 50 for 120 s, p95 < 2 s, error < 1 %, zero 429s in the steady window) and `deploy-staging.yml` runs it as a non-blocking post-deploy step. Residual: promote to blocking once a staging baseline exists (`docs/staging-verification.md` §5). Staging deploys are deferred (§15.2), so no baseline can exist until the cluster does.
- **E2E suite relies on decorator-metadata transform + single-instance pin:** `vitest.config.e2e.ts` uses a custom TypeScript transpile plugin to emit `emitDecoratorMetadata` and pins `@nestjs/core` to a single physical path. Root cause: pnpm instantiates `@nestjs/core` twice (two peer-set variants), giving two `Reflector`/class identities and breaking NestJS DI. A durable fix would resolve the dependency-side duplication; the current workaround is functional but fragile.
- **Idempotency cache-key version-blindness (resolved):** `CalculatorController` now resolves active dataset versions before deriving the cache key, so the key includes tax, transport, and FX dataset versions; a version bump produces a different key and a guaranteed fresh calculation. Client-supplied idempotency keys stay verbatim by contract, and the lookup-time version comparison remains as defence in depth.
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

Per the implementation plan's delivery phases (cross-cutting durable stores, feed adapters for Alko/Posti/ECB, browser e2e, and the operator console landed in the technical-assessment remediation):

- **API customer offering** (Phase 2/3) — disclaimer must be a structural part of result objects so API consumers inherit it (basket optimizer ships structural disclaimers already)
- **Real authentication:** wire an email/OIDC provider onto the existing session and email-verification groundwork; until then account data stays disposable
- **Durable governance and rate-review stores:** replace the operator console's in-memory repositories with database tables (actions are already durably audited)
- **Billing integration:** real third-party billing (Stripe or equivalent) on the stable `BillingService` interface
- **Production roll-out:** apply `infra/k8s/overlays/production` to a live cluster, wire cert-manager/Let's Encrypt (HPA, PDB, ServiceMonitor, and PrometheusRule are already in the base)
- **Potential module extraction** — Data Acquisition, then Data Platform, into separate services without redesigning domain logic

## 17. Project Identification

| Field              | Value                                                                         |
| ------------------ | ----------------------------------------------------------------------------- |
| **Name**           | Rajahinta.fi                                                                  |
| **Language**       | TypeScript (ES2022, strict mode)                                              |
| **Type**           | Cross-border beverage price index + Finnish landed-cost intelligence platform |
| **Runtime**        | Node.js 22 (backend), Next.js 15 (frontend)                                   |
| **Database**       | PostgreSQL 16 + TimescaleDB 2.16 (Drizzle ORM)                                |
| **Cache/Queue**    | Redis 7 (BullMQ)                                                              |
| **Date of review** | 2026-08-19                                                                    |
| **Maintainer**     | Not evident from the repository                                               |

## 18. Glossary / Acronyms

| Term             | Meaning                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Landed cost      | Total cost of a foreign-purchased item delivered to Finland, incl. retail price, transport, excise, container duty  |
| Excise           | Alcohol duty levied by the Finnish Tax Administration based on category, ABV, and volume                            |
| Container duty   | Beverage-container duty (general rate €0.51/litre), with deposit-return exemptions                                   |
| Distance Selling | Transaction classified where the merchant arranges delivery to Finland                                              |
| Distance Buying  | Transaction classified where the buyer arranges transport independently                                             |
| Traveller Import | Personal import excluded from landed-cost calculation                                                              |
| MyTax            | Finnish Tax Administration's online tax service                                                                    |
| ABV              | Alcohol by volume                                                                                                   |
| FX dataset       | Dated, versioned set of foreign-exchange rates (default source: ECB reference rates); published only via operator confirmation |
| Hypertable       | TimescaleDB time-partitioned table; `price_observations` uses 7-day chunks                                          |
| ECB              | European Central Bank (publisher of the default FX reference rates)                                                 |

<!-- Last updated: 2026-08-28, technical-assessment-remediation (sessions, FX datasets, merchant registry, TimescaleDB hypertable, durable audit/analytics/rate limiting, Next 15/React 19/next-intl, ops console, observability); prior: Phase 2 advanced features -->
