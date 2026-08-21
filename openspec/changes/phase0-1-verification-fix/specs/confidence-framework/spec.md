# confidence-framework — Delta Spec

## ADDED Requirements

### Requirement: Single reliability vocabulary

Exactly one reliability vocabulary SHALL exist in the codebase: VERIFIED, STALE, UNAVAILABLE, ESTIMATED. No parallel status value (such as `EXACT`) SHALL be defined, exported, stored, or mapped between; the result payload's reliability status SHALL be typed as this union, not as an open string.

#### Scenario: No alias vocabulary

- **WHEN** the codebase is searched for reliability status values
- **THEN** only VERIFIED, STALE, UNAVAILABLE, and ESTIMATED SHALL exist, with no `EXACT` alias or ad-hoc conversion layer

#### Scenario: Typed status

- **WHEN** a calculation result's `reliabilityStatus` is assigned a value outside the union
- **THEN** compilation SHALL fail

## MODIFIED Requirements

### Requirement: Data-reliability statuses

Every externally sourced data point SHALL carry a reliability status of VERIFIED, STALE, UNAVAILABLE, or ESTIMATED, attached to price, transport, and classification inputs. The four-value set SHALL be the only vocabulary used from ingestion through calculation to the API payload.

#### Scenario: Estimated input

- **WHEN** a shipping cost is based on an assumption rather than a verified offer
- **THEN** that input SHALL be marked ESTIMATED and SHALL influence the result's confidence level

#### Scenario: Status survives the pipeline unchanged

- **WHEN** an input marked VERIFIED at ingestion reaches the calculator and the API payload
- **THEN** it SHALL carry the same VERIFIED status without intermediate vocabulary translation
