# landed-cost-calculator Specification

## ADDED Requirements

### Requirement: Traveller-import calculation mode

The calculator SHALL support a traveller-import mode (`transportArrangement: 'PERSONAL'`) that computes the out-of-pocket cost for goods carried by the buyer across the border within Finnish traveller allowances. The mode SHALL resolve the published traveller-allowance dataset effective on the transaction date via the traveller-allowance port and apply its per-category caps to the requested quantity: the allowed portion carries retail price only (no excise, container duty, or import VAT), and any over-allowance surplus is taxed with the existing engines and the established import-VAT base composition. The result SHALL name the allowance dataset version it applied and SHALL label the single-traveller assumption. Absence of a published effective dataset SHALL reject the calculation with the same honest message shape the trip routes use; the delivery mode SHALL remain available in that case, and caps SHALL never be invented.

#### Scenario: Quantity within the category cap is shelf price only

- **WHEN** a PERSONAL-mode calculation requests 6 × 1 l of a 40% spirit whose category cap covers 6 l
- **THEN** the result totals the shelf price only, with excise, container duty, and import VAT zero for the allowed portion, and the result metadata names the allowance dataset version

#### Scenario: Surplus over the cap is taxed on the surplus only

- **WHEN** a PERSONAL-mode calculation exceeds the product's category cap
- **THEN** only the surplus quantity carries excise, container duty, and import VAT, computed with the existing engines and base composition, and the itemized breakdown separates the allowed and surplus portions

#### Scenario: No effective allowance dataset rejects honestly

- **WHEN** no published traveller-allowance dataset is effective on the transaction date and the mode is PERSONAL
- **THEN** the calculation rejects with the no-dataset message (trip-route parity) and no result is produced with invented caps

#### Scenario: Delivery mode is unchanged

- **WHEN** the request omits `transportArrangement` or sends a delivery arrangement
- **THEN** the calculation, its amounts, and its cache identity are identical to the pre-change behavior

### Requirement: Traveller-alternative estimate on delivery results

Delivery-mode calculation results SHALL carry an additive, optional `travellerAlternative` estimate: the labeled out-of-pocket figure for one traveller carrying the same quantity within the effective allowance caps, with the allowance dataset version and category key. The estimate SHALL be null when no effective dataset exists, when the product's category has no cap row, or when the request was already traveller-mode. Delivery-mode amounts, statuses, and confidence SHALL NOT be altered by the callout's presence.

#### Scenario: Delivery result carries the labelled traveller estimate

- **WHEN** a delivery-mode calculation returns for a product whose category has an effective cap
- **THEN** the result carries `travellerAlternative` with the estimate, the dataset version, and the category key, and all delivery-mode figures are unchanged

#### Scenario: No cap row yields no callout

- **WHEN** the product's category has no row in the effective allowance dataset
- **THEN** `travellerAlternative` is null and the result renders as before
