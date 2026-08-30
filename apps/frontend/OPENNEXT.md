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
    `http://localhost:3000`, the legacy backend port; the API Worker
    base URL is wired in task 5.2)
  - Workers Builds: set them as **build variables** on the Worker's build
    configuration (dashboard → Worker → Settings → Build → Variables),
    per environment — placeholders:
    - staging: `NEXT_PUBLIC_API_URL=https://<api-worker-staging-host>`
    - production: `NEXT_PUBLIC_API_URL=https://<api-worker-production-host>`
- Deploy-time secrets: none required by the frontend Worker today. If a
  future secret is added, use `wrangler secret put <NAME> --env <env>` —
  never commit values.

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
