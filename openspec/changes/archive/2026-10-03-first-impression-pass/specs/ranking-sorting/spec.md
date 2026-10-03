# Spec Delta: ranking-sorting

## MODIFIED Requirements

### Requirement: Documentable logic

The module's logic SHALL be describable in plain language on a public "how ranking works" page without omitting any actual factor. The consumer-facing transparency presentation SHALL state the neutrality facts in consumer language — without type-system names, internal field names, or build-time terminology — while the developer-facing documentation retains the full technical detail. Omitting the jargon SHALL NOT omit any factor: every enforcement fact remains stated.

#### Scenario: Methodology in lockstep

- **WHEN** the public ranking page is compared against the implementation
- **THEN** the documented methodology SHALL match the actual sorting behavior exactly

#### Scenario: Transparency copy is consumer-language

- **WHEN** the transparency section renders on the ranking page in either locale
- **THEN** it states the neutrality enforcement facts — no paid-placement field exists in the sort input, the input shape is pinned by tests, and unexpected fields are rejected at runtime — without naming sort-input interface types, internal flag fields, or compile-time verification
