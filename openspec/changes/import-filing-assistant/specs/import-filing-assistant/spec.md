# import-filing-assistant Delta

## ADDED Requirements

### Requirement: Domain-verified process content

Every filing-process step the assistant renders SHALL trace to a cited
official source recorded in the change notes (verbatim quote plus URL), and
the service output SHALL carry that citation reference with the step. A step
whose fact is unverified or no longer cited SHALL NOT render.

#### Scenario: Unverified fact renders nothing

- **WHEN** a checklist step's underlying fact has no recorded citation
- **THEN** the step is omitted from the guidance output rather than rendered
  as plausible text

### Requirement: Guarantee figure

The guidance SHALL state the guarantee to lodge computed from the filing's
excise and container-duty results per the verified rule, carrying the
underlying reliability status. When no rule applies the figure SHALL be
unavailable — never a substituted plausible number.

#### Scenario: Guarantee follows the tax figures

- **WHEN** the declaration guidance is built from a calculation record with
  excise and container-duty results
- **THEN** the guarantee figure is computed per the verified rule and carries
  the underlying reliability status

#### Scenario: Missing rule yields unavailable

- **WHEN** no applicable rule exists for the filing's figures
- **THEN** the guarantee figure is unavailable and marked as such, with no
  substituted value

### Requirement: Dated pre-dispatch checklist

The guidance SHALL order the filing steps against a user-supplied planned
dispatch date with before-dispatch deadline semantics, marking date-derived
figures ESTIMATED. With no dispatch date the guidance SHALL render the
undated checklist — the same steps and citations, no deadline and no
countdown.

#### Scenario: Dated checklist

- **WHEN** a dispatch date is supplied
- **THEN** the checklist steps are dated against it, the deadline is before
  dispatch, and date-derived figures carry ESTIMATED status

#### Scenario: Absent dispatch date degrades factually

- **WHEN** no dispatch date is supplied
- **THEN** the undated checklist renders with citations and no deadline or
  countdown figures

### Requirement: Post-deadline state

When the supplied dispatch date has passed, the guidance SHALL render the
post-deadline state in the observed-pattern register: the deadline has passed
and the user is directed to verify their obligations with the cited official
sources. The guidance SHALL NOT assert penalties or legal consequences beyond
the recorded citations.

#### Scenario: Deadline passed

- **WHEN** the supplied dispatch date is in the past relative to the filing
  state
- **THEN** the post-deadline state renders with the official-source citation
  and no uncited penalty assertion

### Requirement: Reference-number step

The guidance SHALL include the reference-number step at the lifecycle point
the verified facts establish (capture and pass-to-carrier), citing the source
for the timing.

#### Scenario: Reference-number step present

- **WHEN** the dated checklist renders for a filing that requires advance
  notice
- **THEN** the reference-number step appears at the verified lifecycle point
  with its citation

### Requirement: Read-only no-submission guarantee

The assistant SHALL NOT submit anything to MyTax or any external service and
SHALL NOT persist filing data; the existing runtime no-submission guarantee
remains attached to every service result, and the dispatch date remains a
request parameter rather than stored state.

#### Scenario: No persistence

- **WHEN** guidance is produced for any input
- **THEN** no filing row is written and the runtime guarantee is present on
  the result
