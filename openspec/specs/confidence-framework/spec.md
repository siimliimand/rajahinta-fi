# confidence-framework Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.

## Requirements

### Requirement: Data-reliability statuses

Every externally sourced data point SHALL carry a reliability status of VERIFIED, STALE, UNAVAILABLE, or ESTIMATED, attached to price, transport, and classification inputs. The four-value set SHALL be the only vocabulary used from ingestion through calculation to the API payload.

#### Scenario: Estimated input

- **WHEN** a shipping cost is based on an assumption rather than a verified offer
- **THEN** that input SHALL be marked ESTIMATED and SHALL influence the result's confidence level

#### Scenario: Status survives the pipeline unchanged

- **WHEN** an input marked VERIFIED at ingestion reaches the calculator and the API payload
- **THEN** it SHALL carry the same VERIFIED status without intermediate vocabulary translation

### Requirement: Computed result confidence

Result confidence SHALL be a pure function of the underlying data statuses, not a manually set field: HIGH when all material inputs are verified, MEDIUM when one or more are estimated, LOW when shipping or classification is unverifiable.

#### Scenario: Confidence drift prevention

- **WHEN** an input's reliability status changes from VERIFIED to STALE
- **THEN** the computed confidence SHALL change automatically to reflect the degraded input, without any manual update

### Requirement: Explainable confidence

The framework SHALL expose enough detail that the UI can show why a result has its confidence level.

#### Scenario: Confidence rationale

- **WHEN** a result has MEDIUM confidence
- **THEN** the UI SHALL be able to list which input or inputs were estimated

### Requirement: Single reliability vocabulary

Exactly one reliability vocabulary SHALL exist in the codebase: VERIFIED, STALE, UNAVAILABLE, ESTIMATED. No parallel status value (such as `EXACT`) SHALL be defined, exported, stored, or mapped between; the result payload's reliability status SHALL be typed as this union, not as an open string.

#### Scenario: No alias vocabulary

- **WHEN** the codebase is searched for reliability status values
- **THEN** only VERIFIED, STALE, UNAVAILABLE, and ESTIMATED SHALL exist, with no `EXACT` alias or ad-hoc conversion layer

#### Scenario: Typed status

- **WHEN** a calculation result's `reliabilityStatus` is assigned a value outside the union
- **THEN** compilation SHALL fail

### Requirement: Empirical result margin

The framework SHALL derive an optional empirical margin for a landed-cost
result from user-reported calculation outcomes: the nearest-rank p80 quantile
of relative error `|reported_total − estimated_total| / estimated_total`
(totals in euro cents, the error a fraction of the estimate), resolved
through a cell ladder (category×carrier → category → global) where the
deepest rung with at least 10 matching reports wins. The quantile is an
observed sample value from the cell's own reports, so the sample-floor and
boundary comparisons are inclusive. The resolved margin's quantile SHALL be
clamped to the minimum over the qualifying rungs on the ladder path — a
deeper cell never resolves wider than its qualifying parent — while the
sample count and cell identity still describe the winning (deepest) rung.
When no rung meets the sample floor, the margin SHALL be null — the system
SHALL never fabricate or default a margin, and a null margin SHALL be
renderable as nothing.

#### Scenario: Ladder resolves at the deepest floored cell

- **WHEN** a result's category×carrier cell has 10 or more outcome reports
- **THEN** the margin comes from that cell's quantile, not a shallower rung

#### Scenario: The ladder never widens with depth

- **WHEN** a deeper rung's own p80 exceeds a qualifying parent rung's p80
- **THEN** the resolved margin carries the narrower (minimum) quantile while
  its sample count and cell still describe the deepest qualifying rung

#### Scenario: Below the floor the margin is null

- **WHEN** every ladder rung for a result holds fewer than 10 reports
- **THEN** the margin is null and no numeric margin is rendered or implied

#### Scenario: The margin never enters computation

- **WHEN** a result carries a margin
- **THEN** every total, breakdown line, ranking position, and sort order is
  byte-identical to the same result without the margin

### Requirement: Margin UI presents its basis

Where a margin is displayed, the relative percent, the sample count, and the
as-of date SHALL be presented adjacent to the ± figure, and a link to the
methodology explanation — the public ranking page's methodology section
(`/ranking`) — SHALL be reachable from the meter.

#### Scenario: The basis travels with the figure

- **WHEN** a result renders a ± figure
- **THEN** the relative percent, the sample count (n=), and the as-of date
  are visible next to it, and the methodology link points at the /ranking
  methodology section
