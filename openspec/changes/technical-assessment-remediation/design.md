# Technical Assessment Remediation — Design

## Context

The 2026-08-28 technical assessment (`docs/TECHNICAL-ASSESSMENT.md`) reviewed the monorepo after the Phase 2 advanced-features merge. This change implements every finding in it. The five-layer architecture, neutrality enforcement, versioned tax rules, the reliability model, and the test pyramid are explicitly worth keeping; all remediation works within those structures rather than around them. Where an interface was designed for an upgrade (IRateLimiter, the carrier adapter, the governance gate), the fix plugs into it instead of inventing a parallel path.

## Goals

- Close all four launch blockers: currency mixing, session impersonation, broken legacy endpoints, unauthenticated ops dashboard.
- Make live data trustworthy: real transport source, real search, enum-validated classification, per-merchant ingestion.
- Make shared state durable: Redis rate limiting, PostgreSQL audit, snapshot analytics, partitioned history.
- Match the product to its audience: Finnish-first UI, shared navigation, honest age gate.
- Land the operational additions the document calls for: operator console, structured logging, traces, alerting, browser e2e, SEO.

## Non-Goals

- Payment collection or order management (calculator, not a shop).
- Full OIDC identity provider integration (email-verification groundwork only; D5).
- Tier transitions driven by real billing (groundwork only until subscription billing is real).
- Additional carrier sources and merchant feeds beyond Posti and Alko (the pipeline supports more later).
- Replacing the five-layer architecture or the neutrality model.

## Decisions

### D1 — Legacy calculation endpoints are implemented, not removed

The routes are documented in Swagger and the math exists in `AlcoholExciseService` and `ContainerDutyService`. Wiring the endpoints to those services honoring the request body is a small diff that preserves the published API. The broken `TaxCalculationEngineAdapter` path is deleted rather than repaired because it discards the request body by construction.

### D2 — Conversion happens at ingestion, rates are a governed dataset

FX rates get the same treatment as tax rules: a dated, versioned dataset with provenance and a manual-confirmation publication flow that never auto-publishes. ECB reference rates are the default source behind a configurable adapter. Offers convert to EUR cents at ingestion using the rate effective on the observation date; the original amount and currency stay on the offer for display. Offers whose currency has no effective rate on the observation date are rejected at ingestion, not silently summed later. The calculator sums converted EUR cents only. Idempotency cache entries invalidate on FX dataset version change, matching the tax-dataset convention.

### D3 — Sessions are opaque server-issued tokens; `x-user-id` dies

Sessions become rows in a `sessions` table with the token stored hashed (SHA-256). The backend derives the account from the token presented via httpOnly cookie set by the API. The `x-user-id` header is rejected outright: accepting it in any form keeps the impersonation vector alive. Existing client-UUID sessions are not migrated; anonymous account data is disposable by design and the assessment treats it that way. Rotation issues a new token and invalidates the old one in one transaction. Email verification uses the existing `verified_email` column as groundwork for later real authentication.

### D4 — TimescaleDB is adopted, not just mentioned

`price_observations` is append-only, time-indexed, and scanned by watermark; it fits the hypertable model. The extension is added to migrations and the compose file, and the schema comment stops lying. If the conversion blocks in practice, the fallback is to delete the claim from the schema comment; that fallback is a deliberate downgrade, not the plan.

### D5 — otherCharges is removed

A hardcoded zero with a Phase 1 comment is a dead contract. Removing the field is a breaking API change but an honest one; no consumer can be depending on a constant. If a real other-charges source appears later, the field returns with semantics.

### D6 — Posti first, Alko second, both through the governance gate

Transport rates come from a real Posti source through the same governance-gated pipeline as prices; the no-op adapter is replaced, not wrapped. Alko joins as the domestic reference merchant with a golden dataset, exercising the adapter interface and governance gate a second time, which the assessment notes they are ready for.

### D7 — The merchant registry is database-backed and drives the scheduler

Static `merchants.config.ts` is replaced by a registry table aligned with the governance records already in the database. The hourly catch-all job is replaced by one job per permitted merchant with a per-merchant dedupe key, enabling per-merchant backoff and monitoring. Onboarding a merchant stops requiring a deploy.

### D8 — Durability before scaling

HPA and PDB land only after rate limiting, audit, and analytics are out of process memory (tasks 4.x before 11.1), because replicas multiplied by in-memory limits and wiped analytics are worse than a single replica. The k8s deployment moves to immutable SHA tags the pipeline already builds.

### D9 — Finnish is the default locale; catalogs carry the copy

next-intl with Finnish default and English secondary. Copy moves out of components into message catalogs so the existing content-policy lint polices both languages. The layout declares `lang` from the active locale instead of a hardcoded mismatch.

### D10 — Age gate is honest about being soft

The redirect target becomes a neutral in-house page, the server renders a placeholder instead of restricted content, and gating happens after mount. The backend confirmation provider keeps its interface for the planned stronger verification, and the docs state plainly that Phase 1 confirmation is self-attestation.

## Risks and Trade-offs

- **Size.** One change covering the whole assessment is large (56 tasks). Mitigation: 13 task groups with explicit dependencies; waves are conflict-free by `touches` serialization, and groups 1 to 3 (the blockers) can ship ahead of the rest if needed.
- **Breaking API changes.** Session header removal and `otherCharges` removal break integrators. Mitigation: the API is pre-launch per the assessment, so there is no installed base to protect; the version bump documents both.
- **TimescaleDB conversion.** Hypertable conversion needs a migration window on existing data. Mitigation: additive migration with a backfill, integration tests on real Postgres, and the D4 fallback.
- **Two sources of truth during registry migration.** Static config and the registry coexist for one release. Mitigation: the scheduler reads only the registry; static config is deleted in the same change.
- **Real feeds introduce real volatility.** Posti and Alko responses change without notice. Mitigation: golden datasets pin parser behavior; the governance gate and reliability model already handle bad feeds.

## Migration and Rollout

- Database migrations are additive first: new tables (`fx_rate_datasets`, `fx_rates`, `sessions`, `audit_events`, merchant registry), then the hypertable conversion and monthly partitioning of calculation records as separate migrations.
- Feature flags gate the user-visible surfaces per the compliance rule: new ranking-relevant behavior (search relevance ordering) and new UI (operator console, SEO pages) ship flag-off. Bug fixes (currency, legacy endpoints, health) ship flag-on since they correct documented behavior.
- Compliance-sensitive rollouts keep the rollback rule: flags flip off instantly; migrations are backwards-compatible so a rollback does not lose data.
- Dependency upgrades (Next 15, React 19, Vitest 3) land last, after Playwright e2e exists to catch regressions the HTTP-level suite cannot see.

## Open Questions

- Exact FX source entitlement (ECB reference rates are free but redistribution terms should be checked by legal review before launch).
- Retention window N for anonymous calculation records; proposal is 30 days pending operator input.
- Whether the operator console lives at a separate path with its own auth realm or inside the main app behind tier and allowlist; implementation starts with a separate path.
