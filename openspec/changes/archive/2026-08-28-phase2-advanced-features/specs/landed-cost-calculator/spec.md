# landed-cost-calculator Specification Delta

## ADDED Requirements

### Requirement: Declaration advanced guidance

The Excise Declaration Assistant SHALL augment its structured summary with an advanced-guidance section, computed from the persisted calculation record: (a) a derivation walkthrough of the excise estimate — product category, ABV, volume, quantity, applied excise and container-duty rates with their rule version labels and formula references; (b) the advance-notice deadline computed from the calculation timestamp when the classification requires notice; (c) an ordered, informational MyTax entry checklist phrased as observed patterns, not legal conclusions; (d) confidence-driven caveats — LOW result confidence, unknown deposit-return status (tri-state null → ESTIMATED container duty), and fallback tax-dataset version; and (e) links to official Finnish Tax Administration guidance alongside the existing MyTax link. The guidance SHALL remain strictly read-only: the assistant SHALL never submit, pre-fill, or transmit anything on the user's behalf, and the existing type-level read-only safety proofs SHALL continue to hold.

#### Scenario: Derivation present

- **WHEN** a declaration summary is prepared for a calculation record
- **THEN** the guidance SHALL include the applied rates with their rule version labels and the formula reference used

#### Scenario: Deadline computed

- **WHEN** the classification requires an advance notice with a deadline in days
- **THEN** the guidance SHALL include the computed due date derived from the calculation timestamp

#### Scenario: Caveats on uncertain data

- **WHEN** the underlying calculation has LOW confidence or an unknown deposit-return status
- **THEN** the guidance SHALL surface the corresponding caveat rather than presenting the estimate as certain

#### Scenario: Guidance never submits

- **WHEN** any guidance path is exercised
- **THEN** the assistant SHALL only prepare and display information, with no capability to transmit a declaration — the no-submission guarantee SHALL hold unchanged
