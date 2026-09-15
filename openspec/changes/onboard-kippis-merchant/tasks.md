# Onboard kippis merchant — Tasks

> Sweep (1.x) gates the parser/vocabulary work; 1.2 is scoped by sweep data. Code tasks are `platform-engineer` (TypeScript, data-acquisition/core-domain); env rollouts split deploys (`devops-engineer`) from registry/governance verification. Local → staging → production strictly ordered; production last. Verification last of all.

## 1. Catalog sweep (read-only)

- [x] 1.1 `scripts/kippis-catalog-sweep.ts` cloned from the longero sweep (`COLLECTION_URL` = `https://www.kippis.net/wp-json/wc/store/v1/products`, `PER_PAGE` 100, adapter-parity walk discipline); walks all 677 products through `parseAlksStoreProducts` and reports drop-rate, per-category error distribution, SKU/EAN gap (bare-13 vs GTIN-14 vs other), multipack name-parsing behavior (`33cl x 24` case pricing), and Finnish category-vocabulary coverage; findings recorded in the change notes with a go/no-go for tasks 1.2 and 2.1 <!-- agent: platform-engineer.fast, depends_on: [], touches: [scripts/kippis-catalog-sweep.ts, openspec/changes/onboard-kippis-merchant/notes.md] -->
- [x] 1.2 CONDITIONAL (scope from sweep data): extend `SWEDISH_SOURCE_CATEGORY_MAP` with the kippis terms (candidates: `valkoviinit`, `punaviinit`, `kuohuviinit`, `viskit`, `rommit`, `liköörit`, `konjakit`, `ginit`, `aperitiivit`, `vodkat ja viinat`, `siiderit lonkerot ja seltzerit`, `virvoitusjuomat ja mikserit`, `energiajuomat`) with tests; only additive keys to existing canonical categories, mapped per the design D3 precedents <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [packages/core-domain/src/normalization/source-category.mapper.ts, packages/core-domain/src/normalization/__tests__/source-category.mapper.test.ts] -->

## 2. Parser + adapter + wiring

- [x] 2.1 Extend `readEanFromSku` (`packages/data-acquisition/src/adapters/alks.parser.ts`) to accept bare 13-digit (`^\d{13}$`) and 14-digit leading-zero (`^0\d{13}$`, strip the zero) SKUs alongside the existing prefixed pattern; update the correction-error message text to the new shape set; unit tests for every shape (prefixed, bare-13, GTIN-14, internal code, empty, 12-digit) asserting EAN-or-correction-error outcomes <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [packages/data-acquisition/src/adapters/alks.parser.ts, packages/data-acquisition/src/__tests__/alks.parser.test.ts] -->
- [x] 2.2 Extract the shared Store API page-walk into one module (parameterized by `merchantId`, error-label prefix); rework `AlksFeedAdapter`/`LongeroFeedAdapter` as thin subclasses (behavior unchanged, golden fixtures green); add `KippisFeedAdapter` (`merchantId: 'kippis'`) with golden fixtures + unit tests (kippis-shaped rows: numeric SKUs, sale prices, Finnish categories); export from the package index; register in both composition sites — `composeIngestionStageServices` (apps/api-worker ingestion-steps adapter map) and `composeIngestionPipeline` (apps/api-worker queues/pipeline); composition tests assert four live adapters resolve by merchantId <!-- agent: platform-engineer.build, depends_on: [1.2, 2.1], touches: [packages/data-acquisition/src/adapters/woo-store.adapter.ts, packages/data-acquisition/src/adapters/alks.adapter.ts, packages/data-acquisition/src/adapters/longero.adapter.ts, packages/data-acquisition/src/adapters/kippis.adapter.ts, packages/data-acquisition/src/adapters/__fixtures__/**, packages/data-acquisition/src/index.ts, apps/api-worker/src/workflows/ingestion-steps.ts, apps/api-worker/src/queues/pipeline.ts] -->

## 3. Local rollout

- [x] 3.1 Local D1: registry row (`kippis`, name `Kippis`, country `FI`, feedUrl `https://www.kippis.net`, json, `86_400_000`) + governance record (`RETAILER_API`, `GRANTED`, sourceUrl `https://www.kippis.net/wp-json/wc/store/v1/products`); run the producer tick + ingestion workflow end-to-end locally against the live feed (read-only GETs); verify `retail_offers` rows land, EAN matching joins existing `product_master` rows, and the API serves kippis offers <!-- agent: platform-engineer.fast, depends_on: [2.2], touches: [openspec/changes/onboard-kippis-merchant/notes.md] -->

## 4. Staging rollout

- [x] 4.1 Open PR from the feature branch; CI green (all required checks); merge; staging auto-deploys the api-worker <!-- agent: devops-engineer.fast, depends_on: [3.1], touches: [] -->
- [x] 4.2 Staging registry row + `RETAILER_API`/`GRANTED` governance via the ops path (or direct D1 by the operator); trigger the first ingest via the Workflows REST API; verify end-to-end (workflow instance `complete`, `retail_offers` populated with EAN matches into the existing catalog, API returns kippis offers); staging alks governance stays `REVOKED` — record executed commands in the change notes <!-- agent: devops-engineer.fast, depends_on: [4.1], touches: [openspec/changes/onboard-kippis-merchant/notes.md] -->

## 5. Production rollout

- [ ] 5.1 Production deploy via the gated workflow (`gh workflow run deploy-production.yml` with `confirm_deploy=yes`); health gate green <!-- agent: devops-engineer.fast, depends_on: [4.2], touches: [] -->
- [ ] 5.2 Production registry row + `RETAILER_API`/`GRANTED` governance via the ops console (direct D1 fallback with the audit-events deviation recorded); trigger the first ingest manually; verify the public API + product page serving kippis items; record the follow-up checklist for the next scheduled 00:00 UTC boundary (exactly one `kippis` enqueue, one workflow instance, offers refreshed) <!-- agent: devops-engineer.fast, depends_on: [5.1], touches: [openspec/changes/onboard-kippis-merchant/notes.md] -->

## 6. Verification

- [ ] 6.1 Full sweep: rebuild `@rajahinta/core-domain` first, then typecheck, lint, content lint, unit suites, e2e, D1 suites; evidence recorded — staging and production API/product pages serving the kippis catalog, EAN-match share into the existing catalog, daily-single-enqueue behavior from the producer logs <!-- agent: platform-engineer.fast, depends_on: [1.1, 1.2, 2.1, 2.2, 3.1, 4.2, 5.2], touches: [openspec/changes/onboard-kippis-merchant/notes.md] -->
