# Design — phase0-1-verification-fix

> Source: `docs/phase-0-1-verification-fix-plan.md` (audit 2026-08-21).
> Official rate reference: vero.fi alcohol excise duty table (2022–2026), fetched 2026-08-21.

## Context

The audit established that the calculation engine's math is unit-correct for all
three formulas — `calcPerDegreePlato(36.20, 0.05, 1.0)` = 181 snt, exactly the
official duty for 1 l of 5 % beer. The defects are in the **data** fed to the
engine (seed, fallback constants, test expectations) and in the **surrounding
systems** (CI triggers, e2e module resolution, account persistence paths, audit
wiring). This design therefore avoids touching the math functions' arithmetic
and focuses on data truth, versioning discipline, and plumbing.

## Goals

1. Every user-visible tax number matches the official vero.fi table for the
   calculation date.
2. No test passes by encoding a wrong rate.
3. CI enforces lint/typecheck/build/unit/golden/compliance/data-quality/
   content-policy/e2e on every PR to `master`.
4. GDPR export/erasure/retention work against PostgreSQL, not just in-memory.
5. The three launch-gate conditions are honestly implemented end-to-end
   (correction mechanism now includes its UI).

## Non-goals

- T1.65–T1.69 manual legal tasks (Finnish counsel, owner sign-off).
- Direct vero.fi API integration for live rate fetching (Phase 2, per T1.23 note).
- Billing, auth, or Alko adapter work (Phase 2 per ARCHITECTURE.md §15).
- Changing the calculation engine's arithmetic.

## Key decisions

### D1 — Corrections ship as new versioned entries, never in-place edits

The existing append-only `taxRules` discipline is kept and used: `v1.0-2024`
rows are closed with `effectiveTo = 2024-12-31`, new `v2.0-2025` and
`v3.0-2026` rule sets are appended, and the publication goes through the
existing rate-review pending→approve flow so a review entry records the legal
confirmation. Rationale: the T1.66 sign-off then covers the new versions, and
historical calculations keep resolving against the version effective on their
date. Closing `effectiveTo` on a superseded row is part of the SCD publish
mechanism, not an in-place rate edit.

### D2 — Rate representation follows the official band structure

Rules are banded per category with `appliesTo.min/maxAlcoholByVolume` matching
the official "yli X mutta enintään Y" (half-open: > X, ≤ Y) semantics:

| Category | Bands (ABV) | 2024 rate | Unit |
|---|---|---|---|
| beer | ≤ 0.5 % / > 0.5–3.5 % / > 3.5 % | 0 / 28.35 / 36.20 | snt per cl ethanol |
| wine_still | ≤ 1.2 % / > 1.2–2.8 / > 2.8–5.5 / > 5.5–8 / > 8–15 / > 15–18 | 0 / 0.36 / 1.98 / 3.08 / 4.56 / 4.56 | €/l product |
| wine_sparkling | same bands and values as still | (no separate legal rate) | €/l product |
| intermediate_products | > 1.2–15 / > 15–22 | 5.68 / 8.63 | €/l product |
| spirits | ≤ 1.2 % / > 1.2–2.8 / > 2.8 | 0 / 30.90 / 54.80 | snt per cl ethanol |
| other_fermented | wine bands | wine values | €/l product |
| container_duty | all beverages | 0.51 | €/l |

2025 values equal 2024 except intermediate > 15–22 (8.74) and spirits > 10
(55.50, new band). 2026: beer 28.75/36.71; wine 36→**50 snt from 1.4.2026**
(two rows), 219.02/340.70/504.97/504.97; intermediate 575.95/886.24; spirits
31.33/55.57/56.28. The sparkling category is retained as a data-acquisition
convenience key but carries wine bands (Finnish law has no separate sparkling
rate). `resolveOtherFermentedFormula`'s per-alcohol-litre RTD variant is
removed — fermented beverages are taxed per litre of product; spirit-based
RTDs belong to the spirits category at data-mapping time.

### D3 — Formula constant renamed, arithmetic unchanged

`FORMULA_PER_DEGREE_PLATO` → `FORMULA_PER_CENTILITRE_ETHANOL`. Finnish beer
duty is per centilitre of ethyl alcohol (numerically = snt per %-litre), not
per degree Plato; the constant name and doc comments were legally wrong while
the arithmetic was right. The dispatcher accepts the old string for existing
DB rows so historical records keep rendering; new rows use the corrected
constant.

### D4 — Small-brewery relief: correct or explicitly unavailable

The seeded flat 50 % @ 100 000 hl contradicts the official progressive 10–50 %
scheme (production up to 15 000 000 l/year; HE 106/2024). Preferred shape:
multiple tiered rows with production-volume conditions in `appliesTo`. If the
engine cannot yet evaluate progressive tiers when this change lands, ship the
general rate only and mark small-brewery treatment UNAVAILABLE (reliability
framework) — never silently wrong.

### D5 — Inclusive `effectiveTo`, validated at publish

`tax-rate.repository.ts` switches from `gt(effectiveTo, asOf)` to
`lte(effectiveTo, asOf)` (with `gt(effectiveFrom, …)` adjusted so intervals
remain half-open on the start, closed on the end — matching "voimassa 1.1.–
31.12."). Publish-time validation rejects gaps and overlaps per
(taxType, productCategory). Boundary tests pin: expiry-date equality, ABV band
edges 0.5/2.8/5.5/8/15/18 on both sides, and 31.3.2026 vs 1.4.2026.

### D6 — Fallback rates: remove rather than mirror

`DEFAULT_RATES` currently duplicates the wrong seed values as silent fallbacks.
A missing rule already yields ESTIMATED reliability; a wrong fallback number
is worse than none. Fallbacks are removed (or reduced to zero-rate +
ESTIMATED) so "no rule found" is loud, not plausible.

### D7 — E2E single class identity

`vitest.config.e2e.ts` aliases every workspace package
(`@rajahinta/core-domain`, `@rajahinta/frontend`, and now
`@rajahinta/application-api`, `@rajahinta/data-platform`) to `src/`, so NestJS
DI never sees the same class loaded twice under different identities. The
local `TRANSPORT_OFFER_QUERY` string token in the e2e test is replaced with
the exported domain constant.

### D8 — Accounts fail-fast outside tests

`AccountService` keeps `@Optional()` repositories for the in-memory test
harness, but the constructor throws when repositories are absent and the
environment is not a test environment. Silent in-memory fallback in production
equals data loss + GDPR non-compliance.

### D9 — Erasure via irreversible pseudonymization

`anonymizeAccount()` in DB mode replaces identifiers with non-reversible
placeholders (keeping an anonymized skeleton row for referential integrity of
calculation records), cascades to saved baskets, and records an audit event.
Fulfilled GDPR Art. 17 while preserving aggregate/audit trails that the law
permits keeping in anonymized form.

### D10 — Idempotency keyed by inputs + dataset versions

`hashInput()` gains the resolved dataset versions (tax + transport). The
stored-version comparison at lookup is kept as defence in depth. A test pins
the behaviour: same product input, new tax version ⇒ fresh calculation, never
a stale cache hit.

### D11 — CI on the real default branch

Both `ci.yml` and `deploy-staging.yml` switch triggers to `master` (the
repository's actual default branch). The job set from the replaced richer
workflow is restored (build, data-quality, compliance, content-policy) plus
e2e, unified under a `ci-pass` gate job. The `ci-cd-pipeline` spec delta
rewords "push to `main`" to "the repository's default branch" so the spec
cannot drift from reality again.

### D12 — Load-testing honesty

`docs/staging-verification.md`'s k6 instructions (`k6 run
tests/load/calculator-load.test.ts`, `npm install -g k6`) describe an
impossible flow (a vitest suite is not a k6 script; k6 is not an npm package).
The doc is corrected to describe `pnpm test:load` as an in-process benchmark;
either a real HTTP smoke (artillery script against `STAGING_URL`) is added or
the artillery dependency and unused env are removed.

## Risks / trade-offs

- **Golden expectations change** (e.g. 83 ¢ → 91 ¢/92 ¢ for the canonical
  beer). Every hardcoded consumer is enumerated in the audit (7 files) and
  updated together; `GOLDEN_DATASET_VERSION` bumps.
- **Versioned publish discipline vs. fixing bad data**: closing v1.0-2024 rows
  mutates `effectiveTo` on existing rows. This is the sanctioned SCD publish
  mechanism (the alternative — leaving v1.0 open forever — is the bug).
- **Small-brewery progressive tiers** may exceed the current `appliesTo`
  evaluator; D4's fallback (UNAVAILABLE) keeps the change shippable.
- **2026 intra-year split** requires two rows with adjacent date ranges —
  exactly what D5's gap/overlap validation must permit (adjacent, not
  overlapping).

## Migration plan

1. Land the seed + repository + formula changes with regenerated tests
   (workstream 1) — unit/golden/compliance green on official values.
2. CI trigger fix + job restoration lands independently (workstream 2) so
   enforcement starts immediately.
3. E2E alias fix (workstream 3) unblocks the e2e CI job added in 2.
4. Accounts/GDPR (4), correctness gaps (5), docs (6) follow; each workstream
   is independently shippable and ordered by the audit's severity.

## Open questions

- None blocking. (Container-duty 2025/2026 changes, if any, are caught by the
  updated rate-review snapshot and follow the same pending→approve flow.)
