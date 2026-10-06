# unit-price-metrics Delta

## MODIFIED Requirements

### Requirement: Category ranking by ethanol unit price

The system SHALL expose a public per-category listing ordered deterministically by ethanol €/g ascending, computed by the existing pure unit-price function. Each row SHALL carry its reliability status (VERIFIED or ESTIMATED); products whose unit price is unavailable SHALL be omitted from the listing rather than placed at an arbitrary position. Equal values SHALL resolve by a stable secondary key so the order is fully deterministic.

All Finnish surfaces presenting the metric SHALL render one canonical name (`etanolin grammahinta`) and one display unit (`snt/g`); a surface SHALL NOT name one unit in a header, label, or sort option while rendering another unit in its values. The metric the pure function computes is already cents per gram (`centsPerGram`), so presentation SHALL render the computed value verbatim — no unit conversion is introduced. Any surface presenting the metric SHALL make its meaning (cents per gram of pure ethanol) available to the visitor on that surface, and computed values and wire formats remain unchanged.

#### Scenario: Ranking is deterministic

- **WHEN** the ranking endpoint is queried twice for the same category and dataset state
- **THEN** both responses SHALL contain the products in identical order

#### Scenario: Header and cells agree on the unit

- **WHEN** the value page, a comparison sort option, a product chip, or the calculator embed renders the metric in Finnish
- **THEN** the column header, sort label, or chip name and the rendered values all present `snt/g`, and no surface pairs a `€/g` label with `snt/g` values or the reverse

#### Scenario: Metric explained on the surface

- **WHEN** a visitor encounters the `snt/g` figure on any presenting surface
- **THEN** an explanation (what a grammahinta is: cents per gram of pure ethanol) is available on that same surface — caption, tooltip, or linked legend

#### Scenario: Values render verbatim

- **WHEN** the display-unit label migration lands
- **THEN** every rendered `snt/g` figure equals the API `centsPerGram` value exactly, no conversion is introduced, and compliance suites prove no computed figure moved
