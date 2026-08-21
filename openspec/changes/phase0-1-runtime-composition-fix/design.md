# Phase 0+1 Runtime Composition Fix — Design

> Context: `docs/phase-0-1-verification-round-2.md` (round-2 audit). This change
> fixes how the already-correct parts compose; it does not change any tax values.

## D1. Module composition via `forRoot` with fresh identities

**Problem.** NestJS resolves a provider within the module closure that declares
it. The static `CalculatorModule`/`TaxModule` declare `useValue: null` ports in
their own scope; adapters registered in `apps/backend` `AppModule` (or bindings
in `DataPlatformModule`) are invisible to `LandedCostCalculatorService` and
`AlcoholExciseService` inside those modules. Every existing test builds its own
`TestingModule` and `overrideProvider`s the tokens, which is why CI stays green.

**Decision.** Keep the static modules null-bound (tests rely on that), and add
`forRoot` factory functions that return a **fresh, undecorated module class**
(e.g. `CalculatorConfiguredModule`) whose providers include the concrete port
implementations. A fresh identity is required because Nest merges a
DynamicModule's fields with the static `@Module` metadata of the referenced
class — reusing the decorated class would drag the null-port defaults into the
configured graph alongside the real bindings. This pattern is already drafted in
the working tree (`ApplicationApiModule.forRoot` threading `CalculatorPorts` +
`TaxModuleOptions` through `CoreDomainModule.forRoot`); this change finishes,
reviews, and lands it.

**Alternatives rejected.** (a) `overrideProvider` at the app level — an app-wide
hack that hides the scoping rule instead of encoding it. (b) Making all modules
`@Global()` — defeats the bounded-layer boundaries the architecture depends on.
(c) Registering adapters inside `ApplicationApiModule`'s default imports —
couples the API layer to host-app adapter classes and was the source of the
double-registration e2e failure observed in the working tree.

**Guard.** A composition smoke test boots the real `AppModule` (database
connection faked at the repository boundary only) and asserts via `ModuleRef`
that `LandedCostCalculatorService` holds non-null `PRODUCT_DATA_PORT` and
`CALCULATION_RECORD_PORT`, and `AlcoholExciseService` holds the
`TaxRuleRepositoryAdapter`, then runs one real `calculate()` end-to-end. This
test class is the permanent regression gate for N1 and must run in CI before
PR #18 merges.

## D2. Single taxType vocabulary + data migration

**Problem.** `alcohol-excise.service.ts` calls
`findAllApplicable('excise', …)`; the seed and staging placeholders store
`'excise_duty'`; the Drizzle query is a literal `eq(taxRules.taxType, taxType)`
with no translation. Fixtures seed `'excise'`, so unit/golden/e2e pass while a
real database returns zero rules and the zero-rate ESTIMATED fallback hides the
miss.

**Decision.** Export `TAX_TYPES = { excise: 'excise', containerDuty:
'container_duty' }` (and a `TaxType` union) from core-domain; the engine call
site, `tax-rules.seed.ts`, both staging placeholders, and all test fixtures
reference the constant — no string literals anywhere. `'excise'` wins (shorter,
already what the engine and fixtures use; container duty is already consistent).

**Data migration, not reseed.** The seed's idempotency matches on
`versionLabel`; re-running it after the rename would *skip* already-seeded
`'excise_duty'` rows, leaving them invisible forever. A committed Drizzle data
migration (`UPDATE tax_rules SET tax_type = 'excise' WHERE tax_type =
'excise_duty'`) repairs existing staging databases and runs before the seed in
every deploy (D3). Doc comments in `schema.ts`,
`repository-registry.interface.ts`, and `tax-rule-query.service.ts` are updated
to the winning vocabulary.

**Masking-class killer.** A real-stack integration test: apply Drizzle
migrations to a throwaway Postgres, run `seedTaxRules`, then calculate through
`AlcoholExciseService` backed by the real `DrizzleTaxRateRepository`. Assert
official values: 2024 5 % 0.5 l beer = 91 snt; wine >1.2–2.8 % resolves 36 snt
before and 50 snt after 1.4.2026; spirits 2026 >10 % = 56.28 snt/cl. This is
the only test where the engine vocabulary and the seed vocabulary must agree
through the real query path — fixture consensus can no longer mask a split.

## D3. Deploy sequencing: migrate → seed → rollout

**Problem.** Neither deploy workflow applies schema migrations. A fresh
database has no tables; the seed Job and backend both fail. The official
dataset has no caller at all (`seedTaxRules`/`SEED_RULES` are dead code at
HEAD), so T0.5's "staging carries its own copy of the tax-rule dataset" is
unmet — staging tax rules are the fake v9999 placeholders only.

**Decision.** Add a short-lived migrate Job (same container image, command
`drizzle-kit migrate` with psql fallback, target `DATABASE_URL` from the
environment secret) to both deploy workflows, ordered: migrate → seed (staging
only) → rollout. `seed-runner` gains the official dataset: staging seeds
`SEED_RULES` (v1.0-2024…v3.0-2026, official rates) alongside the clearly-marked
v9999 placeholders, which never collide (own version labels and fake merchant
EAN space). Production runs migrations and stays merchant-empty.

**Isolation semantics change.** `docs/staging-verification.md` §4 currently
asserts staging must contain *only* `v9999-staging` tax labels. That conflates
two things: no production *merchant* data (correct, unchanged) and no official
*tax* data (wrong — official rates are public law, not production data). The
documented check becomes "no production merchant data and no non-staging
merchant labels"; expected tax labels become v1.0-2024…v3.0-2026 + v9999.

**Legacy SQL.** `infra/staging-data/seed.sql` still carries the pre-round-1
wrong rates (beer 33.00, spirits 2950, sparkling 373) and is loaded by the CI
data-quality job. Regenerate it from `SEED_RULES` via a small export script
(single source of truth) or delete it and point `scripts/test-data-quality.sh`
at a generated fixture; either way the wrong numbers leave the repo. The dead
`GOLDEN_DATASET_PATH` env in ci.yml is removed.

## D4. pnpm linker and local/CI parity

**Problem.** The working tree adds `nodeLinker: hoisted` +
`resolvePeersFromWorkspaceRoot: true` and was reinstalled under that layout.
Local e2e now fails for both HEAD and working tree (`RateLimitingModule2` /
`RateLimitGuard2` double identity, `Reflector` unresolvable) while CI passes
the same commit — the hoisted layout defeats the single-instance `@nestjs/core`
aliasing `vitest.config.e2e.ts` relies on.

**Decision.** Prefer reverting the linker flags and keeping the lockfile dedupe
already committed in `a8f353b` (which CI validates). If hoisting is genuinely
needed for the composition fix, land it together with a regenerated lockfile
and a green clean-install run of `pnpm install --frozen-lockfile && pnpm
test:e2e`, and extend the e2e `@nestjs/core` alias strategy to whatever
instances remain. Either way, the branch must not sit in a state where local
runs disagree with CI. Acceptance for the whole change includes a clean-install
local run matching CI.

## D5. HTTP-level load testing (T1.73)

In-process Vitest benchmark stays (CPU-bound throughput, CI-safe). The new
artillery suite exercises the HTTP path the implementation plan §12 names as
the unit-economics risk: ramp 1→50 concurrent over 60 s, steady 50 for 120 s,
payloads beer (light calc), spirits (full calc), multi-item basket; thresholds
p95 < 2 s, error rate < 1 %, zero 429s from the rate limiter in the steady
window. Runs as a post-deploy step in `deploy-staging.yml`, non-blocking until
a baseline exists, then promoted to blocking. Documented in
`docs/staging-verification.md` §5; T1.73 checked in `docs/tasks.md` only when
the suite exists and has run against staging once.

## D6. Transport reliability vocabulary (residual)

`TransportEstimationService` still emits `'EXACT' | 'ESTIMATED'` and the
calculator bridges `EXACT → VERIFIED` ad hoc (`landed-cost-calculator.service.ts:133`).
Preferred: unify at the producer — transport types use the canonical
`ReliabilityStatus` union, bridge deleted. If the producer change ripples too
wide for this change's scope, record the bridge as accepted debt in
ARCHITECTURE §15 with a pointer; either resolution closes round-1 M3 fully.

## Risks and mitigations

- **Merging PR #18 before WS-A/WS-B** would ship N1/N2 to `master`. Mitigation:
  this change is developed against the same branch and must land (or PR #18
  must be updated to include it) before merge; the composition smoke test and
  integration test are the enforcement.
- **Migration on a seeded staging DB** turning invisible rows visible:
  intended — that is the repair. Rates themselves are already official, so no
  calculation value changes, only availability.
- **Parallel sessions** editing the same files (observed during the round-2
  audit): single-owner rule for the working tree; the refactor lands as
  reviewed commits in this change.

## Workstream order

WS-A (composition) and WS-B (vocabulary) first — they gate each other and
PR #18; then WS-C (deploys); WS-D (docs/staging truth) and WS-E (load test) in
parallel; final gate (6.1) last.
