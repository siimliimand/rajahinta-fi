# ci-cd-pipeline Specification

## Purpose

Automated continuous integration and continuous deployment pipeline using GitHub Actions, ensuring that every code change passes lint, typecheck, unit tests, and golden-dataset regression tests before merging, and that staging deployments are automated.

## ADDED Requirements

### Requirement: CI runs on every PR and push

The CI pipeline SHALL run on every pull request to `main` and on every push to `main`, executing lint, typecheck, unit tests, and golden-dataset regression tests in a matrix environment matching production dependencies.

#### Scenario: PR receives CI feedback

- **WHEN** a pull request is opened or updated
- **THEN** the CI workflow SHALL run all checks and report pass/fail status

#### Scenario: Main branch protected

- **WHEN** a push lands on `main`
- **THEN** the CI workflow SHALL re-run all checks to guard against merge-race conditions

### Requirement: CI matrix matches production stack

The CI environment SHALL use Node.js 22, PostgreSQL 16, and Redis 7 — matching the production stack version constraints defined in `docs/tech-stack.md`.

#### Scenario: Version mismatch caught

- **WHEN** a developer attempts to use a feature from a newer Node.js version
- **THEN** the CI SHALL fail, preventing the incompatible code from reaching production

### Requirement: Golden-dataset tests are non-skippable in CI

The golden-dataset regression tests SHALL be included in the CI workflow and SHALL NOT be skippable. A golden-dataset failure SHALL block merge.

#### Scenario: Golden test regression blocks merge

- **WHEN** a code change breaks a golden-dataset test
- **THEN** the CI SHALL report failure and the PR SHALL be blocked from merging

### Requirement: Staging deployment workflow

A deployment workflow SHALL exist that builds the Docker image, pushes it to a container registry, and applies the staging Kubernetes overlay. The workflow SHALL trigger on push to `main` or via manual dispatch.

#### Scenario: Automated staging deploy

- **WHEN** code is pushed to `main`
- **THEN** the staging deployment workflow SHALL build and deploy to the staging environment

#### Scenario: Manual production deploy

- **WHEN** a maintainer triggers a manual dispatch
- **THEN** the production deployment workflow SHALL build and deploy to the production environment