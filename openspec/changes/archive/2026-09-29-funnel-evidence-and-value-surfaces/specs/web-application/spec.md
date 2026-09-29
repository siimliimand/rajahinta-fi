# web-application Specification delta

## MODIFIED Requirements

### Requirement: Homepage value proposition

The homepage value proposition and trust row SHALL describe the service without naming Sweden or Systembolaget: the landed-cost proposition in one sentence, the data model phrased as published retailer datasets plus the Alko domestic reference, the reliability model with its four statuses, and the methodology link. The homepage SHALL additionally render a static, server-rendered task section linking the existing task tools — basket, trip, event, what-if, and savings — styled from the design tokens, present in both locales, and introducing no new input surface: the hero search remains the homepage's only input. All copy SHALL exist in both locales and pass the content-policy lint.

#### Scenario: No residual market naming

- **WHEN** the fi and en message catalogs are linted
- **THEN** no homepage or trust-row string names Sweden, Systembolaget, or a Swedish market, and translation coverage is complete in both locales

#### Scenario: Task section links shipped tools

- **WHEN** a visitor loads the homepage
- **THEN** a server-rendered task section links the basket, trip, event, what-if, and savings pages, styled from the shared design tokens and fully rendered in the server HTML in both locales

#### Scenario: Single input surface

- **WHEN** the homepage is inspected for interactive inputs
- **THEN** the hero search is the only input; the task section contains navigational links only
