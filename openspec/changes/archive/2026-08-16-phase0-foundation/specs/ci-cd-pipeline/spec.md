## ADDED Requirements

### Requirement: Automated regression tests on every deploy

Every deploy (merge to main or promotion to staging/production) SHALL run:
- Golden-dataset tax tests: a fixed set of known product/transport/tax input combinations with manually verified expected outputs
- Data-quality checks: automated checks that flag stale or unavailable data
- Compliance checks: automated checks that no ranking result correlates with any commercial/payment signal

#### Scenario: Failing regression test blocks deploy

- **WHEN** a deploy pipeline runs and the golden-dataset tax tests produce a result that differs from the verified expected output
- **THEN** the deploy SHALL abort and the author SHALL receive a notification with the diff

#### Scenario: All checks pass

- **WHEN** a deploy pipeline runs and all regression, data-quality, and compliance checks pass
- **THEN** the deploy SHALL proceed to the next environment

### Requirement: Greenfield baseline

Since no application code exists yet, the initial CI/CD pipeline SHALL be configured to run the test suite on a placeholder scaffold. It MUST pass (all tests skipped or a trivial passing test) to establish the baseline before feature code is added.

#### Scenario: Initial scaffold pipeline green

- **WHEN** the CI/CD pipeline runs against the initial project scaffold
- **THEN** the pipeline SHALL exit with a success status, confirming the pipeline infrastructure is healthy