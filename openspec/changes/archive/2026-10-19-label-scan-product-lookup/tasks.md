# Tasks

## 1. Funnel foundation (data-platform)

- [x] 1.1 Diacritic-fold utility (lowercase, punctuation strip, unicode fold to ASCII forms) as a pure exported module with unit tests covering the spike cases (`żołądkowa`→`zoladkowa`, Finnish ä/ö, mixed punctuation) <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/repositories/d1/label-fold.ts, packages/data-platform/src/repositories/d1/__tests__/label-fold.test.ts] -->
- [x] 1.2 Label-candidates repository: token-AND `MATCH` SQL over `product_master_fts` joined to `product_master`, band-score expression (ABV 0.5 pp buckets ×10, volume 0.05 l buckets ×2, null-field term dropped), visible-catalog universe predicates, `LIMIT 5` ordering by band then id; repository function taking `{tokens, abv, volume}`; D1 suite tests: adjacency-breaking mid-name number, sibling-variant discrimination, diacritic fold, null-field widening, universe exclusion of `name_quality != 'ok'` rows <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [packages/data-platform/src/repositories/d1/label-candidates.repository.ts, packages/data-platform/src/repositories/d1/__tests__/label-candidates.repository.test.ts] -->

## 2. Scan-label API route

- [x] 2.1 Workers AI binding: add `ai` binding to `apps/api-worker/wrangler.jsonc` (all environments) and the `AI` property on `AppEnv` <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/api-worker/wrangler.jsonc, apps/api-worker/src/env.ts] -->
- [x] 2.2 `POST /api/v1/products/scan-label` route: age gate + anonymous per-IP RateLimiterDO quota; body validation (type JPEG/PNG/WebP, ≤ 4 MB) before model invocation; pinned-model constant (`@cf/mistralai/mistral-small-3.1-24b-instruct`) + transcribe-first prompt; tolerant zod parse (fence stripping, null-on-absent); funnel call with folded tokens; `{extracted, candidates[]}` response envelope; typed 502 retryable envelope on model failure/unparseable output; route mount in `index.ts`; unit tests with a mocked AI binding (happy path, fence noise, model 500, oversize body, wrong type, quota 429, age gate 403, in-memory assertion via storage-binding absence) <!-- agent: platform-engineer.build, depends_on: [1.2, 2.1], touches: [apps/api-worker/src/routes/scan-label.routes.ts, apps/api-worker/src/routes/__tests__/scan-label.routes.test.ts, apps/api-worker/src/index.ts] -->

## 3. Scan page (frontend)

- [x] 3.1 `/scan` route + client component: `getUserMedia` single-shot capture with fill-the-frame guidance, client-side downscale (longest edge ~1024 px, JPEG), scan-label POST, four states (extracting / candidates / no-result / camera-denied), top-3 candidate cards (name, ABV, volume, lowest observed price) with tap-to-confirm navigation to `/products/[id]` (never auto-redirect), no-result handoff to catalog search with extracted brand prefilled, privacy microcopy (fi/en), dynamic import so the camera surface stays out of the main bundle <!-- agent: platform-engineer.build, depends_on: [2.2], touches: [apps/frontend/src/app/[locale]/scan/page.tsx, apps/frontend/src/app/[locale]/scan/scan-client.tsx, apps/frontend/src/messages/fi.json, apps/frontend/src/messages/en.json] -->
- [x] 3.2 Component tests: states render from mocked API responses (three candidates / zero candidates / 502 retryable / camera rejection), no navigation without tap, privacy notice present <!-- agent: platform-engineer.build, depends_on: [3.1], touches: [apps/frontend/src/app/[locale]/scan/__tests__/scan-client.test.tsx] -->
- [x] 3.3 Scan entry affordance in the products-page search area (icon button, fi/en label, links to `/scan`) <!-- agent: platform-engineer.fast, depends_on: [3.1], touches: [apps/frontend/src/app/[locale]/products/components/, apps/frontend/src/messages/fi.json, apps/frontend/src/messages/en.json] -->

## 4. Docs

- [x] 4.1 Footer privacy copy: add the "label photos are processed in memory and never stored" sentence next to the analytics note (fi/en message keys) <!-- agent: platform-engineer.fast, depends_on: [], touches: [apps/frontend/src/app/[locale]/components/SiteFooter.tsx, apps/frontend/src/messages/fi.json, apps/frontend/src/messages/en.json] -->
- [x] 4.2 ARCHITECTURE.md module note: scan-label route, label-candidates repository, Workers AI binding and pinned model under the api-worker/frontend sections <!-- agent: platform-engineer.fast, depends_on: [2.2], touches: [ARCHITECTURE.md] -->

## 5. Verification

- [x] 5.1 Run typecheck, eslint, unit suites, and the D1 suite; fix fallout <!-- agent: platform-engineer.fast, depends_on: [2.2, 3.3, 4.1], touches: [] -->
- [x] 5.2 Staging deploy + smoke: POST a fixture label image to `/api/v1/products/scan-label` on staging — assert candidate envelope shape, extracted fields, latency under 8 s, quota 429 after burst, age-gate 403 without the confirmation header, and zero storage writes (R2/KV bindings untouched); `/scan` renders on mobile viewport with camera prompt <!-- agent: devops-engineer.fast, depends_on: [5.1], touches: [] -->
