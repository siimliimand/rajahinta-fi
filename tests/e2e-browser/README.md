# Browser E2E on the Workers stack (`playwright.workers.config.ts`)

Playwright browser journeys — age gate, calculator flow, compare sorting,
account export — driven against the **Cloudflare Workers stack**
(migrate-to-cloudflare task 5.4). The spec files are shared with the
legacy docker-compose harness and are unchanged: same assertions, same
selectors. Only the harness differs.

| | Legacy (until 6.7) | Workers (this config) |
|---|---|---|
| Config | `playwright.config.ts` | `playwright.workers.config.ts` |
| Frontend | Next dev server :3001 | OpenNext Worker, `wrangler dev` :8787 |
| API | NestJS :3000 | API Worker (`apps/api-worker`), `wrangler dev` :8788 |
| Data | Postgres + Redis (docker compose) | Local D1 (miniflare state), DOs, R2 — all simulated |
| Boot | `boot-stack.sh` | `boot-workers-stack.sh` via the config's webServer array |

## Run locally

```bash
pnpm install                      # once
pnpm exec playwright test \
  -c tests/e2e-browser/playwright.workers.config.ts
```

The config's webServer array does everything in order:

1. **api-worker** — migrates + seeds local D1 with the task-2.6 scripts
   (`pnpm --filter @rajahinta/api-worker db:seed:d1:local`: wrangler
   migrations → seed files → loud verification), applies the journey
   fixtures (`seed-journeys.d1.sql` — the TEST Beer / TEST Wine rows the
   journeys assert on), then starts `wrangler dev` on :8788 with
   `LAUNCH_GATES_OVERRIDE:true` (calculator/price-data gates open) and
   `CORS_ORIGIN:http://localhost:8787` (the frontend Worker origin — the
   journeys exercise the real cross-origin CORS + httpOnly-cookie flow).
   Readiness gate: `GET /api/v1/health/ready` must stop answering 503.
2. **frontend-worker** — builds the OpenNext Worker with
   `NEXT_PUBLIC_API_URL=http://localhost:8788` inlined at build time
   (build-time `next build` inlines it; runtime vars cannot — see
   `apps/frontend/OPENNEXT.md`), then starts `wrangler dev` on :8787.

Skip the frontend rebuild on re-runs:

```bash
SKIP_BUILD=1 pnpm exec playwright test \
  -c tests/e2e-browser/playwright.workers.config.ts
```

Re-running is safe and deterministic: the harness **resets the local D1
state on every `api` boot** (`KEEP_D1=1` to keep it) before migrating and
seeding, because the task-2.6 seed verifies exact row-count totals and
cannot re-apply over foreign rows. Every run therefore sees a fresh
database — fresh migrations, fresh seed, no accumulated sessions. The
journey fixtures re-apply idempotently (`INSERT OR IGNORE`), and sessions
are minted per journey through the API's 401 → issue-session → replay
path — nothing session-shaped is seeded.

Manual stack control (what the webServer entries run):

```bash
bash tests/e2e-browser/boot-workers-stack.sh api        # terminal 1
bash tests/e2e-browser/boot-workers-stack.sh frontend   # terminal 2
bash tests/e2e-browser/boot-workers-stack.sh down       # cleanup
```

Logs land in `/tmp/rajahinta-e2e-browser-workers/` (frontend build log on
failure; Playwright report in `playwright-report-workers/`). The local D1
lives in `apps/api-worker/.wrangler/state` — wiped by each `api` boot,
or manually with `pnpm --filter @rajahinta/api-worker clean`.

## Run against staging / per-PR previews

Deployed environments need **no local web servers** — the API base is
already inlined into the deployed frontend's build (Workers Builds build
variables, task 6.5 deploy workflow). Point the suite at the deployment:

```bash
E2E_BASE_URL=https://rajahinta-frontend-staging.<subdomain>.workers.dev \
  pnpm exec playwright test -c tests/e2e-browser/playwright.workers.config.ts
```

When `E2E_BASE_URL` is set the webServer array is omitted entirely and
`baseURL` becomes that origin. For per-PR preview URLs
(`<version-prefix>-rajahinta-frontend-staging.<subdomain>.workers.dev`,
see `apps/frontend/OPENNEXT.md`) the same command applies. Seeding is the
deploy pipeline's job there (deploy-staging.yml: migrate → seed → verify
via `db:seed:d1:staging`); the journeys only need the TEST products that
`seed-journeys.d1.sql` provides locally — apply it against staging D1 the
same way if a preview should serve journey-ready data:

```bash
pnpm --filter @rajahinta/api-worker exec wrangler d1 execute DB \
  --remote --env staging --file tests/e2e-browser/seed-journeys.d1.sql -y
```

Port overrides for an unusual local placement:
`E2E_FRONTEND_PORT` (default 8787) and `E2E_API_PORT` (default 8788) —
the boot script reads the same variables, and the API base/CORS origin
follow them automatically.

## Feature flags and launch gates

Flags resolve synchronously from wrangler vars (`FF_*`,
`apps/api-worker/src/middleware/feature-flags.ts`) and default to all
OFF — the same state a clean runner gets, which is what the journeys
assert (the helpers scope defensively around flag-on UI, e.g. the compare
page's basket section). To exercise a flag-gated surface locally, add the
var to the api entry in `boot-workers-stack.sh`:

```bash
exec pnpm exec wrangler dev --port "$API_PORT" \
  --var "LAUNCH_GATES_OVERRIDE:true" \
  --var "CORS_ORIGIN:${FRONTEND_ORIGIN}" \
  --var "FF_BASKET_OPTIMIZATION:true"
```

`LAUNCH_GATES_OVERRIDE` exists only to open the calculation/price-data
gates locally (`apps/api-worker/src/middleware/launch-gate.ts`); staging
and production manage gates through their own environment config.

## What is seeded, and where it comes from

| State | Source |
|---|---|
| Tax rules (official versioned dataset) | task-2.6 seed (`db:seed:d1:local`) |
| Staging fixture data (real product names) | task-2.6 seed (`db:seed:d1:local`) |
| TEST Beer / TEST Wine + DE/SE transport + offers | `seed-journeys.d1.sql` (this directory), values mirrored from `packages/data-platform/src/seed/staging-seed.ts` |
| Accounts, sessions, calculation history | created at runtime by the journeys themselves through the real API path |

The fixture rows use high explicit ids (9001+) with `INSERT OR IGNORE`
and rely on the FTS5 sync triggers (migrations 0001/0002) for search —
no parallel seeding machinery.
