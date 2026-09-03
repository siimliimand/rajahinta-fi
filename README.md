# Rajahinta.fi

Rajahinta.fi is a Finnish cross-border beverage price index and landed-cost calculator. It compares alcohol prices at foreign retailers (currently Systembolaget in Sweden, with Alko planned), estimates shipping to Finland, adds Finnish alcohol excise duty and beverage-container duty, and shows the total estimated cost of importing a product. Every number carries a reliability status, every result carries a structural disclaimer, and no merchant can pay for position.

The service is a calculator, not a shop: there is no checkout, no payment collection for alcohol, and no order management. The only commercial transaction the architecture allows is a software subscription.

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

Staleness thresholds: prices 24 h, transport rates 7 days, classifications 30 days.

## Repository layout

pnpm workspace monorepo, five layers matching the planned architecture:

```
apps/
  backend/            NestJS host, composition root (port adapters, DI wiring)
  frontend/           Next.js 14 App Router UI (React 18, Tailwind CSS 3)
packages/
  core-domain/        Tax engines, calculator, ranking, reliability, optimizer,
                      classification, history, audit, entitlement, declaration
  data-acquisition/   Feed adapters (Systembolaget), ingestion pipeline,
                      source governance, rate-review scheduler, content lint
  data-platform/      Drizzle ORM schema, PostgreSQL repositories, migrations,
                      seed data
  application-api/    REST controllers, guards (age gate, rate limit, feature
                      flags, entitlement, launch gates), BullMQ jobs,
                      idempotency cache, analytics, reports, accounts
infra/
  k8s/                Kustomize manifests (base + staging/production overlays)
  environments/       Per-environment configuration notes
  staging-data/       Staging seed SQL
  jobs/               Job-runner Docker compose stack for development
tests/
  golden/             Pre-calculated expected results per product category
  integration/        Real-stack tests through Drizzle + PostgreSQL
  compliance/         Neutrality and ranking lockstep enforcement
  load/               Vitest concurrency benchmark + Artillery profiles
scripts/              dev-up.sh, seed export, test-suite wrappers
```

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22, pnpm 9, TypeScript 5.6 |
| Backend | NestJS 11, Express, Swagger (OpenAPI) at `/api/docs` |
| Frontend | Next.js 14 (App Router), React 18, Tailwind CSS 3 |
| Database | PostgreSQL 16 via Drizzle ORM (8 migrations) |
| Cache / queues | Redis 7, BullMQ (price ingestion, transport refresh, tax review, aggregation) |
| Tests | Vitest 2, Supertest, Testing Library, Artillery 2 |
| CI/CD | GitHub Actions, GHCR image, Docker multi-stage build |
| Orchestration | Kubernetes + Kustomize manifests (deployment deferred, see below) |

## Quick start

Prerequisites: Node 22, pnpm 9, Docker.

```bash
pnpm install
bash scripts/dev-up.sh
```

The script starts PostgreSQL and Redis in Docker, applies Drizzle migrations, seeds demo data (idempotent), builds the workspace packages, and boots both apps:

| Service | URL |
|---|---|
| Frontend | http://localhost:3001 |
| Backend API | http://localhost:3000 |
| Swagger docs | http://localhost:3000/api/docs |
| Health | http://localhost:3000/api/v1/health |
| PostgreSQL | localhost:5432, user/password/database `rajahinta` |

Confirm the age gate ("Yes, I am 18+") in the browser; the backend rejects API calls without the age-confirmation header or cookie. Stop everything with `bash scripts/dev-up.sh --down`.

Notes:

- `dev-up.sh` sets `LAUNCH_GATES_OVERRIDE=true` so the calculator works in development. In production all three launch gates default to closed (legal opinion, tax source mapping, correction mechanism).
- If ports 3000/3001 are busy the script falls back to 3100/3101.
- `SKIP_BUILD=1 bash scripts/dev-up.sh` skips rebuilding packages during iteration.

### Manual start

```bash
docker compose up -d postgres redis
DATABASE_URL=postgresql://rajahinta:rajahinta@localhost:5432/rajahinta \
  pnpm --filter @rajahinta/data-platform exec drizzle-kit migrate
(cd apps/frontend && DATABASE_URL=postgresql://rajahinta:rajahinta@localhost:5432/rajahinta \
  pnpm exec tsx --tsconfig ../../packages/data-platform/tsconfig.json \
  ../../packages/data-platform/src/seed/seed-runner.ts)
pnpm build
DATABASE_URL=... REDIS_HOST=localhost LAUNCH_GATES_OVERRIDE=true \
  pnpm --filter @rajahinta/backend dev        # :3000
NEXT_PUBLIC_API_URL=http://localhost:3000 \
  pnpm --filter @rajahinta/frontend dev       # :3001
```

### Production image

```bash
docker compose up --build     # builds the multi-stage image, boots app + Postgres + Redis
```

The Dockerfile builds backend and all workspace packages into a single Node 22 Alpine image running as a non-root user, with a container health check against `/api/v1/health`.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string; the app fails fast without it |
| `PORT` | no | Backend port (default 3000) |
| `CORS_ORIGIN` | no | Allowed origin (default `http://localhost:3001`) |
| `REDIS_URL` / `REDIS_HOST` + `REDIS_PORT` | no | Redis for idempotency cache and BullMQ. When unset, in-memory fallbacks are used and background jobs do not run |
| `NEXT_PUBLIC_API_URL` | no (frontend) | API base URL baked at build time (default `http://localhost:3000`) |
| `LAUNCH_GATES_OVERRIDE` | no | `true` forces all launch gates open. Development only |
| `LAUNCH_GATE_LEGAL_OPINION` | no | Individual launch gate confirmations; all three must be `true` before calculation and price data go public |
| `LAUNCH_GATE_TAX_SOURCE_MAPPING` | no | see above |
| `LAUNCH_GATE_CORRECTION_MECHANISM` | no | see above |
| `FF_<FLAG>` | no | Feature flags: `true`/`1` enables, a number sets rollout percentage |
| `FF_ROLLOUT_<FLAG>` | no | Explicit rollout percentage override |
| `ENTITLEMENT_DEFAULT_TIER` | no | Tier for authenticated users (default PREMIUM) |
| `ENTITLEMENT_TIER_<USERID>` | no | Per-user tier override |

Feature flags (all default off): `NEW_MERCHANT_SOURCE`, `NEW_TAX_RULESET`, `UI_RANKING_V2`, `HISTORICAL_PRICE_INTELLIGENCE` (price history charts), `BASKET_OPTIMIZATION` (multi-store optimizer), `ADVANCED_FEATURES` (scenarios, report export, reliability scores, declaration guidance).

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Parallel dev servers for all packages |
| `pnpm build` | Build all packages and apps |
| `pnpm lint` | ESLint across the monorepo |
| `pnpm lint:content` | Content-policy lint (forbidden marketing phrases, translation coverage) |
| `pnpm typecheck` | `tsc --noEmit` everywhere |
| `pnpm test` | Unit tests in every package |
| `pnpm test:golden` | Golden dataset regression (seeds Postgres, compares pre-calculated totals) |
| `pnpm test:integration` | Real Drizzle + Postgres flows |
| `pnpm test:data-quality` | Schema conformance and freshness invariants on seeded data |
| `pnpm test:compliance` | Neutrality, ranking lockstep, audit-trail compliance |
| `pnpm test:e2e` | HTTP-level tests against an in-memory backend |
| `pnpm test:load` | Concurrency benchmark (p95 assertion) |
| `pnpm load:http` | Artillery load profiles |
| `pnpm dev:up` | `scripts/dev-up.sh` |
| `pnpm format` | Prettier |

## Background jobs

Jobs run in BullMQ queues, off the request path, scheduled by cron:

| Queue | Schedule | Work |
|---|---|---|
| price-ingestion | hourly | Fetch permitted merchant feeds, map, upsert, run data-quality checks, record price observations on changed offers |
| transport-refresh | every 6 h | Carrier rate refresh (adapter currently a documented no-op) |
| tax-dataset-review | daily 02:00 Europe/Helsinki | Detect newly published official rates and create manual-review tasks. Rates are never auto-published |
| time-series-aggregation | every 30 min | Materialize daily/weekly price-history summaries from observations using a persisted watermark cursor |
| account-retention | cron | GDPR retention sweeps for accounts |

Retry policy per queue is configured in `packages/application-api/src/jobs/job-registry.ts` (exponential backoff, 2 to 5 attempts).

A merchant feed is only ingested when source governance has a GRANTED permission record for it; unknown merchants default to PENDING and are skipped.

## API surface

All routes are versioned under `/api/v1` and documented in Swagger. Guards vary per route (age gate, rate limit, feature flag, entitlement):

| Route | Method | Purpose |
|---|---|---|
| `/health` | GET | Liveness (used by Docker and Kubernetes probes) |
| `/products` | GET | Product search and ID lookup (free-text query is a Phase 2 placeholder) |
| `/products/:id` | GET | Product detail with retail offers |
| `/products/:id/price-history` | GET | Daily/weekly price and landed-cost series (feature-flagged) |
| `/calculator` | POST | Single-product landed-cost calculation (idempotency-key aware) |
| `/calculator/result/:recordId` | GET | Fetch a persisted result |
| `/basket/optimize` | POST | Multi-store basket optimization (feature-flagged) |
| `/calculations/excise`, `/calculations/landed-cost` | POST | Legacy calculation endpoints (see technical assessment) |
| `/declaration/:recordId` | GET | Excise declaration guidance |
| `/reports/:recordId` | GET | JSON/CSV/HTML report export (PREMIUM tier) |
| `/corrections` | POST | Flag a calculation or data point for correction |
| `/account/*` | GET/POST/DELETE | Anonymous-session history, baskets, scenarios, GDPR export |
| `/merchants/reliability` | GET | Per-merchant reliability scores |
| `/analytics/click`, `/outbound/:offerId` | POST/GET | Click counting and merchant-link redirect (no affiliate fields allowed) |
| `/ranking/methodology` | GET | Public ranking methodology |
| `/feature-flags` | GET | Public flag states for UI gating |
| `/ops/health` | GET | Ops dashboard snapshot |

Rate limit profiles (per IP): default 60/min, calculator 10/min, basket 10/min, search 30/min, declaration 20/min, historical 30/min. Exceeding a limit returns 429 with `Retry-After`.

## Domain invariants

These rules are enforced in code and verified by the compliance test suite:

- Ranking neutrality. `NeutralSortInput` is the only sorting input type, it has no commercial fields, a runtime guard rejects unknown properties, and a compile-time assertion proves a `paidBoost` field cannot be assigned. Billing is structurally isolated from ranking and an import-analysis test keeps it that way.
- Versioned tax rules. Rate rows have effective-from/to windows and are appended, never overwritten. Historical dates resolve against the rate version effective on that date.
- Manual rate publication. The daily review job detects new official rates but only creates a review task; a human confirms before a version goes live.
- Structural disclaimer. The Finnish disclaimer is stored on every calculation record, not only rendered in the UI.
- Background work off the request path. Ingestion, aggregation, and reviews run in queues.
- Minimal personal data. Accounts are anonymous sessions (UUID cookie) with no email collection in the current UI; GDPR export and retention jobs exist.

## Testing and CI

CI (`.github/workflows/ci.yml`) gates every PR and push to master through: lint, content policy, build, unit, golden dataset, data quality, compliance, e2e, composition smoke (boots the real AppModule with in-memory ports), integration (real Postgres), and a Docker Compose smoke test. A separate load-test workflow runs the calculator benchmark on PRs with a p95 latency assertion.

Local equivalents are the `pnpm test:*` scripts above. Golden tests need `DATABASE_URL` pointing at a disposable database.

## Deployment

The deploy workflows build the image as `ghcr.io/siimliimand/rajahinta:<sha>` and push to GHCR. Kubernetes manifests (`infra/k8s`) exist with Kustomize overlays for staging and production, but the staging cluster is not provisioned; the deploy workflows are manual (`workflow_dispatch`) and Kubernetes is deferred until traffic justifies it. Until then, the Docker Compose stack is the reference production topology.

The three-tier promotion model is development, staging, production, with staging carrying its own tax-rule and merchant data (`infra/staging-data`).

## Further documentation

- `ARCHITECTURE.md` for the full component, data-flow, and decision record
- `DESIGN.md` for the UI design system
- `docs/USER-GUIDE.md` for how to use the website
- `docs/TECHNICAL-ASSESSMENT.md` for known gaps and recommended work
- `docs/tech-stack.md`, `docs/rajahinta-fi-implementation-plan.md` for background
