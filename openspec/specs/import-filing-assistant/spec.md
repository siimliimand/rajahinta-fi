# import-filing-assistant Specification

## Purpose
TBD - created by archiving change import-filing-assistant. Update Purpose after archive.

## Requirements

### Requirement: Domain-verified process content

Every filing-process step and date-derived figure the assistant renders SHALL
trace to a cited official source recorded in the change notes (verbatim quote
plus URL), and the service output SHALL carry that citation reference with the
step or figure. A step whose fact is uncited SHALL NOT render — the consumer
omits it rather than rendering plausible text.

#### Scenario: Citations carried with each step

- **WHEN** the dated or undated checklist is built for a filing
- **THEN** every step in the output carries its official-source citations with
  it, and date-derived figures carry their citations likewise

#### Scenario: Unverified fact renders nothing

- **WHEN** a checklist step's underlying fact has no recorded citation
- **THEN** the step is omitted from the rendered guidance rather than rendered
  as plausible text

### Requirement: Guarantee figure

The guidance SHALL state the guarantee to lodge as exactly the filing's
calculated alcohol-excise figure. The beverage-packaging (container-duty)
result SHALL be excluded from the amount — no guarantee attaches to it. The
offered figure SHALL carry a reliability status no higher than ESTIMATED;
VERIFIED is never asserted from the calculation record. The figure SHALL be
unavailable — never a substituted plausible number — when the excise record
proves no applicable rule: a fallback-dataset rule label, missing rule-version
provenance, or a non-finite or negative recorded amount.

#### Scenario: Guarantee follows the excise figure

- **WHEN** the declaration guidance is built from a calculation record whose
  alcohol excise carries an applicable rule version
- **THEN** the guarantee figure equals that excise figure exactly, excludes
  the container-duty result, and carries ESTIMATED status

#### Scenario: Missing rule yields unavailable

- **WHEN** the recorded excise carries the fallback rule label or no
  rule-version provenance, or a non-finite or negative amount
- **THEN** the guarantee figure is unavailable and marked as such, with no
  substituted value

### Requirement: Dated pre-dispatch checklist

The guidance SHALL accept an optional planned dispatch date as a request
parameter and resolve the checklist into exactly one of three states: DATED
(today or ahead), POST_DEADLINE (in the past relative to the filing state), or
UNDATED. Dated states SHALL order the filing steps against that date with
before-dispatch deadline semantics, anchor each step to the date, and mark
date-derived figures ESTIMATED — including a return-due estimate placing the
excise return and payment on the 12th of the month following the planned
date. With no usable date the guidance SHALL render the undated checklist —
the same steps and citations, no deadline, no derived dates, no countdown.
An absent, empty, malformed, or impossible calendar date SHALL degrade to the
UNDATED state — never an error, never a guessed date; the strict calendar-date
validation lives in the service as its single source.

#### Scenario: Dated checklist

- **WHEN** a usable dispatch date is supplied
- **THEN** the checklist steps are anchored to it, the deadline semantics are
  before dispatch, and date-derived figures carry ESTIMATED status

#### Scenario: Return-due estimate in dated states

- **WHEN** the checklist resolves to the DATED or POST_DEADLINE state
- **THEN** a return-due estimate names the 12th of the month following the
  planned date with ESTIMATED status and its citation, and is absent in the
  UNDATED state

#### Scenario: Absent or malformed dispatch date degrades factually

- **WHEN** the dispatch date is absent, empty, malformed, or an impossible
  calendar date
- **THEN** the undated checklist renders with citations and no deadline or
  derived dates — no error is raised and no date is invented

### Requirement: Post-deadline state

When the supplied dispatch date is in the past relative to the filing state,
the guidance SHALL render the post-deadline state in the observed-pattern
register: the before-dispatch filing window has passed and the user is
directed to verify their obligations with the cited official sources. The
negligence penalty (laiminlyöntimaksu) MAY be named only in the officially
hedged, cited form — a possible consequence with no amount or computation
basis stated — and that hedged wording SHALL be confined to the post-deadline
state: the checklist steps and dated figures SHALL NOT assert penalties or
legal consequences beyond their recorded citations.

#### Scenario: Deadline passed

- **WHEN** the supplied dispatch date is in the past relative to the filing
  state
- **THEN** the post-deadline state renders with the official-source citations
  and no quantitative or uncited penalty assertion

#### Scenario: Hedged penalty wording stays in the post-deadline family

- **WHEN** any checklist step or dated figure renders
- **THEN** no negligence-penalty wording appears outside the post-deadline
  state

### Requirement: Reference-number steps

The checklist SHALL include the reference-number capture step at the verified
lifecycle point — the excise number appears in MyTax under advance notices
only once the guarantee payment has been received, with the payment visible
within 1–2 business days — and the pass-to-carrier step: every received
number is given to the carrier or marked on the parcel before dispatch. Both
steps SHALL cite their sources and SHALL appear in the dated and undated
checklists alike.

#### Scenario: Reference-number steps present

- **WHEN** the checklist renders, dated or undated
- **THEN** the capture step (post-guarantee-payment) and the pass-to-carrier
  step (all numbers, before dispatch) appear at the verified lifecycle points
  with their citations

### Requirement: Read-only no-submission guarantee

The assistant SHALL NOT submit anything to MyTax or any external service and
SHALL NOT persist filing data; the existing runtime no-submission guarantee
remains attached to every service result, the type-level read-only proofs
continue to hold, and the dispatch date remains a request parameter rather
than stored state.

#### Scenario: No persistence

- **WHEN** guidance is produced for any input
- **THEN** no filing row is written and the runtime guarantee is present on
  the result
