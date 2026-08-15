# Phase 0 — Foundation & Project Setup

## Why

Rajahinta.fi is a greenfield project with a detailed engineering plan but no application code. Phase 0 builds the foundation that every subsequent phase depends on: the tech stack, the modular monolith scaffold with its five bounded layers, and the compliance-critical infrastructure the plan requires before any feature code exists.

## What Changes

- Select backend language/framework, database, and frontend framework
- Scaffold the modular monolith with five bounded layers (Data Acquisition, Core Domain, Data Platform, Application/API, Presentation)
- Establish strict module interfaces so any layer can be extracted later without domain redesign
- Stand up dev → staging → production with a staging copy of tax-rule and merchant data
- Configure CI/CD with automated regression tests (golden-dataset tax tests, data-quality checks, compliance checks) on every deploy
- Deploy a feature-flag system gating new merchant sources, new tax rulesets, and new ranking behavior
- Set up scheduled/queued job infrastructure for background work, isolated from the request/response path
- Instrument the four KPI categories (product, commercial, data, compliance) directly, not reconstructed from raw logs
- Expose operational health signals on an internal ops dashboard
- Instrument per-calculation cost attribution

## Capabilities

### New Capabilities
- `project-scaffold`: tech stack selection and the five-layer modular monolith scaffold with strict module interfaces
- `environment-pipeline`: three-tier environment promotion (dev→staging→prod) with a staging data copy
- `ci-cd-pipeline`: automated build/test/deploy pipeline with regression and compliance checks on every deploy
- `feature-flags`: flag system gating compliance-sensitive changes (merchant sources, tax rulesets, UI ranking behavior)
- `background-jobs`: scheduled/queued job infrastructure running price ingestion, transport-rate refresh, tax-dataset review, and time-series aggregation off the request path
- `observability`: direct KPI instrumentation, ops health dashboard, and per-calculation cost attribution

### Modified Capabilities
(none — greenfield)

## Impact

- No application code exists; everything created is net-new foundation
- CI/CD configuration, environment provisioning, deployment setup
- Observability and instrumentation wired into the scaffold for later phases
- No product/domain modules built (Phase 1 scope)
- All touched paths are tentative (stack not yet selected)

## Missing Specialist Engineer

No spawned subagents exist. The only agent is `fullstack-engineer` (mode: primary, not spawnable). Phase 0 is DevOps/platform engineering work. Before running `/plan-apply`, create a `devops-engineer` or `platform-engineer` via `/make-engineer`.