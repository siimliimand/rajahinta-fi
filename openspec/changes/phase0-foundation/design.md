## Context

Rajahinta.fi is a greenfield project. The engineering plan in `docs/rajahinta-fi-implementation-plan.md` fixes the architecture (modular monolith, five layers) but deliberately leaves the stack open. Phase 0 must make those stack choices and stand up the scaffolding and infrastructure that Phase 1 modules plug into.

## Goals / Non-Goals

**Goals:**
- Select and document a coherent tech stack
- Scaffold the five-layer monolith with enforced layer boundaries
- Stand up CI/CD that runs regression, data-quality, and compliance tests on every deploy
- Deploy feature flags that can gate any compliance-sensitive change
- Wire observability into the scaffold before feature code exists

**Non-Goals:**
- Build any product/domain modules (Phase 1 scope)
- Implement any tax, duty, or classification logic
- Create the web UI
- Populate any real data sources

## Decisions

### Stack selection process (T0.1)

The engineering plan deliberately leaves stack choice to the engineering team. The selection process should produce a `docs/tech-stack.md` documenting:
- Backend language + framework, with rationale
- Database choice, with rationale (relational vs. document vs. hybrid)
- Frontend framework, with rationale
- Any additional libraries selected during scaffold

A pragmatic default recommendation: TypeScript across the stack (backend on Node.js/Bun, frontend on React or similar), PostgreSQL for versioned/relational data (tax rules, product master, calculation records), and a job queue for background work. But the decision belongs to the team building it.

### Monolith scaffold (T0.2)

Follow the five-layer structure from the engineering plan. Directory convention:
```
src/
  data-acquisition/     # ingestion pipeline interfaces
  core-domain/          # tax, classification, transport, calculator
  data-platform/        # models, repositories, migrations
  application-api/      # REST/API routes, middleware
  presentation/         # web UI
```

Each directory gets a barrel export or public interface file that downstream layers import from, never from internal files. Lint rules enforce this.

### Module interfaces (T0.3)

Interfaces live at layer boundaries as dedicated files (e.g., `src/data-acquisition/interface.ts` defining `ProductIngestor`, `PriceFetcher`). The CI/CD lint step checks that no import crosses a layer boundary in the wrong direction.

### Feature flags (T0.7)

Use a lightweight flag library or service. Flags must resolve synchronously on the request path. Avoid flags that depend on a network round-trip for evaluation. If using a SaaS flag provider, cache flag evaluations locally with a short TTL.

### Background jobs (T0.8)

Separate the job runner from the web server process. A queue-based approach (job enqueued by the web process, consumed by a worker) is preferred over in-process scheduling. This ensures a stuck job never blocks the HTTP server.

### Observability and instrumentation (T0.9–T0.11)

Emit structured events (not free-text logs) from the scaffold. Use a library or lightweight abstraction that supports pluggable backends (stdout for development, a metrics service for production). Wire the scaffold to emit events for all four KPI categories, even if the initial events are stubs.

## Risks / Trade-offs

- **Stack decision blocks everything.** T0.1 is the root dependency — pick quickly and move on. The architecture tolerates a backend swap at the interface layer; the important part is making a decision and scaffolding the layers.
- **Greenfield, so no existing CI to extend.** CI/CD config starts from scratch. Pipeline config must cover a placeholder scaffold that passes, not fail from missing test files.
- **Feature flags add complexity early.** Mitigation: a minimal flag library (or even a simple config map with environment overrides) is sufficient for Phase 0. The important property is instant rollback, not sophisticated segmentation.
- **Observability instrumentation without real data.** Phase 0 events will carry placeholder payloads until Phase 1 modules emit real ones. This is acceptable: the wiring and dashboards exist, ready to ingest real data.

## Open Questions

- Backend language: TypeScript/Node.js, Go, Rust, Python? Decision needed before T0.2.
- Database: PostgreSQL recommended (versioned data, ACID), but team preference may differ.
- Feature flag provider: library (LaunchDarkly, Flagsmith, or open-source equivalent) or a simple env-based toggle for early stages?