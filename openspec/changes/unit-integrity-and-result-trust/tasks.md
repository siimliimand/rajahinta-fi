# Unit integrity and result trust — Tasks

> Group 1 unblocks everything display-side (canonical litres change what the formatters receive). Group 2 and 3 are independent of each other. Rollout is last: production backfill runs only after the worker deploy, because new code expects litres.

## 1. Catalog data integrity (units + entities)

- [x] 1.1 Mapper writes litres: `unitVolume: String(record.volumeMl / 1000)` in `DataMappingService.mapToProductAndOffer`; unit tests cover standard bottles (500 → 0.5, 750 → 0.75), BIB (3000 → 3), and miniature rounding (150 → 0.15) <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-acquisition/src/services/data-mapping.service.ts, packages/data-acquisition/src/__tests__/**] -->
- [x] 1.2 Decode HTML entities (named + numeric: `&#038;`, `&amp;`, `&#8221;`, `&#215;`, …) in feed `productName`/`brand` at mapping time; unit tests pin the observed entity cases from the live catalog <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-acquisition/src/services/data-mapping.service.ts, packages/data-acquisition/src/__tests__/**] -->
- [x] 1.3 Backfill: one-time D1 pass dividing ml rows (`unit_volume >= 5`) by 1000 and entity-decoding stored `name`/`brand` (SQL in `backfill.sql`); apply locally with before/after counts (local expect ~1,502 ml-like of 1,570); normalize the seed pipeline (`scripts/seed-d1.ts` export path) so reseeding cannot reintroduce ml <!-- agent: platform-engineer.build, depends_on: [1.1, 1.2], touches: [scripts/seed-d1.ts, openspec/changes/unit-integrity-and-result-trust/backfill.sql] -->
- [ ] 1.4 Data-quality invariant `0 < unit_volume < 100` enforced in the ingestion quality stage; D1 seeded-data test and a regression test pinning the Koskenkorva 0.5 L case through calculator mapping <!-- agent: platform-engineer.build, depends_on: [1.3], touches: [apps/api-worker/src/workflows/ingestion-steps.ts, apps/api-worker/src/__tests__/**, packages/data-platform/src/d1/__tests__/**] -->
- [x] 1.5 D1 port guard: `d1-domain-ports.ts` reads litres canonically; rows with implausible volume (≥ 100 L) degrade reliability to ESTIMATED and increment a metric, never silently multiplied; adapter tests for the guard and for the correct 0.5 L path <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [apps/api-worker/src/adapters/d1-domain-ports.ts, apps/api-worker/src/adapters/__tests__/**] -->

## 2. Calculator sanity rail

- [x] 2.1 Core-domain rail: line excise > 5× line retail price (named constant, documented rationale) → overall confidence LOW, affected component statuses ESTIMATED, `sanityNotes` added to the result; amounts byte-unchanged; golden suite stays green; new unit tests plus one golden-shape test asserting the Koskenkorva-case shape (excise ≫ price) degrades instead of passing VERIFIED <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/core-domain/src/calculator/**, tests/golden/**] -->
- [x] 2.2 ResultCard + CalculatorResult render the degraded state: visible LOW-confidence note driven by `sanityNotes`; fi/en messages in parity <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [apps/frontend/src/app/[locale]/calculator/components/**, apps/frontend/src/messages/en.json, apps/frontend/src/messages/fi.json] -->

## 3. Price visibility

- [x] 3.1 Search route offer aggregation fix: `lowestPriceCents`/`merchantCount` match product-detail offers for the same product id (kippis rows currently null/0 while detail shows an offer); route test with kippis-shaped offer rows <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/api-worker/src/routes/search.routes.ts, apps/api-worker/src/routes/__tests__/search.routes.test.ts] -->
- [x] 3.2 ProductSearch rows render the lowest observed price; Configure step shows the selected product's best current price before the first calculation; fi/en copy <!-- agent: platform-engineer.build, depends_on: [3.1], touches: [apps/frontend/src/app/[locale]/calculator/components/ProductSearch.tsx, apps/frontend/src/app/[locale]/calculator/calculator-view.tsx, apps/frontend/src/messages/en.json, apps/frontend/src/messages/fi.json] -->

## 4. Display formatting

- [ ] 4.1 `formatAbv` (fraction × 100, ≤ 1 decimal — kills `14.499999999999998%`) and `formatVolume` (canonical litres → trimmed `0.5 l` / `50 cl` rendering with unit label) helpers in the frontend lib; applied across calculator search rows, products listing, product detail, calculator configure/summary, and compare <!-- agent: platform-engineer.build, depends_on: [1.3], touches: [apps/frontend/src/lib/**, apps/frontend/src/app/[locale]/**] -->
- [ ] 4.2 Enum label translations: category and containerType render through message catalogs (reuse existing category filter keys; add container-type keys), fi/en parity pinned by the messages test <!-- agent: platform-engineer.fast, depends_on: [4.1], touches: [apps/frontend/src/messages/en.json, apps/frontend/src/messages/fi.json, apps/frontend/src/app/[locale]/products/[id]/page.tsx] -->

## 5. Verification + rollout

- [ ] 5.1 Full local verification: typecheck, lint, content lint, unit, golden, e2e, D1 suites; browser pass recording evidence in change notes — Koskenkorva case total lands in the plausible range (price ≈ €98.70 + excise ≈ €107 + duty ≈ €2.55 + transport 0), value ranking loses the tonne-scale ethanol artifact, search rows show prices <!-- agent: platform-engineer.fast, depends_on: [1.4, 1.5, 2.2, 3.2, 4.2], touches: [] -->
- [ ] 5.2 Production: gated worker deploy (`gh workflow run` with `confirm_deploy=yes`), remote D1 backfill with before/after counts recorded in change notes, verify a sweep product's live calculator result shows plausible excise with the sanity rail armed <!-- agent: devops-engineer.fast, depends_on: [5.1], touches: [] -->
