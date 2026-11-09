# Frontend on Cloudflare Workers (OpenNext)

The Next.js 16 frontend (16.4.3) runs on Cloudflare Workers via
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

The app uses **time-based ISR plus tagged data-cache fetches**. Verified
windows against the route modules (Next 16.4.3):

| Surface | Window | Source |
|---|---|---|
| Localized tree ISR | `revalidate = 60` | `src/app/[locale]/layout.tsx` |
| Product detail ISR (and OG images) | `revalidate = 300` | `src/app/[locale]/products/[id]/page.tsx`, `src/app/tuotteet/[id]/page.tsx` |
| Sitemap index and tree routes | `revalidate = 900` | `src/app/sitemap.xml/route.ts`, `src/app/sitemaps/[tree]/route.ts` |
| Data-cache API fetches | `next: { revalidate: 900 }` | blog/guides server modules, `src/lib/server-api.ts`, `src/lib/sitemap-entries.ts` |

The old `app/sitemap.ts` metadata route is gone (sitemap-tree-coverage):
`/sitemap.xml` is a hand-rolled sitemapindex over `/sitemaps/<tree>` Route
Handlers. There is no `revalidate: 60` data-cache fetch; 60 s is only the
`[locale]` layout ISR window. Product pages use on-demand ISR
(`dynamicParams = true`, empty `generateStaticParams`).

That still requires an incremental cache plus a revalidation queue. Chosen:

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
- **Tag cache: called, not deployed.** `src/app/api/internal/revalidate/route.ts`
  calls `revalidateTag(tag, 'max')` for the allowlisted tags `guides` and
  `blog` (Next 16 requires a cache profile; `'max'` marks every entry for
  the tag stale). The API Worker's ops-console publish transition invokes
  that endpoint after a successful blog-post publish
  (`apps/api-worker/src/routes/ops.routes.ts`). `wrangler.jsonc` declares
  **no** `NEXT_TAG_CACHE_*` binding, and `open-next.config.ts` does not
  pass a `tagCache` override, so the adapter binds its dummy tag cache
  (`writeTags` is a no-op, `getByTag` returns `[]`, `isStale` returns
  `false`). On-demand tag revalidation therefore has no persistent store
  on the deployed Worker today; the 60/300/900 s ISR windows remain the
  effective freshness mechanism. Adding `d1NextTagCache` (or
  `doShardedTagCache` at higher load) plus the matching
  `NEXT_TAG_CACHE_*` binding is the upgrade path, not a current fact.

### Stable cache-key invariant (data-cache fetches)

Next's `generateCacheKey` hashes the fetch URL, method, and headers. It
strips `traceparent` and `tracestate` and keeps every other header,
including `x-request-id`. A UUID minted per render therefore minted a
distinct cache key, a distinct R2 `.fetch` object, and an origin request
per render. The production cache bucket held 152,987 `.fetch` objects
(213,769 total) on 2026-11-09; a 454-entry sample contained 11 distinct
URLs. The shared `SiteFooter` fetches the blog and guides indexes on
every localized render, which multiplied the defect.

Invariant: on a positive-revalidate read, no per-request-varying header
may enter the fetch cache key. Generated correlation metadata must not
vary per render.

What the fix does (`src/lib/api.ts`, `apiFetch`): for `next.revalidate >
0`, the generated `traceparent` is kept (Next strips it from the key) and
the generated `x-request-id` is omitted. Explicit caller-supplied IDs
pass through, and requests without a positive revalidation window keep
the generated UUID.

What the API Worker does instead: on an actual miss that arrives without
a valid `x-request-id`, `apps/api-worker/src/middleware/request-id.ts`
generates a UUID, echoes it in the response header, and stamps it on the
structured request log. A cache hit has no origin request and needs no
request ID. The `API_WORKER` service-binding path (`serverRequest`) is
unchanged: it bypasses Next's fetch cache, so cache-key fragmentation
does not apply there.

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
call path — browser fetches, RSC/SSR fetches (with one scoped
exception, the amendment below), and build-time sitemap/OG fetches. A
**service binding was rejected** for the general case:

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

### Amendment: scoped API_WORKER service binding (product-page-cold-latency 3.1)

The URL base above stays **canonical** for browsers, build-time
sitemap/OG fetches, and anything session-carrying — the rejection
rationale below is unchanged for those paths. What changed: the
frontend Worker now also carries an `API_WORKER` **service binding**
(`rajahinta-api`, `rajahinta-api-dev`, `rajahinta-api-staging`,
`rajahinta-api-production` per environment — see `wrangler.jsonc`) used
by exactly one module, `src/lib/server-api.ts`, for the SSR **public
catalog reads** (product detail, product listing, price history, price
context, dupes):

- **Binding is SSR-public-reads only.** These reads carry no session —
  the age gate rides the fixed `x-age-confirmed` attestation header —
  so the 5.2 cookie-origin objection does not apply. Browser fetches
  and any future session-carrying server call keep using the URL base.
- **Environment detection, not a flag.** `serverRequest` probes
  `getCloudflareContext().env.API_WORKER` in a try/catch and falls back
  to the plain-URL `request()` path (same headers, same
  `ApiFetchError` contract) wherever the worker context or binding is
  unavailable: `next dev`, `next build`, vitest.
- **Cache consequence, accepted:** a binding fetch is not Next's
  patched global fetch, so the per-fetch data cache
  (`next: { revalidate: 900 }`) governs the URL fallback only. On the
  binding path the page-level ISR window (`revalidate = 300`, R2
  incremental cache) is what bounds render frequency.

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
`00-<trace-id>-<span-id>-01` is generated per request). A UUID
`x-request-id` (echoed by the API and surfaced on `ApiFetchError`) is
sent on non-cacheable requests and when the caller supplies one;
positive-revalidate reads omit the generated ID so the fetch cache key
stays stable (see the stable cache-key invariant). On a cache miss the
API Worker assigns the UUID, echoes it, and logs it. Server routes that
want a full browser→frontend→API waterfall can forward the inbound
request's `traceparent`/`tracestate` headers into the request init.

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

## Cache-bucket lifecycle (30-day expiration)

The staging and production frontend cache buckets carry a 30-day
object-expiration rule (change `fix-r2-fetch-cache-key-explosion`, design
D4). The rule ages out build-scoped ISR entries and the historical
`.fetch` duplicates. No bulk deletion is performed. An expired entry
regenerates from source on the next request. Observation logs, rate
snapshots, and D1 records are different stores and are unaffected. The
dev bucket (`rajahinta-frontend-cache-dev`) is out of scope.

Both buckets are EU-jurisdiction (`wrangler.jsonc`:
`"jurisdiction": "eu"`), so every lifecycle command must pass
`--jurisdiction eu` (short form `-J eu`). The commands target the bucket
by name; `--env` is not how the bucket is selected.

```bash
# From apps/frontend (the frontend's own Wrangler).

# List rules
npx wrangler r2 bucket lifecycle list rajahinta-frontend-cache-staging --jurisdiction eu
npx wrangler r2 bucket lifecycle list rajahinta-frontend-cache-production --jurisdiction eu

# Add the 30-day object-expiration rule (prefix omitted: all objects)
npx wrangler r2 bucket lifecycle add rajahinta-frontend-cache-staging expire-30d --expire-days 30 --jurisdiction eu
npx wrangler r2 bucket lifecycle add rajahinta-frontend-cache-production expire-30d --expire-days 30 --jurisdiction eu

# Remove the rule itself (not required during a Worker rollback)
npx wrangler r2 bucket lifecycle remove rajahinta-frontend-cache-staging --name expire-30d --jurisdiction eu
npx wrangler r2 bucket lifecycle remove rajahinta-frontend-cache-production --name expire-30d --jurisdiction eu
```

`lifecycle set <bucket> --file <json>` replaces the whole configuration
from a JSON file; `lifecycle add` appends one named rule. `add` also
accepts `--ia-transition-days` and `--abort-multipart-days`; both are
unused here.

Rollback: a frontend Worker rollback does not touch the lifecycle rule.
The rule may stay during a rollback because it only expires regenerable
cache objects.

## Known deviations from the adapter defaults

- Memory queue instead of `DOQueueHandler` — see above and
  `open-next.config.ts` for the documented trade-off and upgrade path.
- `output: 'standalone'` stays in `next.config.mjs` for the current
  container stack (`pnpm build`); the OpenNext build is unaffected by it.
