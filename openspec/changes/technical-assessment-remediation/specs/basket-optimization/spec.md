# basket-optimization Specification Delta

## ADDED Requirements

### Requirement: Input caps pinned by test

A test SHALL pin the optimizer's input caps (items per basket, merchants per item) so a cap change is a deliberate, visible act rather than silent drift.

#### Scenario: Cap change fails the pin

- **WHEN** a cap constant is altered without updating the pinning test
- **THEN** the test suite SHALL fail

### Requirement: Total combinations guard

The optimizer SHALL guard on total combination count before enumerating, returning a clean 422 with an explanatory error when the request exceeds the configured bound, rather than exhausting CPU or memory.

#### Scenario: Oversized request rejected

- **WHEN** a basket request's total combinations exceed the configured bound
- **THEN** the API SHALL return 422 with an explanation and SHALL NOT enumerate the combinations
