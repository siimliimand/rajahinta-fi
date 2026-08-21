# Phase 0 + Phase 1 Verification — Findings & Fix Plan

> **Superseded by round 2.** See `docs/phase-0-1-verification-round-2.md` for
> the follow-up audit (runtime composition, vocabulary fix, deploy sequencing)
> and the `phase0-1-runtime-composition-fix` change that resolves the findings below.

> **Audit date:** 2026-08-21
> **Scope:** Deep verification of Phase 0 (Foundation) and Phase 1 (MVP) against
> `docs/rajahinta-fi-implementation-plan.md` and `docs/tasks.md`.
> **Excluded:** T1.65–T1.69 (manual legal/owner tasks — see `docs/legal-tasks-guide.md`).
> **Verdict: Phase 0 NOT fully implemented (CI/CD inert). Phase 1 NOT correctly
> implemented (core tax dataset contradicts official law; several functional defects).**

---

## 1. Verification method

| Check | Result |
|---|---|
| `pnpm typecheck` | ✅ pass |
| `pnpm lint` | ✅ pass |
| `pnpm build` | ✅ pass |
| `pnpm test` (unit, all workspaces) | ✅ pass |
| `pnpm test:golden` | ✅ pass — **but encodes wrong rates** (see C1) |
| `pnpm test:compliance` | ✅ pass |
| `pnpm test:load` | ✅ pass (in-process benchmark only) |
| `pnpm test:e2e` | ❌ **fail — suite-level DI error, all 16 tests skipped** (C4) |
| GitHub Actions trigger analysis | ❌ CI + staging deploy never run (C3) |
| Seeded tax rates vs official vero.fi table | ❌ **wrong in nearly every category** (C1, C2) |
| Sub-audits: calculator/classification, tax engine, API/compliance/accounts, frontend/infra/tests | 4 reports folded into findings below |

Official rate source used for comparison (fetched 2026-08-21):
[vero.fi — Alkoholi- ja alkoholijuomaverotaulukko](https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/alkoholijuomavero/alkoholi-ja-alkoholijuomaverotaulukko/)

---

## 2. What IS correctly implemented (verified)

To keep the verdict fair — large parts of Phase 1 are genuinely done and done well:

- **Schema & data platform** (T1.1–T1.5): all tables present; tri-state
  `depositSystemStatus` (`boolean | null`) handled end-to-end; append-only
  `taxRules` with effective ranges; `calculationRecords` FKs to exact rule
  versions + disclaimer.
- **Calculation engine math**: all three formulas are unit-correct.
  `calcPerDegreePlato(36.20, 0.05, 1.0)` = 181 snt = exactly the official duty
  for 1 l of 5 % beer. **The engine is right; the data fed to it is not.**
- **Ranking structural neutrality** (T1.37–T1.39, T1.53): input type has no
  commercial fields, compile-time neutrality assertion, runtime unknown-key
  guard, alphabetical tiebreakers.
- **Launch gating**: three env gates default OFF; calculator/search 403 until
  opened; `LAUNCH_GATES_OVERRIDE` dev-only.
- **Rate-review design** (T1.23): snapshot diff → *pending review entry*;
  never auto-publishes. Correct and important design.
- **Jobs** (T0.8): 4 real BullMQ workers + cron scheduler, real processors.
- **Observability** (T0.9–T0.11): KPI service (4 categories), ops dashboard,
  cost attribution.
- **Data acquisition** (T1.7–T1.11): ingestion, pipeline orchestrator, mapping,
  upsert adapter, governance (PENDING default), data-quality with staleness +
  no-silent-verified checks.
- **Staging environment**: staging seed, K8s seed Job, overlays; production
  overlay correctly excludes the seed Job.
- **Content lint, outbound redirect neutrality, entitlement guard, retention
  worker, identity-document zero-fields** — all present.

---

## 3. Findings

### CRITICAL

#### C1. Seeded excise dataset contradicts the official vero.fi rates in nearly every category

`docs/tasks.md` T1.22 is checked `[x]` claiming "sourced from official Finnish
Tax Administration data". The citations exist; **the values are wrong.** The
seed (`v1.0-2024`) vs the official table:

| Category | Seed (v1.0-2024) | Official vero.fi 2024 | Error |
|---|---|---|---|
| Beer > 3.5 % | 33.00 "€/hl/°Plato" | **36.20 snt/cl ethanol** | wrong value + wrong legal basis label (law taxes per cl of ethyl alcohol, not per degree Plato) |
| Beer 0.5–3.5 % | *(missing — gets 33.00)* | **28.35 snt/cl ethanol** | missing tier |
| Wine > 2.8–5.5 % | 3.40 €/l (band starts at 1.2 %) | **1.98 €/l** (band > 2.8 %) | wrong band + value |
| Wine > 5.5–8 % | 3.40 €/l | **3.08 €/l** | wrong |
| Wine > 8–15 % | 3.40 €/l | **4.56 €/l** | wrong (−25 %) |
| Wine > 1.2–2.8 % | treated as **exempt** | **0.36 €/l — taxable** | false exemption |
| Sparkling wine | separate category, 3.73 €/l | **no separate category** (taxed as wine) | fabricated category + rate |
| Spirits ≥ 1.2 % | 29.50 €/l pure alcohol | **54.80 €/l pure alcohol** (CN 2208 > 2.8 %) | **−46 %**; also missing > 1.2–2.8 % band (30.90 snt/cl) |
| Intermediate 1.2–15 % | 3.40 €/l | **5.68 €/l** | −40 % |
| Intermediate > 15–22 % | 4.55 €/l | **8.63 €/l** | −47 % |
| Other fermented > 2.8 % | 3.40 €/**l pure alcohol** | wine bands **per litre of product** (1.98/3.08/4.56) | wrong basis + values |
| Other fermented 1.2–2.8 % | exempt | **0.36 €/l** | false exemption |
| Small brewery | flat 16.50 (50 %), `maxAnnualProductionHl: 100_000`, comment "< 500 000 l/year" | **progressive 10–50 % relief, production ceiling 15 000 000 l/year** (HE 106/2024; vero.fi pienpanimoalennus guidance) | flat-vs-progressive, wrong ceiling, comment contradicts data by 20× |
| Container duty | 0.51 €/l | 0.51 €/l | ✅ plausible for 2024 — re-verify date basis |

Worked example: 0.7 l 40 % vodka → official excise **€15.34**; seed computes
**€8.26**. A 5 % 0.5 l beer → official **€0.905**; seed computes **€0.825**.

**Wrong values are encoded in 7 files** (all must change together):
- `packages/data-platform/src/seed/tax-rules.seed.ts` (source dataset)
- `packages/core-domain/src/tax/services/alcohol-excise.math.ts` (`DEFAULT_RATES` fallbacks, lines 45–55)
- `packages/core-domain/src/tax/tax-categories.ts` (doc comments, lines 10–14)
- `tests/golden/helpers/in-memory-tax-rule.repository.ts` (mirrors seed)
- `tests/golden/golden-dataset.test.ts` + `tests/golden/data/products.ts` + `tests/golden/per-category.test.ts` (expected values)
- `apps/backend/tests/e2e/calculator.test.ts` (expects excise 83 ¢; official 2024 = 91 ¢)
- `packages/core-domain/src/tax/__tests__/alcohol-excise.math.test.ts`, `alcohol-excise.service.test.ts`

**Why everything still passes:** the golden/unit/e2e tests hardcode the same
wrong numbers — a garbage-in consensus. This is the platform's highest-severity
risk class per its own business plan (incorrect tax information shown to users).

#### C2. Tax dataset is stale — presented as current law in 2026

`v1.0-2024` rows are `effectiveFrom 2024-01-01, effectiveTo null` — i.e.
claimed valid forever. It is 2026-08-21. The official table has since changed:

| Rate | 2024 | 2025 | 2026 |
|---|---|---|---|
| Beer > 3.5 % (snt/cl) | 36.20 | 36.20 | **36.71** |
| Beer 0.5–3.5 % (snt/cl) | 28.35 | 28.35 | **28.75** |
| Wine > 2.8–5.5 % (snt/l) | 198 | 198 | **219.02** |
| Wine > 5.5–8 % (snt/l) | 308 | 308 | **340.70** |
| Wine > 8–15 % (snt/l) | 456 | 456 | **504.97** |
| Intermediate > 1.2–15 (snt/l) | 568 | 568 | **575.95** |
| Intermediate > 15–22 (snt/l) | 863 | 874 | **886.24** |
| Spirits > 2.8 % (snt/cl) | 54.80 | 54.80 (> 2.8–10) / **55.50** (> 10) | 55.57 (> 2.8–10) / **56.28** (> 10) |
| Wine > 1.2–2.8 % (snt/l) | 36 | 36 | 36 **until 31.3.2026, then 50 from 1.4.2026** |

Note the **intra-year 2026 change** (1.4.2026) — it exercises exactly the
effective-range machinery this repo has, and that machinery has a boundary bug
(M1). The rate-review scheduler (T1.23) was designed to catch this, but the
configured snapshot was never updated, so nothing was ever flagged.

#### C3. CI and staging deploy never run — wrong branch triggers

The repository's default branch is **`master`** (PRs #16/#17 merged into
master). But:

- `.github/workflows/ci.yml` triggers on `pull_request/push: branches: [main]`
  → **never fires**. T0.4 exists as a file, runs zero times.
- `.github/workflows/deploy-staging.yml` triggers on `push: branches: [main]`
  → **never fires**. Staging deploys never happen from CI.
- Additionally, the current minimal `ci.yml` (commit 3753a5e) **replaced** a
  richer version (commit 0e2fe9b) and lost the `build`, `data-quality`,
  `compliance`, `content-policy`, and `e2e` jobs plus the `ci-pass` gate job.
  Today's CI would only run lint + typecheck + unit + golden.
- `load-tests.yml` targets `master` (correct); `deploy-production.yml` uses
  `workflow_dispatch` (correct). The frontend/infra sub-audit initially
  mis-read `main` in ci.yml as the default branch — git history confirms
  master is default, so ci.yml and deploy-staging.yml are the broken pair.

Net effect: **no CI enforcement at all** on the default branch since the
trigger regression landed. Type/lint/test regressions can merge unnoticed.

#### C4. E2E suite is red — cannot run at all

`pnpm test:e2e` fails at suite setup: *"Nest can't resolve dependencies of the
TransactionClassificationService (?, ClassificationRuleEngine)"* → all 16 tests
skip, exit code 1. Root cause: **dual class identities** —
`vitest.config.e2e.ts` aliases `@rajahinta/core-domain` and
`@rajahinta/frontend` to `src/`, but `@rajahinta/application-api` and
`@rajahinta/data-platform` resolve to their `dist/` builds. The same class gets
loaded twice under two module identities; `@Optional()` injection tokens and
class-based DI then mismatch. (Also: `apps/backend/tests/e2e/calculator.test.ts:56`
declares a local `TRANSPORT_OFFER_QUERY` string token instead of importing the
exported domain constant — same class of hazard.)

### HIGH

#### H1. GDPR right-to-erasure is a no-op in production wiring

`packages/application-api/src/accounts/account.service.ts:270-288` —
`anonymizeAccount()` in DB mode logs a warning ("not yet implemented") and
**returns without doing anything**. Only the in-memory fallback path works.
T1.58–T1.64 cannot be called correctly implemented while erasure silently
no-ops against Postgres.

#### H2. AccountService silently falls back to in-memory storage if DI fails

`account.service.ts` takes `@Optional()` repositories with in-memory `Map`
fallbacks and **no production guard**. A DI misconfiguration in production
means account data lives in RAM: lost on restart, no retention enforcement, no
export. It should fail-fast outside test environments.

#### H3. Correction mechanism has no user-facing UI

`POST /api/v1/corrections` exists, but there is no frontend component to flag
a calculation. `docs/legal-tasks-guide.md` lists the correction-mechanism gate
as "already built & tested" — the API is; the user-facing path (which the
launch condition is about) is not.

### MEDIUM

- **M1. `effectiveTo` boundary excludes a rule on its own expiry date.**
  `packages/data-platform/src/repositories/tax-rate.repository.ts` uses
  `gt(effectiveTo, asOf)` (lines 47/84/147/173/191/222). With the SCD
  convention (and the 2026 intra-year change), a rule must apply **through**
  its end date: use `gte` on `effectiveFrom` + `lte` on `effectiveTo`
  (half-open intervals are fine only if consistently implemented and tested —
  currently neither). No gap/overlap validation exists when new versions are
  published, and no boundary tests exist (`effectiveTo === asOf`, ABV edges
  0.5 / 2.8 / 5.5 / 8 / 15 / 18, 1.4.2026).
- **M2. Audit trail never written.** `AuditService.logChange()` has **zero
  call sites** outside its own tests. Tax-rule publications, classification
  rule-set changes, ranking-logic changes (the spec's named high-liability
  entities, T1.51) are not audit-logged.
- **M3. Reliability vocabulary is split.** `ReliabilityStatus` =
  `VERIFIED|STALE|UNAVAILABLE|ESTIMATED` vs `DataReliability` =
  `EXACT|ESTIMATED|STALE|UNAVAILABLE`, bridged ad hoc in
  `landed-cost-calculator.service.ts:50-52` (EXACT→VERIFIED);
  `calculator.types.ts:86` types `reliabilityStatus: string`. One vocabulary
  should win.
- **M4. TravellerImport classification is unreachable through the calculator.**
  `landed-cost-calculator.service.ts:177` hardcodes `buyerIsTravelling: false`;
  `CalculatorInput` has no transport-arrangement field. A user who imports
  goods personally is always classified as distance selling/buying and told
  they owe excise + advance notice — wrong for that cohort.
- **M5. Idempotency cache key excludes dataset versions.**
  `idempotency.service.ts` `hashInput()` hashes product/quantity/destination/
  transport only. Versions are compared at lookup time (mitigation) — verify
  the comparison covers **all** dataset inputs, or fold versions into the key.
- **M6. Load-test claims vs reality.** `docs/staging-verification.md` instructs
  `k6 run tests/load/calculator-load.test.ts` and `npm install -g k6` — this
  cannot work (the file is a vitest suite; k6 is a Go binary, not an npm
  package). `deploy-staging.yml` runs in-process `pnpm test:load` with an
  unused `STAGING_URL`. `artillery` sits unused in devDependencies. No
  HTTP-level load test exists.
- **M7. Ranking methodology lockstep coverage uncertain.** The compliance spec
  requires the public methodology page to be generated from / kept in lockstep
  with the implementation. Sub-audits disagree on whether a lockstep test
  exists (`tests/compliance/neutrality-compliance.test.ts` vs controller
  tests). Verify and, if missing, add: endpoint output ⇔ RankingService
  descriptions.
- **M8. Age-gate guard coverage unverified across all alcohol-content API
  routes.** Frontend gate is localStorage-based (acceptable as lightweight
  confirmation per plan), but backend `AgeGateGuard` coverage per controller
  should be enumerated and tested.

### LOW

- **L1. `docs/tasks.md` out of sync.** Many boxes unchecked though implemented
  (T0.4/T0.5/T0.6, T1.49, T1.50, T1.60, T1.62–T1.64 …), while checked boxes
  now overclaim (T1.22 values wrong; "e2e passing" claims).
- **L2. Schema exists twice** — Drizzle `schema.ts` and hand-written
  `infra/staging-data/schema.sql`, no Drizzle migrations. Drift risk; pick one
  source of truth (recommend Drizzle `generate` → committed migrations).
- **L3. Seed-job lifecycle in `deploy-staging.yml`** deletes then waits for a
  Job it never explicitly creates (relies on kustomize apply); make ordering
  explicit. Production deploy lacks staging-level env/secrets rigor.
- **L4. Wine "> 15–18 %" band** exists in official table as its own row
  (456 snt 2024–25, 504.97 in 2026) — include when re-banding (C1).

---

## 4. Fix plan

Workstream order: **WS1 first** (data truth — everything downstream depends on
it), then WS2/WS3/WS4 in parallel, then WS5, then WS6. Nothing here touches
T1.65–T1.69.

### WS1 — Tax dataset truth (C1, C2, M1, L4) — *blocking, highest priority*

**WS1.1 — Correct the category/band model in the seed.**
Replace `SEED_RULES` in `packages/data-platform/src/seed/tax-rules.seed.ts`
with the official structure (bands per category, `appliesTo`
min/max `alcoholByVolume` matching the official "yli X mutta enintään Y"
half-open semantics; rates in the unit the corresponding formula expects):

- beer: two tiers — > 0.5–3.5 % and > 3.5 % — per-cl-ethanol (36.20/28.35 for 2024); ≤ 0.5 % stays 0
- wine_still: four bands — > 1.2–2.8 (0.36 €/l), > 2.8–5.5 (1.98), > 5.5–8 (3.08), > 8–15 (4.56) + > 15–18 (4.56) — per litre of product
- wine_sparkling: same bands/values as still wine (no separate legal rate)
- intermediate_products: > 1.2–15 (5.68), > 15–22 (8.63) — per litre of product
- spirits: > 1.2–2.8 (30.90 snt/cl), > 2.8 (54.80 snt/cl) — per cl ethanol
- other_fermented: wine bands (per litre of product); delete the per-alcohol-litre variant
- container duty: 0.51 €/l confirmed with its own vero.fi source URL + effective date

**WS1.2 — Version the dataset correctly (never in-place edits).**
Add `v2.0-2025` and `v3.0-2026` rule sets (2026 values incl. the 1.4.2026
split into two rows for wine > 1.2–2.8: `effectiveFrom 2026-01-01 /
effectiveTo 2026-03-31` = 36 snt, `effectiveFrom 2026-04-01 / effectiveTo
null` = 50 snt). Close `v1.0-2024` rows with `effectiveTo 2024-12-31` and
`v2.0-2025` with `2025-12-31` via the publish mechanism. Route the change
through the existing pending-review → approve flow (T1.23 machinery) so a
review entry records the legal confirmation — that is the designed path.

**WS1.3 — Fix the formula constant naming.**
Rename/alias `FORMULA_PER_DEGREE_PLATO` → `FORMULA_PER_CENTILITRE_ETHANOL`
(the math is already correct; the name and doc comments are legally wrong —
Finnish beer duty is per centilitre of ethyl alcohol). Keep the old string
accepted in `calculateAlcoholExcise` dispatch for existing DB rows; new rows
use the corrected constant. Update `calcPerDegreePlato` doc comments.

**WS1.4 — Small-brewery relief.**
Re-source from vero.fi *pienpanimoalennus* guidance (progressive 10–50 % by
annual production, ceiling 15 000 000 l/year; tied/ownership restrictions per
alkoholiverolain 9 §). Replace the single fabricated row with a tiered
representation (multiple rows with production-volume conditions, or extend
`appliesTo`). If the engine cannot yet evaluate progressive tiers, ship the
general rate only and mark small-brewery as UNAVAILABLE (never silently
wrong).

**WS1.5 — Repository boundary + integrity.**
In `tax-rate.repository.ts`: `gt(effectiveTo, asOf)` → `lte(effectiveTo,
asOf)` (and audit every range predicate for consistent half-open semantics);
add publish-time gap/overlap validation per (taxType, productCategory); add
boundary tests: rule expiring exactly on asOf, ABV edges 0.5/2.8/5.5/8/15/18
both sides, 31.3.2026 vs 1.4.2026.

**WS1.6 — Align fallbacks, docs, and tests with the official values.**
Update `DEFAULT_RATES` (or drop fallback rates entirely — reliability
ESTIMATED already covers "no rule found"; keeping wrong numbers as fallback
is worse than none), `tax-categories.ts` doc comments, and regenerate:
golden fixtures + expectations (bump `GOLDEN_DATASET_VERSION`), per-category
tests, e2e expected values (e.g. 5 % 0.5 l beer 2024: 36.20 × 2.5 cl = 91 ¢,
not 83 ¢), unit tests in `tax/__tests__/`. Add a comment table in the golden
data mapping each expected value to its vero.fi table row.

**WS1.7 — Rate-review snapshot.**
Update the configured snapshot consumed by `ConfigBackedRateChangeSource` to
the current official table so the scheduler's baseline is reality; verify it
creates a pending review entry when a future change appears.

**Acceptance:** golden/compliance/unit/e2e green with official-value
expectations; boundary tests green; seeded staging DB shows v1.0-2024 →
v3.0-2026 with no gaps/overlaps; a review entry exists for the new versions.

### WS2 — Make CI/CD actually run (C3, M6, L3)

1. `ci.yml` + `deploy-staging.yml`: triggers `main` → `master` (keep both
   during transition if a `main` branch ever appears; simplest is
   `branches: [master]`).
2. Restore the lost CI jobs from commit `0e2fe9b`: `build`, `data-quality`,
   `compliance`, `content-policy`, plus `e2e` (after WS3) and the `ci-pass`
   gate job requiring all of them.
3. Fix `docs/staging-verification.md` load-test section: remove the bogus
   `k6 run tests/load/calculator-load.test.ts` / `npm install -g k6`
   instructions; document `pnpm test:load` as an in-process benchmark and add
   either a real HTTP smoke (curl loop or artillery script against
   `STAGING_URL`) or drop the claim. Either use or remove the `artillery`
   devDependency; remove the unused `STAGING_URL` env or use it.
4. Make the staging seed-Job sequence explicit (create → wait → allow re-run);
   bring production deploy env/secrets handling to staging's level.
5. Recommend (GitHub settings, manual): require the CI check on `master` PRs.

**Acceptance:** a PR to `master` triggers full CI incl. e2e and fails on a
deliberately broken commit; push to `master` deploys staging and runs the
post-deploy check.

### WS3 — Repair the e2e suite (C4, L3)

1. `vitest.config.e2e.ts`: alias `@rajahinta/application-api` and
   `@rajahinta/data-platform` to their `src/` like the other packages — one
   class, one identity.
2. Replace the local `TRANSPORT_OFFER_QUERY` string token in
   `apps/backend/tests/e2e/calculator.test.ts:56` with the exported constant.
3. Update expected values per WS1.6; get all 16 tests running and green.
4. Wire `pnpm test:e2e` into CI (WS2.2).

**Acceptance:** `pnpm test:e2e` exits 0 with 16/16 executed (0 skipped), in CI.

### WS4 — Accounts & GDPR (H1, H2)

1. Implement `anonymizeAccount()` for DB mode: irreversible pseudonymization
   via `AccountRepository` (replace identifiers, keep anonymized skeleton for
   referential integrity), cascade to saved baskets, record an audit event;
   unit + integration tests.
2. Fail-fast guard: outside test env, `AccountService` constructor throws if
   repositories are not injected (keep `@Optional()` semantics only for the
   in-memory test harness).
3. Verify retention worker and export path operate on Postgres data
   end-to-end (restart-persistence test already exists per the completeness
   fix — extend to erasure).

**Acceptance:** GDPR export + erasure + retention demonstrably work against
Postgres; erasure of an account leaves no recoverable identifiers.

### WS5 — Correctness gaps (M2, M3, M4, M5, M7, M8, H3)

1. **Audit trail (M2):** call `logChange()` from the rate-review
   publish/approve flow, classification rule-set version publication, and any
   ranking-logic change path; test that each records before/after + actor.
2. **Vocabulary (M3):** collapse `EXACT` into `VERIFIED` (keep
   `ReliabilityStatus`); type `reliabilityStatus` as the union, not `string`;
   update the landed-cost mapping and golden expectations.
3. **Traveller import (M4):** add `transportArrangement` to `CalculatorInput`
   (`SELLER_ARRANGED | INDEPENDENT_CARRIER | PERSONAL`), feed it into
   `TransactionClassificationService` (replacing the hardcoded
   `buyerIsTravelling: false`), return the TravellerImport outcome with its
   "excluded from this calculator" messaging; e2e test for the personal case.
4. **Idempotency (M5):** include dataset versions in `hashInput()` (or prove
   lookup-time comparison covers every dataset input and test that path);
   add a test: same input, new tax version ⇒ new calculation, no stale cache
   hit.
5. **Lockstep (M7):** add/verify test that `GET /api/v1/ranking/methodology`
   output is generated from the same source as the RankingService's actual
   sort descriptions (fails when one changes without the other).
6. **Age gate (M8):** enumerate controllers exposing alcohol-content data;
   ensure `AgeGateGuard` on each; add a coverage test.
7. **Correction UI (H3):** "Flag a problem" affordance on the calculator
   result page → `POST /api/v1/corrections` with recordId/context; link from
   the methodology page; then the legal-guide claim "already built & tested"
   is true end-to-end.

### WS6 — Documentation truth (L1, L2)

1. `docs/tasks.md`: resync every checkbox to verified reality; annotate T1.22
   with the correction note (v1.0-2024 values superseded by WS1 versions).
2. `ARCHITECTURE.md` §15 (known debt): add audit-trail wiring, correction UI
   (until WS5.7), schema-dual-source decision.
3. Decide schema source of truth (Drizzle migrations vs `schema.sql`) and
   delete the other path from the deploy pipeline; document the choice.

---

## 5. Suggested sequence & rough size

| Order | Workstream | Size | Unblocks |
|---|---|---|---|
| 1 | WS1 tax dataset truth | M–L (data + tests) | golden/e2e value updates everywhere |
| 2 (parallel) | WS2 CI/CD, WS3 e2e repair, WS4 accounts/GDPR | S / S / M | CI enforcement, e2e in CI, erasure |
| 3 | WS5 correctness gaps | M | launch-gate honesty, audit trail |
| 4 | WS6 docs truth | S | accurate record |

Out of scope by instruction: T1.65–T1.69 (manual legal tasks — engage Finnish
counsel per `docs/legal-tasks-guide.md`; note WS1 deliberately routes the rate
corrections through the pending-review flow so the T1.66 sign-off covers the
new dataset versions).

---

## 6. Sources

- [vero.fi — Alkoholi- ja alkoholijuomaverotaulukko (official rate tables 2022–2026)](https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisteverotus/alkoholijuomavero/alkoholi-ja-alkoholijuomaverotaulukko/)
- [vero.fi — Pienpanimoalennus Suomessa (small-brewery relief guidance)](https://www.vero.fi/syventavat-vero-ohjeet/ohje-hakusivu/48587/pienpanimoalennus-suomessa3/)
- [Finlex — HE 106/2024 (progressive 10–50 % small-brewery relief)](https://www.finlex.fi/fi/hallituksen-esitykset/2024/106)
- [Valtiovarainministeriö — Alkoholiverotus (15 M litre ceiling)](https://vm.fi/alkoholiverotus)

*Audit performed 2026-08-21. Rate values above transcribed from the official
table; re-verify at implementation time per the project's own source-mapping
discipline (T1.66).*
