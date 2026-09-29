# mvp-testing Specification delta

## MODIFIED Requirements

### Requirement: E2E suite executes

The end-to-end test suite SHALL execute in full: every declared test SHALL run (zero skipped-by-error), the suite SHALL exit non-zero on failure, and it SHALL run in CI. The e2e module configuration SHALL resolve every workspace package to a single module identity (source aliases, not mixed `src`/`dist` resolution) so framework dependency injection cannot fail on duplicate class identities. The suite SHALL additionally include mobile-viewport projects (375×667 and 390×844) executing the calculator, basket, and product journeys, asserting that result surfaces render without horizontal overflow and that primary quantity controls meet the 44 px minimum touch-target size.

#### Scenario: All e2e tests run

- **WHEN** `pnpm test:e2e` executes
- **THEN** all declared tests SHALL run (0 skipped), and the command SHALL exit 0 on green

#### Scenario: Single class identity

- **WHEN** the e2e suite boots the application composition root
- **THEN** every workspace package SHALL be loaded from exactly one module identity, and injection SHALL resolve without duplicate-class errors

#### Scenario: Mobile viewport journeys

- **WHEN** the mobile-viewport projects execute the calculator, basket, and product journeys at 375×667 and 390×844
- **THEN** result surfaces render without horizontal overflow, quantity controls meet the 44 px touch-target minimum, and failures exit non-zero in CI
