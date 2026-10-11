# Ferry onboard prices — Tasks

> Sweep (1.1) gates everything: no dataset work before the go/no-go is recorded. Curated-source tasks (2.x) are `platform-engineer` (TypeScript, data-acquisition/data-platform); the compliance extension (3.2) must land before any staging exposure of the block. Local → staging → production strictly ordered; production last; verification last of all.

## 1. Sweep (read-only, gate)

- [x] 1.1 Read-only sweep of the Tallink Silja / Viking Line / Eckerö pre-order shops (`scripts/ferry-shop-sweep.ts`): probe feed shape (WooCommerce/Shopify/custom), currency, category vocabulary, product-label overlap candidates, terms-of-use posture per operator; record findings + go/no-go in the change notes <!-- agent: platform-engineer.fast, depends_on: [], touches: [scripts/ferry-shop-sweep.ts, openspec/changes/ferry-onboard-prices/notes.md] -->

## 2. Curated dataset + storage

- [x] 2.1 D1 migration `ferry_price_observations` (operator, route, label, price_cents, observed_at, citation, unique per operator+route+label+observed_at) + `FerryPriceRepository` (published-row reads, idempotent upsert) with D1-integration tests <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [packages/data-platform/src/d1/schema.ts, packages/data-platform/src/d1/drizzle/*.sql, packages/data-platform/src/d1/repositories/ferry-price.repository.ts] -->
- [x] 2.2 Curated dataset `ferry-price.source.ts` (Fransberg/Posti pattern: `OBSERVED_AT` + transcribed rows with citations) + monthly curated-rate-refresh cron wiring with unchanged-skip + governance fail-closed; ingestion-runbook section for the operator transcription + grant procedure <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [packages/data-acquisition/src/adapters/ferry-price.source.ts, apps/api-worker/src/cron/**, docs/ingestion-runbook.md] -->

## 3. API + compliance

- [ ] 3.1 Additive `ferryPrices` block on trip fill/feasibility responses (published rows only, full provenance, no other field touched); age gate + CALCULATOR limiter + idempotency unchanged <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [apps/api-worker/src/routes/trip.routes.ts, apps/api-worker/src/routes/trip-feasibility.routes.ts] -->
- [ ] 3.2 Extend `tests/compliance/trip-affiliate-neutrality.test.ts`: byte-identity of all calculation output across zero/one/many `ferryPrices` rows <!-- agent: platform-engineer.build, depends_on: [3.1], touches: [tests/compliance/trip-affiliate-neutrality.test.ts] -->

## 4. Frontend

- [ ] 4.1 Trip result "Laivaston havaitut hinnat" collapsed block (operator, route, price, observed-at, citation, observed-facts disclaimer) + designed empty state + FI/EN message-catalog copy passing content lint + component tests <!-- agent: platform-engineer.build, depends_on: [3.1], touches: [apps/frontend/src/app/[locale]/trip/**, apps/frontend/**/messages/**] -->

## 5. Rollout

- [ ] 5.1 Local + staging: apply migration, register operator governance rows (PENDING → GRANTED), load first curated dataset, verify block renders with provenance on staging and renders nothing when unpublished <!-- agent: devops-engineer.fast, depends_on: [3.2, 4.1], touches: [openspec/changes/ferry-onboard-prices/notes.md] -->
- [ ] 5.2 Production gated deploy; migration + governance + dataset publication; verify public trip page block + exactly one monthly-cron ingest behavior recorded in notes <!-- agent: devops-engineer.fast, depends_on: [5.1], touches: [openspec/changes/ferry-onboard-prices/notes.md] -->

## 6. Verification

- [ ] 6.1 Full verification: typecheck, lint, content lint, unit suites, D1 suites, compliance suite green with the extended byte-identity test; evidence (staging/production trip page block, cron skip behavior) recorded in notes <!-- agent: platform-engineer.fast, depends_on: [2.2, 3.2, 4.1, 5.2], touches: [openspec/changes/ferry-onboard-prices/notes.md] -->
