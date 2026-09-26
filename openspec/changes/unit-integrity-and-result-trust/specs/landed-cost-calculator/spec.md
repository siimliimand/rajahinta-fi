# landed-cost-calculator Specification

## MODIFIED Requirements

### Requirement: Result confidence and reliability

Every calculation result SHALL carry an overall confidence level and per-component reliability statuses. In addition, the calculator SHALL apply a plausibility sanity rail: when a line's excise estimate exceeds 5× that line's foreign retail price (named, documented constant), the result's overall confidence SHALL be LOW, the affected component's reliability SHALL read ESTIMATED rather than VERIFIED, and the result SHALL carry machine-readable sanity notes explaining the downgrade. The rail SHALL never alter any computed amount: totals and line figures remain byte-identical to a rail-less calculation with the same inputs.

#### Scenario: Plausible calculation is unaffected

- **WHEN** a calculation's excise is within 5× of the retail price
- **THEN** the result carries no sanity notes and its confidence/statuses follow the normal reliability model

#### Scenario: Absurd excise degrades visibly

- **WHEN** a line's excise exceeds 5× that line's retail price (for example a unit-conversion regression producing €10,693 of excise on a €98.70 basket)
- **THEN** the overall confidence is LOW, the excise component reads ESTIMATED, and `sanityNotes` names the threshold breach

#### Scenario: The rail never changes amounts

- **WHEN** the same inputs are calculated with and without the rail condition being met
- **THEN** every monetary figure is identical; only confidence, statuses, and the notes differ

#### Scenario: Golden dataset stays green

- **WHEN** the golden regression suite runs against sane fixtures
- **THEN** no fixture trips the rail and all expected totals are unchanged
