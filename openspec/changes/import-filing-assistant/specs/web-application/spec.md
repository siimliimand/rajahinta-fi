# web-application Delta

## ADDED Requirements

### Requirement: Dated filing guidance on the calculator result

The declaration guidance panel on the calculator result SHALL offer a planned
dispatch-date input and, when a date is supplied, render the dated checklist,
guarantee figure, and reference-number step from the guidance response; when
no date is supplied, the undated checklist SHALL render. Unavailable figures
and unverified steps SHALL render nothing. Copy SHALL exist in fi and en with
content lint green, and the single structural-disclaimer render rule is
untouched.

#### Scenario: Visitor enters a dispatch date

- **WHEN** the visitor supplies a planned dispatch date in the panel
- **THEN** the dated checklist with deadline, guarantee line, and
  reference-number step renders from the guidance response

#### Scenario: No date supplied

- **WHEN** the visitor has not entered a dispatch date
- **THEN** the undated checklist renders and no deadline or countdown appears

#### Scenario: Honest empty states

- **WHEN** the guarantee figure is unavailable or a step's fact is uncited
- **THEN** the panel renders nothing for that figure or step
