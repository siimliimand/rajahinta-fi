# Onboard mydrink merchant — Tasks

> Sweep (1.x) gates the vocabulary and adapter work; 1.2's re-sweep measures the drop-rate improvement the new keys buy. Code tasks are `platform-engineer` (TypeScript, data-acquisition/core-domain); env rollouts split deploys (`devops-engineer`) from registry/governance verification. Local → staging → production strictly ordered; production last. Verification last of all.

## 1. Catalog sweep (read-only)

- [x] 1.1 `scripts/mydrink-catalog-sweep.ts` cloned from the kippis sweep (`COLLECTION_URL` = `https://mydrink.ee/wp-json/wc/store/v1/products`, `PER_PAGE` 100, adapter-parity walk discipline, added brand-coverage and product-type censuses); walked all 707 products through `parseAlksStoreProducts` and reported the drop taxonomy (443 no-canonical-category drops), the 70-term Estonian category census, the 100% internal-SKU gap, 0% brand coverage, and 100% `type: simple`; findings recorded in the change notes with go for tasks 1.2 and 2.1 <!-- agent: platform-engineer.fast, depends_on: [], touches: [scripts/mydrink-catalog-sweep.ts, openspec/changes/onboard-mydrink-merchant/notes.md] -->
- [x] 1.2 Extend `SWEDISH_SOURCE_CATEGORY_MAP` (`packages/core-domain/src/normalization/source-category.mapper.ts`) with the sweep-scoped MyDrink terms (design D3 table: `kange alkohol ▾`, `vodka`, `viski`, `konjak`, `rumm`, `gin`, `liköör`, `punased`, `valged`, `pakiveinid`, `vahuveinid`, `shampanjad`, `õlu ▾`, `siider`, `alkoholivaba ▾`, `karastusjoogid` per census spelling) with tests; deliberately NOT mapped: the wine parent `veinid ▾`, cocktails, promo/decorative terms; re-run the sweep and record the new parse rate and the wine-leaf remainder in the notes <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [packages/core-domain/src/normalization/source-category.mapper.ts, packages/core-domain/src/normalization/__tests__/source-category.mapper.test.ts, openspec/changes/onboard-mydrink-merchant/notes.md] -->

## 2. Adapter + wiring

- [x] 2.1 Add `MydrinkFeedAdapter` (`merchantId: 'mydrink'`, thin `WooStoreFeedAdapter` subclass, no parser or walk change) with golden fixtures + unit tests (mydrink-shaped rows: internal-code SKUs kept EAN-less, sale prices, Estonian categories, `weight` kg parsing, empty brands); export from the package index; register in both composition sites — `composeIngestionStageServices` (apps/api-worker ingestion-steps adapter map) and `composeIngestionPipeline` (apps/api-worker queues/pipeline); composition tests assert five live adapters resolve by merchantId <!-- agent: platform-engineer.build, depends_on: [1.2], touches: [packages/data-acquisition/src/adapters/mydrink.adapter.ts, packages/data-acquisition/src/adapters/__fixtures__/**, packages/data-acquisition/src/__tests__/**, packages/data-acquisition/src/index.ts, apps/api-worker/src/workflows/ingestion-steps.ts, apps/api-worker/src/queues/pipeline.ts] -->

## 3. Local rollout

- [ ] 3.1 Local D1: registry row (`mydrink`, name `MyDrink`, country `EE`, feedUrl `https://mydrink.ee`, json, `86_400_000`) + governance record (`RETAILER_API`, `GRANTED`, sourceUrl `https://mydrink.ee/wp-json/wc/store/v1/products`); run the producer tick + ingestion workflow end-to-end locally against the live feed (read-only GETs); verify `retail_offers` rows land, compound-key matching is idempotent across a second run (no duplicate `product_master` rows), and the API serves mydrink offers <!-- agent: platform-engineer.fast, depends_on: [2.1], touches: [openspec/changes/onboard-mydrink-merchant/notes.md] -->

## 4. Staging rollout

- [ ] 4.1 Open PR from the feature branch; CI green (all required checks); merge; staging auto-deploys the api-worker <!-- agent: devops-engineer.fast, depends_on: [3.1], touches: [] -->
- [ ] 4.2 Staging registry row + `RETAILER_API`/`GRANTED` governance via the ops path (or direct D1 by the operator); trigger the first ingest via the Workflows REST API; verify end-to-end (workflow instance `complete`, `retail_offers` populated, mydrink products as their own catalog rows, API returns mydrink offers); record executed commands in the change notes <!-- agent: devops-engineer.fast, depends_on: [4.1], touches: [openspec/changes/onboard-mydrink-merchant/notes.md] -->

## 5. Production rollout

- [ ] 5.1 Production deploy via the gated workflow (`gh workflow run deploy-production.yml` with `confirm_deploy=yes`); health gate green <!-- agent: devops-engineer.fast, depends_on: [4.2], touches: [] -->
- [ ] 5.2 Production registry row + `RETAILER_API`/`GRANTED` governance via the ops console (direct D1 fallback with the audit-events deviation recorded); trigger the first ingest manually; verify the public API + product page serving mydrink items; record the follow-up checklist for the next scheduled 00:00 UTC boundary (exactly one `mydrink` enqueue, one workflow instance, offers refreshed) <!-- agent: devops-engineer.fast, depends_on: [5.1], touches: [openspec/changes/onboard-mydrink-merchant/notes.md] -->

## 6. Verification

- [ ] 6.1 Full verification: rebuild `@rajahinta/core-domain` first, then typecheck, lint, content lint, unit suites, e2e, D1 suites; evidence recorded — staging and production API/product pages serving the mydrink catalog, compound-key idempotency across runs, daily-single-enqueue behavior from the producer logs <!-- agent: platform-engineer.fast, depends_on: [1.1, 1.2, 2.1, 3.1, 4.2, 5.2], touches: [openspec/changes/onboard-mydrink-merchant/notes.md] -->
