# web-application Delta

## ADDED Requirements

### Requirement: Localized monetary and date presentation

User-facing monetary amounts and dates on the web application SHALL render in the active locale through the shared formatters: Finnish renders comma-decimal amounts with a suffix symbol (`64,19 €`) and localized numeric dates (`4.10.2026`); English renders its own convention. No user-facing surface SHALL present amounts or dates in a third convention (raw ISO dates in prose, dot-decimal Finnish amounts, symbol-first Finnish amounts). Server-side monetary figures are unaffected — only their client-side rendering changes, and every rendered amount SHALL equal the API value it presents.

#### Scenario: Finnish amounts render Finnish-style everywhere

- **WHEN** any user-facing surface (calculator result, search dropdown, catalog card, allowances, trip, product price-context) renders a monetary amount under the `fi` locale
- **THEN** the amount uses comma decimals and the suffix euro symbol, and equals the API-provided figure exactly

#### Scenario: Dates in Finnish prose are localized

- **WHEN** a Finnish page embeds a date in prose (price-context "tilanne", trip "havainnot … asti", allowances "… alkaen")
- **THEN** the date renders in Finnish numeric convention rather than raw ISO form

#### Scenario: English keeps its convention

- **WHEN** the same surfaces render under the `en` locale
- **THEN** amounts and dates use the English convention consistently

#### Scenario: Figures unchanged, rendering only

- **WHEN** the formatting migration lands
- **THEN** compliance byte-identity suites pass with no monetary figure moved, and deliberately updated presentation tests document the new rendering
