# Phase 1 Tax Engine Correction

## Why

Phase 1 compiles, typechecks, and passes 846 tests across six packages, but the tax/duty calculation engine — the single highest-liability code path in the platform — has correctness defects that an audit against the engineering plan and business plan exposed. The system currently computes some alcohol excise and container-duty figures from invented fallback constants rather than official Finnish Tax Administration rates, and it does not record which tax-rule version produced a result.

The specific failures:

- Three divergent tax datasets exist and are never reconciled: the fallback constants in `alcohol-excise.math.ts`, the application seed in `packages/data-platform/src/seed/tax-rules.seed.ts`, and the staging seed in `infra/staging-data/seed.sql`. They use different category taxonomies, different formulas, and different rate values (staging sets `wine_still = 0.00` and container duty at €0.10/€0.15 instead of €0.51).
- The category keys produced by `normaliseCategory()` (`wine`, `intermediate`, `other`, `cider`, `rtd`) do not match the keys stored in either seed (`wine_still`, `wine_sparkling`, `intermediate_products`, `other_fermented`). As a result, wine, intermediate, other-fermented, cider, and RTD always miss the repository and fall back to hardcoded defaults; only `beer` and `spirits` ever resolve a seeded rule.
- Beer excise is computed from hardcoded ABV tiers (0.295 / 0.435 / 0.580 €/l) and ignores the seeded official rate. Finnish beer excise is levied per degree Plato, not per ABV tier.
- Wine tiering is lost: sparkling wine (3.73) and still wine 15–18% (4.55) collapse to a flat 3.40. Intermediate products >15% (4.55) are lost.
- Cider is misclassified as beer (progressive ABV); the seed lumps cider into `other_fermented` with the wrong formula (`PER_LITRE_OF_ALCOHOL` instead of `PER_LITRE_OF_PRODUCT`).
- Container duty lookup uses the packaging string as the category key, so the seeded `all_beverages` rule is unreachable and container duty is always ESTIMATED even when a VERIFIED rule exists.
- `calculationRecords.exciseRuleVersionId` and `containerDutyRuleVersionId` are persisted as `null` because the tax results do not carry the numeric rule id, breaking the "record which tax-rule versions were used" requirement.
- The golden-dataset tests stub the repository to return `null` and therefore never exercise the seeded data; they encode the wrong fallback values as "correct".
- `pnpm lint` fails with 2 errors, leaving the CI lint job red.
- The rate-review source check still returns `newRatesDetected: false` unconditionally, so the recurring review job never detects a published rate change.

## What Changes

1. Reconcile the three tax datasets into a single canonical category taxonomy and a single rate set sourced from official Finnish Tax Administration data.
2. Make category resolution reach the seeded rules (including ABV-tier selection for wine and intermediate products).
3. Correct beer excise to the official per-degree-Plato (hectolitre-percent) formula and honor the rule's `rateValue` instead of hardcoded tiers.
4. Restore still-wine, sparkling-wine, and intermediate-product ABV tiers.
5. Fix cider (flat per-litre) and RTD/long-drink (per-litre-of-alcohol) mapping; correct the `other_fermented` formula.
6. Fix container-duty lookup to resolve by container-duty category key, restore €0.51, and make the seeded rule reachable.
7. Populate the tax-rule version foreign keys on calculation records.
8. Make the golden tests run against seed data with correct official expected values.
9. Fix the two lint errors.
10. Implement the rate-review source check so it actually reads the configured source and detects changes, while keeping the never-auto-publish rule.
11. Add the ranking-methodology endpoint or remove the dead frontend call.
12. Resync `docs/tasks.md` and `ARCHITECTURE.md` to the true state.

## Capabilities

### New Capabilities

None — this change fixes existing Phase 1 capabilities; it introduces no new domain.

### Modified Capabilities

- `tax-duty-engine`: excise and container-duty formulas are corrected to official rates; category resolution reaches seeded rules; calculation records carry tax-rule version ids.
- `data-acquisition`: the rate-review source check reads the configured source instead of hardcoding "no changes".
- `mvp-testing`: golden-dataset tests validate against seeded official rates, not fallback constants.
- `application-api`: a ranking-methodology endpoint is exposed (or the dead frontend call is removed).

## Impact

- Corrects the tax figures that consumers see, eliminating the highest-severity correctness risk identified in the business plan.
- Restores the "every number is explainable" guarantee by recording the tax-rule version that produced each calculation.
- Changes expected values in the golden tests (sparkling wine 3.73, beer per-°Plato, cider, container duty 0.51).
- Changes the seeded tax data (staging `seed.sql` and application `tax-rules.seed.ts` are reconciled).
- Does not change classification rules, ranking neutrality, transport estimation, the declaration assistant's read-only contract, or the deposit-checker's tri-state semantics.
- Legal review tasks remain external and unchanged; the launch gate stays off until they complete.

## Human-Process Tasks

None new. The pre-launch legal review (Phase 1 tasks T1.65–T1.69) remains the gate that must complete before the launch flag is turned on. Tax-counsel validation of the corrected rate values is part of that review.
