# Tech Stack

> Decision record for Rajahinta.fi technology choices.
> Decided: 2026-08-15
> **Amended 2026-08-31 (change `migrate-to-cloudflare`, task 6.7):** the
> deployment/DB/queue rows below now reflect the Cloudflare Workers stack.
> The original NestJS/Postgres/Redis rationale (§2–§4) is kept as the
> historical decision record; those components remain only as the legacy
> test-harness path.

## 1. Stack Overview

| Layer | Technology | Version | Rationale |
|---|---|---|---|
| Runtime | Cloudflare Workers | — | Request-scoped edge runtime for API, email, and frontend (OpenNext); no long-running servers to operate |
| API framework | Hono | 4.x | Lightweight Worker-native router; preserves the former NestJS API contracts (zod DTOs, guards, error envelope) |
| Language | TypeScript | 5.6+ | Strong typing across stack, catch domain errors at compile time, single language reduces context switching |
| Database | Cloudflare D1 (SQLite) | — | Serverless SQL at the edge; Drizzle `sqliteTable` schema, forward-only migrations, EU jurisdiction |
| Object storage | Cloudflare R2 | — | Append-only price-observation log (JSONL by date), rate snapshots, OpenNext ISR cache; EU jurisdiction |
| Request-scoped state | Durable Objects | — | Strongly consistent rate limiting, idempotency, click counters (SQLite-backed storage + alarms) |
| ORM | Drizzle | 0.38+ | Type-safe, transparent SQL generation, no hidden N+1 queries; pg driver (legacy suites) + D1 driver |
| Frontend framework | Next.js (App Router) | 15.5 | SSR for public pages, server components for calculation results, client components for dashboards; deployed as a Worker via OpenNext |
| Frontend styling | Tailwind CSS | 3.4+ | Utility-first, small bundle, consistent design system |
| Job queue | Cloudflare Queues + Workflows | — | Durable queue with DLQ + per-step-retry Workflow for ingestion; Cron Triggers for schedules |
| Background schedules | Cron Triggers | — | 7 UTC patterns dispatched in one Worker (ingestion, refresh, reviews, aggregation, retention, freshness alert) |
| Email | Cloudflare Email Service (`send_email`) | — | Dedicated email Worker is the only sender; SPF/DKIM via domain verification |
| Package manager | pnpm | 9.x | Fast, disk-efficient, strict dependency isolation for monorepo |
| Testing | Vitest | 3.x | Fast, TypeScript-native; D1 suites run on the node:sqlite harness |
| E2E testing | Playwright | 1.62+ | Browser journeys against the Workers stack (local wrangler dev or staging) |
| Observability | OpenTelemetry (OTLP) + Workers Analytics Engine | — | Traces to Grafana Cloud (destination unchanged); request/freshness metrics via `writeDataPoint` |
| Frontend RUM | Faro Web SDK | 1.14+ | Session replay, Core Web Vitals, error tracking, correlates to backend traces |
| Feature flags | Custom service (wrangler vars) | — | Synchronous resolution from `FF_*` environment vars; LaunchDarkly-ready interface |
| CI/CD | GitHub Actions + wrangler | — | Wrangler deploy pipelines, `--dry-run` config validation, D1 migrate → seed → deploy gating |

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
| Hosting | Cloudflare Workers | No servers or containers to operate; environments via wrangler (`dev`/`staging`/`production`), rollback via `wrangler rollback` |
| Job queue | Cloudflare Queues + Workflows | Durable delivery with DLQ; per-step retries for the ingestion pipeline; Cron Triggers for schedules |
| Data residency | EU jurisdiction (D1/R2) | Deliberate placement for the legal/tax review; set at resource creation |
| Feature flags | Custom service | Synchronous resolution (no network call on request path). Interface designed so LaunchDarkly can replace the implementation without changing flag consumers |
| Package manager | pnpm | Strict dependency isolation prevents accidental cross-layer imports. Monorepo-ready for the five-layer structure |
| CI/CD | GitHub Actions + wrangler | No additional SaaS. `wrangler deploy --dry-run` validates every Worker config on PRs; deploys gated per environment |
| Containers | none (retired) | The Docker/K8s production path was decommissioned (task 6.7); `docker-compose.yml` remains only to serve Postgres/Redis to the legacy pg test suites |

## 6. Version Constraints Summary

| Dependency | Min version | Max version | Notes |
|---|---|---|---|
| Node.js | 22.0.0 | <23.0.0 | LTS only (22.x) — local tooling and the legacy test harness |
| TypeScript | 5.6 | — | Track latest stable |
| PostgreSQL | 16.0 | — | Legacy test harness only (docker-compose pg suites) |
| TimescaleDB | 2.16.0 | — | Legacy test harness only |
| Redis | 7.2 | — | Legacy test harness only |
| Next.js | 15.5 | — | Track latest stable (OpenNext Worker output) |
| React | 19.2 | — | Match Next.js 15.x |
| pnpm | 9.0 | — | Package manager |
| wrangler | latest | — | Cloudflare CLI; keep current for D1/Workers feature support |

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