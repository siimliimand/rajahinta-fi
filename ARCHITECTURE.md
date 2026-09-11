# ARCHITECTURE.md

## Architecture Overview

Rajahinta.fi is a **cross-border beverage price index and Finnish landed-cost intelligence platform**. It is a calculator, not a shop: there is no checkout, no payment collection for alcohol, and no physical-goods order management — the only commercial transaction is a software subscription.

The architecture is a set of clearly bounded packages (core-domain, application-api, data-acquisition, data-platform) whose logic runs on **Cloudflare Workers** (change `migrate-to-cloudflare`, designs D1–D10): an OpenNext frontend Worker (Next.js 15, Finnish default locale via next-intl), a Hono API Worker preserving the former NestJS contracts (zod DTOs, guard semantics, unified error envelope), an email Worker on the `send_email` binding, and the Cron/Queues/Workflows substrate. Every module is still wired through explicit port/adapter interfaces so any module can later be extracted into a separate service without redesigning domain logic. Data lives in D1 (SQLite, Drizzle ORM), R2 (observation log, rate snapshots), and Durable Objects; observability exports OTLP traces to Grafana Cloud (destination unchanged). The NestJS composition root (`apps/backend`) and the Postgres/Redis path remain in the repository only as test-harness substrate for the legacy pg suites and the legacy browser-E2E harness — they serve no traffic since the cutover (`docs/cutover-runbook.md`), and the K8s/Docker production artifacts were deleted at decommission (task 6.7).

## 1. Project Structure

```
rajahinta/
├── AGENTS.md                          # Agent operating contract
├── ARCHITECTURE.md                    # This document
├── DESIGN.md                          # Design-system documentation
├── docker-compose.yml                 # Local TimescaleDB + Redis for the legacy pg test suites
├── eslint.config.mjs                  # ESLint flat config
├── package.json                       # Root workspace (pnpm workspaces)
├── apps/
│   ├── api-worker/                    # API Worker (Hono) — the production API on Workers
│   │   └── src/
│   │       ├── routes/                # Hono routes preserving the NestJS API contracts (design D1)
│   │       ├── do/                    # RateLimiterDO, IdempotencyDO, ClickCounterDO (design D5)
│   │       ├── cron/                  # Cron handlers dispatched by pattern (design D6)
│   │       ├── workflows/             # Price-ingestion Cloudflare Workflow (design D6)
│   │       ├── observability/         # Analytics Engine metrics + OTLP export (design D8)
│   │       └── wrangler.jsonc         # dev/staging/production environments + bindings (design D9)
│   ├── email-worker/                  # Email Worker — send_email binding, MIME builder (design D7)
│   ├── frontend/                      # Next.js 15 frontend → OpenNext Cloudflare Worker (task 5.1)
│   └── backend/                       # LEGACY NestJS composition root — test-harness only since cutover
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
│   │       ├── unitprice/             # €/g ethanol unit price — pure eurPerGram, density 789 g/l, status-carrying (VERIFIED/ESTIMATED/unavailable)
│   │       ├── packing/               # Deterministic first-fit-decreasing box packing, fill-rate + glass/metal mixing warning
│   │       ├── eventcalc/             # Event consumption calculator — MVP shopping list + V2 cross-border sourcing over versioned norms
│   │       ├── tripcalc/              # Trip break-even calculator over versioned traveller allowance datasets
│   │       ├── whatif/                # Hypothetical excise substitution — pure, zero persistence (ephemeral by design)
│   │       ├── grouporder/            # Group-order proportional allocation + minimal transfers (accounting-only, no payment fields)
│   │       ├── reliability/           # ConfidenceFrameworkService, ReliabilityService, MerchantReliabilityScoreService
│   │       ├── ranking/               # RankingService (neutrality-enforced sorting)
│   │       ├── blacklist/             # Shop-report evidence validation, report state machine, published-standard constants, merchant identity normalization
│   │       ├── outcomes/              # Outcome submission validation (60-day window, one per record+account), 5% margin comparison, pure accuracy aggregation — user-reported everywhere
│   │       ├── content/               # Rate-change blog draft builder (FI + EN, what changed / effective date / typical-basket impact)
│   │       ├── sharing/               # Share-snapshot assembly (frozen copy, 22-char public id, personal-data strip assertion)
│   │       ├── declaration/           # ExciseDeclarationService (read-only, never submits)
│   │       ├── correction/            # CorrectionService, CorrectionModule
│   │       ├── entitlement/           # EntitlementService (free/premium gating, tier from account record)
│   │       ├── audit/                 # AuditService, AuditModule
│   │       ├── governance/            # SourceGovernanceService (merchant permission gating)
│   │       ├── benchmark/             # Alko reference benchmark — pure offer-vs-Alko comparison for display; never a calculation or ranking input
│   │       ├── savings/               # Pure savings-gap computation + deterministic ordering (display-only, change insight-surfaces)
│   │       ├── price-context/         # Pure 90-day window statistics with INSUFFICIENT_HISTORY gate (change insight-surfaces)
│   │       └── history/               # PriceObservationRecorderService, TaxChangeAttributionService
│   ├── data-platform/                 # Drizzle ORM repositories, schema, seed data
│   │   └── src/
│   │       ├── schema.ts              # Canonical Drizzle schema — 36 tables: productMaster, retailOffers, taxRules, transportOffers, calculationRecords, priceHistorySummaries, aggregationWatermarks, merchantTerms, basketCalculationRecords, savedScenarios, accounts, savedBaskets, sessions, emailTokens, auditEvents, clickCounterSnapshots, merchantRegistry, priceAlerts (kind PRICE | TAX_CHANGE), alertNotifications, productDimensions, carrierBoxTypes, consumptionNorms, travellerAllowanceDatasets, travellerAllowanceLimits, groupOrderSessions, groupOrderItems, ferryOffers, producerLinks, curatedEntries, shopReports, blacklistEntries, calculationOutcomes, blogPosts, newsletterSubscribers, newsletterNotifications, shareSnapshots (raw observations live in R2, not D1 — §5); every stored offer is EUR (the currency union is the `'EUR'` literal)
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
│   │       │   ├── basket-calculation-record.repository.ts # Optimizer result persistence (IBasketCalculationRecordPort adapter)
│   │       │   ├── saved-scenario.repository.ts        # Named calculator input sets per account
│   │       │   ├── session.repository.ts               # Server-issued sessions, tokens hashed at rest
│   │       │   ├── audit-event.repository.ts           # Append-only audit trail
│   │       │   ├── click-counter-snapshot.repository.ts # Click analytics PostgreSQL snapshots
│   │       │   ├── merchant-registry.repository.ts     # Database-backed merchant registry
│   │       │   └── merchant-reliability.repository.ts  # Merchant data-reliability aggregation reads
│   │       ├── data-platform.module.ts # DataPlatformModule — registers concrete repos + TAX_RULE_REPOSITORY_PORT
│   │       └── seed/tax-rules.seed.ts # Versioned Finnish excise duty rates (v1.0-2024 … v3.0-2026)
│   ├── data-acquisition/              # Merchant feed ingestion pipeline
│   │   └── src/
│   │       ├── adapters/
│   │       │   ├── alko.adapter.ts           # Alko domestic reference feed (golden-fixture tested)
│   │       │   ├── alks.adapter.ts           # alks.fi WooCommerce Store API feed (second live merchant, change alks-feed-and-import-vat)
│   │       │   ├── alks.parser.ts            # alks pure parser: SKU→EAN, name ABV/volume, category mapping
│   │       │   ├── posti-rate.source.ts      # Posti carrier rate source (governance-gated, fixture-pinned)
│   │       │   ├── pipeline-price-ingestion.adapter.ts
│   │       │   ├── pipeline-transport-rate.adapter.ts
│   │       │   ├── pipeline-tax-dataset-review.adapter.ts
│   │       │   ├── rate-review-repository.adapter.ts
│   │       │   ├── transport-offer-write.adapter.ts
│   │       │   └── upsert-port.adapter.ts
│   │       ├── __fixtures__/            # Golden fixtures (Alko assortment, Posti rates)
│   │       └── services/                # FeedIngestion, DataQuality, RateReviewScheduler, DataMapping
│   └── application-api/               # API layer: controllers, DTOs, guards, jobs
│       └── src/
│           ├── calculator/            # CalculatorController, CalculatorDto
│           ├── calculations/          # Legacy /api/v1/calculations/*: direct AlcoholExciseService / ContainerDutyService calls honoring the body
│           ├── basket/                # BasketOptimizerController, basket DTOs (POST /api/v1/basket/optimize)
│           ├── search/                # SearchController: pg_trgm ranked q with deterministic order
│           ├── declaration/           # DeclarationController (read-only)
│           ├── reports/               # ReportsController, ReportExportService — GET /api/v1/reports/:recordId?format=json|csv|html (entitlement seam, FREE for all today)
│           ├── merchants/             # MerchantsController, MerchantReliabilityService — GET /api/v1/merchants/reliability
│           ├── analytics/             # ClickAnalyticsService (Redis counters + PG snapshots), OutboundRedirectController
│           ├── ops/                   # Operator console API (OpsAccessGuard): governance grants, dataset confirmations, correction queue; fully audited
│           ├── redis/                 # RedisModule client shared by rate limiting, idempotency, analytics
│           ├── common/                # Unified ApiErrorResponse envelope (api-error.filter.ts); decimal coercion at the repository boundary (data-platform db/pg-numeric.ts)
│           ├── feature-flags/         # (removed 2026-09-07 — flag + launch-gate systems deleted by owner decision)
│           ├── rate-limiting/         # RateLimitGuard, RateLimitingService (Redis sliding window, Lua)
│           ├── idempotency/           # IdempotencyService (version-aware cache keys)
│           ├── age-gate/              # AgeGateService, SimpleConfirmationProvider
│           ├── entitlement/           # EntitlementGuard
│           ├── billing/               # BillingService, BillingModule
│           ├── accounts/              # AccountService, DataExportService, AccountRetentionService, SessionAuthGuard, session rotate/logout endpoints (/api/v1/account/session*) — test substrate; no credential flow (see §9 legacy-harness divergence)
│           ├── historical/            # HistoricalDataController — GET /api/v1/products/:id/price-history
│           ├── jobs/                  # BullMQ workers: price-ingestion (per-merchant), transport-rate-refresh, tax-dataset-review, time-series-aggregation, calculation-record-retention, account-retention
│           ├── audit/                 # AuditRepositoryAdapter (bridges to core-domain, durable audit_events store)
│           └── observability/         # ReadinessService, MetricsService (prom-client /metrics on METRICS_PORT), KpiService, OpsDashboardController + OpsAccessGuard, CostAttributionService, InstrumentationService
├── infra/
│   ├── environments/                  # Committed Cloudflare environment descriptions (task 6.5)
│   │   ├── dev.yaml                   # local development
│   │   ├── staging.yaml               # pre-production validation (EU data plane)
│   │   └── prod.yaml                  # production hardened (gated deploys, rollback)
│   └── staging-data/                  # Test fixture SQL (feeds scripts/test-data-quality.sh)
├── scripts/                           # Ops/CI tooling: ETL (etl-pg-to-d1.ts), parity harness, seed-d1, test runners
├── tests/
│   ├── golden/                        # Golden-dataset regression tests (real engines, no vi.fn mocks)
│   │   ├── golden-dataset.test.ts
│   │   ├── per-category.test.ts
│   │   └── data/products.ts           # Fixed product/offer fixtures
│   ├── compliance/                    # Neutrality + ranking-lockstep compliance suite (fails the build on violations)
│   ├── integration/                   # Legacy Postgres suite (TEST_DATABASE_URL) + d1/ suites on the node:sqlite D1 harness
│   ├── e2e-browser/                   # Playwright journeys (workers config; legacy compose harness kept for CI)
│   └── load/                          # Optimizer/calculator load tests + artillery HTTP suite (Workers staging target)
├── docs/
│   ├── Rajahinta-FI.docx              # Business plan (Finnish)
│   ├── rajahinta-fi-implementation-plan.md  # Engineering implementation plan
│   ├── tasks.md                       # Task checkboxes (Phase 0–3 + product-roadmap Phases 1–4)
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
| `packages/core-domain`      | Domain logic — tax engines, classification, ranking, calculator orchestrator, basket optimizer, confidence framework, merchant reliability scoring, correction, entitlement, audit, source governance, price-history recording and attribution, display-only Alko reference benchmark, plus the roadmap modules: €/g unit price, packing optimization, event and trip calculators, excise what-if simulation, group-order allocation, and the trust-and-reach modules: shop blacklist, calculation outcomes, content drafts, share snapshots, allowance-fill objective, savings-gap computation, and price-context window statistics | `tax/`, `classification/`, `normalization/`, `transport/`, `calculator/`, `optimizer/`, `unitprice/`, `packing/`, `eventcalc/`, `tripcalc/`, `whatif/`, `grouporder/`, `reliability/`, `ranking/`, `blacklist/`, `outcomes/`, `content/`, `sharing/`, `declaration/`, `correction/`, `entitlement/`, `audit/`, `governance/`, `benchmark/`, `savings/`, `price-context/`, `history/` |
| `packages/data-platform`    | Drizzle ORM schema, concrete repositories, connection provider, seed data                                                                             | `schema.ts`, `abstracts.ts`, `repositories/`, `db/drizzle.provider.ts`, `data-platform.module.ts`, `seed/tax-rules.seed.ts`                                                  |
| `packages/data-acquisition` | Merchant feed ingestion pipeline (Alko domestic reference, alks.fi Store API), carrier sources (Posti), data-quality checks, rate-review scheduler | `adapters/`, `services/`, `__fixtures__/` |
| `packages/application-api`  | API controllers, DTOs, guards (session auth, rate limiting, idempotency, age gate, entitlement, ops access), operator console API, analytics, background job workers, observability | `calculator/`, `calculations/`, `basket/`, `search/`, `ranking/`, `declaration/`, `historical/`, `ops/`, `analytics/`, `rate-limiting/`, `age-gate/`, `jobs/`, `observability/` |
| `apps/backend`              | Composition root — AppModule wires all packages and provides domain-port adapters                                                                     | `app.module.ts`, `adapters/product-data.adapter.ts`, `adapters/calculation-record.adapter.ts`, `adapters/merchant-terms.adapter.ts`, `adapters/basket-calculation-record.adapter.ts`, `adapters/transport-offer-query.adapter.ts`                |

**Connection provider**: `DRIZZLE` token in `packages/data-platform/src/db/drizzle.provider.ts` creates a `pg.Pool` from `DATABASE_URL` and returns a fully-typed Drizzle ORM instance. The `DrizzleModule` is `@Global()`, making the connection available application-wide.

**DataPlatformModule** (`packages/data-platform/src/data-platform.module.ts`) registers concrete Drizzle repositories under abstract class tokens and exports them:

- `ProductRepository` → `DrizzleProductRepository`
- `TaxRateRepository` → `DrizzleTaxRateRepository`
- `TransportOfferRepository` → `DrizzleTransportOfferRepository`
- `CalculationRecordRepository` → `DrizzleCalculationRecordRepository`
- Plus durable stores added in the technical-assessment remediation: `SessionRepository` (hashed session tokens), `AuditEventRepository` (append-only audit trail), `ClickCounterSnapshotRepository`, and `MerchantRegistryRepository`.
- Plus the roadmap repositories (change `product-roadmap-phases-1-4`, under `repositories/d1/`): `PriceAlertRepository`/`AlertNotificationRepository` (intent-log + delivery marking), `ProductDimensionRepository`/`CarrierBoxTypeRepository`, `ConsumptionNormRepository`, `TravellerAllowanceRepository` (both versioned datasets behind the manual publish gate), `FerryOfferRepository`, `ProducerLinkRepository`, `CuratedEntryRepository`, and the `GroupOrderRepository` (sessions + items; `groupOrderSessions`/`groupOrderItems` carry no payment-adjacent columns by design).
- Plus the trust-and-reach repositories (change `trust-and-reach-roadmap`, under `repositories/d1/`): `ShopReportRepository`, `BlacklistRepository`, and `CalculationOutcomeRepository` (read-side accuracy aggregation: count, within-margin share by period), and `BlogPostRepository`, `NewsletterSubscriberRepository`, `NewsletterNotificationRepository` (intent rows before send, outcome marking after), `ShareSnapshotRepository`; the alert repository is kind-aware (PRICE/TAX_CHANGE, duplicate check per product+kind).
- Plus the insight-surface repositories (change `insight-surfaces`, under `repositories/d1/`): `SavingsSnapshotRepository` (idempotent per-(asOf, productId) upsert, latest-day + per-category range reads); the `blogPosts` table and `BlogPostRepository` are kind-aware (RATE_CHANGE default | GUIDE, kind-filtered listings).

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
| **Layout**           | Shared header (calculator, compare, basket, products, event, trip, what-if, account, ranking) with active-page indicator, logo link home, and keyboard-operable mobile menu; footer carries the disclaimer and methodology link; per-page back-links removed | `apps/frontend/src/app/[locale]/layout.tsx`, `apps/frontend/src/app/[locale]/components/SiteHeader.tsx`, `apps/frontend/src/app/[locale]/components/SiteFooter.tsx` |
| **Design system**    | Semantic token layer (status palette, gray scale, radii, shadows as CSS variables mapped into Tailwind), Inter via `next/font`, shared UI primitives (Button, Badge, Card, Input, EmptyState, ErrorState, LoadingSkeleton), and the canonical status module that replaces every per-component color map | `apps/frontend/src/app/globals.css`, `apps/frontend/tailwind.config.ts`, `apps/frontend/src/lib/design/status.ts`, `apps/frontend/src/components/ui/` |
| **Home page**        | Hero with a one-sentence value proposition and calculator CTA, plus a static trust row (data sources, reliability model, methodology link); no backend calls from the page | `apps/frontend/src/app/[locale]/page.tsx`                           |
| **Calculator page**  | Product search (300 ms debounce), product selector, quantity selector, result display with itemized breakdown | `apps/frontend/src/app/[locale]/calculator/`                      |
| **Comparison page**  | Side-by-side product comparison with sort controls; store-grouped multi-store comparison                          | `apps/frontend/src/app/[locale]/compare/`                          |
| **Basket page**      | Basket builder (items, quantities, destination, transport arrangement) and optimization results with neutral cost-ordered alternatives | `apps/frontend/src/app/[locale]/basket/`                          |
| **Ranking page**     | Explanation of ranking methodology (neutrality enforcement); structured JSON via `GET /api/v1/ranking/methodology` | `apps/frontend/src/app/[locale]/ranking/page.tsx`, `packages/application-api/src/ranking/ranking.controller.ts` |
| **Account page**     | Account management, saved baskets, session-linked history      | `apps/frontend/src/app/[locale]/account/`                          |
| **Product pages**    | SEO surface: browsable `/products` catalog (server-rendered, URL-state category filter over the six canonical values, true pagination, offer-derived lowest price + merchant count, per-category metadata with canonical URLs, sitemap base + category URLs) and per-product pages with metadata, plus sitemap and robots; dupe panel (evidence-backed producer links) and set-alert action | `apps/frontend/src/app/[locale]/products/`, `apps/frontend/src/app/sitemap.ts`, `apps/frontend/src/app/robots.ts` |
| **Roadmap feature pages** | Live for all visitors: alerts management (account), event calculator, trip feasibility with fill mode and the visually distinct ferry-offer block, curated lists (`lists/[slug]`), what-if simulator with embeddable widget, group-order session page with a persistent settlement-happens-outside note | `apps/frontend/src/app/[locale]/account/`, `.../event/`, `.../trip/`, `.../lists/`, `.../what-if/`, `.../group-order/` |
| **Trust-and-reach pages** | Live for all visitors: blog index and per-locale slug pages (PUBLISHED posts only, sitemap-included), newsletter subscribe form (blog + footer, explicit consent separate from price alerts) with confirmation landing page, public share page `/share/[publicId]` rendering a frozen snapshot with DisclaimerBanner and OG metadata, embeddable calculator `/embed/calculator` (minimal chrome, iframe-friendly headers, age gate + disclaimers intact), €/g value page `/value` with per-category ranking and status badges, merchant warning badges on product/compare/search, accuracy statistic in the home trust row and on the methodology page (sample size + user-reported wording, honest zero state), report-outcome form on in-window account history records | `apps/frontend/src/app/[locale]/blog/`, `.../newsletter/`, `.../share/`, `.../embed/`, `.../value/`, `.../products/`, `.../page.tsx` |
| **Insight pages** | Live for all visitors: `/savings` per-category gap listing (as-of + coverage counts in the header, reliability + confidence badges, ordering rule stated in the copy, honest zero state), `/allowances` date-addressable explorer (verbatim citations as evidence links, version label + effective window, version history, guidance-not-legal-advice framing), `/guides` + `/guides/[slug]` (GUIDE-kind posts only, cross-links to /allowances and /trip), and the product-page price-context line (delta vs the 90-day median with window + as-of, insufficient-history state renders no percentage) | `apps/frontend/src/app/[locale]/savings/`, `.../allowances/`, `.../guides/`, `.../products/` |
| **Operator console** | OpsAccessGuard-protected: governance grants against the durable D1 `source_governance` table (grant/revoke/list shared with the hourly producer and the ingestion workflow gate; every mutation audited to `audit_events`, un-granted merchants fail closed as `PENDING`), merchant registration (`POST /ops/console/merchants` upserts the registry and auto-grants a merchant with no governance records — owner blanket-permission policy; explicit records, revocation in particular, survive re-registration), dataset confirmations, correction queue, report review queue (link/reject), blacklist publish + appeal inbox, blog post publish, guide draft create/edit/publish (GUIDE kind, no rate-version provenance), newsletter notify-subscribers broadcast | `apps/frontend/src/app/[locale]/ops/`, `apps/api-worker/src/routes/ops.routes.ts` |
| **Age Gate**         | Age verification wrapper (renders in root layout); honest gate: SSR placeholder, gating after mount, in-house declined page; Phase 1 confirmation is self-attestation | `apps/frontend/src/app/[locale]/age-gate/` (incl. `declined/`), `apps/frontend/src/app/[locale]/components/AgeGate.tsx` |
| **DisclaimerBanner** | Structural disclaimer rendered on every calculation result                                  | `apps/frontend/src/app/[locale]/calculator/components/DisclaimerBanner.tsx` |

**Technology:** Next.js 15.5 (App Router, `[locale]` segment via next-intl 4.14 with Finnish default and English secondary, message catalogs under content lint), React 19.2, Tailwind CSS 3.4, Vitest 3.2 + Testing Library, Playwright for browser e2e.

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

1. **Data Acquisition** → the hourly producer resolves the merchant's adapter from the `FEED_ADAPTERS` registry keyed by `merchantId`: `alko` fetches the domestic reference assortment JSON; `alks` walks the WooCommerce Store API sequentially (`per_page=100` capped by `X-WP-TotalPages`, page failures collected, never thrown), parses ABV/volume from the product name (a record whose ABV or volume cannot be parsed still ingests as ESTIMATED), carries an optional feed weight into `weight_grams` on the product master, and ignores image fields. Both adapters map to `RawFeedRecord` (all prices are EUR — the currency union is pinned to the `'EUR'` literal, so there is no conversion step), pipeline orchestrator runs data-quality checks, `DataMappingService` normalizes fields, `UpsertPortAdapter` persists via `ProductRepository.upsertByEan()`.
2. **User selects product + quantity + destination** → `CalculatorController` receives request.
3. **Transport Estimation** → `TransportEstimationService` queries `ITransportOfferQuery` for applicable carrier rates by route/weight/package tier; `BasketShippingCalculator` handles multi-item baskets.
4. **Transaction Classification** → `TransactionClassificationService` determines Distance Selling / Distance Buying / Traveller Import with evidence summary.
5. **Tax & Duty Calculation** → `AlcoholExciseService` resolves versioned tax rules via `ITaxRuleRepositoryPort.findApplicable()` (no plausible numeric fallback — a missing rule yields zero duty flagged `ESTIMATED`), computes excise duty. `ContainerDutyService` evaluates deposit-return exemption via `checkDepositExemption()` (tri-state: true/false/null) then applies container duty.
6. **Confidence Framework** → `ConfidenceFrameworkService` computes result confidence as a pure function of underlying data statuses (HIGH/MEDIUM/LOW).
7. **Landed-Cost Calculator** → `LandedCostCalculatorService` orchestrates the above, assembles itemized result with structural disclaimer. When the product has Alko reference offers, the result additionally carries a display-only `alkoBenchmark` comparison — it never enters the total, the breakdown, or any ranking input.
8. **Calculation Record** → Persisted via `ICalculationRecordPort` for auditability.
9. **Excise Declaration Assistant** → `ExciseDeclarationService` packages calculation into structured summary, links to MyTax (never submits).

## 5. Data Stores

| Store          | Purpose                                                                                                             | Implementation                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| D1 (SQLite)    | Primary relational store: products, retail offers (EUR only), transport offers, versioned tax rules, calculation records, price-history summaries, sessions, single-use email tokens (verification + password reset), audit trail, merchant registry, source governance (operator-granted feed permissions gating ingestion), click-counter snapshots, price alerts (kind PRICE \| TAX_CHANGE) + notification intents, packing dimensions + carrier box types, versioned consumption-norm and traveller-allowance datasets, curated ferry offers, producer links, curated editorial entries, the group-order ledger, shop reports + blacklist entries, user-reported calculation outcomes, blog posts + newsletter subscribers + newsletter notification intents, frozen share snapshots, and the daily savings-snapshot materialization (idempotent per as-of day + product) | `packages/data-platform/src/d1/schema.ts` (sqliteTable, design D2), bound as `DB` in `apps/api-worker/wrangler.jsonc`; 38 tables plus the `product_master_fts` FTS5 search index (design D3); migrations via `wrangler d1 migrations` in the deploy pipeline (design D2) |
| R2             | Append-only price-observation log (JSONL objects partitioned by date, batch-read for aggregation — design D4 as amended by G1) + rate-snapshot objects + OpenNext ISR cache | `OBSERVATION_LOG`, `RATE_SNAPSHOTS`, `NEXT_INC_CACHE_R2_BUCKET` bindings; EU jurisdiction (design D9) |
| Durable Objects | Strongly consistent request-scoped state: `RateLimiterDO` (sliding-window log), `IdempotencyDO` (version-aware cache keys), `ClickCounterDO` (SQLite storage, `alarm()`-flushed snapshots into D1) | `apps/api-worker/src/do/` (design D5) |
| Legacy Postgres + Redis (test harness) | The former production stores, kept only for the legacy pg suites (golden, data-quality, compliance, integration) and the legacy browser-E2E harness | `docker-compose.yml` (postgres+redis services), `tests/integration/` |

Schema design principles applied (unchanged through the migration):

- Data minimization at schema level — no optional fields "for later"
- Versioned tax rules are append-only (never mutated in place) — as do the roadmap reference datasets: `consumptionNorms` and `travellerAllowanceDatasets`/`travellerAllowanceLimits` are append-only with effective-date resolution and the same manual publish gate
- **Data immutability for history (explicit):** the price-observation log is append-only — observations are written once and never overwritten or rewritten; corrections surface as new observations, and tax-driven movements are attributed read-time against the versioned tax-rule history. The only history-adjacent mutation is the idempotent re-materialization of `priceHistorySummaries` aggregates from the log
- `groupOrderSessions`/`groupOrderItems` carry no payment-adjacent columns by design — the ledger is accounting-only (see §9); `ferryOffers` is a curated, display-only affiliate slot that is never part of a calculation input (see §9)
- Time-series: `priceObservations` lives in R2 as an append-only JSONL log partitioned by date, scanned by watermark like the former TimescaleDB hypertable chunks (design D4 as amended by gate G1 — D1-only storage failed the ≥2× byte-headroom requirement); `priceHistorySummaries` remains the long-term analytical record, materialized into D1 with `strftime` bucketing
- Retention: calculation records are **age-capped** by configuration (default 180 days) via a scheduled Cron `DELETE` sweep — anonymous rows keep the 30-day window, and the cap replaces the former "session-bearing rows are never pruned" rule (amended by G1); `calculationOutcomes` is deliberately absent from that sweep's table list and carries its own 24-month cap constant (`CALCULATION_OUTCOME_RETENTION_DAYS = 730`, its own sweep a noted follow-up), so the record sweep can never destroy user-reported outcomes
- Share snapshots are frozen copies: `shareSnapshots` rows reference no account and no calculation-record foreign key — the assembler strips personal data and the API refuses to store a snapshot that fails the strip assertion; a 12-month hygiene sweep constant exists for orphaned snapshots
- `newsletterSubscribers` holds the double opt-in state (PENDING → ACTIVE on the emailed token, UNSUBSCRIBED immediately on the one-click link) separately from `priceAlerts`; `newsletterNotifications` is the per-recipient intent log (write intent before send, mark outcome after)
- `sessions` stores server-issued opaque tokens SHA-256 hashed at rest; the plaintext token exists only in the httpOnly cookie
- `emailTokens` stores SHA-256-hashed single-use tokens for email verification (24 h expiry) and password reset (1 h expiry); the raw token exists only in the emailed link
- `auditEvents` is append-only (durable audit trail); click counters live in `ClickCounterDO` with periodic snapshots into `clickCounterSnapshots`
- `depositSystemStatus` is tri-state (nullable integer in D1) — unknown is explicitly represented
- Reliability status per data point (`VERIFIED`/`ESTIMATED`/`STALE`/`UNAVAILABLE`)
- Structural disclaimer text stored on every `calculationRecords` row (not UI-only)

## 6. External Integrations / APIs

| Integration                            | Status                                 | Implementation                                                                                                                               |
| -------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Posti carrier rates                    | Source implemented (fixture-pinned)    | `packages/data-acquisition/src/adapters/posti-rate.source.ts`: governance-gated transport pipeline; 7-day freshness alert hook |
| Alko (Finnish retailer)                | Live — the domestic reference feed | `packages/data-acquisition/src/adapters/alko.adapter.ts`: domestic reference feed through the governance gate, golden-fixture tested |
| alks.fi (retailer, seller country DE)  | Live — second merchant feed, `GRANTED` (staging bootstrap grant 2026-09-11 under the owner's blanket-permission policy; production grant pending, `docs/ingestion-runbook.md`) | `packages/data-acquisition/src/adapters/alks.adapter.ts` + `alks.parser.ts` (change `alks-feed-and-import-vat`): WooCommerce Store API (`https://alks.fi/wp-json/wc/store/v1/products`), source type `RETAILER_API`, EUR minor units, hourly cadence from the registry row; sequential pagination (`per_page` 100, `X-WP-TotalPages` bound, page failures collected not thrown), SKU-prefix EAN validation (non-matching rows to the correction queue), ESTIMATED on unparsed ABV/volume, optional weight into the product master, image fields ignored; read-only full-catalog audit via `scripts/alks-catalog-sweep.ts` |
| Finnish Tax Administration rate tables | Seed data (v1.0-2024 … v3.0-2026) + snapshot-based rate review  | `packages/data-platform/src/seed/tax-rules.seed.ts`, `packages/core-domain/src/tax/services/alcohol-excise.math.ts`, `packages/data-acquisition/src/services/rate-review-scheduler.service.ts` — `ConfigBackedRateChangeSource` reads a configured snapshot object from R2 (the `RATE_SNAPSHOTS` binding; a file before the Cloudflare migration, design D6), computes a SHA-256 hash, and compares against the last-reviewed entry to detect rate changes; review entries require manual/legal confirmation before promoting dataset versions |

Merchant ingestion is driven by the **database-backed merchant registry** (`merchant_registry` table + `MerchantRegistryRepository`): the scheduler enqueues one job per permitted merchant with per-merchant dedupe keys (`price-ingestion-<merchantId>-<hour>`), so onboarding a merchant does not require a deploy. Ingestion is gated by `SourceGovernanceService`: a merchant must have `GRANTED` permission status before the pipeline will fetch or persist its data. New merchants default to `PENDING` (off) until compliance review.

## 7. Key Technologies

| Technology              | Role                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| TypeScript              | Primary language — all packages and apps                                                            |
| Cloudflare Workers      | Runtime — API Worker (Hono), email Worker, OpenNext frontend Worker                                  |
| Hono                    | HTTP framework of the API Worker — preserves the former NestJS contracts (design D1)                 |
| D1 (SQLite)             | Primary relational store, Drizzle `sqliteTable` schema in `packages/data-platform/src/d1/schema.ts` (design D2) |
| R2                      | Append-only observation log, rate snapshots, OpenNext ISR cache (design D4)                          |
| Durable Objects         | Rate limiting, idempotency, click counters (design D5)                                               |
| Queues / Workflows / Cron Triggers | Background processing: price ingestion queue + durable Workflow, scheduled refresh/review/aggregation/retention (design D6) |
| Cloudflare Email Service | `send_email` binding behind the email Worker (design D7)                                            |
| Drizzle ORM             | Type-safe SQL ORM — pg lineage (legacy suites) + D1 driver (design D2)                               |
| Next.js 15 + next-intl 4.14 | Frontend (App Router, `[locale]` routing, Finnish default / English secondary), deployed via OpenNext |
| Vitest 3.2 / Playwright | Test runners: unit/golden/integration/e2e and browser-level journeys                               |
| OpenTelemetry           | Trace export to Grafana Cloud via Workers' OTLP (env-configured exporter — vendor destination unchanged, design D8) |
| Workers Analytics Engine | Request counters and freshness gauges (`writeDataPoint`), queried via the GraphQL API (design D8)   |
| Workers Logs            | Structured request logging with request IDs (replaces pino-to-stdout)                                |
| wrangler                | Cloudflare CLI: environments, D1 migrations, deploys, `--dry-run` config validation in CI            |
| ESLint                  | Linting (flat config in `eslint.config.mjs`)                                                        |
| OpenCode                | Agent runtime and developer interface                                                               |
| OpenSpec                | Change/specification management                                                                     |
| CodeGraph               | Code intelligence / indexing MCP server                                                             |
| AgentMemory             | Cross-session memory MCP server                                                                     |

## 8. Deployment & Infrastructure

| Component                   | Status      | Details                                                                                                                                                                                                                                 |
| --------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare Workers          | Implemented | API Worker (Hono, `apps/api-worker`), email Worker (`apps/email-worker`, `send_email` binding), OpenNext frontend Worker (`apps/frontend`); wrangler environments `dev`/`staging`/`production` (design D9)                                |
| Deploy pipelines            | Implemented | `deploy-staging.yml` (push to master: D1 migrate → seed → deploy → health gate) and `deploy-production.yml` (manual dispatch gated by `confirm_deploy == 'yes'`: migrate → deploy — **never seeded**; production data arrives via the one-time ETL, `docs/cutover-runbook.md`) |
| D1 migrations               | Implemented | `wrangler d1 migrations` in the deploy pipeline — staging automatic, production gated — preserving migrate-before-rollout ordering (design D2); forward-only, rollback does not revert schema                                            |
| EU residency                | Implemented | D1 created with `--jurisdiction=eu`, R2 buckets `jurisdiction: "eu"` (location weur), DO locality follows the EU-placed Worker — deliberate for the legal/tax review (design D9); described in `infra/environments/*.yaml`                 |
| Metrics                     | Implemented | Workers Analytics Engine `writeDataPoint` request counters + freshness gauges, queried via the GraphQL API; dashboards re-pointed (design D8)                                                                                             |
| Email                       | Implemented | Email Worker on the `send_email` binding (`POST /internal/email/send` behind a shared-secret header) — consumers are the ops freshness alert, price-alert and tax-change alert notifications, newsletter double opt-in confirmation + per-recipient broadcast mail (one-click unsubscribe link mandatory, rejected without it), and account verification/password-reset mail; the newsletter FI + EN body templates live in the email Worker (`apps/email-worker/src/templates.ts`) and are imported by the API Worker's newsletter routes (design D7)                                                                                                                                              |
| Rollback                    | Implemented | `wrangler rollback --env production` (previous Workers Version, no DNS changes); the K8s DNS-revert lever was retired at decommission (task 6.7)                                                                                          |
| Feature flags               | Removed 2026-09-07 (owner decision) | The `FF_*` var system, its middleware, and the launch gates were deleted; every feature ships enabled. Rollback is `wrangler rollback`, not a flag flip                                                                                                    |
| Background jobs             | Implemented | Cron Triggers (5 patterns dispatched in `src/cron/router.ts` — the 30-minute aggregation tick carries four handlers: time-series aggregation, freshness alert, price-alert evaluation, and savings-snapshot materialization (change `insight-surfaces` — runs after time-series aggregation, idempotent per as-of day, per-product failure isolation, cadence constant `SAVINGS_SNAPSHOT_CADENCE`), each isolated in its own `waitUntil`), Queues (price ingestion + DLQ), and the price-ingestion Workflow with durable per-step retries (design D6). The trust-and-reach additions live beside the cron handlers without a pattern of their own: `rate-confirmation.ts` is the single seam the manual rate-version confirmation invokes, fanning out — fail-open, via `waitUntil` — the TAX_CHANGE alert evaluation (`tax-change-alert-evaluation.ts`, scoped to the confirmed versions, landed-cost deltas via `TaxChangeAttributionService`, shared intent-log + 24 h cooldown path) and the FI + EN blog-draft creation (`blog-drafts.ts`, idempotent per (slug, locale)); the newsletter notify-subscribers console action rides the HTTP path with the same write-intent-then-send discipline |
| CI                          | Implemented | `ci.yml`: build, lint, unit, golden, data-quality, compliance, e2e, composition smoke, integration, D1 suite, api-worker e2e, OpenNext build + compile check, per-worker `wrangler deploy --dry-run` validation (task 6.5)                 |

The former Docker/K8s production path (root Dockerfile, `docker-compose` app stack, Kustomize overlays in `infra/k8s/`, migrate/seed Jobs, ServiceMonitor/PrometheusRule) was **deleted at decommission** (task 6.7, after the rollback window closed per `docs/cutover-runbook.md` §6). `docker-compose.yml` remains only as the Postgres/Redis provider for the legacy pg test suites.

The promotion path is development → staging → production, with staging carrying its own tax-rule and merchant data copies. The feature-flag and launch-gate systems were removed (2026-09-07, owner decision): the previously gated features — historical price intelligence, basket optimization, the operator console, advanced features (saved scenarios, report exports, merchant freshness, declaration guidance), and the product-roadmap features `UNIT_PRICE_EUR_PER_GRAM` (€/g metric), `PRICE_ALERTS` (Hinta-Haukka watchlist + evaluation cron), `PACKING_OPTIMIZER` (packing section of the basket optimize response), `EVENT_CALCULATOR`, `TRIP_CALCULATOR`, `PRODUCER_DUPE_FINDER`, `CURATED_LISTS`, `EXCISE_WHAT_IF`, and `GROUP_ORDER_LEDGER` — are all unconditionally live. Instant rollback is `wrangler rollback --env <env>` (previous Workers Version, no DNS changes).

## 9. Security Architecture

Implemented measures:

- **Authentication (email + password credentials)**: registration, login, and a cheap identity read (`POST /api/v1/account/register`, `POST /api/v1/account/login`, `GET /api/v1/account/me`) live in the API Worker (`apps/api-worker/src/routes/`, password port in `apps/api-worker/src/auth/password.ts`). Passwords are hashed with PBKDF2-SHA256 via WebCrypto (600 000 iterations, 16-byte per-user salt, self-describing stored format, constant-time comparison) under a NIST-style policy: minimum 12 characters, maximum 128, no composition rules. The email address is the username, lowercased before uniqueness checks, with a unique SQL index on `lower(email)`. Sessions remain server-issued opaque tokens SHA-256 hashed at rest in the `sessions` table, delivered as the httpOnly `rajahinta_session` cookie; the account is derived from the token, the legacy `x-user-id` header is rejected outright, and sessions rotate via `POST /api/v1/account/session/rotate`. There are no anonymous accounts: the server-minted anonymous issuance, the placeholder-email identity, the client auto-mint bootstrap, and the self-asserted verification endpoint are all removed, and the D1 migration purged the anonymous rows.
- **Email verification and password reset**: single-use tokens are stored SHA-256-hashed in the `email_tokens` table (24 h verification expiry, 1 h reset expiry; consumption checks expiry and sets `usedAt` in the same statement, so replay loses). `verified` derives from `email_verified_at IS NOT NULL`. Verification and reset mail rides the email Worker's existing `/internal/email/send` contract (same as freshness and price-alert mail), with FI and EN bodies and links to `/account/verify?token=…` and `/account/reset?token=…`; a dispatch failure never fails a registration, and the account can request a resend. A completed reset rehashes the password and revokes all of the account's sessions. Login returns a uniform 401 for unknown email and wrong password, and reset requests always return an accepted response, sending mail only when the account exists (no enumeration). Register, login, verification, and reset events append to the durable `audit_events` trail; register, login, and reset requests sit behind the tighter `AUTH` rate-limit profile.
- **Legacy-harness divergence (deliberate)**: the credential flow is implemented once, in the API Worker. The NestJS test-harness substrate (`apps/backend` + `packages/application-api`) keeps session-validation parity for the legacy pg suites and holds no credential flow and no anonymous issuance; porting auth into the harness to "restore symmetry" is explicitly not wanted.
- **Rate limiting**: sliding-window limiter behind the rate-limit middleware on public-facing calculation endpoints, shared across all requests/instances. On Workers it is `RateLimiterDO` (exact sliding-window log, design D5) reading the trustworthy `CF-Connecting-IP`; the legacy Nest path approximates it with a Redis Lua script plus `RATE_LIMIT_TRUST_PROXY`. The guard semantics (profiles, limits, 429 + Retry-After) are identical on both.
- **Ops dashboard guard**: `OpsAccessGuard` on the ops endpoints: env-configured operator bearer token plus IP allowlist, fails closed when unconfigured.
- **Idempotency**: `IdempotencyService` ensures calculation endpoints are idempotent for identical inputs; cache keys are version-aware (request payload plus tax and transport dataset versions).
- **Age gate**: `AgeGateService` with `SimpleConfirmationProvider`: self-attestation, not identity verification (documented as such).
- **Entitlement gating**: `EntitlementGuard` enforces feature access by tier; tier resolves from `accounts.tier` (environment override is a non-production test mechanism). Current policy: every feature requires only FREE (`FEATURE_TIER_MAP` all-FREE, 2026-09-07) — the tier machinery stays as the future paywall seam.
- **Launch gate removed (2026-09-07, owner decision):** the `LaunchGateGuard` gate trio (legal opinion, tax-source mapping, correction mechanism) was deleted; calculations and price data are publicly reachable. The sign-off records under `docs/launch-*.md` remain as the historical legal-review trail.
- **Audit trail**: append-only `audit_events` table; governance actions, dataset confirmations, operator-console actions, blacklist moderation (report link/reject, publish, appeal resolve), blog publication, newsletter broadcasts, and account security events (register, login, verification, reset) are durably recorded.
- **Display-only trust surfaces**: `merchantWarnings` blocks, the accuracy statistic, and the €/g ranking are additive response fields and read-model listings that never enter a calculation or ranking input — compliance tests prove calculation and ranking output byte-identical with zero, one, and many warnings present (`tests/compliance/warnings-additive-neutrality.test.ts`) and prove accuracy/ranking data cannot reach calculation or ordering inputs (`tests/compliance/accuracy-unitprice-input-isolation.test.ts`).
- **Share snapshots carry no identity**: the snapshot assembler asserts the absence of account fields before persisting (a violation is a loud 500, nothing stored), and the public share page answers unknown and malformed identifiers with the same 404 so share links cannot double as record-id oracles.
- **Data minimization**: Schema-level enforcement — no optional fields "for later"; identity document storage deferred.
- **Neutrality enforcement**: `RankingService` structurally rejects any input with billing-related fields; no code path allows paid/manual boost.
- **Affiliate neutrality (ferry slot display-only)**: `ferryOffers` is a curated, audited operator-console-managed block returned alongside the trip-feasibility result in its own separate `ferryOffers` section — affiliate fields are absent from the calculation module's input types at source level, and a compliance test proves calculation output is byte-identical with zero, one, and many ferry-offer rows (`tests/compliance/trip-affiliate-neutrality.test.ts`).
- **Evidence-only dupes**: the producer dupe finder (`GET /api/v1/products/:id/dupes`) returns only `producerLinks` rows with complete evidence fields (producer key, manufacturer, source URL, reviewer, review date); there is deliberately no similarity scoring or flavor matching anywhere in the module — asserted at source level. Evidence links (dupes and curated lists) render as direct outbound anchors rather than through the offer-keyed redirect controller, because no offerId exists for evidence links (a generic redirect route would be api-worker scope; noted in the module docblocks).
- **What-if ephemerality**: the excise what-if simulator (`POST /api/v1/what-if/excise`) persists nothing — no scenario rows, no rule mutation; sharing works through an opaque token encoding the scenario inputs, decoded read-only. Zero persistence is compliance/integration-tested.
- **Group-order accounting-only**: the ledger computes proportional allocation and minimal transfers and nothing else — payment-instrument fields are rejected at the DTO with the offending field named, the module contains no payment-processing imports (import-position scanned), and settlement happens entirely outside the platform.

Non-negotiable constraints from the implementation plan:

- Minimal personal data: default to anonymous usage; identity/age-verification (only if legally required) is a separate, isolated subsystem.
- Tax data is versioned, never overwritten; historical calculations resolve against the effective rate version.
- No code path may allow paid/manual boost of a merchant's position (neutrality enforced in code).
- No commercial or affiliate signal may enter any calculation input (ferry offers are display-only; compliance-tested).
- No payment processing anywhere: the group-order ledger is accounting-only; users settle externally with their own methods.

Agent infrastructure constraints: credentials stay out of logs and committed files; `.env` files are write-only.

## 10. Monitoring & Observability

The production observability path is the Workers rework (design D8):

| Concern                  | Implementation                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Metrics                  | Workers Analytics Engine `writeDataPoint`: request counters, freshness gauges (stale price share, transport age), and the price-alert evaluation counters (evaluated/matched/notified/failed with a failure gauge, following the freshness-gauge pattern), queried via the Cloudflare GraphQL API; Grafana dashboards re-pointed (`apps/api-worker/src/observability/`) |
| Traces                   | Workers' OTLP export keeps **Grafana Cloud as the trace destination** — no APM vendor change; env-configured endpoint |
| Logs                     | Workers Logs with request-ID fields (replaces pino-to-stdout)                       |
| Health                   | `GET /api/v1/health/ready` verifies a D1 roundtrip plus a DO ping (dependency-aware, short timeouts); liveness stays process-only and cheap |
| Alerting                 | A Cron checker (30-min pattern, `apps/api-worker/src/cron/freshness-alert.ts`) evaluates the freshness invariants — stale price share > 10 %/25 %, transport age > 5/7 days, and an absent-signal check — and emails ops through the email Worker (design D7/D8), replacing PrometheusRule paging |
| Error tracking           | No Sentry-class service yet (unchanged gap)                                         |

Every externally sourced fact carries a reliability status and timestamp surfaced to the user.

The legacy Nest-side observability (`packages/application-api/src/observability/`: prom-client `/metrics` on `METRICS_PORT`, `KpiService`, `OpsDashboardController`, `CostAttributionService`) remains in the repository as part of the test-harness-only Nest composition root; it serves no production traffic since the cutover.

## 11. Performance & Scalability

Implemented:

- **Background jobs separate from request/response path**: Cloudflare Queues, Workflows, and Cron Triggers handle per-merchant price ingestion, transport-rate refresh, tax-dataset review, time-series aggregation, price-alert evaluation, and retention sweeps (formerly BullMQ workers); a slow scrape never blocks a user's calculation. The price-alert evaluation shares the 30-minute post-ingestion tick — it reads only the materialized summaries that tick maintains (never the raw R2 log), enforces the 24 h per-alert cooldown through a crash-safe write-before-dispatch intent log, and never runs on a request path. TAX_CHANGE alert evaluation and blog-draft creation ride the manual rate-confirmation seam the same way — fire-and-forget, individually fail-open, never blocking or failing the confirmation.
- **Basket-level transport estimation**: `BasketShippingCalculator` handles non-linear shipping thresholds for multi-item baskets.
- **Idempotent calculation endpoints**: results are reproducible and cacheable for identical inputs given the same dataset versions. Cache keys are version-aware: the request payload plus the tax and transport dataset versions are part of the key, so entries invalidate when a dataset version changes, not on a timer. The basket optimizer enforces input caps with a total-combinations guard (clean 422 when exceeded).

## 12. Development Workflow

The repository is an agentic workspace with a working application build. Commands:

| Command                     | Purpose                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docker compose up -d postgres redis` | Legacy pg-suite data stores (TimescaleDB + Redis) for golden/data-quality/compliance/integration runs; `pnpm dev:up` wraps it with migrations                                    |
| `pnpm --filter @rajahinta/api-worker dev` | API Worker on `wrangler dev` (:8787/8788 pattern; local D1/DO/R2 simulators)                                                                                      |
| `pnpm test`                 | Run all Vitest test suites (per package)                                                                                                                                  |
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
| API-layer tests            | Implemented | `packages/application-api/src/__tests__/rate-limiting.service.test.ts`, `age-gate.service.test.ts`, `idempotency.service.test.ts`                  |
| Historical-price flow tests | Implemented | `tests/integration/historical-price-flow.test.ts` — observation append → aggregation → API response with attribution, real engines + in-memory ports (`pnpm test:integration`); unit tests in `core-domain/src/history/__tests__/`, `application-api/src/jobs/__tests__/`, `data-platform/src/repositories/__tests__/` |
| Basket optimizer tests | Implemented | `packages/core-domain/src/optimizer/__tests__/basket-optimizer.service.test.ts` (search, thresholds, tie-breaking, neutrality), `packages/application-api/src/basket/__tests__/basket-optimizer.controller.test.ts`, `tests/integration/basket-optimizer-api.test.ts`, `tests/integration/basket-calculator-consistency.test.ts` (optimizer/calculator equivalence for identical inputs) |
| Advanced-features tests | Implemented | `packages/core-domain/src/reliability/__tests__/merchant-reliability-score.service.test.ts`, `packages/core-domain/src/ranking/__tests__/reliability-ranking-isolation.test.ts` (ranking accepts no score input), `packages/core-domain/src/declaration/__tests__/excise-declaration-guidance.test.ts`, `packages/application-api/src/reports/__tests__/`, `packages/application-api/src/merchants/__tests__/`, `packages/application-api/src/accounts/__tests__/account-scenarios.controller.test.ts` + `gdpr-scenario-lifecycle.test.ts`, `packages/data-platform/src/repositories/__tests__/saved-scenario-repository.test.ts`, `tests/integration/reports-api.test.ts` |
| Session integrity tests | Implemented | `packages/application-api/src/accounts/__tests__/`: token forge/guess denied, cross-account access denied, rotation invalidates the old token atomically, `x-user-id` rejected |
| Search tests | Implemented | `packages/application-api/src/search/__tests__/`: "karhu" matches, deterministic ranked order, pagination interplay, blank query passthrough |
| Compliance suite | Implemented | `tests/compliance/`: neutrality-compliance, ranking-lockstep, trip-affiliate-neutrality (byte-identical calculation output across zero/one/many `ferryOffers` rows), trip-fill-ferry-neutrality (same for the trip fill response), warnings-additive-neutrality (byte-identical detail/search/compare across zero/one/many `merchantWarnings`), accuracy-unitprice-input-isolation (accuracy statistic and €/g ranking proven not to feed ranking or calculation inputs); runs with `COMPLIANCE_ENFORCED=true` so violations fail the build |
| Roadmap-feature tests | Implemented | Unit suites per module (`packages/core-domain/src/{unitprice,packing,eventcalc,tripcalc,whatif,grouporder}/__tests__/`); D1 integration suites `tests/integration/d1/` (`price-alerts`, `packing-optimizer`, `event-calc`, `group-order` incl. payment-field named rejection, `producer-dupes` evidence completeness, `curated-lists`, `what-if` zero-persistence) |
| Data-quality suite | Implemented | Data-quality invariants over seeded data (`scripts/test-data-quality.sh`) |
| Durability tests | Implemented | `tests/integration/durability-restart.test.ts`: rate limits shared across two app instances, audit and analytics survive restart |
| Data-lifecycle tests | Implemented | `tests/integration/data-lifecycle.test.ts`: partition pruning, hypertable query parity, watermark scan |
| Browser e2e tests | Implemented | `tests/e2e-browser/` (Playwright): 8 journeys across age gate (2), calculator flow (2), compare sorting (3), account export incl. session issue (1); CI workflow boots the real stack |
| Load tests | Implemented | `tests/load/`: optimizer and calculator under the historical K8s-era resource envelope (kept as the regression reference), artillery HTTP suites (`tests/load/artillery/`) targeting the Workers staging URL via `load-tests.yml` (dispatch, `STAGING_API_URL`); results in `tests/load/basket-load-results.md` |

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
| Affiliate neutrality                | The curated `ferryOffers` slot never enters a calculation input; output is compliance-tested byte-identical regardless of ferry-offer rows        |
| Roadmap features unconditionally live | The ten product-roadmap features ship enabled; the flag system was removed (2026-09-07) — rollback is `wrangler rollback`, not a flag flip                              |
| Group order is accounting-only      | No payment fields in schema or DTOs, no payment-processing imports; settlement happens entirely outside the platform                              |
| History is immutable                | The observation log is append-only — rows are appended, never overwritten; corrections and attribution are new-row/read-time concerns             |
| Compliance layer across all layers  | Neutrality, reliability labeling, and audit at each boundary, not a separate service                                                               |

## 15. Constraints, Risks, and Technical Debt

- **Durable cross-cutting state (resolved in the technical-assessment remediation):** rate limiting is Redis-backed (sliding window, shared across replicas), audit events persist to the append-only `audit_events` table, click analytics live in Redis with PostgreSQL snapshots, sessions are durable server-issued tokens, and anonymous calculation records are pruned by the retention worker. In-memory implementations remain for tests only. **Residual:** the operator console's governance store is now durable — the D1 `source_governance` table (migration 0021, change `durable-source-governance-store`) read by the console list/grant/revoke and both ingestion gates, with mutations audited to `audit_events` (the in-memory governance repository remains for the legacy harness/tests only). The rate-review store (`packages/application-api/src/ops/confirmations/in-memory-rate-review.repository.ts`) and the correction repository (`packages/application-api/src/correction/in-memory-correction.repository.ts`) are still Phase 1 in-memory: every console action is durably audited, but those stores are restart-volatile; durable tables are a noted follow-up.
- **Credentials auth without federation:** accounts are email + password (PBKDF2-SHA256, 600 000 iterations, 16-byte salt) with emailed verification and self-service reset over single-use hashed tokens; sessions stay opaque, hashed at rest, httpOnly, and rotating. There is no OIDC provider and no breach-list screening (the latter mitigated by the 12-character minimum policy and the `AUTH` rate-limit profile). Age-gate remains self-attestation, not a verified identity check.
- **Integration suite not wired into CI:** `tests/integration/` (104 tests, incl. durability and data lifecycle) runs locally against `TEST_DATABASE_URL`. CI covers build, lint, unit, golden, data-quality, compliance, e2e, and composition smoke; the browser e2e and load suites run in their own workflows (`e2e-browser.yml`, `load-tests.yml`).
- **Anonymous calculation-record retention window:** 30 days configured; the final value is pending operator input.
- **No centralized error tracking:** tracing and metrics export exist (OTel to Grafana Cloud, prom-client `/metrics`), but no error-tracking service (Sentry-class) is integrated.
- **Billing is simulated:** Subscription billing module uses in-memory state with no payment provider. Real third-party billing integration (Stripe or equivalent) is explicitly deferred to Phase 2 — `BillingService` interface remains stable. See `docs/tasks.md` T1.56.
- **Legal review tasks incomplete** (5 external tasks marked `agent: none`): Finnish legal opinion, tax counsel validation, compliance review.
- **Classification rules subject to legislative change** (e.g., 1 September 2024 joint-liability change) require versioned, dated rule sets.
- **Deposit-return system status per product/packaging is tri-state** (`boolean | null`); null means ESTIMATED — the container-duty engine flags uncertain exemptions, never silently assumes.
- **Small-brewery relief (pienpanimoalennus) UNAVAILABLE:** The official vero.fi scheme is a progressive 10–50 % discount by annual production volume (ceiling 15 000 000 l/year, HE 106/2024). The current rule evaluator cannot express production-volume tiers, so only the general beer rate is shipped. Small-brewery treatment is documented as `UNAVAILABLE` pending Phase 2 evaluator support. See vero.fi pienpanimoalennus guidance; rationale in `docs/phase-0-1-verification-fix-plan.md` §3 C1.
- **GDPR integration tests require `TEST_DATABASE_URL`:** `packages/application-api/src/accounts/__tests__/gdpr-integration.test.ts` runs against a real PostgreSQL instance. There is no always-on Postgres harness in CI; these tests are skipped unless `TEST_DATABASE_URL` is set.
- **HTTP-level load test pending baseline:** `tests/load/artillery/` provides the HTTP suite (ramp 1→50 over 60 s, steady 50 for 120 s, p95 < 2 s, error < 1 %, zero 429s in the steady window). `load-tests.yml` runs it on manual dispatch against the deployed Workers staging URL (`STAGING_API_URL` repository variable; the in-process vitest load suites gate every PR). Residual: promote to blocking once a staging baseline exists — the G3 absolute numbers (`spikes/g3-vertical-slice.md`) are the local reference per the migration's recorded decision 5.
- **E2E suite relies on decorator-metadata transform + single-instance pin:** `vitest.config.e2e.ts` uses a custom TypeScript transpile plugin to emit `emitDecoratorMetadata` and pins `@nestjs/core` to a single physical path. Root cause: pnpm instantiates `@nestjs/core` twice (two peer-set variants), giving two `Reflector`/class identities and breaking NestJS DI. A durable fix would resolve the dependency-side duplication; the current workaround is functional but fragile.
- **Idempotency cache-key version-blindness (resolved):** `CalculatorController` now resolves active dataset versions before deriving the cache key, so the key includes the request payload plus the tax and transport dataset versions; a version bump produces a different key and a guaranteed fresh calculation. Client-supplied idempotency keys stay verbatim by contract, and the lookup-time version comparison remains as defence in depth. (The FX dataset version was removed from the key when the FX machinery was deleted — change `drop-sweden-eur-only-alko-benchmark`.)
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
> **SUPERSEDED by change `migrate-to-cloudflare`:** staging (and production) are now Cloudflare Workers deployed by wrangler pipelines — no cluster, `KUBE_CONFIG`, or GHCR image path exists. The context below is retained as the historical record of why the K8s path was deferred; it was ultimately retired rather than resumed (decommission, task 6.7).

**Context:** The deploy workflows authenticate to the cluster with a `KUBE_CONFIG` secret that was never set — the repo held no secrets at all, so every `Deploy Staging` run on `master` failed at the first `kubectl` step (the auth step `echo`-writes the secret and exits 0 even when it is empty). No staging cluster exists and no kubeconfig for one is available. The registry side works: `deploy-staging.yml` and `deploy-production.yml` push to `ghcr.io/siimliimand/rajahinta` with the workflow-scoped `GITHUB_TOKEN` (verified by a pushed image, run 32529902593).

**Decision:** Kubernetes is deferred until traffic justifies it. `deploy-staging.yml` triggers on `workflow_dispatch` only, so `master` pushes no longer run a known-red deploy. The three-tier promotion path (development → staging → production) resumes when a cluster is provisioned.

**Resume steps:**

- Provision the staging cluster; set the `KUBE_CONFIG` repo secret.
- Make `ghcr.io/siimliimand/rajahinta` public (Actions-pushed packages are private by default) or wire an `imagePullSecrets` entry — the cluster currently has no registry credentials.
- Restore the `push: master` trigger on `deploy-staging.yml` or dispatch manually.
- Run the deferred OpenSpec gates recorded in the archived `phase0-1-delivery-cleanup` change (`openspec/changes/archive/2026-08-21-phase0-1-delivery-cleanup/tasks.md`): the 1.2 staging-verification walk, the 1.3 artillery blocking promotion, and the staging half of 5.1.

## 16. Future Considerations

Per the implementation plan's delivery phases (cross-cutting durable stores, feed adapters for Alko/Posti, browser e2e, and the operator console landed in the technical-assessment remediation):

- **API customer offering** (Phase 2/3) — disclaimer must be a structural part of result objects so API consumers inherit it (basket optimizer ships structural disclaimers already)
- **OIDC/social login:** credentials authentication (register, login, verification, reset) exists in the API Worker; a federated identity provider is a possible later addition on the same session machinery
- **Durable rate-review store:** replace the operator console's remaining in-memory rate-review repository with a database table (governance is done — the durable D1 `source_governance` table; actions are already durably audited)
- **Billing integration:** real third-party billing (Stripe or equivalent) on the stable `BillingService` interface
- **Production roll-out:** done via Cloudflare — `deploy-production.yml` (manual, gated) migrates D1 and deploys the Workers; cutover sequence and decommission gate in `docs/cutover-runbook.md`
- **Potential module extraction** — Data Acquisition, then Data Platform, into separate services without redesigning domain logic
- **Merchant feeds for the further EUR markets** — with `alks.fi` (seller country DE) live as the second merchant, Estonia and the remaining markets are the deliberate deferrals; the adapter registry and the governance gate onboard a new merchant without a deploy, and the currency union is already pinned to `'EUR'`

## 17. Project Identification

| Field              | Value                                                                         |
| ------------------ | ----------------------------------------------------------------------------- |
| **Name**           | Rajahinta.fi                                                                  |
| **Language**       | TypeScript (ES2022, strict mode)                                              |
| **Type**           | Cross-border beverage price index + Finnish landed-cost intelligence platform |
| **Runtime**        | Cloudflare Workers (Hono API Worker, OpenNext frontend, email Worker); Node.js 22 for the legacy test harness |
| **Database**       | Cloudflare D1 (SQLite, Drizzle ORM) + R2 (observation log, rate snapshots); Durable Objects for request-scoped state |
| **Cache/Queue**    | Durable Objects (rate limit, idempotency, click counters); Cloudflare Queues + Workflows + Cron Triggers |
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
| Hypertable       | TimescaleDB time-partitioned table; the former home of `price_observations` (7-day chunks) — superseded by the R2 date-partitioned JSONL log (design D4); still required by the legacy pg test harness |

<!-- Last updated: 2026-09-11, merchant auto-grant registration: `POST /ops/console/merchants` (owner blanket-permission policy, 2026-09-11) upserts the merchant registry and auto-grants a merchant with no governance records (default acquisition method RETAILER_API, source URL = registered feed URL, both actions audited); explicit records survive re-registration (revocation stays the kill switch); staging `alks` bootstrap-granted under the same policy. Prior: 2026-09-10, durable-source-governance-store (task 3.1, docs): operator-console governance now backed by the durable D1 `source_governance` table (migration 0021, 38 D1 tables) — console list/grant/revoke, the hourly producer, and the ingestion workflow gate read the same store (empty table aggregates fail-closed to `PENDING`, a console grant reaches ingestion on the next hourly pass without a deploy), every mutation audited to `audit_events`, the former 503 StoreUnavailable console path removed; prior: alks-feed-and-import-vat (2026-09-09, task 6.2): second live merchant alks — WooCommerce Store API feed (`alks.adapter.ts` + `alks.parser.ts` in `FEED_ADAPTERS` beside `alko`), registry row country DE / hourly cadence / source type `RETAILER_API`, governance fail-closed (`PENDING` until an operator grant, `docs/ingestion-runbook.md`), sequential `per_page`-100 pagination bounded by `X-WP-TotalPages`, SKU-prefix EAN with correction-queue fallback, ESTIMATED on unparsed ABV/volume, optional `weight_grams` on the product master, images ignored, read-only catalog sweep script `scripts/alks-catalog-sweep.ts` (task 7.1); prior: trust-and-reach-roadmap (2026-09-08, task 9.2): seven features — core-domain modules blacklist/outcomes/content/sharing plus the allowance-fill objective in optimizer/tripcalc, seven new D1 tables (36 total: shopReports, blacklistEntries, calculationOutcomes, blogPosts, newsletterSubscribers, newsletterNotifications, shareSnapshots) and priceAlerts.kind (PRICE | TAX_CHANGE, duplicate check per product+kind), new routes (POST /api/v1/reports, POST /api/v1/calculations/:id/outcome, GET /api/v1/accuracy, POST /api/v1/calculations/:id/share, GET /api/v1/share/:publicId, GET /api/v1/blog/posts[/:slug], POST /api/v1/trip/fill, GET /api/v1/unitprice/ranking, newsletter subscribe/confirm/unsubscribe, ops moderation + blog publish + newsletter notify), rate-confirmation seam fanning out fail-open TAX_CHANGE alert evaluation and FI+EN blog drafts at the manual rate gate, calculationOutcomes excluded from the record sweep with its own 24-month cap constant (its sweep a noted follow-up), merchantWarnings/accuracy/€/g display-only with compliance tests; prior: email-password-auth (2026-09-07, task 5.2): real email + password credentials in the API Worker (register/login/me; PBKDF2-SHA256 600 000 iterations, 16-byte salt; policy min 12 / max 128 chars; the username is the lowercased, uniquely indexed email), single-use SHA-256-hashed tokens in the new `emailTokens` D1 table (24 h verify, 1 h reset; reset revokes all sessions; 29 D1 tables), accounts gains password_hash + email_verified_at with a unique lower(email) index, anonymous accounts / placeholder emails / client auto-mint bootstrap / self-asserted verify endpoint removed, verification + reset mail rides the existing email-worker contract (FI + EN), credentials auth deliberately lives only in the API Worker while the legacy NestJS harness keeps session-validation parity without it; prior: remove-feature-flags (owner decision): the FF_* feature-flag system, the percentage-rollout machinery, and the LAUNCH_GATE_* launch gates are deleted across api-worker, application-api, frontend, wrangler.jsonc and infra/environments; every previously gated feature (historical price intelligence, basket optimization, operator console, advanced features, and the nine roadmap features) is unconditionally live; entitlement stays but FEATURE_TIER_MAP is all-FREE (tier machinery kept as the future paywall seam); rollback is `wrangler rollback`; prior: drop-sweden-eur-only-alko-benchmark (2026-09-06, task 5.3): EUR-only product — the Systembolaget adapter and all Sweden-facing data are removed, the FX machinery (FX module, ECB source, fx-dataset-review cron, FX publish flow, fx tables and provenance columns) is deleted, every stored offer is EUR, the adapter registry holds Alko only, idempotency keys are payload + tax + transport versions, and a display-only Alko benchmark (`benchmark/`) enriches calculator results; prior: product-roadmap-phases-1-4 (2026-09-05, task 10.3): ten roadmap features — core-domain modules unitprice/packing/eventcalc/tripcalc/whatif/grouporder, twelve new D1 tables (30 total), price-alert-evaluation cron on the 30-min tick, affiliate-neutrality/accounting-only/evidence-only/what-if-ephemerality boundaries, explicit data-immutability statement; prior: migrate-to-cloudflare decommission (2026-08-31, task 6.7): Cloudflare Workers/D1/R2/DO/Queues/Workflows/Cron architecture, OpenNext frontend, email Worker, Grafana via OTLP, wrangler CI/CD; K8s/Docker-prod artifacts removed; prior: technical-assessment-remediation (2026-08-28, sessions, FX datasets, merchant registry, TimescaleDB hypertable, durable audit/analytics/rate limiting, Next 15/React 19/next-intl, ops console, observability); prior: Phase 2 advanced features -->
