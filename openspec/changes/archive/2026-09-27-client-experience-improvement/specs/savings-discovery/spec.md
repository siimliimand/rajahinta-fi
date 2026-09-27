# savings-discovery Specification

## ADDED Requirements

### Requirement: Post-calculation savings summary

After a landed-cost calculation whose product has Alko reference offers, the result SHALL show a prominent savings summary ("Tilaamalla Virosta säästät arviolta €X verrattuna Alkon hintaan") built from the display-only `alkoBenchmark` comparison. The summary is display-only: it never enters the total, the breakdown, or any ranking input. When no benchmark exists the section SHALL be absent rather than showing a placeholder figure.

#### Scenario: Benchmark exists

- **WHEN** a calculation result renders for a product with Alko reference offers
- **THEN** the summary states the estimated saving against the Alko price, consistent with the `alkoBenchmark` figures already on the result

#### Scenario: No benchmark renders nothing

- **WHEN** a calculation result renders for a product without Alko reference offers
- **THEN** the savings summary section is absent

### Requirement: Savings summary is factual and lint-clean

Savings and suggestion copy SHALL state figures factually with their estimate and as-of context. Advice phrasing banned by the content vocabulary lint ("best deal", "good time to buy", "buy now" and their locale equivalents) SHALL NOT appear on any public surface.

#### Scenario: Copy passes the content lint

- **WHEN** the savings summary and trip-suggestion strings are added to the message catalogs
- **THEN** the content lint passes in both locales with no advice-phrasing violations
