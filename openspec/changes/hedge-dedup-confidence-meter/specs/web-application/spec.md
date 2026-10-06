# web-application Delta

## MODIFIED Requirements

### Requirement: Structural disclaimers on all new result surfaces

The event calculator, trip calculator, what-if simulator, and packing
suggestion SHALL render their respective disclaimers as structural parts of
the result presentation, sourced from the result objects. Each result view
SHALL render its disclaimer exactly once: either in the result body or in the
site footer, never both nor repeated within the view. The what-if simulator's
HYPOTHETICAL disclaimer SHALL keep its prominent render and remains governed
by its own stronger-wording requirement. The disclaimer text SHALL remain
byte-identical to the result object's field.

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
