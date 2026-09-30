# data-acquisition Specification

## ADDED Requirements

### Requirement: Offer price plausibility gate

Ingestion SHALL reject any mapped offer whose price is not a positive integer cent amount. A price of `0` or less SHALL be treated as price drift: the offer is not published, the failure carries an explicit drift message naming the source value, and the rejection is counted in the data-quality metrics.

#### Scenario: Zero-priced feed product is rejected

- **WHEN** a WooCommerce feed product carries a minor-unit price of `"0"`
- **THEN** mapping fails with a price-drift error and no offer is published for that product

#### Scenario: Rejections are observable

- **WHEN** the ingestion pipeline rejects zero or negative prices
- **THEN** the rejection count is observable through the data-quality metrics

### Requirement: Category-bounded volume plausibility

The ingestion quality stage SHALL enforce per-category unit-volume ceilings (beer, cider, wine, spirits and the remaining catalog categories, bounds in one constants table). A product whose parsed unit volume exceeds its category bound SHALL have its volume stored as unavailable with a review flag — never published as a plausible value. The existing `0 < unit_volume < 100` invariant remains in force as the outer rail.

#### Scenario: Category-implausible volume is not published

- **WHEN** a beer product parses to a unit volume above the beer ceiling (e.g. "24×33 l")
- **THEN** the product's volume is unavailable, the row is flagged for review, and no plausible 33-litre beer appears in the catalog

#### Scenario: Plausible volumes pass unchanged

- **WHEN** a product's parsed unit volume is within its category bound
- **THEN** the volume is stored as before and no review flag is set

### Requirement: Multipack-aware volume parsing

The shared WooCommerce name parser SHALL parse multipack volume tokens (`24×0,33 l`, `24 x 33 cl`) into a deterministic unit volume and pack count rather than applying first-token-wins to a possibly mistyped token.

#### Scenario: Multipack token resolves to unit volume

- **WHEN** a feed product name contains `24×0,33 l`
- **THEN** the parser records a unit volume of 330 ml with pack count 24

### Requirement: Bundle names are held for review

A feed product whose name indicates a multi-product bundle (multi-brand concatenation such as "+ Jägermeister …") SHALL be held for review instead of being published as a single product with arbitrarily parsed ABV/volume.

#### Scenario: Bundle is not published as a product

- **WHEN** a feed row's name concatenates distinct products
- **THEN** the row is held for review and no product with a misattributed ABV/volume is published

### Requirement: Pipeline contract fixtures pin ingestion gates

Golden fixtures SHALL cover the observed failure shapes (zero price, category-implausible volume, bundle name) and a pipeline contract test SHALL assert that none of them publishes: the gates hold for the class, not only for the four recorded incidents.

#### Scenario: Contract test keeps the gates honest

- **WHEN** the fixture pipeline runs in CI
- **THEN** no fixture with a zero price, category-implausible volume, or bundle name produces a published product/offer
