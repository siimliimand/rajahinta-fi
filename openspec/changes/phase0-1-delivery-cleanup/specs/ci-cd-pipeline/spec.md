# ci-cd-pipeline — Delta Spec

## MODIFIED Requirements

### Requirement: Staging deployment workflow

The staging deployment workflow SHALL authenticate to the container registry with a working credential, push the built image, run the migrate Job, run the seed Job, and complete the backend rollout. A push to `master` SHALL produce a green end-to-end staging deploy (image push, migrations applied, seed complete, rollout healthy). The workflow SHALL NOT contain placeholder or echo-only deploy steps.

#### Scenario: Automated staging deploy

- **WHEN** a push to `master` triggers the staging deploy workflow
- **THEN** the workflow SHALL log in to GHCR with a valid credential, push the image, and complete migrate, seed, and rollout steps with a green conclusion

#### Scenario: Registry credential failure is fixed, not bypassed

- **WHEN** the registry login step fails
- **THEN** the deploy SHALL fail (no silent skip), and the credential SHALL be repaired (workflow-scoped `GITHUB_TOKEN` with `packages: write`, or a valid `REGISTRY_TOKEN` PAT) rather than removed

#### Scenario: No placeholder deploy pipelines

- **WHEN** `.github/workflows/` is inspected
- **THEN** no workflow SHALL contain echo-only "deploy" or "migration" steps or lint bypasses justified by stale comments; the deploy surface SHALL be exactly `ci.yml`, `deploy-staging.yml`, `deploy-production.yml`, and `load-tests.yml`

#### Scenario: Required checks survive workflow deletion

- **WHEN** the legacy `deploy.yml` is deleted
- **THEN** branch protection on `master` SHALL report no missing required checks and open pull requests SHALL show no stuck check
