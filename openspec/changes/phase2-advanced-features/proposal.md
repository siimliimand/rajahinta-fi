## Why

The Phase 1 calculator is a single-visit experience: inputs are lost on reload, results cannot be taken away as a structured record, comparison results show per-fact reliability but not how dependable each merchant's data is overall, and the Excise Declaration Assistant returns a summary without explaining how the figures were derived. Task 2C in `docs/tasks.md` (T2.10 through T2.13) closes these gaps as the third Phase 2 growth block.

Most of the infrastructure already exists:

- The account system persists to PostgreSQL (`accounts`, `savedBaskets`) with the `x-user-id` header pattern, GDPR export, erasure cascade, and retention jobs — saved scenarios follow the same shape as saved baskets.
- `calculationRecords` already stores the full structured breakdown, per-line reliability, dataset versions, confidence, classification evidence, and the structural disclaimer — export requires formatting only, no new data.
- `reliability_status` per offer, `ReliabilityService`, and `SourceGovernanceService` exist — a merchant-level score is a pure aggregation of stored statuses, never a new judgment.
- The entitlement `calculation:export` (PREMIUM) is already reserved in `FEATURE_TIER_MAP` for exactly this feature.
- `ExciseDeclarationService` is read-only with type-level safety proofs — advanced guidance extends the summary additively without touching the safety contract.

## What Changes

- **Saved scenarios (T2.10)**: New `savedScenarios` table storing named calculator input sets (product, quantity, destination, transport inputs) per account, unique by (account, name) with upsert-by-name semantics. CRUD endpoints under `/api/v1/account/scenarios`, save/load controls in the calculator UI, a scenario list on the account page. Scenarios are account data: included in the GDPR export, cascaded on erasure, covered by retention. Only calculator inputs are stored — no personal data (data minimization).
- **Exportable calculation reports (T2.11)**: New `ReportExportService` + `GET /api/v1/reports/:recordId?format=json|csv|html` generating reports from the persisted calculation record (never recomputed). JSON is lossless; CSV is a flat line-item table with proper escaping; HTML is a printable report for browser print-to-PDF — no new dependencies. The structural disclaimer appears in every format; every figure row carries its reliability status, dataset version, and timestamp. Gated by the existing `calculation:export` PREMIUM entitlement, rate limiting, and the feature flag. Export affordances added to the calculator result view and account history.
- **Merchant reliability scoring (T2.12)**: New pure `MerchantReliabilityScoreService` in `core-domain/reliability/` aggregating a merchant's current offer statuses into a factual score object (counts and shares per status, strictest status, freshest observation timestamp, governance permission status) — no letter grades or subjective labels (controlled vocabulary). Served via `GET /api/v1/merchants/reliability` and embedded where merchant offers are surfaced. Informational only: the score SHALL NOT alter ranking order, and a lockstep test proves the ranking module accepts no score input.
- **Declaration advanced guidance (T2.13)**: Additive `guidance` object on `DeclarationSummary`: excise derivation (applied rates, rule version labels, formula reference), computed advance-notice deadline from the calculation timestamp, MyTax entry checklist, confidence-driven caveats (LOW confidence, unknown deposit status, fallback dataset version), and official vero.fi source links. Read-only guarantees preserved: type-level safety proofs stay green and the no-submission safety test is extended. Rendered in a collapsible panel on the calculator result detail page.
- **Feature flag**: `ADVANCED_FEATURES` (slug `enable_advanced_features`) gates all four surfaces — API routes and UI — default OFF for instant rollback, following the rollout rule for new user-facing data presentation.

## Capabilities

### New Capabilities
- `saved-scenarios`: Named, reloadable calculator input sets scoped to an account, with GDPR lifecycle integration.
- `calculation-reports`: Exportable calculation reports in JSON, CSV, and printable HTML formats, generated from persisted records with structural disclaimer and full provenance.
- `merchant-reliability-scoring`: Factual per-merchant data-reliability aggregation surfaced in comparison results, informational only, never affecting ranking.

### Modified Capabilities
- `landed-cost-calculator`: Adds the advanced-guidance requirement to the read-only declaration assistant (derivation, deadline, checklist, caveats, official sources).
- `web-application`: Adds scenario save/load controls, report export affordances, merchant data-freshness display in comparisons, and the declaration guidance panel — all behind the feature flag.
- `mvp-testing`: Adds unit, API, safety, and neutrality test coverage for the advanced features, following the real-engines-no-mocks convention.

## Impact

- **Code**: New files under `packages/application-api/src/reports/`, `packages/application-api/src/merchants/`, plus repositories under `packages/data-platform/src/repositories/`. Modifications to `packages/data-platform/src/schema.ts`, `packages/core-domain/src/reliability/`, `packages/core-domain/src/declaration/`, `packages/application-api/src/accounts/`, `packages/application-api/src/declaration/`, `packages/application-api/src/feature-flags/`, `packages/application-api/src/search/`, and `apps/frontend/src/`.
- **APIs**: New `GET/POST/DELETE /api/v1/account/scenarios`, `GET /api/v1/reports/:recordId`, `GET /api/v1/merchants/reliability`; additive `guidance` field on `GET /api/v1/declaration/:recordId`. No breaking changes to existing endpoints.
- **Dependencies**: None. Reports are hand-rolled serialization; the printable format uses browser print; storage uses the existing PostgreSQL + Drizzle stack.
- **Data**: One new table (`savedScenarios`), small and account-scoped, following the same retention rules as saved baskets. No new high-volume data.
- **Infrastructure**: None.
- **Documentation**: `docs/tasks.md` T2.10 through T2.13 updated with completion notes.

## Task mapping

| docs/tasks.md | Change tasks |
|---|---|
| T2.10 saved scenarios | 1.1, 1.2, 3.1, 3.2, 4.1 |
| T2.11 exportable reports | 3.3, 4.2 |
| T2.12 merchant reliability scoring | 1.3, 2.1, 3.4, 4.3 |
| T2.13 declaration advanced guidance | 2.2, 3.5, 4.4 |
| Cross-cutting (flag, tests, verification) | 5.1, 6.1–6.5 |
