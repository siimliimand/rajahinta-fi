# event-calculator Specification

## ADDED Requirements

### Requirement: Event templates

The event calculator SHALL offer occasion templates (wedding, birthday, company party, graduation among them) that prefill guest count, duration, and drink-mix assumptions. Template values SHALL remain fully editable, and the estimated quantities and total cost SHALL always derive from the editable inputs, never from the template alone.

#### Scenario: Template prefills editable inputs

- **WHEN** the visitor selects an occasion template
- **THEN** guest count, duration, and drink-type selections fill with the template values and remain editable

#### Scenario: Estimates follow inputs, not template

- **WHEN** the visitor edits any prefilled value
- **THEN** quantity and cost estimates recompute from the edited inputs
