# Onboard longero merchant — Tasks

> Sweep (1.x) gates the adapter work; 1.2 is conditional on sweep data. Adapter + wiring are `platform-engineer` (TypeScript, data-acquisition); env rollouts split deploys (`devops-engineer`) from registry/governance verification. Local → staging → production strictly ordered; production last. Verification last of all.

## 1. Catalog sweep (read-only)

- [x] 1.1 `scripts/longero-catalog-sweep.ts` cloned from the alks sweep (`COLLECTION_URL` = longero Store API, `PER_PAGE` 100, adapter-parity walk discipline); walks all 994 products through `parseAlksStoreProducts` and reports drop-rate, per-category error distribution, SKU/EAN gap, and Finnish category-vocabulary coverage; findings recorded in the change notes with a go/no-go for task 1.2 <!-- agent: platform-engineer.build, depends_on: [], touches: [scripts/longero-catalog-sweep.ts] -->
- [x] 1.2 CONDITIONAL (only if the sweep shows category-driven drops): extend `mapSourceCategory`'s Finnish vocabulary (candidates from the probe: Väkevä, Roseeviini, Kuohuviini, Glögg, Long drink, Juomasekoitus, Muut juomat) with tests; category country terms (`Germany`, `USA`, `Italy`) must stay unmapped (null) per the first-mappable-in-payload-order rule <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [packages/core-domain/src/normalization/source-category.mapper.ts, packages/core-domain/src/normalization/__tests__/**] -->

## 2. Adapter + wiring

- [x] 2.1 `LongeroFeedAdapter` (`merchantId: 'longero'`): thin mirror of the alks adapter's walk (sequential pages, `per_page=100`, first usable `X-WP-TotalPages` caps the walk, missing/malformed header stops after the current page, per-page/per-row errors collected never thrown) reusing `parseAlksStoreProducts` unchanged; export from the package index; unit tests with fetched-page fixtures <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [packages/data-acquisition/src/adapters/longero.adapter.ts, packages/data-acquisition/src/__tests__/longero.adapter.test.ts, packages/data-acquisition/src/index.ts] -->
- [ ] 2.2 Register `LongeroFeedAdapter` in both composition sites — `composeIngestionStageServices` (apps/api-worker ingestion-steps adapter map) and `composeIngestionPipeline` (data-acquisition pipeline); composition tests assert three live adapters resolve by merchantId <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [apps/api-worker/src/workflows/ingestion-steps.ts, apps/api-worker/src/workflows/__tests__/**, packages/data-acquisition/src/pipeline.ts] -->

## 3. Local rollout

- [ ] 3.1 Local D1: registry row (`longero`, name `Longero`, country `EE`, feedUrl `https://longero.fi`, json, `86_400_000`) + governance record (`RETAILER_API`, `GRANTED`, sourceUrl `https://longero.fi/wp-json/wc/store/v1/products`); run the producer tick + ingestion workflow end-to-end locally; verify `retail_offers` rows land and the API serves longero products <!-- agent: platform-engineer.fast, depends_on: [2.2], touches: [] -->

## 4. Staging rollout

- [ ] 4.1 Merge the feature branch; staging auto-deploys the api-worker; CI green <!-- agent: devops-engineer.fast, depends_on: [2.2], touches: [] -->
- [ ] 4.2 Staging registry row + `RETAILER_API`/`GRANTED` governance via the ops path (or direct D1 by the operator); verify the first ingest end-to-end (workflow instance created, `retail_offers` populated, API returns longero products); staging alks governance stays `REVOKED` — record executed commands in the change notes <!-- agent: devops-engineer.fast, depends_on: [4.1], touches: [] -->

## 5. Production rollout

- [ ] 5.1 Production deploy via the gated workflow (`gh workflow run` with `confirm_deploy=yes`); health gate green <!-- agent: devops-engineer.fast, depends_on: [4.2], touches: [] -->
- [ ] 5.2 Production registry row + `RETAILER_API`/`GRANTED` governance via the ops console; verify the first 00:00 UTC ingest (exactly one `longero` enqueue, workflow instance, `retail_offers` populated) and the public API + product page serving longero items <!-- agent: devops-engineer.fast, depends_on: [5.1], touches: [] -->

## 6. Verification

- [ ] 6.1 Full sweep: typecheck, lint, content lint, unit suites, e2e, D1 suites; evidence recorded — staging and production API/product pages serving the longero catalog, daily-single-enqueue behavior from the producer logs <!-- agent: platform-engineer.build, depends_on: [1.1, 1.2, 2.2, 3.1, 4.2, 5.2], touches: [] -->
