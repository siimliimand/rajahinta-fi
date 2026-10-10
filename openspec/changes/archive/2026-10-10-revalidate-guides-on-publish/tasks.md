# Tasks: revalidate-guides-on-publish

- [ ] 1.1 Frontend: tag the guide/blog server fetches — `tags: ['guides']` in guides.server.ts (index + slug), `tags: ['blog']` in blog.server.ts (index + slug); update the fetch-init assertions in the page/server tests
- [ ] 1.2 Frontend: `POST /api/internal/revalidate` route handler — constant-time secret check vs worker secret (503 when unset), tag allowlist (`guides`, `blog`), `revalidateTag` per tag, `force-dynamic`; route tests (auth matrix, allowlist, revalidate invoked)
- [ ] 2.1 API worker: publish transition issues `waitUntil` revalidate POST to `${APP_PUBLIC_URL}/api/internal/revalidate` with `FRONTEND_REVALIDATE_TOKEN` (5 s timeout, fail-open, skip+audit when unset, `cache_revalidate` audit row with outcome); env typing + blog.routes publish tests (called / fail-open / skipped)
- [ ] 3.1 Full battery (typecheck, lint, content lint, unit, build) + secrets wiring recorded (wrangler secret put REVALIDATE_TOKEN / FRONTEND_REVALIDATE_TOKEN, staging + production) before deploy
