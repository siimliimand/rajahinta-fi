# Tasks — Phase 1 Tax Engine Correction

## 1. Tax category and dataset reconciliation

- [x] 1.1 Define a single canonical tax-category taxonomy and mapping in core-domain so `normaliseCategory()` produces the seed keys (beer, wine_still, wine_sparkling, spirits, intermediate_products, other_fermented, container_duty). <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/core-domain/src/tax/**] -->
- [x] 1.2 Reconcile `packages/data-platform/src/seed/tax-rules.seed.ts` and `infra/staging-data/seed.sql` to one taxonomy and one official rate set; fix `wine_still = 0.00`, container duty `0.10/0.15` → `0.51`, and exclude unverified `2026-PROPOSAL` rows from active resolution. <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [packages/data-platform/src/seed/tax-rules.seed.ts, infra/staging-data/seed.sql] -->
- [x] 1.3 Make category resolution reach seeded rules: align `findApplicable`/`findByCategory` and the excise service so wine/intermediate/other/cider/rtd resolve to real rules, including ABV-tier selection within a category. <!-- agent: platform-engineer.build, depends_on: [1.1,1.2], touches: [packages/data-platform/src/repositories/tax-rate.repository.ts, packages/core-domain/src/tax/services/alcohol-excise.service.ts] -->

## 2. Excise formula correctness

- [x] 2.1 Replace the hardcoded `DEFAULT_BEER_TIERS`/ABV-tier beer model with the official per-degree-Plato (hectolitre-percent) formula; make `calculateAlcoholExcise` honor the rule's `rateValue`. <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [packages/core-domain/src/tax/services/alcohol-excise.math.ts] -->
- [ ] 2.2 Implement ABV-tier selection for still wine (≤1.2 → 0, 1.2–15 → 3.40, 15–18 → 4.55), sparkling wine (>1.2 → 3.73), and intermediate products (≤15 → 3.40, 15–22 → 4.55). <!-- agent: platform-engineer.build, depends_on: [1.2,1.3], touches: [packages/core-domain/src/tax/services/alcohol-excise.math.ts] -->
- [ ] 2.3 Fix cider (flat per-litre-of-product) and RTD/long-drink (per-litre-of-alcohol) mapping; correct the `other_fermented` formula from `PER_LITRE_OF_ALCOHOL` to `PER_LITRE_OF_PRODUCT`. <!-- agent: platform-engineer.build, depends_on: [1.2,1.3], touches: [packages/core-domain/src/tax/services/alcohol-excise.math.ts, packages/data-platform/src/seed/tax-rules.seed.ts] -->

## 3. Container duty

- [ ] 3.1 Fix container-duty lookup to resolve by a container-duty category key (not the packaging string); restore €0.51 and make the seeded rule reachable. <!-- agent: platform-engineer.build, depends_on: [1.2,1.3], touches: [packages/core-domain/src/tax/services/container-duty.service.ts, packages/data-platform/src/repositories/tax-rate.repository.ts] -->
- [ ] 3.2 Preserve deposit-exemption and `null → ESTIMATED` semantics; add/adjust container-duty tests for the corrected lookup. <!-- agent: platform-engineer.build, depends_on: [3.1], touches: [packages/core-domain/src/tax/__tests__/**] -->

## 4. Version traceability

- [ ] 4.1 Add a numeric `ruleId` to `ExciseResult` and `ContainerDutyResult`; populate `calculationRecords.exciseRuleVersionId` and `containerDutyRuleVersionId` instead of `null`. <!-- agent: platform-engineer.build, depends_on: [1.3], touches: [packages/core-domain/src/tax/services/*, packages/core-domain/src/calculator/landed-cost-calculator.service.ts] -->

## 5. Golden tests

- [ ] 5.1 Replace the `InMemoryTaxRuleRepository → null` stubs with a seed-backed repository in the golden tests so they exercise real rates. <!-- agent: platform-engineer.build, depends_on: [1.2,1.3,2.1,2.2,2.3,3.1], touches: [tests/golden/**] -->
- [ ] 5.2 Re-verify and correct all golden expected values against official Finnish Tax Administration rates (sparkling 3.73, beer per-°Plato, cider, container duty 0.51). <!-- agent: platform-engineer.build, depends_on: [5.1], touches: [tests/golden/**, tests/golden/data/products.ts] -->

## 6. Lint

- [x] 6.1 Fix the two raw `Function`-type lint errors in `calculator-guard-regression.test.ts`. <!-- agent: platform-engineer.fast, depends_on: [], touches: [packages/application-api/src/calculator/__tests__/calculator-guard-regression.test.ts] -->

## 7. Rate review source

- [x] 7.1 Implement `ConfigBackedRateChangeSource` to actually read the configured snapshot and return `newRatesDetected` on change; keep the never-auto-publish rule. <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-acquisition/src/services/rate-review-scheduler.service.ts] -->

## 8. Ranking methodology endpoint

- [x] 8.1 Add `/api/v1/ranking/methodology` or remove the dead `getRankingMethodology` frontend call; keep the lockstep compliance test. <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/**, apps/frontend/src/lib/api.ts] -->

## 9. Docs resync

- [ ] 9.1 Resync `docs/tasks.md` and `ARCHITECTURE.md` to the true implementation state. <!-- agent: platform-engineer.fast, depends_on: [1.1,1.2,1.3,2.1,2.2,2.3,3.1,3.2,4.1,5.1,5.2,6.1,7.1,8.1], touches: [docs/tasks.md, docs/ARCHITECTURE.md] -->
