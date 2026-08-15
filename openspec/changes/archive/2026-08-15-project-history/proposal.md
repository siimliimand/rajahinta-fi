# Project History

## What this project is

Rajahinta.fi is a cross-border beverage price index and Finnish landed-cost intelligence platform. It is a greenfield project: there is no application code yet, only business and engineering planning documentation. The platform is intended to be a calculator, not a shop — the only commercial transaction is a software subscription, and every calculated number (excise, container duty, transport, total) must be traceable back to its inputs and the dataset version that produced it.

## Key decisions already made (inferred from code and docs)

The engineering plan in `docs/rajahinta-fi-implementation-plan.md` fixes several non-negotiable design decisions before any code exists:

- **Modular monolith, not microservices**, for the MVP. The calculation engine, classification engine, and data platform are tightly coupled, and the planned module boundaries allow later extraction without redesigning domain logic.
- **A calculator, not a shop** — no checkout, no payment collection for alcohol, no physical-goods order management.
- **Neutrality enforced in code** — ranking and sorting must be deterministic; no code path allows a paid/manual boost to a merchant's position.
- **Tax data is versioned, never overwritten** — historical rates remain queryable so past calculations stay reproducible; rate changes require a reviewed, confirmed dataset version before promotion.
- **Isolated Transaction Classification Module** as the platform's most important proprietary logic — outputs observed patterns with confidence and evidence, never bare legal conclusions.
- **Excise and container-duty sub-engines split and independently versioned**, using official Finnish Tax Administration rate tables as the primary source.
- **Data freshness as a first-class citizen** — every externally sourced fact carries a reliability status and timestamp surfaced to the user.
- A **Compliance & Governance layer** runs across all layers, enforcing neutrality rules, data-reliability labeling, and audit logging.

## Known tech debt or constraints visible in the codebase

- No implementation language, framework, or database has been selected yet; delivery phases and module boundaries are defined, but stack choices remain open.
- The deposit-return system exemption and container-duty estimation carry an explicit requirement that unknown deposit status be flagged ESTIMATED rather than silently assumed.
- Classification rules are subject to legislative change (e.g., the 1 September 2024 joint-liability change) and therefore must be stored as versioned, dated rule sets.
- Minimal personal data is a stated constraint — the architecture should default to anonymous usage; identity/age-verification handling, if ever required, is a separate isolated subsystem.

## Current state of the project

Greenfield. The repository contains planning documentation and the agentic infrastructure (`.agents/skills/`, `.opencode/`, OpenSpec scaffolds, an AGENTS.md operating contract) but no application source code yet. ARCHITECTURE.md and DESIGN.md are placeholders pending their generation step of repo initialization.