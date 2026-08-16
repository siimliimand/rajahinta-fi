# Tech Stack

> Decision record for Rajahinta.fi technology choices.
> Decided: 2026-08-15

## 1. Stack Overview

| Layer | Technology | Version | Rationale |
|---|---|---|---|
| Backend runtime | Node.js | 22 LTS (22.x) | Long-term support, stable package ecosystem, native TypeScript support via tsx |
| Backend framework | NestJS | 11.x | Module system maps to five bounded layers, DI container enforces interface boundaries, enterprise-grade for compliance audits |
| Language | TypeScript | 5.6+ | Strong typing across stack, catch domain errors at compile time, single language reduces context switching |
| Database | PostgreSQL | 16+ | ACID compliance for tax calculations, complex query support, versioned data patterns |
| Database extension | TimescaleDB | 2.16+ | Hypertables for time-series historical rates and price data |
| ORM | Drizzle | 0.38+ | Type-safe, transparent SQL generation, no hidden N+1 queries, excellent Postgres support |
| Frontend framework | Next.js (App Router) | 14.2+ | SSR for public pages, server components for calculation results, client components for dashboards |
| Frontend styling | Tailwind CSS | 3.4+ | Utility-first, small bundle, consistent design system |
| Job queue | BullMQ | 5.x | Redis-backed, durable, supports scheduling, retries, and dead-letter queues |
| Cache / broker | Redis | 7.2+ | Job queue backend, rate-limit state, session cache |
| Package manager | pnpm | 9.x | Fast, disk-efficient, strict dependency isolation for monorepo |
| Testing | Vitest | 2.x | Fast, TypeScript-native, compatible with NestJS testing utilities |
| E2E testing | Playwright | 1.47+ | Cross-browser, API testing, visual regression |
| Observability | OpenTelemetry | JS SDK 0.55+ | Vendor-neutral instrumentation, traces-to-metrics pipeline |
| Frontend RUM | Faro Web SDK | 1.14+ | Session replay, Core Web Vitals, error tracking, correlates to backend traces |
| Feature flags | Custom service (env + DB) | — | Lightweight, synchronous resolution, LaunchDarkly-ready interface for future migration |
| CI/CD | GitHub Actions | — | Native GitHub integration, matrix testing, deploy workflows |

## 2. Backend Rationale (NestJS / Node.js / TypeScript)

### Why not Go

Go offers raw performance and simpler concurrency, but NestJS on Node.js provides:
- **Module system** that directly maps to the five bounded layers. Each NestJS module (`@Module({})`) becomes a bounded context with explicit imports and exports.
- **Dependency injection** that makes the dependency graph visible and testable. Substituting a repository implementation for testing is a one-line override.
- **Interceptor/Guard/Pipe pipeline** for cross-cutting concerns (audit logging, compliance checks, rate limiting) without tangling domain logic.
- **OpenAPI/Swagger integration** via `@nestjs/swagger` to generate API docs from decorators for compliance reviewers.
- **Single language across stack** reduces context switching and hiring friction. Domain experts writing tax rules in TypeScript, not switching to Go.

### Why NestJS over Express/Fastify solo

- Opinionated structure prevents architectural drift. Team conventions are enforced by the framework, not just PR reviews.
- `@nestjs/bull` integration provides background jobs with the same DI and module system as the web layer.
- Testing utilities (`TestingModule`) make it easy to isolate and test each module independently.
- CLS (continuation-local storage) for request-scoped context (trace ID, user ID, calculation ID) for audit trails.

### Why NestJS on Express (not Fastify adapter)

- Express ecosystem breadth. Largest middleware library, best community support for compliance-oriented integrations.
- The HTTP layer is a thin wrapper. Performance bottleneck is tax calculation logic, not request routing.
- Can migrate to Fastify adapter later by changing the platform adapter without touching module code.

## 3. Database Rationale (PostgreSQL + TimescaleDB)

### Why PostgreSQL

- **Versioned tax rules.** PostgreSQL's native support for `WITH`, window functions, and exclusion constraints makes it straightforward to implement temporal/versioned data patterns (SCD Type 2) for tax rates that must be queryable as-of any historical date.
- **Complex aggregation.** Finnish tax calculations involve multiple rate schedules, category-based excise tiers, and container-duty exemptions. SQL-level aggregation is more transparent than ORM-level.
- **Compliance reporting.** Direct SQL access for auditors. No hidden mapping layers.
- **ACID transactions.** Guarantee that a calculation record and its line items are written atomically.

### Why TimescaleDB extension

- **Time-series price/rate history.** Tax-rate changes, historical prices, and transport-rate evolution are inherently time-series.
- **Continuous aggregates.** Pre-compute daily/weekly/monthly averages for historical charts without application-level scheduling.
- **Data retention policies.** Automatically drop raw ingestion data beyond a configurable window while retaining aggregated views.

### Why Drizzle ORM (not Prisma, not raw SQL)

- **Transparent SQL.** Drizzle generates SQL that looks hand-written. No hidden JOINs or N+1 queries at runtime.
- **Type-safe queries.** Full TypeScript inference from the schema. Column types, nullable states, and relations are checked at compile time.
- **Migration control.** SQL-based migrations are plain `.sql` files. Auditors can read them without understanding an ORM DSL.
- **Lightweight.** No code generation step, no large runtime, no engine binary.

## 4. Frontend Rationale (Next.js / React / Tailwind)

### Why Next.js App Router

- **Server components** for public calculator pages. Calculation logic runs on the server, only the rendered result ships to the client. No API call latency for the primary user journey.
- **Client components** for interactive dashboards (comparison tables, historical charts) where client-side state and interactivity matter.
- **Server Actions** for form submissions (calculator inputs) without building a separate API endpoint for every interaction.
- **Route handlers** for the API layer where the NestJS backend serves the presentation layer.

### Why Tailwind CSS

- **Design-system friendly.** Utility classes map directly to a constrained set of design tokens, consistent with the planned design system in `DESIGN.md`.
- **Bundle size.** Purged CSS in production, zero runtime.
- **Rapid iteration.** No context-switching between HTML and CSS files.

## 5. Infrastructure Choices

| Component | Choice | Why |
|---|---|---|
| Job queue | BullMQ on Redis | Durable, supports delayed/recurring jobs, monitoring UI available |
| Feature flags | Custom service | Synchronous resolution (no network call on request path). Interface designed so LaunchDarkly can replace the DB-backed implementation without changing flag consumers |
| Package manager | pnpm | Strict dependency isolation prevents accidental cross-layer imports. Monorepo-ready for the five-layer structure |
| CI/CD | GitHub Actions | No additional SaaS. Matrix testing across Node 22, Postgres 16, Redis 7 |
| Container | Docker | Each environment (dev/staging/prod) runs the same container image. Distroless base for production |

## 6. Version Constraints Summary

| Dependency | Min version | Max version | Notes |
|---|---|---|---|
| Node.js | 22.0.0 | <23.0.0 | LTS only (22.x). Not 20.x or 21.x |
| TypeScript | 5.6 | — | Track latest stable |
| PostgreSQL | 16.0 | — | Use native psql 16+ |
| TimescaleDB | 2.16.0 | — | Matches PG16 support |
| Redis | 7.2 | — | For BullMQ + caching |
| NestJS | 11.0 | — | Track latest major |
| Next.js | 14.2 | — | Track latest stable |
| React | 18.3 | — | Match Next.js 14.x peer dep |
| pnpm | 9.0 | — | Package manager |
| Docker | 24.0 | — | Container runtime |

## 7. Layer-to-Framework Mapping

```
src/
├── data-acquisition/     → NestJS module: scraper/ingestion jobs
│                           - BullMQ consumers (price ingestion, transport refresh)
│                           - HTTP clients for external APIs
│
├── core-domain/          → Pure TypeScript (no NestJS dependency)
│                           - Tax engine, classification rules, transport estimator
│                           - Independently testable, framework-agnostic
│                           - Single abstract interface that NestJS modules import
│
├── data-platform/        → NestJS module: database layer
│                           - Drizzle schema definitions
│                           - Repository classes (injectable into other modules)
│                           - Migration scripts
│
├── application-api/      → NestJS module: REST controllers
│                           - Calculation endpoint, search, comparison
│                           - Guards (auth), Interceptors (audit), Pipes (validation)
│                           - Swagger/OpenAPI decorators
│
└── presentation/         → Next.js App Router
                            - Server components for public pages
                            - Client components for dashboards
                            - API route handlers proxy to NestJS (or direct in monolith)
```

## 8. Future Migrations (Noted, Not Acted On)

- **Fastify adapter swap.** If throughput becomes a bottleneck, change NestJS platform from Express to Fastify. Module code unchanged.
- **LaunchDarkly migration.** The flag service implements an interface. Swap implementation to LaunchDarkly SDK when segmentation needs grow beyond env-based toggles.
- **Module extraction.** Any NestJS module can become a standalone microservice by wrapping it in its own NestJS application. The module's public interface (exports from `@Module({})`) is the service boundary.
- **Astro or other frontend.** Next.js is the default, but if the public-facing calculator pages grow into a content-heavy site, Astro could serve static pages while Next.js handles the dashboard. Both consume the same API.