# Phase 2C — Advanced Features — Design

## Context

Task 2C (T2.10–T2.13) adds four user-facing capabilities on top of the Phase 1 account, calculator, reliability, and declaration modules. All four reuse existing persistence, guards, and patterns; none introduces a new dependency or infrastructure component. A single feature flag (`ADVANCED_FEATURES`, slug `enable_advanced_features`, default OFF) gates every surface for instant rollback, following the 2A/2B rollout rule.

Concurrent change `phase2-basket-optimization` (2B) modifies `landed-cost-calculator` and `web-application` specs with disjoint requirements; the deltas merge without conflict.

## Goals

- Users can save a calculator input set under a name and reload it later (T2.10).
- Users can download a calculation as JSON/CSV or print it as a report, with full provenance and the structural disclaimer (T2.11).
- Comparison results show a factual per-merchant data-reliability summary (T2.12).
- The Excise Declaration Assistant explains its figures: derivation, deadline, checklist, caveats, official sources — still read-only (T2.13).

## Non-Goals

- No real authentication — account identity remains the `x-user-id` header session pattern until an auth provider is wired.
- No PDF library — the printable format is HTML styled for browser print-to-PDF (no new dependencies).
- No merchant quality judgment — the reliability score presents counts and statuses of stored data, never a grade, rating, or recommendation.
- No ranking changes — the score is display-only; the ranking module is untouched.
- No declaration submission or pre-filling — guidance is informational; the no-submission guarantee is absolute.

## Decisions

### D1 — Scenarios are a separate table, upsert-by-name

`savedScenarios` stores calculator inputs only (productId, quantity, destination, transport method/arrangement) as JSONB — deliberately distinct from `savedBaskets` (product selections for basket shipping, 2B). Unique (accountId, name); POST with an existing name replaces the inputs. Load is client-side: the list endpoint returns inputs, the UI repopulates the calculator and re-runs — scenario data never bypasses the calculation engines. Data minimization: no personal data beyond the account FK. Scenarios are account data: included in `DataExportService` export, deleted by the erasure cascade, covered by retention.

### D2 — Reports serialize persisted records, never recompute

`ReportExportService` reads the calculation record through the existing `ICalculationRecordQueryPort` and renders:

- **JSON** — lossless mirror of the record's structured breakdown, disclaimer, confidence, classification evidence, dataset versions.
- **CSV** — flat line-item rows (label, category, cents, reliability, dataset version, timestamp) with RFC-4180 escaping; the disclaimer is a structural trailing row, not a header comment.
- **HTML** — printable report page (browser print-to-PDF), controlled-vocabulary labels, disclaimer block.

Figures come from the record verbatim — a report can never diverge from the calculation the user saw. The endpoint is guarded by `EntitlementGuard` + `@RequireFeature('calculation:export')` (PREMIUM — already in `FEATURE_TIER_MAP`), `RateLimitGuard`, `AgeGateGuard`, and the feature flag.

### D3 — Merchant reliability score is a factual aggregation

`MerchantReliabilityScoreService` (pure, in `core-domain/reliability/`) maps offer-status counts + governance status to: offerCount, per-status counts and shares, strictest status, freshest observedAt, governance permission status, computedAt. No letter grade, no adjective, no weighting — controlled vocabulary only. Computed at read time via a SQL aggregate over current offers (merchants are few; no caching machinery until measurement demands it). Displayed in compare/product surfaces with its timestamp. Neutrality: informational only — a lockstep test asserts `RankingService` rejects a score-carrying input, mirroring the billing-isolation convention.

### D4 — Declaration guidance is additive and provably read-only

`DeclarationSummary` gains a `guidance` object:

- `derivation` — category, ABV, volume × quantity, applied excise/container-duty rates with rule version labels and formula references, from the persisted record.
- `deadline` — advance-notice due date computed from the calculation timestamp when the classification requires notice.
- `checklist` — ordered MyTax entry steps (informational, observed-pattern phrasing).
- `caveats` — confidence-driven notices: LOW confidence, unknown deposit status (tri-state null → ESTIMATED), fallback dataset version.
- `officialSources` — vero.fi guidance links alongside the existing MyTax link.

The existing type-level proofs (`ReadonlyInterface`, `DeclarationSafetyConstraint`) and `NO_SUBMISSION_GUARANTEE` are unchanged; the safety test is extended to cover the new assembly paths. The API DTO is extended additively — existing consumers see a new optional field, nothing moves.

### D5 — One flag, four surfaces

`ADVANCED_FEATURES` (enum, slug `enable_advanced_features`, env `FF_ADVANCED_FEATURES`, default OFF) guards: scenario endpoints + UI, report endpoint + export buttons, reliability endpoint + embedded scores, declaration guidance field + panel. Instant rollback of the whole 2C rollout with one switch; entitlement (`calculation:export`) provides the tier split on top of the flag for reports.

## Risks and Trade-offs

- **Reports could strip context when shared** → every exported line carries reliability + dataset version + timestamp and the disclaimer is structural in all three formats; a report without provenance is a spec violation.
- **Score misread as merchant endorsement/criticism** → factual fields only, controlled vocabulary, freshness timestamp always shown, and display-only semantics enforced by test. Neutral equal-treatment styling, per the comparison-view neutrality rule.
- **Scenario staleness** (saved product later disappears) → loading re-runs the calculation against current data; a missing product surfaces a normal not-found, never a stale cached result.
- **Guidance drifting into tax advice** → observed-pattern phrasing (same convention as classification evidence), no imperative legal conclusions, standing disclaimer preserved, read-only proofs compile-time enforced.
- **Concurrent 2B changes in compare page / calculator result view** → disjoint components; `touches` serialization in `ob-plan-apply` keeps same-file edits sequential.

## Migration and Rollout

1. Schema migration adds `savedScenarios` (additive; no backfill).
2. Flag ships OFF; enable on staging, verify with the 6.x test waves, then enable in production.
3. Rollback = flag off; the table and endpoints remain but serve 403, and the UI hides the surfaces.

## Open Questions

None blocking. (Report localization beyond English and the disclaimer's existing fi/en pair is a possible follow-up; the record already carries `disclaimerLanguage`.)
