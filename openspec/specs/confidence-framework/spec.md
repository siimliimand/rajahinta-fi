# confidence-framework Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.
## Requirements
### Requirement: Data-reliability statuses

Every externally sourced data point SHALL carry a reliability status of VERIFIED, STALE, UNAVAILABLE, or ESTIMATED, attached to price, transport, and classification inputs. The four-value set SHALL be the only vocabulary used from ingestion through calculation to the API payload.

#### Scenario: Estimated input

- **WHEN** a shipping cost is based on an assumption rather than a verified offer
- **THEN** that input SHALL be marked ESTIMATED and SHALL influence the result's confidence level

#### Scenario: Status survives the pipeline unchanged

- **WHEN** an input marked VERIFIED at ingestion reaches the calculator and the API payload
- **THEN** it SHALL carry the same VERIFIED status without intermediate vocabulary translation

### Requirement: Computed result confidence

Result confidence SHALL be a pure function of the underlying data statuses, not a manually set field: HIGH when all material inputs are verified, MEDIUM when one or more are estimated, LOW when shipping or classification is unverifiable.

#### Scenario: Confidence drift prevention

- **WHEN** an input's reliability status changes from VERIFIED to STALE
- **THEN** the computed confidence SHALL change automatically to reflect the degraded input, without any manual update

### Requirement: Explainable confidence

The framework SHALL expose enough detail that the UI can show why a result has its confidence level.

#### Scenario: Confidence rationale

- **WHEN** a result has MEDIUM confidence
- **THEN** the UI SHALL be able to list which input or inputs were estimated

### Requirement: Single reliability vocabulary

Exactly one reliability vocabulary SHALL exist in the codebase: VERIFIED, STALE, UNAVAILABLE, ESTIMATED. No parallel status value (such as `EXACT`) SHALL be defined, exported, stored, or mapped between; the result payload's reliability status SHALL be typed as this union, not as an open string.

#### Scenario: No alias vocabulary

- **WHEN** the codebase is searched for reliability status values
- **THEN** only VERIFIED, STALE, UNAVAILABLE, and ESTIMATED SHALL exist, with no `EXACT` alias or ad-hoc conversion layer

#### Scenario: Typed status

- **WHEN** a calculation result's `reliabilityStatus` is assigned a value outside the union
- **THEN** compilation SHALL fail

