# landed-cost-calculator Specification

## MODIFIED Requirements

### Requirement: Single-currency totals

Every calculation SHALL be expressed in EUR, and the system SHALL enforce this as a type-level invariant: the offer currency union contains only the `'EUR'` literal, offers carry no conversion provenance, and the unconvertible-offer exclusion path SHALL NOT exist. A data-quality invariant SHALL verify that every stored offer is EUR so a future non-EUR feed fails checks rather than silently corrupting totals.

#### Scenario: Every stored offer is EUR

- **WHEN** the data-quality suite runs against any environment
- **THEN** zero offers carry a currency other than EUR, and the suite fails if the invariant is violated

#### Scenario: No conversion code path

- **WHEN** the repository is searched for FX conversion or unconvertible-offer handling in the calculator and ingestion paths
- **THEN** no such code exists

### Requirement: Itemized breakdown

The itemized result SHALL contain retail price, transport, alcohol excise, and container duty as before, each with reliability status and timestamp. The response and the persisted calculation record SHALL additionally carry an optional `alkoBenchmark` object: the product's Alko reference price, the difference against the calculated offer in euros and percent, the reference's reliability status, and its observation timestamp. The field SHALL be absent when no Alko reference offer exists for the product, SHALL be excluded from `totalCents` and from the itemized array, and SHALL be display-only. Records created before this change lack the field, and consumers SHALL treat absence as normal.

#### Scenario: Benchmark present

- **WHEN** a calculation runs for a product that has an Alko reference offer
- **THEN** the result and its persisted record carry `alkoBenchmark` with price, difference, percent, reliability, and timestamp, and the total equals the itemized breakdown without it

#### Scenario: Benchmark absent

- **WHEN** a calculation runs for a product with no Alko reference offer, or a pre-change record is fetched
- **THEN** the field is absent, the response and page render normally, and no placeholder or guess is shown

## ADDED Requirements

### Requirement: Domestic reference benchmark is display-only

The Alko benchmark SHALL never enter any calculation input, the landed-cost total, or any ranking input. Result output SHALL be byte-identical whether zero, one, or many Alko reference offers exist for unrelated purposes. Benchmark wording in both locales SHALL be factual and pass the content-policy lint.

#### Scenario: Output invariance

- **WHEN** the same calculation inputs run against datasets containing zero, one, or many Alko reference rows
- **THEN** the calculated totals, breakdown, confidence, and ranking inputs are byte-identical across all three runs, and only the optional benchmark field varies
