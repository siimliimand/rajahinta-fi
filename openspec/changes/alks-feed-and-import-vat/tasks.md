# alks.fi feed and import VAT — Tasks

> Second live merchant (alks.fi, WooCommerce Store API) plus the import-VAT term the merchant's tax model exposes as missing. All implementation tasks go to `platform-engineer` (TypeScript, D1/Drizzle, tax engines, ingestion pipelines); `devops-engineer` has no surface in this change. `fullstack-engineer` is the primary planning agent, not a spawned worker. Ingestion (1.x) and the VAT module (4.1) start in parallel; the calculator (4.3) needs both the VAT module and the schema/mapping work; verification sweeps last. The alks source stays PENDING in governance until a human grants it (2.3), so nothing fetches prematurely.

## 1. Ingestion adapter

- [ ] 1.1 Pure WooCommerce Store API parser in data-acquisition (`alks.parser.ts`): SKU `^[a-z]{2}-\d{13}$` prefix strip to EAN, name regex for ABV/volume, container tokens through `standardizeContainerType`, categories through `mapSourceCategory` with disagreement reported, price minor-units to cents, optional `weightGrams`; golden fixture pinned from the live sample (no image fields) <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-acquisition/src/adapters/alks.parser.ts, packages/data-acquisition/src/adapters/__fixtures__/**, packages/data-acquisition/src/__tests__/alks.parser.test.ts] -->
- [ ] 1.2 `AlksFeedAdapter implements IFeedAdapter`: sequential pagination (per_page 100, `X-WP-TotalPages` bound, page failures collected not thrown), per-row correction errors, ESTIMATED path on parse failure, `weightGrams` optional field added to `RawFeedRecord` <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [packages/data-acquisition/src/adapters/alks.adapter.ts, packages/data-acquisition/src/interfaces/feed-adapter.interface.ts, packages/data-acquisition/src/__tests__/alks.adapter.test.ts] -->
- [ ] 1.3 Wire the adapter into the api-worker compositions (`composeIngestionPipeline`, `composeIngestionStageServices`) and the package exports so `FEED_ADAPTERS` resolves `alks` <!-- agent: platform-engineer.build, depends_on: [1.2], touches: [apps/api-worker/src/queues/pipeline.ts, apps/api-worker/src/workflows/ingestion-steps.ts, packages/data-acquisition/src/index.ts] -->

## 2. Schema, seed, governance

- [ ] 2.1 Forward migration adding `weight_grams` (nullable) to the product master on D1 and pg schema parity <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/d1/**, packages/data-platform/src/schema.ts, packages/data-platform/drizzle/**] -->
- [ ] 2.2 Merchant-registry seed row `alks` (name, country DE, feedUrl `https://alks.fi`, json, 3,600,000 ms) in pg and D1 seeds plus `scripts/seed-d1.ts` <!-- agent: platform-engineer.fast, depends_on: [2.1], touches: [packages/data-platform/src/seed/merchant-registry.seed.ts, scripts/seed-d1.ts] -->
- [ ] 2.3 Register the alks source (`RETAILER_API`) and grant it in staging through the operator console; document the production grant step in the ingestion runbook <!-- agent: platform-engineer.fast, depends_on: [2.2], touches: [docs/**] -->

## 3. Mapping

- [ ] 3.1 `DataMappingService`: persist `weightGrams` to the product master, mark offers with null ABV/volume as ESTIMATED, and pin both paths with tests <!-- agent: platform-engineer.build, depends_on: [1.1, 2.1], touches: [packages/data-acquisition/src/services/data-mapping.service.ts, packages/data-acquisition/src/__tests__/data-mapping.service.test.ts, packages/data-platform/src/repositories/d1/**] -->

## 4. Import-VAT engine

- [ ] 4.1 Core-domain vat module (`packages/core-domain/src/vat/`): pure calculation, versioned rate dataset seed (24% before 2024-09-01, 25.5% from), versioned base rule (price + transport + excise + container duty), effective-date resolution, unit tests with exact numeric vectors <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/core-domain/src/vat/**, packages/data-platform/src/seed/**] -->
- [ ] 4.2 Add the VAT dataset version to idempotency cache-key composition (Nest `IdempotencyService` and api-worker `IdempotencyDO`) beside tax and transport <!-- agent: platform-engineer.build, depends_on: [4.1], touches: [packages/application-api/src/idempotency/**, apps/api-worker/src/do/idempotency.do.ts] -->
- [ ] 4.3 Calculator integration: itemized import-VAT line with rate version, base breakdown, reliability; applied when seller country differs from destination, absent for domestic; `totalCents` includes it when present; legacy `POST /calculations/landed-cost` optional VAT input parity <!-- agent: platform-engineer.build, depends_on: [4.1, 3.1], touches: [packages/core-domain/src/calculator/**, apps/api-worker/src/routes/calculator.routes.ts, packages/application-api/src/calculator/**, packages/application-api/src/calculations/**] -->
- [ ] 4.4 Golden and compliance tests: foreign-seller totals include VAT with traceable provenance, domestic results byte-identical to the pre-change engine, neutrality suite stays green, pre-change records without a VAT line render <!-- agent: platform-engineer.build, depends_on: [4.3], touches: [tests/golden/**, tests/compliance/**] -->

## 5. Transport estimation

- [ ] 5.1 Estimation prefers the stored product weight when present (basis stated in the result) and keeps the volume-based estimate as fallback with unchanged shapes and tests <!-- agent: platform-engineer.build, depends_on: [3.1], touches: [packages/core-domain/src/transport/**] -->

## 6. UI and documentation

- [ ] 6.1 fi/en message-catalog label for the import-VAT breakdown line, passing content lint, rendering nothing when the line is absent <!-- agent: platform-engineer.fast, depends_on: [4.3], touches: [apps/frontend/src/messages/**] -->
- [ ] 6.2 Update ARCHITECTURE.md merchant table and ingestion flow for alks, README merchant line, and the ingestion runbook (governance grant, sweep script usage) <!-- agent: platform-engineer.fast, depends_on: [1.3, 4.3], touches: [ARCHITECTURE.md, README.md, docs/**] -->

## 7. Verification

- [ ] 7.1 Full-catalog sweep script against the live Store API (read-only): EAN pattern coverage, ESTIMATED share, category disagreements; report numbers into the change notes before completion <!-- agent: platform-engineer.fast, depends_on: [1.2], touches: [scripts/] -->
- [ ] 7.2 Full verification: typecheck, lint, content lint, unit suites, golden, data-quality, compliance, e2e, D1 suites, plus a staging smoke of the first alks ingestion run and one foreign-seller calculation showing the VAT line <!-- agent: platform-engineer.build, depends_on: [2.3, 4.4, 5.1, 6.1, 6.2, 7.1], touches: [] -->
