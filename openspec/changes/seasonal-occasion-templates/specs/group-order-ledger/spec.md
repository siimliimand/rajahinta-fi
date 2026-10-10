# group-order-ledger Delta

## ADDED Requirements

### Requirement: Estimate-derived prefill intake

The group-order creation flow MAY accept an optional prefill source consisting of item names and quantities originating from an event-calculator estimate. Prefill rows SHALL be ordinary ledger items — fully editable and removable — indistinguishable in treatment from manually added rows. The prefill channel SHALL NOT accept prices, payment-adjacent fields, or settlement semantics; the accounting-only boundary and its DTO-level rejection of payment-instrument fields SHALL remain unchanged and pinned by test. An empty or invalid prefill SHALL resolve to the standard empty creation state.

#### Scenario: Prefill populates editable rows

- **WHEN** the creation flow opens with a valid names-and-quantities prefill
- **THEN** the ledger items appear prefilled and behave exactly like manually added rows (editable, removable, weighted in allocation)

#### Scenario: Accounting-only rejection is unchanged

- **WHEN** any payload through the prefill or create path contains a payment-instrument field
- **THEN** it is rejected at the DTO with the offending field named, as before this change

#### Scenario: Invalid prefill degrades to empty state

- **WHEN** the creation flow opens with an empty or malformed prefill
- **THEN** the standard empty creation state renders with no error surface
