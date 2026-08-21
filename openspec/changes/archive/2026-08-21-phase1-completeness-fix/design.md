## Context

Phase 1 of the Rajahinta.fi platform is 78% complete: 57 of 73 engineering tasks are implemented with production-quality code. The core domain (tax engines, classification, normalization, transport, calculator, reliability, ranking, correction, audit, entitlement, governance) is solid with 7,240 lines of tests. The frontend has all required pages. The data model and acquisition pipeline are functional.

The remaining gaps fall into three categories:
1. **Operational infrastructure** — CI/CD pipeline, load testing, staging environment
2. **Compliance features** — content vocabulary enforcement, outbound link safety, identity-document verification
3. **Persistence migration** — account system currently in-memory (acceptable for internal MVP validation)

All changes follow existing architecture patterns: NestJS modules, Drizzle ORM repositories, React/Next.js frontend, in-memory services with port/adapter interfaces that enable future migration to persistent stores.

## Goals / Non-Goals

**Goals:**
- Wire automated CI/CD (lint, typecheck, unit tests, golden-dataset regression) on every PR
- Add load testing on the Landed-Cost Calculation endpoint with baseline thresholds
- Implement content vocabulary linting to enforce the "no promotional language" compliance requirement
- Implement plain outbound merchant links with basic click counting, zero purchase/commission tracking
- Resolve the account persistence question (migrate to PostgreSQL or explicitly accept in-memory for Phase 1)
- Fill critical test coverage gaps (governance service, declaration functional tests, controllers, guards)
- Correct task statuses where implementation is done but the task is unchecked

**Non-Goals:**
- Full authentication/authorization system (Phase 2)
- Third-party billing integration (Phase 2 — T1.56)
- Automatic tax filing (explicitly deferred)
- Affiliate/commission tracking (explicitly prohibited)
- Social features, reviews, recommendations (explicitly deferred)
- Direct vero.fi API integration for rate fetching (Phase 2)
- Database migration for in-memory services other than accounts (rate-limiting, idempotency, audit remain in-memory until Phase 2)

## Decisions

### Decision 1: GitHub Actions for CI/CD

**Choice**: GitHub Actions with matrix testing across Node 22, PostgreSQL 16, Redis 7.
**Alternatives considered**: GitLab CI (no GitLab instance), CircleCI/Travis (extra SaaS dependency, no benefit over native Actions).
**Rationale**: Already documented as the chosen platform in `docs/tech-stack.md`. Native integration with GitHub. Matrix testing feature handles multi-service dependency.

### Decision 2: k6 for load testing

**Choice**: k6 (Grafana) for load test scripts.
**Alternatives considered**: Artillery (less community adoption for complex scenarios), autocannon (CLI-only, limited scripting).
**Rationale**: Scriptable in JavaScript, built-in threshold assertions, CI-friendly output formats, open-source. The existing observability stack (Grafana Cloud, OpenTelemetry) aligns with k6's Grafana ecosystem.

### Decision 3: Content vocabulary linting as a pipeline step

**Choice**: Implement as a pure service (`ContentLintService`) injected into `PipelineOrchestratorService` after mapping and before upsert. Flag violations in pipeline report; do not reject products.
**Alternatives considered**: ESLint rule (wrong layer — ESLint lints code, not runtime data), pre-commit hook (data arrives at runtime, not commit time), frontend-only filter (UI-only doesn't protect API consumers).
**Rationale**: Insertion point in the pipeline ensures ALL data paths (feed ingestion, manual upload, API) pass through the lint. Non-rejecting behavior is deliberate — flagged products are not blocked, they just carry a warning. Rejection would cause data gaps. The manual review queue downstream can handle flagged content.

### Decision 4: Click analytics as a redirect endpoint

**Choice**: `GET /api/v1/outbound/:offerId` that logs a `[CLICK]` line and 302-redirects to the merchant URL. Explicitly no purchase tracking, no commission calculation, no affiliate ID propagation.
**Alternatives considered**: Direct `<a>` links (no analytics), client-side `fetch` + `window.location` (bypassable, no server-side counting), third-party analytics (privacy risk, extra dependency).
**Rationale**: Server-side redirect guarantees accurate counting even if client JS is blocked. The `[CLICK]` log format matches the existing `[KPI]` log pattern in `KpiService`. The `rel="nofollow noopener"` attributes enforce the "no SEO benefit to merchants" policy.

### Decision 5: Account persistence — migrate now

**Choice**: Migrate the account system to PostgreSQL-backed repositories as part of this change.
**Alternatives considered**: Accept in-memory for Phase 1 with a migration task (cheaper now, creates data-loss risk if any real user data is captured during MVP validation). Redis-backed accounts (adds complexity; PostgreSQL is simpler and already the primary store).
**Rationale**: While in-memory is "acceptable for MVP" per ARCHITECTURE.md, this change already touches the account module for identity-document verification (T1.61) and anonymous usage (T1.62). Adding PostgreSQL persistence now avoids a second migration later. The `AccountService` port interface already exists — the repository implementation maps cleanly.

### Decision 6: Staging seed data via init container

**Choice**: K8s Job or init container that runs the staging seed on first deploy of the staging overlay.
**Alternatives considered**: Manual seeding (unreliable, forgotten on rebuild), same seed as production (staging needs separate data for legal/tax review of rule changes).
**Rationale**: The implementation plan (Section 2.2) explicitly requires staging to have "its own copy of the tax-rule dataset and merchant data." An init container approach ensures every fresh staging deploy gets consistent seed data.

## Risks / Trade-offs

- **[Risk] Account migration touches schema and existing in-memory code** → Mitigation: Add new tables alongside existing schema; dual-write during migration? No — the system has no real user data yet (Phase 1 MVP validation), so a clean cut from in-memory to PostgreSQL is safe.
- **[Risk] Load testing may reveal performance issues that need further optimization** → Mitigation: Set non-blocking thresholds initially; move to blocking only after baseline is established and any necessary optimizations are in place.
- **[Risk] Content vocabulary linting may flag legitimate product names if the banned-pattern list is too aggressive** → Mitigation: Flag as warning in pipeline report, not rejection. Allow manual override. Start with a conservative set of universally-banned words and expand based on false-positive analysis.
- **[Risk] CI/CD pipeline requires secrets (DATABASE_URL, etc.) in GitHub** → Mitigation: Use GitHub Actions secrets. Test database is ephemeral (created in CI, destroyed after run).

## Open Questions

1. **Account persistence**: Should we migrate accounts to PostgreSQL now (recommended in Decision 5) or accept in-memory for Phase 1? If user data is expected during MVP validation, migrate now.
2. **k6 vs artillery**: k6 is recommended. Confirm before adding the dependency.
3. **Staging infrastructure**: Is the staging Kubernetes cluster provisioned and accessible? The deployment workflow needs a target.
4. **Banned vocabulary list**: Should the initial list include Finnish, Swedish, and English? Or start with English + Finnish, add Swedish when Systembolaget adapter produces Swedish-language content?