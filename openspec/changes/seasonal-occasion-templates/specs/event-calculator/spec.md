# event-calculator Delta

## MODIFIED Requirements

### Requirement: Event templates

The event calculator SHALL offer occasion templates (wedding, birthday, company party, graduation, vappu, juhannus, rapujuhlat, and talkoot among them) that prefill guest count, duration, and drink-mix assumptions. Template values SHALL remain fully editable, and the estimated quantities and total cost SHALL always derive from the editable inputs, never from the template alone. Occasion selection SHALL be URL-addressable through an `occasion` query parameter so templates are shareable and campaign-linkable; an unknown occasion value SHALL resolve to the default state without an error surface.

#### Scenario: Template prefills editable inputs

- **WHEN** the visitor selects an occasion template
- **THEN** guest count, duration, and drink-type selections fill with the template values and remain editable

#### Scenario: Estimates follow inputs, not template

- **WHEN** the visitor edits any prefilled value
- **THEN** quantity and cost estimates recompute from the edited inputs

#### Scenario: Deep link selects the occasion

- **WHEN** the event page is opened with `?occasion=juhannus`
- **THEN** the juhannus template's prefill state applies exactly as if selected by hand, and remains editable

#### Scenario: Unknown occasion is ignored

- **WHEN** the event page is opened with `?occasion=nonsense`
- **THEN** the calculator opens in its default state with no error surface

## ADDED Requirements

### Requirement: Event estimate handoff to group order

The event result SHALL offer a handoff action that opens the group-order creation flow with the estimated item list prefilled as item names and quantities only. The handoff SHALL NOT carry prices, payment-adjacent fields, or any settlement semantics — prefill rows are ordinary editable ledger items, and the group-order accounting-only boundary SHALL remain unchanged. The handoff action SHALL render only when a completed estimate exists.

#### Scenario: Handoff prefills names and quantities

- **WHEN** the visitor activates the handoff action on a completed event estimate
- **THEN** the group-order creation flow opens with the estimated items prefilled as editable rows

#### Scenario: Handoff carries no price or payment data

- **WHEN** the handoff payload is inspected
- **THEN** it contains item names and quantities only — no prices, no payment-adjacent fields — and the accounting-only boundary tests remain green

#### Scenario: No estimate, no handoff

- **WHEN** the event page has no completed estimate
- **THEN** the handoff action is not rendered
