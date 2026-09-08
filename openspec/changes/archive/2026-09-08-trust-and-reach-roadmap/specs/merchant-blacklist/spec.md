# merchant-blacklist Specification

## ADDED Requirements

### Requirement: Evidence-gated merchant reporting

An authenticated account SHALL be able to submit a report against a merchant identified by domain and normalized name, including required evidence fields (order reference, correspondence summary). Reports SHALL be stored with the reporter's account id and SHALL enter the OPEN moderation state. Reporting SHALL be rate-limited and audited.

#### Scenario: Report created

- **WHEN** an authenticated user submits a report with a merchant domain and the required evidence fields
- **THEN** the system SHALL store it in the OPEN state bound to the reporter's account and append an audit event

#### Scenario: Incomplete evidence rejected

- **WHEN** a report is submitted without the required evidence fields
- **THEN** the request SHALL be rejected with a validation error and nothing SHALL be stored

### Requirement: Manual publication against a published standard

Blacklist entries SHALL be published only by an operator action in the ops console, and only when the accumulated evidence meets the module's published standard (confirmed non-delivery by 3 or more independent reports, or a confirmed invalid business registration). No automatic path SHALL publish an entry.

#### Scenario: Standard met and operator publishes

- **WHEN** a merchant's OPEN reports satisfy the published standard and an operator confirms publication
- **THEN** a blacklist entry SHALL be created, the source reports SHALL be linked to it, and the action SHALL be appended to the audit trail

#### Scenario: Standard not met

- **WHEN** an operator attempts to publish without the standard being met
- **THEN** the action SHALL be rejected and no entry SHALL be created

### Requirement: Appeal path

A published blacklist entry SHALL be disputable. An appeal SHALL move the entry to REOPENED, remove its public display while reopened, and require a new operator decision (republish or reject) that is appended to the audit trail.

#### Scenario: Appeal reopens entry

- **WHEN** an appeal is filed against a published entry
- **THEN** the entry SHALL stop appearing in warnings immediately and SHALL await re-review

#### Scenario: Appeal resolved

- **WHEN** an operator resolves a reopened entry
- **THEN** the entry SHALL return to PUBLISHED or move to REJECTED, with the decision recorded

### Requirement: Display-only warnings

Responses that include offers from a blacklisted merchant SHALL carry a `merchantWarnings` block identifying the merchant and linking the methodology page. Warnings SHALL NOT exclude offers, alter sort order, or modify any calculated value, and output SHALL be byte-identical whether zero, one, or many warnings are present.

#### Scenario: Warning attached without side effects

- **WHEN** a response contains offers from a blacklisted merchant
- **THEN** the offers, their order, and all calculated figures SHALL be identical to the same response without the warning block, which SHALL be additive only

#### Scenario: No published entry, no warning

- **WHEN** a merchant has open reports but no published blacklist entry
- **THEN** no warning SHALL be displayed for that merchant
