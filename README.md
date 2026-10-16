# Rajahinta.fi

Rajahinta.fi is a Finnish cross-border beverage price index and landed-cost intelligence platform, EUR-only by design. It estimates shipping to Finland, adds Finnish alcohol excise duty and beverage-container duty, and shows the total estimated cost of importing a product bought abroad; every calculation can be compared against the Alko domestic reference price as a display-only benchmark. Prices come from five live feeds — the Alko domestic reference assortment and four retailer catalogs on the WooCommerce Store API (`alks`, `longero`, `kippis`, `mydrink`; each seller's market comes from its merchant registry row) — ingested through a per-merchant permission gate (retailer feeds for the further EUR markets are a future direction). Every number carries a reliability status, every result carries a structural disclaimer, and no merchant can pay for position.

Beyond the calculator, the platform maintains sourced intelligence surfaces: deterministic cross-border savings listings, price-history series, €/g ethanol unit prices, an excursion and trip calculator, a hypothetical excise what-if simulator, and a sourced tax-change calendar (`/veromuutokset`, en `/tax-changes`) that shows when alcohol prices change over the year — confirmed changes with exact dates and official sources, annual rhythms labeled as rhythm, never as forecasts.

The service is a calculator, not a shop: there is no checkout, no payment collection for alcohol, and no order management. The only commercial transaction the architecture allows is a software subscription.

## Runtime architecture

Everything runs on **Cloudflare Workers** (cut over from the original NestJS/Postgres/Redis/Kubernetes stack on 2026-08-31 — see `docs/cutover-runbook.md`):

| Piece | Technology |
|---|---|
| Frontend | Next.js 15 (App Router, React 19, next-intl, Finnish default) via OpenNext → Worker |
| API | Hono Worker (`apps/api-worker`) preserving the original `/api/v1` contracts, zod DTOs, age gate, rate limiting, unified error envelope |
| Email | Dedicated Worker on the `send_email` binding |
| Data | Cloudflare D1 (SQLite, Drizzle ORM, committed migrations), R2 (observation log, rate snapshots), Durable Objects (rate limiting, idempotency, click counting) |
| Scheduling | Cron triggers + Cloudflare Queues/Workflows (per-merchant ingestion, aggregation, alert sweeps, tax-dataset review) |
| Observability | OTLP traces to Grafana Cloud, Analytics Engine metrics, provisioning YAML in `infra/grafana` |

The NestJS composition root (`apps/backend`) and the PostgreSQL/Redis path remain in the repository only as test-harness substrate for the legacy suites — they serve no traffic.

## What a calculation contains

A landed-cost estimate for one product line:

- Foreign retail price (best current offer, chosen by lowest price)
- Transport cost (carrier rate bracket for the route and weight)
- Finnish alcohol excise duty (category and ABV banded, from versioned official rates)
- Finnish beverage-container duty (per litre, with an exemption when the packaging participates in the Finnish deposit-return system)
- A total, a confidence level (HIGH / MEDIUM / LOW), and a per-component reliability status

Each component is traceable to the exact input values, rate-dataset version, and timestamp that produced it. The disclaimer "estimated total cost in Finland, not final legal tax liability" is part of every result object the API returns, not only a UI string.

Reliability vocabulary used everywhere (prices, transport, classifications):

| Status | Meaning |
|---|---|
| VERIFIED | Confirmed against an authoritative source |
| ESTIMATED | Derived from incomplete or indirect data |
| STALE | Was verified/estimated but exceeded its freshness threshold |
| UNAVAILABLE | No data exists |

Staleness thresholds: prices 48 h, transport rates 7 days, classifications 30 days.

## Repository layout

pnpm workspace monorepo:

```
apps/
  api-worker/         Hono API Worker — routes, Durable Objects, cron handlers,
                      ingestion workflow, observability (the production API)
  email-worker/       Email sending Worker (send_email binding, MIME builder)
  frontend/           Next.js 15 App Router UI → OpenNext Cloudflare Worker
  backend/            LEGACY NestJS composition root — test-harness only
packages/
  core-domain/        Tax engines, calculator, ranking, reliability, optimizer,
                      classification, history, calendar facts, what-if, audit,
                      entitlement, declaration, content drafts
  data-acquisition/   Feed adapters (Alko domestic reference; alks, longero,
                      kippis, mydrink Store API; sitemap crawls), ingestion
                      pipeline, source governance, rate-review, content lint
  data-platform/      Drizzle ORM schema (D1), committed migrations, D1
                      repositories, idempotent seeds with verification gates
  application-api/    Legacy NestJS API layer — test-harness only
infra/
  environments/       Per-environment configuration notes (D1, workers, vars)
  grafana/            Observability provisioning (alerts, dashboards)
  staging-data/       Staging seed SQL
tests/
  golden/             Pre-calculated expected results per product category
  integration/        Real-stack suites, incl. fresh-D1 migration tests
  compliance/         Neutrality, ranking lockstep, display-only isolation
  load/               Vitest concurrency benchmark + Artillery profiles
  e2e-browser/        Playwright journeys against a running stack
scripts/              seed-d1, dev-up.sh (legacy harness), test wrappers
```

## Toolchain

| Layer | Technology |
|---|---|
| Runtime | Node.js 24 (`.nvmrc`; the D1 test harness needs ≥ 24 for FTS5), pnpm 9, TypeScript 5.6 |
| API Worker | Hono on `workerd`, zod DTOs, WebCrypto |
| Frontend | Next.js 15 (App Router), React 19, Tailwind CSS, next-intl |
| Database | Cloudflare D1 (SQLite) via Drizzle ORM (committed migrations) |
| Async | Cron triggers, Cloudflare Queues/Workflows, Durable Objects |
| Tests | Vitest 3, Testing Library, Playwright, Artillery 2 |
| CI/CD | GitHub Actions → `wrangler deploy` (staging on master push; production gated `workflow_dispatch`) |

The legacy stack (NestJS 11, PostgreSQL 16 + TimescaleDB, Redis 7, BullMQ, Docker Compose) exists only to run the historical pg/golden/compliance suites locally (`docker-compose.yml`, `scripts/dev-up.sh`).

## Local development

Prerequisites: Node 24 (nvm), pnpm 9.

```bash
pnpm install
pnpm --filter @rajahinta/api-worker run db:migrate:d1:local
pnpm --filter @rajahinta/api-worker run db:seed:d1:local
pnpm dev        # parallel dev servers: API Worker on :8787 (wrangler dev),
                # frontend on :3001 (next dev) — see each package's scripts
```

`NEXT_PUBLIC_API_URL` defaults the frontend to the local API; point it at the Worker port for a coupled run. The frontend and API enforce the age gate ("Yes, I am 18+"); unconfirmed API clients get the `AGE_GATE_REQUIRED` envelope.

Useful commands:

| Command | What it does |
|---|---|
| `pnpm build` | Build all packages and apps |
| `pnpm lint` / `pnpm lint:content` | ESLint / content-policy lint (forbidden marketing phrases, translation coverage) |
| `pnpm typecheck` | `tsc --noEmit` everywhere |
| `pnpm test` | Unit tests in every package |
| `pnpm test:d1` | Fresh-D1 suites (applies every committed migration to a local SQLite DB) |
| `pnpm test:golden` | Golden dataset regression against pre-calculated totals |
| `pnpm test:data-quality` | Schema conformance and freshness invariants |
| `pnpm test:compliance` | Neutrality, ranking lockstep, display-only isolation |
| `pnpm test:e2e` / `pnpm test:e2e-browser` | HTTP-level suite / Playwright journeys |
| `pnpm test:load` + `pnpm load:http` | Concurrency benchmark + Artillery profiles |
| `bash scripts/dev-up.sh` | LEGACY harness: Postgres + Redis in Docker, NestJS backend :3000, frontend :3001 (pg/golden/compliance suites) |

## Environment and configuration

Worker configuration lives in `apps/api-worker/wrangler.jsonc` (dev/staging/production environments, bindings, cron triggers) and `infra/environments/*.yaml` documents each environment. Repository variables used by CI: `STAGING_API_URL`, `PRODUCTION_API_URL`. GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (values never committed). The launch-gate and feature-flag systems were removed (2026-09-07, owner decision): every feature is unconditionally live, in development and production alike.

## Scheduled and gated work

| Trigger | Work |
|---|---|
| Hourly cron | Producer enqueue gate compares per-merchant cadence buckets and fetches permitted feeds (registry-driven; unknown merchants default to PENDING and are skipped), mapping, upserts, data-quality checks, price observations on changed offers |
| Every 30 min | Time-series aggregation (watermark cursor) and price-alert evaluation (PRICE/LANDED_COST/CATEGORY threshold kinds; TAX_CHANGE rides rate-version events; 24-hour delivered-row cooldown via the notification intent log) |
| Daily 02:00 Europe/Helsinki | Tax-dataset review: detects newly published official rates and creates manual-review tasks — rates are never auto-published |
| Monthly | Curated carrier-rate refresh (skip when the dataset date is unchanged) |
| Cron sweeps | Account and calculation-record retention |
| At manual rate-version confirmation | TAX_CHANGE alert evaluation across the confirmed versions (fail-open) + FI/EN rate-change blog drafts (fail-open, idempotent); publication is always a human operator action |

## API surface

All routes are versioned under `/api/v1`. Guards vary per route (age gate, rate limiting, session auth, ops bearer realm); exceeding a rate limit returns 429 with `Retry-After`. Highlights:

| Route | Method | Purpose |
|---|---|---|
| `/health/ready` | GET | Readiness: D1 roundtrip + DO ping (deploy health gate) |
| `/products` | GET | Catalog and free-text search (ranked `q`, category filter, server-side sort; savings embeds on covered rows) |
| `/products/:id` | GET | Product detail with offers, merchant warnings, evidence-backed dupe panel |
| `/products/:id/price-history` | GET | 30/90/365-day price and landed-cost series |
| `/calculator` | POST | Single-product landed-cost calculation (idempotency-key aware) |
| `/calculator/result/:recordId` | GET | Fetch a persisted result |
| `/basket/optimize` | POST | Multi-store basket optimization |
| `/trip/fill`, `/event-calc` | POST | Allowance-fill planner; excursion calculator |
| `/what-if/excise` | POST | Hypothetical excise substitution — pure, zero persistence, structural disclaimer |
| `/unitprice/ranking` | GET | Public per-category €/g ranking — deterministic, reliability per row |
| `/savings/top`, `/savings/overview`, `/savings/best-per-merchant` | GET | Cross-border savings surfaces (negative-gap-only eligibility, as-of + coverage, deterministic order) |
| `/allowances` | GET | Traveller-allowance explorer (versioned datasets, verbatim citations) |
| `/calendar/events`, `/calendar/next` | GET | Tax-change calendar: sourced year listing and the next upcoming event (CONFIRMED dates vs EXPECTED annual-rhythm windows; age-gated) |
| `/blog/posts[/:slug]`, `/guides[/:slug]` | GET | PUBLISHED posts only, per locale |
| `/accuracy`, `/accuracy/margins` | GET | User-reported accuracy statistic + per-cell breakdowns |
| `/ranking/methodology` | GET | Ranking methodology |
| `/calculations/:id/outcome`, `/calculations/:id/share`, `/share/:publicId` | POST/GET | Outcome reporting (60-day window), frozen share snapshots |
| `/reports`, `/reports/:recordId` | POST/GET | Merchant reports + JSON/CSV/HTML export |
| `/corrections` | POST | Flag a calculation or data point for correction |
| `/contact` | POST | Owner-read contact form (honeypot, rate-limited) |
| `/newsletter/subscribe|confirm|unsubscribe` | POST/GET | Double opt-in newsletter |
| `/account/*` | GET/POST/PUT/DELETE | Credentials auth (email = username), session rotate/logout, alerts (PRICE/TAX_CHANGE/LANDED_COST/CATEGORY), favorites, onboarding preferences, GDPR export |
| `/merchants/reliability` | GET | Per-merchant reliability scores |
| `/analytics/click`, `/outbound/:offerId` | POST/GET | Click counting and merchant-link redirect (no affiliate fields) |
| `/declaration/:recordId` | GET | Excise declaration guidance (read-only) |
| `/ops/console/*` | GET/POST/PATCH | Operator console (bearer realm, fail-closed): governance grants, dataset confirmations, correction queue, match review, blog/guide publication, newsletter broadcast, **calendar-events maintenance** — every action audited |

## Domain invariants

These rules are enforced in code and verified by the compliance test suite:

- Ranking neutrality. `NeutralSortInput` is the only sorting input type, it has no commercial fields, a runtime guard rejects unknown properties, and a compile-time assertion proves a `paidBoost` field cannot be assigned. Billing is structurally isolated from ranking and an import-analysis test keeps it that way.
- Versioned tax rules. Rate rows have effective-from/to windows and are appended, never overwritten; the (taxType, productCategory) timeline is validated gap- and overlap-free. Historical dates resolve against the rate version effective on that date.
- Manual rate publication. The daily review job detects new official rates but only creates a review task; a human confirms before a version goes live — and the confirmation fans out the calendar year's rate-change record, TAX_CHANGE alert evaluation, and FI/EN blog drafts.
- Structural disclaimers. The Finnish disclaimer is stored on every calculation record, and hypothetical (what-if) plus expected-calendar-rhythm surfaces carry their own versioned disclaimer constants — forecast language is structurally excluded.
- Background work off the request path. Ingestion, aggregation, reviews, and notification sweeps run on crons/queues.
- Minimal personal data. Accounts are email + password registrations (the email address is the username; it is collected for sign-in, verification, and alert mail); GDPR export and retention jobs exist.
- Credentials auth, deliberately. Registration, login, email verification, and password reset run with self-hosted credentials; there is no OIDC/social login provider, and the age gate remains documented self-attestation.

## Testing and CI

CI gates every PR and push to master through: lint, content policy, build, unit tests, worker checks + wrangler config validation, D1 suite (fresh-DB migrations), golden dataset, data quality, compliance, integration, composition smoke, HTTP e2e, Playwright browser journeys, and the calculator load benchmark (p95 assertion). A separate gated workflow deploys staging; production deploy is a manual `workflow_dispatch` with a confirmation gate.

Local equivalents are the `pnpm test:*` scripts above. D1 suites and the Playwright browser journeys need Node ≥ 24 (`.nvmrc`).

## Deployment

GitHub Actions deploy to Cloudflare: pushes to master run the staging pipeline (D1 migrations → seed with verification gates → API/email Worker deploys → frontend OpenNext build → frontend deploy → readiness health gate). The frontend build deliberately runs after the Worker deploys so build-time prerender fetches hit the NEW API. Production is a separate gated `workflow_dispatch`. Grafana Cloud receives OTLP traces and Analytics Engine metrics; provisioning YAML lives in `infra/grafana`.

## Further documentation

- `ARCHITECTURE.md` for the full component, data-flow, and decision record
- `DESIGN.md` for the UI design system
- `docs/USER-GUIDE.md` for how to use the website
- `docs/cutover-runbook.md` for the Cloudflare cutover, `docs/ingestion-runbook.md` for feed operations
- `docs/TECHNICAL-ASSESSMENT.md` for known gaps and recommended work
