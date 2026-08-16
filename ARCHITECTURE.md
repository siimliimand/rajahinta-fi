# ARCHITECTURE.md

## Architecture Overview

Rajahinta.fi is a **cross-border beverage price index and Finnish landed-cost intelligence platform**. It is planned as a calculator, not a shop: there is no checkout, no payment collection for alcohol, and no physical-goods order management — the only commercial transaction is a software subscription.

This repository is currently in **greenfield planning state**. There is no application source code yet: the repository contains the engineering plan, business documentation, and the agentic development infrastructure (skills, commands, OpenSpec scaffolding). The architecture below describes (a) the infrastructure that exists today and (b) the planned application architecture defined in `docs/rajahinta-fi-implementation-plan.md`, which will be built in the planned delivery phases.

Planned architectural style: a **modular monolith** for the MVP, organized into clearly bounded modules (data acquisition, calculation, data platform, API, presentation) so any module can later be extracted into a separate service without redesigning domain logic.

## 1. Project Structure

```
rajahinta/
├── AGENTS.md                          # Agent operating contract (repo-wide workflow rules)
├── ARCHITECTURE.md                    # This document
├── DESIGN.md                          # Design-system documentation (placeholder pending /make-design)
├── opencode.jsonc                     # OpenCode configuration (model, plugins, MCP servers, permissions)
├── skills-lock.json                   # Lockfile pinning externally installed agent skills
├── .agents/skills/                    # Installed agent skills (ob-* platform skills + community skills)
├── .opencode/
│   ├── agents/fullstack-engineer.md   # Primary engineer agent definition
│   ├── commands/                      # Slash commands (/init, /plan-*, /make-*, /repo-*, /ops-*)
│   ├── plugins/                       # ob-subagent-monitor.js, ob-subagent-tiers.js
│   ├── tui/                           # Custom TUI components (ob-subagents.tsx)
│   ├── package.json                   # Tooling dependencies (opencode plugins, browser, quota)
│   ├── source-roots.json              # Analysis roots used by doc-generation tools
│   ├── opencode-onboard.json          # Agent onboarding config (tiers, concurrency)
│   └── opencode-quota/                # Quota/token usage state
├── .codegraph/                        # CodeGraph index (code intelligence)
├── docs/
│   ├── Rajahinta-FI.docx              # Business plan (Finnish)
│   └── rajahinta-fi-implementation-plan.md  # Engineering implementation plan
└── openspec/
    ├── config.yaml                    # OpenSpec configuration
    ├── changes/archive/               # Archived OpenSpec changes (project-history)
    └── specs/                         # Current (empty) spec baseline
```

## 2. High-Level System Diagram

Planned application architecture (not yet implemented):

```mermaid
flowchart LR
    subgraph Users
        Consumer[Consumer web app]
        APIUser[API customers (Phase 2/3)]
    end

    subgraph Presentation
        Calculator[Landed-Cost Calculator]
        Comparison[Comparison views]
        Charts[Historical charts]
        Account[Account / subscription]
    end

    subgraph Application Layer
        API[Calculation / search / comparison API]
    end

    subgraph Core Domain
        Normalization[Product Normalization]
        Classification[Transaction Classification]
        Tax[Tax & Duty Calculation]
        Transport[Transport Estimation]
        Landed[Landed-Cost / Excise Assistant]
    end

    subgraph Data Platform
        DB[(Product / merchant / transport / tax DB)]
        TS[(Historical time-series store)]
    end

    subgraph Acquisition
        Scrapers[Price / product ingestion]
        Rates[Tax-rate dataset sync]
        Shipping[Transport-rate refresh]
    end

    External[External merchants / carriers / tax authority]

    External --> Acquisition
    Acquisition --> Data Platform
    Data Platform --> Core Domain
    Consumer --> Presentation --> API --> Core Domain
    APIUser --> API
```

The planned **Compliance & Governance layer** runs across all layers (neutrality enforcement, reliability labeling, audit logging) rather than as a separate service.

## 3. Core Components

### 3.1 Existing infrastructure (this repository today)

| Component | Responsibility | Key files |
|---|---|---|
| Agent skill library | Instructions that govern agent behavior (planning, guardrails, codegen, evidence) | `.agents/skills/` (ob-*, openspec-*, community skills) |
| Slash commands | User-facing entry points for init, planning, shipping, verification | `.opencode/commands/*.md` |
| OpenCode config | Model selection, MCP servers (codegraph, agentmemory), plugin wiring, permissions | `opencode.jsonc` |
| OpenSpec workspace | Specification-driven change management | `openspec/` |
| Documentation | Business + engineering plans driving the product build | `docs/` |

### 3.2 Planned Frontend / User Interface

Planned consumer web application: calculator, comparison views, historical charts, and account/subscription management. No implementation exists yet.

### 3.3 Planned Backend / Server / API

Planned modular monolith exposing calculation, search, comparison, and account functionality to the frontend and to future API customers. Scheduled/queued background jobs handle price ingestion, transport-rate refresh, tax-dataset review, and time-series aggregation, kept off the request/response path.

### 3.4 Planned CLI / Scripts / Automation

Not evident from the repository (beyond agent tooling, which is operational infrastructure, not product automation).

## 4. Data Flow

Not applicable to implemented code — no application runtime exists yet. The planned primary user journey (per `docs/rajahinta-fi-implementation-plan.md`) is:

1. User selects product + quantity + destination (+ optional transport method).
2. Transport Estimation computes estimated shipping for the basket.
3. Transaction Classification determines Distance Selling / Distance Buying / Traveller Import.
4. Tax & Duty Calculation resolves versioned tax datasets and computes alcohol excise + container duty.
5. Landed-Cost Calculator assembles the itemized result with calculation-status metadata.
6. Excise Declaration Assistant packages a structured summary linking out to MyTax (never submits on the user's behalf).

## 5. Data Stores

None exist yet. Planned stores (from the implementation plan):

| Store | Planned purpose |
|---|---|
| Product/merchant/transport/tax database | Structured canonical products, retail offers, transport offers, versioned tax-rule datasets |
| Historical time-series store | Historical prices and rate versions so past calculations remain reproducible |

## 6. External Integrations / APIs

None implemented. Planned integrations: external merchants (product/price ingestion), carriers (transport offers), and the Finnish Tax Administration rate tables (primary source for excise/container-duty rates).

## 7. Key Technologies

| Technology | Role |
|---|---|
| OpenCode | Agent runtime and developer interface (config in `opencode.jsonc`) |
| OpenSpec | Change/specification management (`openspec/`) |
| CodeGraph | Code intelligence / indexing MCP server |
| AgentMemory | Cross-session memory MCP server |
| skills.sh (`npx skills`) | Agent skill installer (see `skills-lock.json`) |
| Node.js | Tooling runtime (`.opencode/package.json` dependencies: opencode plugins, browser automation, solid-js TUI) |
| Application stack | **Not yet selected** — open decision per the implementation plan |

## 8. Deployment & Infrastructure

No application deployment exists. The planned promotion path is development → staging → production, with staging carrying its own tax-rule and merchant data copies, and feature flags gating new merchant sources, tax rulesets, and UI ranking behavior.

## 9. Security Architecture

No application security architecture exists yet (no app code). Non-negotiable constraints from the implementation plan that will shape it:

- Minimal personal data: default to anonymous usage; identity/age-verification (only if legally required) is a separate, isolated subsystem.
- Tax data is versioned, never overwritten; historical calculations resolve against the effective rate version.
- No code path may allow paid/manual boost of a merchant's position (neutrality enforced in code).

Agent infrastructure constraints: credentials stay out of logs and committed files; `.env` files are write-only.

## 10. Monitoring & Observability

Not evident from the repository for application code. The plan requires every externally sourced fact to carry a reliability status and timestamp surfaced to the user.

## 11. Performance & Scalability

Not evident from implemented code. Planned: background/scheduled jobs separate from the request/response path so a slow scrape never blocks a user's calculation; basket-level transport estimation to handle non-linear shipping thresholds.

## 12. Development Workflow

The repository is an agentic workspace. There is no application build/dev/test command yet. Agent tooling commands: `/init` (repo initialization), `/plan-*` (OpenSpec planning pipeline), `/make-*` (documentation/engineer generation), `/repo-*` (audit, onboard, verify), `/ops-*` (ship, evidence, review).

## 13. Testing Strategy

Not applicable yet — no application code or test suites exist. The engineering plan mandates the Transaction Classification Module and calculation modules be isolated and independently testable, and every number explainable/traceable.

## 14. Architectural Decisions & Rationale

| Decision | Rationale |
|---|---|
| Modular monolith for MVP | Calculation, classification, and data platform are tightly coupled; microservices would add latency and consistency risk without MVP-scale benefit |
| Calculator, not a shop | Per business plan; only transaction is the software subscription |
| Versioned, reviewed tax datasets | Tax calculations carry legal risk; rates are never auto-published, never overwritten |
| Transaction Classification isolated | Most important proprietary logic; independently testable, versioned rule sets subject to legislative change |
| Neutrality enforced in code | Ranking must be objective and deterministic; no paid/manual boost path |
| Data freshness first-class | Every external fact carries reliability status + timestamp surfaced to the user |
| Compliance layer across all layers | Neutrality, reliability labeling, and audit at each boundary, not a separate service |

## 15. Constraints, Risks, and Technical Debt

- No application code exists; all architecture above is planned and unvalidated against a real implementation.
- Language/framework/database selection is an open decision (implementation plan deliberately leaves it to the engineering team).
- Deposit-return system status per product/packaging must be captured for container-duty exemptions; unknown status must be flagged ESTIMATED, never silently assumed.
- Classification rules subject to legislative change (e.g., 1 September 2024 joint-liability change) require versioned, dated rule sets.

## 16. Future Considerations

Per the implementation plan's delivery phases:
- Basket Optimizer (Phase 2) building on basket-level transport estimation.
- API customer offering (Phase 2/3) — the disclaimer must be a structural part of result objects so API consumers inherit it.
- Potential extraction of modules (e.g., Data Acquisition) into separate services without redesigning domain logic.

Recommendation: after the initial application scaffold is in place, rerun `/make-architecture` to capture the implemented component boundaries.

## 17. Project Identification

| Field | Value |
|---|---|
| Name | Rajahinta.fi |
| Language | None selected yet (greenfield) |
| Type | Cross-border beverage price index + Finnish landed-cost intelligence platform (planned) |
| Runtime | Node.js tooling only; application runtime TBD |
| Date of review | 2026-08-15 |
| Maintainer | Not evident from the repository |

## 18. Glossary / Acronyms

| Term | Meaning |
|---|---|
| Landed cost | Total cost of a foreign-purchased item delivered to Finland, incl. retail price, transport, excise, container duty |
| Excise | Alcohol duty levied by the Finnish Tax Administration based on category, ABV, and volume |
| Container duty | Beverage-container duty (general rate €0.51/litre), with deposit-return exemptions |
| Distance Selling | Transaction classified where the merchant arranges delivery to Finland |
| Distance Buying | Transaction classified where the buyer arranges transport independently |
| Traveller Import | Personal import excluded from landed-cost calculation |
| MyTax | Finnish Tax Administration's online tax service |
| ABV | Alcohol by volume |

<!-- Last updated: 2026-08-16 -->
