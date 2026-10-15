# Tasks

## 1. Measurement

- [ ] 1.1 Catalog-wide classification script (scripts/, `--stats`/`--dry-run`/apply modes): run the informativeness test and annotation regex over all 20,070 rows, write the quarantine + annotation ID lists to an artifact, and print counts to compare against the 1,425-row sample (0.07 % empty / 0.14 % non-informative / 0.21 % annotated) <!-- agent: platform-engineer.build, depends_on: [], touches: [scripts/classify-product-name-quality.ts] -->

## 2. Gate

- [x] 2.1 Migration `0037_product_name_quality.sql`: `products.name_quality` ('ok' | 'quarantined', default 'ok') + `products.name_annotation` TEXT; add both to the Drizzle schema <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/d1/migrations/0037_product_name_quality.sql, packages/data-platform/src/d1/schema.ts] --> (bd413bf; the repo's table is product_master, not products; hand-written migrations post-0016 carry no meta journal — wrangler d1 migrations apply picks up 0037 lexicographically; full-chain SQL validated on a local node:sqlite build minus FTS5 steps)
- [x] 2.2 Pure gate + stripper module in data-acquisition services; unit tests over live-derived fixtures: empty, "40 %", "ÀN 2022", the annotated Glenfarclas form, pack-notation names (must still pass), normal names untouched <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-acquisition/src/services/name-quality.ts, packages/data-acquisition/src/services/__tests__/name-quality.test.ts] --> (68093d4; 13/13 green on-host (pure, no DB); informativeness = <3 alphabetic residue after stripping annotations/ABV/volume/pack/numerics; annotation = merchant-commentary vocabulary parentheticals, never pack parentheticals; annotated stays 'ok')
- [ ] 2.3 Apply gate + stripper at the persistence path: product upsert sets `name_quality`, stores the stripped display name, and preserves the raw feed name + annotation metadata <!-- agent: platform-engineer.build, depends_on: [2.2], touches: [packages/data-acquisition/src/adapters/upsert-port.adapter.ts, packages/data-acquisition/src/services/pipeline-orchestrator.service.ts] -->
- [ ] 2.4 Listing exclusions: product search repository, unit-price ranking candidates, and savings candidate queries filter `name_quality = 'ok'` by default <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [packages/data-platform/src/repositories/d1/product-search.repository.ts, apps/api-worker/src/routes/unitprice.routes.ts, apps/api-worker/src/routes/savings.routes.ts] -->

## 3. Ops surface

- [ ] 3.1 Ops route + console view listing quarantined rows with raw name, merchant, and observed_at for enrichment <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [apps/api-worker/src/routes/ops.routes.ts, apps/frontend/src/app/[locale]/ops/page.tsx, apps/frontend/src/app/[locale]/ops/components/] -->

## 4. Backfill + verification

- [ ] 4.1 Production backfill: migrate → run classification apply → verify counts match the 1.1 stats artifact <!-- agent: devops-engineer.build, depends_on: [1.1, 2.3, 2.4], touches: [] -->
- [ ] 4.2 Spot-check the live default `BIGGEST_SAVING` top-25: names stripped, no annotated or empty rows, no quarantined rows listed <!-- agent: platform-engineer.fast, depends_on: [4.1], touches: [] -->
- [ ] 4.3 Run typecheck, eslint, and affected suites (data-acquisition, data-platform, api-worker routes) <!-- agent: platform-engineer.fast, depends_on: [2.4, 3.1], touches: [] -->
