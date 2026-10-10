# web-application Delta

## MODIFIED Requirements

### Requirement: Declaration guidance panel

The calculator result detail page SHALL render the declaration assistant's
advanced guidance (derivation, deadline, checklist, caveats) in a clearly
bounded panel using observed-pattern phrasing. The panel SHALL additionally
offer a planned dispatch-date input: a complete calendar-date value refetches
the guidance with the `dispatchDate` request parameter (never persisted), and
an incomplete value SHALL NOT trigger a fetch. When a usable date is
supplied, the dated checklist renders — the cited steps including the
reference-number and pass-to-carrier steps, the guarantee line with its
reliability chip, the ESTIMATED return-due line, and the before-dispatch
deadline semantics; when the supplied date is in the past, the post-deadline
copy renders verbatim from the response — never locally invented; with no
date, the undated checklist renders without deadline or countdown. An
unavailable guarantee and an uncited step SHALL render nothing, and a
response predating the dated-checklist fields SHALL render nothing new. The
dated copy SHALL exist in Finnish and English under the content-policy lint,
and the single structural-disclaimer render rule is untouched.

#### Scenario: Guidance rendered

- **WHEN** a user expands the declaration guidance panel on a result
- **THEN** the derivation, deadline, checklist, and any caveats SHALL be
  displayed with the standing disclaimer

#### Scenario: Visitor enters a dispatch date

- **WHEN** the visitor supplies a complete planned dispatch date in the panel
- **THEN** the dated checklist with deadline semantics, guarantee line,
  reference-number steps, and return-due estimate renders from the guidance
  response

#### Scenario: Incomplete date never fetches

- **WHEN** the dispatch-date input holds a partial value
- **THEN** no guidance request is issued for it

#### Scenario: No date supplied

- **WHEN** the visitor has not entered a dispatch date
- **THEN** the undated checklist renders and no deadline or countdown appears

#### Scenario: Post-deadline copy verbatim

- **WHEN** the supplied dispatch date resolves to the post-deadline state
- **THEN** the panel renders the response's post-deadline copy and citations
  verbatim, with no locally invented penalty text

#### Scenario: Honest empty states

- **WHEN** the guarantee figure is unavailable or a step's fact is uncited
- **THEN** the panel renders nothing for that figure or step

#### Scenario: Payload predating the dated fields

- **WHEN** the guidance response omits the dated-checklist fields
- **THEN** the panel renders exactly its previous sections and nothing new
