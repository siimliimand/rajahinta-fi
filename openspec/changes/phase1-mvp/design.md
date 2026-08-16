## Context

Phase 0 selected the tech stack (NestJS/TypeScript/PostgreSQL/Next.js/Tailwind/BullMQ etc.) and scaffolded the five-layer modular monolith. Phase 1 adds the first application code — the domain modules, data platform, API, and presentation layers that together form the landed-cost calculator MVP. The architecture and design decisions from the engineering plan (`docs/rajahinta-fi-implementation-plan.md`) and tech stack decision (`docs/tech-stack.md`) are now fixed; Phase 1 implements against them.

## Goals / Non-Goals

**Goals:**
- Implement all four core data entities plus the Calculation Record
- Build every domain module in `src/core-domain/` (tax, classification, transport, normalization, calculator, confidence, ranking, governance, correction)
- Build the acquisition layer, API layer, and presentation layer
- Integrate with the Phase 0 infrastructure (feature flags, background jobs, observability)
- Fix the structural constraints from the business plan (neutrality, versioned tax data, structural disclaimer, data freshness, minimal personal data)

**Non-Goals:**
- Basket optimization (Phase 2)
- Historical time-series / price intelligence (Phase 2)
- External/partner API (Phase 2)
- Social features, reviews, recommendations, affiliate tracking, loyalty (deferred)
- Automated tax filing (the platform prepares information only)
- Identity verification beyond age confirmation (unless legal review mandates)

## Decisions

### Layer ownership

The five-layer structure from `docs/tech-stack.md` Section 7 governs file placement:
- `src/data-acquisition/` — ingestion pipelines, HTTP clients, scheduled jobs
- `src/core-domain/` — pure TypeScript, framework-agnostic, independently testable
- `src/data-platform/` — Drizzle schema, repositories, migrations, seed data
- `src/application-api/` — NestJS controllers, guards, interceptors, pipes
- `src/presentation/` — Next.js App Router (server + client components)

No import may cross layers in the wrong direction. The linter enforces this.

### Domain module interfaces

Each core domain module exposes a single interface file (`module-name/interface.ts`) that downstream layers import from. Internal implementation details are not re-exported. This keeps the extraction path clean: to pull a module into a separate service, wrap its interface.

### Tax engine design

The excise and container-duty sub-engines are separate modules with no shared mutable state. Each operates on the versioned Tax Rule entity via repository injection. A calculation requests the rate effective on a given date; the repository resolves the correct version.

### Classification module isolation

The Transaction Classification Module has zero dependencies on the presentation or API layers. It accepts transport arrangement signals and produces a classification with confidence and evidence. The output type (`ClassificationResult`) has no field for a legal "conclusion" — it carries the classification label, confidence level, and an evidence summary array. Downstream code interprets the label, not the module.

### Version-keyed caching

Calculation results are cached by a composite key: `(product_id, quantity, destination, transport_assumption, tax_dataset_version, transport_dataset_version)`. This is a NestJS cache interceptor. Cache invalidation is automatic on dataset version bump; no TTL-based eviction for stale results.

### Age gate is a guard/interceptor, not a separate page

The age gate is a NestJS guard on protected routes and a Next.js middleware equivalent, not a standalone page redirect. This keeps it composable with feature flags and the entitlement module.

### Feature flags

Phase 0 deployed a flag system. Phase 1 uses it for: launch gating (alcohol data + calc behind `LAUNCH_ENABLED` flag), classification rule rollout, new merchant source enablement. All flag evaluations are synchronous (no network call).

## Risks / Trade-offs

- **73 tasks, 17 groups.** This is the largest single OpenSpec change in the repo. The apply phase will need parallel subagent waves via `ob-plan-apply`. The dependency graph supports phased waves (data model → engines → calculator → API → UI → compliance → legal). Same-file tasks within groups are serialized automatically by shared `touches`.
- **Legal review (group 16) is on the critical path for launch** but is a human process, not engineable. Tasks 16.1–16.5 cannot be delegated to code agents. The launch flag (12.2) gates everything until 16.5 confirms.
- **PostgreSQL vs platform-engineer's SQLite specialization.** The tech stack chose PostgreSQL + Drizzle. The `platform-engineer` agent has `@sqlite-expert` skill. Drizzle abstracts the SQL dialect; specialized SQLite patterns should be ported to PostgreSQL equivalents. The mismatch is noted; if needed, a `data-engineer` agent with PostgreSQL specialization should be created via `/make-engineer`.
- **Greenfield paths are tentative.** All `touches` annotations are best-effort. Directory layout follows `docs/tech-stack.md` Section 7 but exact file names may evolve during implementation.

## Open Questions

- Subscription billing provider: which third party? (Not blocked — the entitlement module defines an interface; billing implementation swaps behind it.)
- Load testing tool: k6, artillery, or custom? (Not blocked — start with the simplest option; the test is scoped to one endpoint.)