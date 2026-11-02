# Fix OpenNext adapter cache regression (Next 16 deploy CPU 3–4×)

## Why

The Oct 26 production deploy (PR #153, Next 15.5→16.4.3) tripled-to-quadrupled
frontend CPU: ~39 ms/req (Oct 23) → 130–175 ms/req (Oct 26+), 74% of account
CPU on 21% of requests (Oct 20–31 window). The investigation's original
suspect — `cookies()` in the root layout — was already fixed Oct 3 (commit
8c35fe7b) and deployed Oct 14; the seven `searchParams` routes the Next 16
build table now marks `ƒ` were already `no-store` per-request SSR under
Next 15 by design D5 (pinned by `products/__tests__/cache-headers.test.ts`).
Neither is the cause.

The actual cause is upstream: production resolved `@opennextjs/cloudflare`
1.20.13 → `@opennextjs/aws` 4.1.12 (lockfile-pinned, deployed Oct 26). That
adapter line predates three Next-16 cache-path fixes that shipped Oct 30 in
aws 4.1.14 (bundled in cloudflare 1.20.15):

- #1317 — cache-entry lifetime not reported to Next.js → entries chronically
  treated as stale → serve-stale + re-render per request
- #1333 — wrong build id when `deploymentId` is set → build-written cache
  entries invisible at runtime → per-request misses
- #1331 — `revalidateTag(tag, 'max')` entries not served stale-while-revalidate
  → full MISS render after every on-demand invalidation (the internal
  revalidate endpoint switched to this API in PR #153)

The same bug family (#1315/#1304, where #1304 IS in production) means
`fetch(..., { next: { revalidate } })` data-cache entries may never be
rewritten at runtime on deployed Workers — a latent data-staleness
correctness bug (upstream reporter observed 16-day-old data), independent of
the CPU burn. The Oct 23→26 CPU step-change matches the Oct 26 deploy exactly;
the adapter fixes landed Oct 30, four days after production deployed and one
day before the investigation window closed.

## What Changes

- **Dependency bump**: `@opennextjs/cloudflare` `^1.20.13` → `^1.20.15`
  (resolves `@opennextjs/aws` → 4.1.14), lockfile refresh. No application
  code changes. Also refreshes the stale pre-merge `node_modules`.
- **Recurrence guard**: a CI check that fails a PR which changes the `next`
  version while the adapter pair resolves behind the latest published
  release, pointing at the adapter release notes.
- **Deploy verification discipline**: staging curl matrix (cache HIT headers
  on ISR routes + rendered-data freshness vs the API) as the gate before
  production promotion for this change; post-deploy observability check
  (CPU trend, API volume, R2 writes) recorded in the change folder.

## Non-goals

- No application-code restructuring of the seven `searchParams` routes
  (client islands) — that path contradicts design D5 (no-JS GET-form
  filtering) and only becomes relevant if CPU stays hot after this fix.
- No change to ISR windows (`revalidate = 60`), the R2 incremental cache /
  memory queue wiring, or `open-next.config.ts`.
- No work on the stuck `feature/d1-read-cost-reduction` branch (separate
  follow-up).
- No `cacheComponents` migration (the official Next 16 caching model) —
  a deliberate future conversation, not a hot-CPU mitigation.

## Dependencies

None external. The gated production deploy (`deploy-production.yml`,
`confirm_deploy: yes`) and the D1-migrate-before-build ordering stay as is.
