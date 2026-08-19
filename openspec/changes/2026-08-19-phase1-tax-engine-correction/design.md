# Design — Phase 1 Tax Engine Correction

## Context

The core-domain engines are functionally complete but the tax/duty path is incorrect. This design corrects the tax engine without disturbing the working classification, transport, ranking, and declaration modules. The core problem is a taxonomy and data-reconciliation failure, not missing logic: the code has the right shape (ports, adapters, versioned rules, formula dispatch) but the category keys and rate values across three datasets never line up, so the engine silently falls back to invented constants.

## Decisions

### 1. Single canonical tax category taxonomy

Define one taxonomy in `core-domain` that both seeds and the normaliser agree on. Recommendation:

- Excise categories: `beer`, `wine_still`, `wine_sparkling`, `spirits`, `intermediate_products`, `other_fermented`, plus runtime aliases `cider` (resolves to `other_fermented`, flat per-litre) and `rtd`/`lonkero` (resolves to `spirits`, per-litre-of-alcohol).
- Container-duty category: `container_duty` (a dedicated key, distinct from packaging type).

`normaliseCategory()` maps raw strings into these keys. The packaging string stays a separate input for the standard/non-standard container distinction, and is no longer used as the container-duty lookup key.

### 2. Dataset reconciliation

`packages/data-platform/src/seed/tax-rules.seed.ts` and `infra/staging-data/seed.sql` are reconciled to the same taxonomy and the same official values. Staging must carry the same tax model as dev/prod, not a divergent one. Fixes: `wine_still = 0.00` becomes the real per-litre rate; container duty becomes €0.51 (not 0.10/0.15); the `2026-PROPOSAL` unverified rows are either removed or explicitly marked `verification_date = NULL` and excluded from active resolution.

### 3. Category resolution with ABV-tier selection

`TaxRuleRepositoryAdapter.findApplicable()` (or a thin wrapper) resolves by `(taxType, productCategory, asOf)` against the reconciled keys. The excise service selects the correct rule within a category by ABV where a category has tiers (wine, intermediate), instead of returning a single flat rule. The fallback path remains only as a documented ESTIMATED safety net, and its constants are corrected to match the seed.

### 4. Beer formula

`calculateAlcoholExcise()` for the beer/progressive path stops hardcoding `DEFAULT_BEER_TIERS` and instead consumes the rule's `rateValue` and formula reference. Beer is modeled per degree Plato (or the documented hectolitre-percent approximation), consistent with the official source. The `rate` column's documented meaning (€/hl/°Plato) is honored.

### 5. Wine, cider, RTD, other-fermented

- Still wine: ≤1.2% → 0, 1.2–15% → 3.40, 15–18% → 4.55.
- Sparkling wine: >1.2% → 3.73.
- Intermediate products: ≤15% → 3.40, 15–22% → 4.55.
- Cider: flat per-litre-of-product.
- RTD/long drink: per-litre-of-alcohol at the spirits rate.
- `other_fermented` formula corrected from `PER_LITRE_OF_ALCOHOL` to `PER_LITRE_OF_PRODUCT`.

### 6. Container duty

`ContainerDutyService.calculate()` looks up by `container_duty` category key, not by packaging. The €0.51 general rate is applied from the seeded rule; deposit-return exemption and `null → ESTIMATED` semantics are unchanged.

### 7. Version traceability

`ExciseResult` and `ContainerDutyResult` gain a numeric `ruleId`. `LandedCostCalculatorService` writes it into `calculationRecords.exciseRuleVersionId` / `containerDutyRuleVersionId` instead of `null`.

### 8. Golden tests

The `InMemoryTaxRuleRepository` stubs that return `null` are replaced with an in-memory repository seeded from `tax-rules.seed.ts` (or the reconciled staging SQL). Expected values are re-derived from the official Finnish Tax Administration tables and fixed (sparkling 3.73, beer per-°Plato, cider, container duty 0.51).

### 9. Lint

The two raw `Function` types in `calculator-guard-regression.test.ts` are replaced with explicit signatures.

### 10. Rate-review source

`ConfigBackedRateChangeSource.checkForChanges()` reads the configured snapshot path and compares against the last-known rate set, returning `newRatesDetected` when they differ. `createRateUpdateTask()` and the never-auto-publish guard are unchanged.

### 11. Ranking methodology

Either add `/api/v1/ranking/methodology` returning the lockstep-tested `ranking-descriptions.ts` content, or delete the dead `getRankingMethodology()` call so the frontend uses embedded text only. The lockstep compliance test stays.

### 12. Docs resync

Update `docs/tasks.md` and `ARCHITECTURE.md` to match the corrected tax engine and any other stale checkboxes.

## Non-goals

- No change to classification rules, ranking neutrality, transport estimation, or the declaration assistant's read-only contract.
- No change to the deposit-checker tri-state semantics.
- No third-party billing integration.
- No legal-opinion work (external, unchanged).
- No new product categories beyond alcohol.

## Open Questions

- Confirm the official Finnish beer excise model to encode (per °Plato vs. a documented hectolitre-percent approximation) and its 2024/2025/2026 rate values. This must be validated with Finnish tax counsel as part of the pre-launch legal review before the corrected rates are relied on.
