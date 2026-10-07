# web-application Delta

## MODIFIED Requirements

### Requirement: Structural disclaimers on all new result surfaces

The event calculator, trip calculator, what-if simulator, and packing
suggestion SHALL render their respective disclaimers as structural parts of
the result presentation, sourced from the result objects. Each result view
SHALL render its disclaimer exactly once in the result presentation — never
repeated within the view; the site footer's own legal strip is a separate
page-level line and SHALL remain unchanged. The what-if simulator's
HYPOTHETICAL disclaimer SHALL keep its prominent render and remains governed
by its own stronger-wording requirement, counted as that view's one render.
The disclaimer text SHALL remain byte-identical to the result object's field.
A result view whose API response carries no result confidence (the trip and
event calculators) SHALL render the banner at its documented default
intensity and SHALL NOT fabricate or display a confidence value. The
exactly-once counts SHALL be pinned by the disclaimer-single-render
compliance suite, which renders the real views and counts byte-level
occurrences of the payload text.

#### Scenario: Disclaimer rendered from result

- **WHEN** a new result surface renders a calculation outcome
- **THEN** its disclaimer text comes from the result object and appears exactly
  once in the view

#### Scenario: No heap

- **WHEN** a result view is rendered
- **THEN** the disclaimer string appears exactly once in the rendered output,
  and estimate framing is carried by reliability badges and status dots rather
  than repeated prose

#### Scenario: What-if keeps its prominent hypothetical banner

- **WHEN** a what-if result is rendered
- **THEN** the HYPOTHETICAL disclaimer renders prominently and prominently only

#### Scenario: No confidence is fabricated

- **WHEN** a trip or event API response carries no result confidence
- **THEN** the banner renders at its documented default intensity and no
  confidence value is fabricated or shown as the result's
