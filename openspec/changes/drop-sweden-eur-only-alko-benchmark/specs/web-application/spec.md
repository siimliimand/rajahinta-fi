# web-application Specification

## MODIFIED Requirements

### Requirement: Homepage value proposition

The homepage value proposition and trust row SHALL describe the service without naming Sweden or Systembolaget: the landed-cost proposition in one sentence, the data model phrased as published retailer datasets plus the Alko domestic reference, the reliability model with its four statuses, and the methodology link. All copy SHALL exist in both locales and pass the content-policy lint.

#### Scenario: No residual market naming

- **WHEN** the fi and en message catalogs are linted
- **THEN** no homepage or trust-row string names Sweden, Systembolaget, or a Swedish market, and translation coverage is complete in both locales

### Requirement: Calculator UI

The calculator result view SHALL render an Alko benchmark line when the result carries the optional `alkoBenchmark` field: the Alko price, the difference in euros and percent, and the reference's reliability badge and timestamp. Wording SHALL be factual in both locales, including the plain statement when importing is not cheaper. The line SHALL NOT render when the field is absent, and SHALL never display as part of the total.

#### Scenario: Benchmark line rendering

- **WHEN** a result with a benchmark field is displayed, and a pre-change record without one is displayed
- **THEN** the first shows the factual benchmark line below the breakdown and the second shows the result unchanged with no placeholder
