# Frontend on Cloudflare Workers (OpenNext)

The Next.js 15 frontend runs on Cloudflare Workers via
[`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare)
(migrate-to-cloudflare task 5.1). This is the runbook: local build, local
Workers preview, deploy, and how per-PR preview URLs behave.

## What was configured

| File | Purpose |
|---|---|
| `open-next.config.ts` | Adapter cache components (see the documented choices inline) |
| `wrangler.jsonc` | Worker config: build output layout, bindings, `dev`/`staging`/`production` environments (design D9), `preview_urls`, `observability.enabled` |
| `public/_headers` | Immutable `Cache-Control` for `/_next/static/*` (the Worker does not sit in front of static assets, so `next.config` `headers` do not apply there) |
| `next.config.mjs` | `initOpenNextCloudflareForDev()` — integrates `next dev` with local Workers bindings |

### Caching choices (why)

The app uses **time-based ISR only**: `revalidate = 60` on the `[locale]`
layout, `revalidate = 900` on `sitemap.ts`, and `next: { revalidate }`
data-cache fetches (60/900) in `src/lib/api.ts`. That requires an
incremental cache plus a revalidation queue. Chosen:

- **R2 incremental cache** (`NEXT_INC_CACHE_R2_BUCKET`) — KV is eventually
  consistent (adapter docs discourage it), static-assets cache is
  read-only.
- **Memory revalidation queue** instead of the adapter's default Durable
  Object queue. Cloudflare does **not** generate preview URLs for Workers
  that implement a Durable Object (the generated worker exports
  `DOQueueHandler`), and per-PR previews are required by this migration.
  The memory queue revalidates directly with per-isolate dedupe; at this
  site's scale the trade-off is a few duplicate revalidations per ISR
  window. The upgrade path (DO queue + what it costs) is documented in
  `open-next.config.ts`.
- **No tag cache** — the app never calls `revalidateTag`/`revalidatePath`.

## Scripts

```bash
pnpm --filter @rajahinta/frontend build:worker   # opennextjs-cloudflare build (runs next build, then bundles the Worker)
pnpm --filter @rajahinta/frontend dev:worker     # wrangler dev on the .open-next output (run build:worker first)
pnpm --filter @rajahinta/frontend preview        # build + opennextjs-cloudflare preview (wrangler dev with populated bindings)
pnpm --filter @rajahinta/frontend deploy:dev           # build + wrangler deploy --env dev
pnpm --filter @rajahinta/frontend deploy:staging       # build + wrangler deploy --env staging
pnpm --filter @rajahinta/frontend deploy:production    # build + wrangler deploy --env production
```

`pnpm dev` (Node dev server) and `pnpm build` (standalone Node output,
current container stack) are unchanged; both stacks stay runnable until
cutover (design D10).

## Local run

```bash
pnpm install
pnpm --filter @rajahinta/frontend build:worker
pnpm --filter @rajahinta/frontend dev:worker     # http://localhost:8787
```

`wrangler dev` simulates the R2 bucket and service bindings locally — no
Cloudflare account or real resources needed. The Finnish home page
(`/fi`) and the middleware-driven locale routing must render exactly as
on the Node server.

During `next build` you may see warnings about the `WORKER_SELF_REFERENCE`
service binding or Next-internal cache bindings not being real classes in
local dev — expected, documented in the adapter's known issues, ignorable.

## Environment variables

- `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SITE_URL` are **build-time**
  inlined (`next build`), so runtime `vars` in `wrangler.jsonc` cannot
  change them. Set them in the build environment:
  - local worker build: `NEXT_PUBLIC_API_URL=<API_BASE_URL>` (default:
    `http://localhost:3000`, the legacy backend port)
  - Workers Builds: set them as **build variables** on the Worker's build
    configuration (dashboard → Worker → Settings → Build → Variables),
    per environment — placeholders:
    - staging: `NEXT_PUBLIC_API_URL=https://rajahinta-api-staging.<account-subdomain>.workers.dev`
    - production: `NEXT_PUBLIC_API_URL=https://api.rajahinta.fi`
- Deploy-time secrets: none required by the frontend Worker today. If a
  future secret is added, use `wrangler secret put <NAME> --env <env>` —
  never commit values.

## Frontend → API connection (task 5.2)

**Strategy: same-zone routing — a plain URL base per environment.**
One API base URL is inlined at build time (`NEXT_PUBLIC_API_URL`,
resolved in `src/lib/api.ts` → `resolveApiBaseUrl`) and used by every
call path: browser fetches, RSC/SSR fetches, and build-time
sitemap/OG fetches. A **service binding was rejected**:

- browser fetches (search, calculator, session lifecycle, reports)
  cannot traverse a binding — they need a public URL regardless;
- `next build` sitemap/OG fetches run outside any Worker runtime, where
  no binding exists;
- a binding-for-SSR + URL-for-browser split would give the two contexts
  different API origins — the httpOnly session cookie would be issued on
  one and never seen by the other, breaking auth — for zero gain, since
  the URL path must exist anyway.

Per-environment bases (production custom domain attached in task 6.5):

| Environment | API base (`NEXT_PUBLIC_API_URL`) |
|---|---|
| local (`pnpm dev`) | `http://localhost:3000` (legacy backend default) |
| local concurrent Workers | `http://localhost:8788` — run the API Worker as `pnpm --filter @rajahinta/api-worker exec wrangler dev --port 8788` (frontend worker owns 8787) and build the frontend with the var set |
| dev / staging | `https://rajahinta-api-staging.<account-subdomain>.workers.dev` |
| production | `https://api.rajahinta.fi` (same zone as the frontend) |

All outbound calls go through `src/lib/api.ts` (`request()` for the
consumer API, exported `apiFetch()` also for the operator console at
`app/[locale]/ops/api.ts`), so base-URL resolution, credentials, and
trace headers have exactly one home.

### Cookie behavior on Workers (verified)

The API Worker issues the session cookie host-only
(`rajahinta_session`; `Path=/; HttpOnly; Secure; SameSite=Lax`, **no
`Domain` attribute** — `apps/api-worker/src/routes/accounts.routes.ts`):

- **`Secure` is unconditional.** Every deployed Workers origin is
  https-only (workers.dev and custom-domain routes force TLS), so
  staging gets the same protection as production. On the legacy Node
  stack the flag was NODE_ENV-gated; that gate never fired on Workers
  (NODE_ENV is not a wrangler var) and was removed in 5.2.
- **Host-only on purpose.** With same-zone routing the API origin is the
  cookie's only consumer — the frontend never reads the httpOnly token
  (it reads only the non-httpOnly `age_confirmed` cookie it sets itself
  and sends its value as the `x-age-confirmed` header). A
  `Domain=.rajahinta.fi` attribute would broaden the cookie across
  subdomains for zero benefit. `SameSite=Lax` holds because the frontend
  and API hosts are in the same site.
- Known dev-only caveat: `wrangler dev` serves `http://localhost`, which
  Chromium/Gecko treat as a trustworthy origin (Secure cookies allowed);
  Safari does not, so session flows in Safari need https preview URLs.

### CORS on the API Worker (required follow-up)

A browser calling a different origin (`rajahinta.fi` → `api.rajahinta.fi`
or the local 8787 → 8788 pair) needs the API Worker to answer CORS with
an **explicit origin (never `*`) + `Access-Control-Allow-Credentials:
true`** — the contract the legacy NestJS boot already implements
(`apps/backend/src/main.ts`, `CORS_ORIGIN` env). The API Worker does not
emit CORS headers yet, so browser-originated calls to a cross-origin API
base fail preflight; server-side (RSC/sitemap) calls and direct fetches
are unaffected. Wire the CORS middleware on the API Worker before task
5.4 (browser journeys) can exercise cross-origin UI flows.

### Trace propagation (per 6.2, `apps/api-worker/src/observability/TRACES.md`)

Every request through the fetch client carries a W3C `traceparent`
(caller-supplied values pass through verbatim; otherwise a standalone
`00-<trace-id>-<span-id>-01` is generated per request) and a UUID
`x-request-id` (echoed by the API and surfaced on `ApiFetchError`).
Server routes that want a full browser→frontend→API waterfall can
forward the inbound request's `traceparent`/`tracestate` headers into
the request init.

## Per-PR preview URLs (wired by task 6.5)

`wrangler.jsonc` sets `preview_urls: true`, which enables Workers
**version preview URLs**. Behavior once the repo is connected:

1. Connect the GitHub repo to Workers Builds (dashboard → Workers & Pages
   → Create → Workers → Connect to Git, or the Worker's Settings → Build
   → Connect). Cloudflare installs the GitHub App and needs `wrangler
   deploy` permission via an API token scoped to the account — grant it
   through the connect flow, no token is stored in the repo.
2. The Workers Builds pipeline builds non-production branches (PRs) with
   the configured build watch paths and uploads a **version**.
3. Each PR gets a versioned preview URL of the form:
   `<VERSION_PREFIX>-<WORKER_NAME>.<SUBDOMAIN>.workers.dev`, e.g.
   `https://a1b2c3d4-rajahinta-frontend-staging.<account-subdomain>.workers.dev`
   (prefix = first 8 hex chars of the version ID; subdomain = the
   account's workers.dev subdomain). The URL appears in the build log and
   on the Worker's Deployments tab; posting it to the PR is CI glue
   (task 6.5).
4. Pushes to the configured production branch deploy the worker normally
   (per-environment deploys use `--env staging` / `--env production`).

Constraints to keep in mind (Cloudflare preview-URL limitations):

- No preview URLs for Workers implementing Durable Objects — the reason
  this setup uses the memory revalidation queue.
- Preview URLs are only served on the account's workers.dev subdomain;
  custom-domain previews are not supported (custom domains/routes are
  attached in task 6.5).
- Preview URLs are public; put Cloudflare Access in front of them if PR
  previews must not be world-readable.

## Known deviations from the adapter defaults

- Memory queue instead of `DOQueueHandler` — see above and
  `open-next.config.ts` for the documented trade-off and upgrade path.
- `output: 'standalone'` stays in `next.config.mjs` for the current
  container stack (`pnpm build`); the OpenNext build is unaffected by it.
