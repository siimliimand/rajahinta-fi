# unit-price-metrics Specification

## Purpose
TBD - created by archiving change product-roadmap-phases-1-4. Update Purpose after archive.

## Requirements

### Requirement: Price per gram of pure ethanol

The system SHALL compute a unit price in euro per gram of pure ethanol for every product offer as price divided by the product of unit volume in litres, units per package, alcohol fraction, and ethanol density (789 g/l). Units per package SHALL be 1 for single-unit products; for a multipack — whose price prices the whole package — it SHALL be derived from the product name's pack notation at read time and SHALL NOT be persisted as a column (amendment: a pack priced against one can's volume is the defect this rule removes). The metric SHALL be derived at read time from stored offer and product fields and SHALL NOT be persisted as a column. The unavailability reason set SHALL distinguish zero ethanol (`ZERO_ETHANOL` — the alcohol fraction is present and equals 0, so the denominator is zero and the metric is physically undefined) from invalid input (`INVALID_ALCOHOL_FRACTION`, `INVALID_VOLUME`, `INVALID_PRICE`, `INVALID_UNITS_PER_PACKAGE` — the value is unusable data; the last is a supplied pack size that is not a finite number ≥ 1, where only an absent argument defaults to one unit) and from missing input (`MISSING_VOLUME`, `MISSING_ALCOHOL_FRACTION`, `MISSING_PRICE` — known unknowns report before value-level faults).

#### Scenario: Metric computed from complete inputs

- **WHEN** an offer has a price and the product has both unit volume and alcohol percentage
- **THEN** the API SHALL return the €/g value computed by the pure function, with the offer's price reliability status attached

#### Scenario: Pack product prices the package against the package total

- **WHEN** an offer of 2199 cents names `24×33 l` with unit volume 0.33 l and 5.3 % ABV (product 2900 shape)
- **THEN** the metric divides by 24 × 0.33 l × 0.053 × 789 g/l ≈ 331.19 g and reports ≈ 6.64 c/g — never the ≈ 159.35 c/g a single-can denominator produced

#### Scenario: Products without pack notation are byte-identical to the unit-only formula

- **WHEN** a product name states no decisive pack size and no units-per-package is supplied
- **THEN** the metric SHALL be exactly the value the pre-amendment unit-volume formula produced (the default multiplier of 1 changes no byte)

#### Scenario: A supplied pack size outside the domain is honest

- **WHEN** a units-per-package value is supplied and is not a finite number ≥ 1 (e.g. 0, −3, NaN, Infinity)
- **THEN** the metric SHALL be unavailable with reason `INVALID_UNITS_PER_PACKAGE`, never a silently substituted count

#### Scenario: Missing alcohol data

- **WHEN** a product has no alcohol percentage
- **THEN** the metric SHALL be reported as unavailable with an explicit status, and no value SHALL be silently substituted

#### Scenario: Alcohol-free product is zero-ethanol, not invalid

- **WHEN** a product's alcohol percentage is present and equals 0 (e.g. a 0,0% beer)
- **THEN** the metric SHALL be reported unavailable with reason `ZERO_ETHANOL`, and SHALL NOT report `INVALID_ALCOHOL_FRACTION`

### Requirement: Status consistency with the reliability framework

The €/g metric SHALL inherit its reliability from its inputs: an offer price that is not VERIFIED yields an ESTIMATED metric, and the status SHALL be surfaced wherever the value is shown.

#### Scenario: Estimated price produces estimated metric

- **WHEN** the underlying offer price carries an ESTIMATED status
- **THEN** the €/g metric SHALL be labeled ESTIMATED in the API response and the UI

### Requirement: €/g sorting is objective and deterministic

Where the metric is exposed, sorting by €/g SHALL order strictly by metric value with product id as the tiebreaker, producing the same order on every request for the same data. The sort SHALL NOT accept any commercial or promotion signal.

#### Scenario: Stable ordering

- **WHEN** two products share the same €/g value
- **THEN** they SHALL be ordered by product id, identically on every request

### Requirement: Formula transparency in the UI

The compare view SHALL present the €/g metric with a tooltip that states the formula, the ethanol density constant, and the reliability status of the inputs, consistent with the VERIFIED/ESTIMATED presentation used elsewhere.

#### Scenario: Tooltip explains the calculation

- **WHEN** a user views the €/g column
- **THEN** an accessible tooltip SHALL show the formula and the status of the underlying price, volume, and alcohol inputs

### Requirement: Category ranking by ethanol unit price

The system SHALL expose a public per-category listing ordered deterministically by ethanol €/g ascending, computed by the existing pure unit-price function. Each row SHALL carry its reliability status (VERIFIED or ESTIMATED); products whose unit price is unavailable SHALL be omitted from the listing rather than placed at an arbitrary position. Equal values SHALL resolve by a stable secondary key so the order is fully deterministic.

#### Scenario: Ranking is deterministic

- **WHEN** the ranking endpoint is queried twice for the same category and dataset state
- **THEN** both responses SHALL contain the products in identical order

#### Scenario: Status carried per row

- **WHEN** the ranking is rendered or returned
- **THEN** each row SHALL include its reliability status and the interface SHALL render it with the standard status components

#### Scenario: Unavailable prices omitted

- **WHEN** a product in the category has no computable unit price
- **THEN** it SHALL NOT appear in the ranking

### Requirement: Informational, non-editorial presentation

The ranking SHALL be presented as an informational listing. Copy SHALL NOT characterize products as best, recommended, or otherwise editorial, consistent with the content-policy lint, and the ranking SHALL NOT feed product default ordering, search order, or any calculation input.

#### Scenario: Neutral copy enforced

- **WHEN** the ranking page and its API responses are linted by the content-policy suite
- **THEN** no editorial or promotional phrasing SHALL be present

#### Scenario: No effect on other orderings

- **WHEN** the unit-price ranking is computed for a category
- **THEN** product search order, offer ordering, and calculation outputs SHALL remain unchanged

### Requirement: Ethanol grams derive from canonical litres

The €/g ethanol computation SHALL derive `ethanolGrams` from the product's unit volume in litres (canonical `product_master` convention) multiplied by the ABV fraction and the ethanol density constant. Values computed from a mis-scaled unit volume (millilitre rows read as litres) SHALL NOT be served; rows failing the plausibility window SHALL be omitted or statused UNAVAILABLE, never published as rankings.

#### Scenario: Gram figure matches hand calculation

- **WHEN** a 24 × 0.33 l beer case at 5.3 % ABV is scored
- **THEN** the reported ethanol grams are in the hundreds (≈ 420 g), not hundreds of thousands

#### Scenario: Implausible unit volumes never rank

- **WHEN** a row's underlying unit volume violates the `0 < unit_volume < 100` window
- **THEN** the row is omitted from the ranking (or UNAVAILABLE), consistent with the unavailable-omitted contract

### Requirement: Listing embed derives from a single current offer

Product listing rows SHALL embed `eurPerGram` computed from the **cheapest current-available single offer** for the product — a real offer's price and its price reliability status, resolved with the same freshness and availability semantics the product-detail endpoint uses. The embed SHALL NOT be derived from any multi-offer aggregate value (a minimum's identity as one specific offer is what makes the derivation honest; aggregates as aggregates remain banned as metric inputs). The embed SHALL be unavailable — with the domain's explicit reason — when the product has no current-available offer or its physical inputs are missing, invalid, or zero-ethanol. Listing embeds SHALL NOT reorder results, feed ranking, or alter any calculation input.

#### Scenario: Listing embed matches the cheapest current detail offer

- **WHEN** a product's detail endpoint lists a current-available offer with the lowest price P and provenance R
- **THEN** the listing row's `eurPerGram` equals the metric computed from P, labeled with reliability R

#### Scenario: No current offer stays honestly unavailable

- **WHEN** a product has no current-available offer (stale or unavailable rows only)
- **THEN** the listing embed reports unavailable with an explicit reason, never a value derived from a stale price presented as current

#### Scenario: Sort receives real embeds

- **WHEN** the compare page orders products by €/g
- **THEN** products with a computed listing embed order by metric value (id tiebreaker), and only products without one sort last — the order is no longer a universal id-order no-op
