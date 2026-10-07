# landed-cost-calculator Delta

## MODIFIED Requirements

### Requirement: Result presentation

The calculator SHALL present its result answer-first: the estimated landed
cost as the primary figure, followed by the explicit difference against the
Finland reference, then the full breakdown beneath. The breakdown figures
SHALL remain traceable to the result object's inputs (existing explainability
contract, unchanged). The result card SHALL surface the data reliability
status and timestamp carried by the underlying data, using the existing
reliability-status model, and SHALL render the structural disclaimer from the
result object exactly once: as an amber banner when result confidence is LOW,
as a quiet neutral one-liner otherwise, with the disclaimer text byte-identical
to the result object's field. Tax-line category labels SHALL carry no estimate
qualifier — excise, container duty, and import VAT are deterministic given
classification — and estimate-ness SHALL be carried by the per-value
reliability status indicators; the transport line SHALL keep an explicit
estimate label when no transport offer was selected. The confidence breakdown
SHALL be reachable from the result presentation (behind the derivation
disclosure) rather than always-on; degraded-state sanity notes SHALL remain
visible when result confidence is LOW, naming the degraded input directly
(the former generic framing label is retired). When an empirical margin is
composed for the result, the calculator result view SHALL render it beside
the primary figure with its sample count and as-of date, as a display-only
figure.

#### Scenario: Answer before breakdown

- **WHEN** a calculation completes
- **THEN** the landed cost and Finland difference appear before any breakdown,
  with the explicit cheaper/dearer text — the comparison is never conveyed by
  color alone

#### Scenario: Freshness is visible

- **WHEN** a result renders
- **THEN** the card shows the reliability status and observation timestamp of
  the price data feeding the result

#### Scenario: Disclaimer comes from the result object

- **WHEN** a result renders
- **THEN** the disclaimer text rendered is the result object's structural
  disclaimer field

#### Scenario: One disclaimer per result

- **WHEN** the result card renders
- **THEN** the structural disclaimer text appears exactly once, amber at LOW
  confidence and quiet otherwise

#### Scenario: Deterministic taxes are not labeled as estimates

- **WHEN** the breakdown lists excise, container duty, or import VAT
- **THEN** the line labels carry no estimate qualifier, and the line's
  reliability status dot is the only estimate signal

#### Scenario: Breakdown detail stays reachable

- **WHEN** a reader wants to know why a result carries its confidence level
- **THEN** the per-input breakdown is available behind the derivation
  disclosure in one interaction

#### Scenario: Margin shows its basis

- **WHEN** a calculator result view renders a composed empirical margin
- **THEN** the ± figure, relative percent, sample count, and as-of date render
  beside the primary figure, and every monetary figure is unchanged
