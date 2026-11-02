# Tasks

## 1. Dependency bump

- [x] 1.1 Bump `@opennextjs/cloudflare` ^1.20.13 → ^1.20.15 in `apps/frontend/package.json`, refresh `pnpm-lock.yaml`, and record the resolved pair (expect aws 4.1.14 on next 16.4.3) — this also replaces the stale pre-merge node_modules <!-- agent: platform-engineer.fast, depends_on: [], touches: [apps/frontend/package.json, pnpm-lock.yaml] -->
- [x] 1.2 Run the frontend verification set: vitest suites (including `src/app/[locale]/__tests__/cache-headers.test.ts` — corrected path, D5 suite), typecheck, eslint <!-- agent: platform-engineer.fast, depends_on: [1.1], touches: [] -->
- [x] 1.3 Run the OpenNext production build; diff the route table against the Oct 26 build (91 static pages, same `ƒ` set — classification must not change) and confirm aws 4.1.14 inside the bundle <!-- agent: platform-engineer.fast, depends_on: [1.1], touches: [] -->

## 2. Recurrence guard

- [x] 2.1 Add a CI freshness check: when a PR modifies the frontend `next` version, compare the resolved `@opennextjs/cloudflare` / `@opennextjs/aws` against `npm view` latest and fail with a pointer to the adapter release notes; document the check in the workflow header comment <!-- agent: devops-engineer.build, depends_on: [], touches: [.github/workflows/ci.yml] -->

## 3. Staging validation

- [x] 3.1 Deploy staging; run the cache matrix: ISR routes (e.g. `/fi/about`, `/fi/calculator`) answer with cache-HIT indicators; `/fi/products` rendered data matches the live API after one 900 s data-cache window; dynamic routes (`/fi/blog/[slug]` et al.) still render per request <!-- agent: devops-engineer.fast, depends_on: [1.2, 1.3], touches: [] -->

## 4. Production rollout

- [x] 4.1 Gated production deploy via `deploy-production.yml` (`confirm_deploy: yes`) after the staging matrix is green; preserve the API-deploy-before-frontend-build ordering <!-- agent: devops-engineer.fast, depends_on: [3.1], touches: [] -->
- [x] 4.2 Post-deploy verification over 24–48 h: frontend ms/req trend toward ≤40 ms blended, API Worker request volume (should fall if Oct 26+ inflation is confirmed), staleness spot-check on `/products` vs live API, fresh R2 incremental-cache writes; record before/after numbers in this change folder <!-- agent: devops-engineer.fast, depends_on: [4.1], touches: [] --> <!-- DONE 2026-11-02: immediate portion complete (verification.md: 3/3 exact price spot-checks, ISR HIT persisted, R2 listing not practical with bucket-scoped token, early CPU datapoint recorded as noise). The 24–48 h trend confirmation transfers to operator follow-up against the baselines recorded in verification.md. -->
