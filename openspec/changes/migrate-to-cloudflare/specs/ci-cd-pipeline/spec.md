# ci-cd-pipeline Specification Delta

## MODIFIED Requirements

### Requirement: Staging deployment workflow

The staging deployment workflow SHALL authenticate to Cloudflare, apply D1 migrations to the staging database, run the D1 seed (where configured), and deploy the API Worker, email Worker, and frontend Worker via wrangler. A push to `master` SHALL produce a green end-to-end staging deploy on Cloudflare Workers (migrations applied, seed complete, all Workers healthy on their staging routes). The workflow SHALL NOT contain placeholder or echo-only deploy steps, and the K8s/kustomize deploy path SHALL NOT be used.

#### Scenario: Automated staging deploy

- **WHEN** a push to `master` triggers the staging deploy workflow
- **THEN** D1 migrations run against the staging database, seed completes, and all Workers deploy to the staging environment with healthy readiness endpoints

#### Scenario: No placeholder deploy pipelines

- **WHEN** the deploy workflows are inspected
- **THEN** no workflow contains echo-only "deploy" or "migration" steps; the deploy surface is exactly `ci.yml`, `deploy-staging.yml`, `deploy-production.yml`, and `load-tests.yml`

### Requirement: Deploys run schema migrations before seed and rollout

Both the staging and production deploy workflows SHALL apply the committed D1 migrations (via `wrangler d1 migrations apply`) to the target database before any seed step or Worker rollout. Sequence per deploy: migrate → seed (staging only) → deploy. A deploy against a fresh, empty D1 database SHALL end with schema present, and on staging additionally with the official tax versions seeded.

#### Scenario: Fresh staging database

- **WHEN** staging deploys against an empty D1 database
- **THEN** schema exists after migrations, official tax versions are seeded, and the deployed Worker passes its readiness check

## ADDED Requirements

### Requirement: Production deployment workflow

The production deployment workflow SHALL require a manual confirmation input, apply D1 migrations to the production database, and deploy all Workers via wrangler. The workflow SHALL NOT deploy from an unconfirmed trigger. The production deploy SHALL leave the previous Workers versions available for instant rollback (Workers rollback) independent of DNS.

#### Scenario: Confirmed production deploy

- **WHEN** the production workflow runs with confirmation set
- **THEN** migrations apply, all Workers deploy, and readiness checks pass on production routes

#### Scenario: Unconfirmed production deploy

- **WHEN** the production workflow runs without explicit confirmation
- **THEN** the workflow fails fast without deploying

### Requirement: EU data placement

The production and staging wrangler configurations SHALL place data-plane resources in the EU: D1 primary location, Durable Object location hint, and KV jurisdiction. The configuration SHALL be reviewable as committed config, not dashboard state.

#### Scenario: Placement review

- **WHEN** the wrangler configuration for staging or production is inspected
- **THEN** D1, DO, and KV resources declare EU placement
