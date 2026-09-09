# landed-cost-calculator Specification

## MODIFIED Requirements

### Requirement: Itemized breakdown

The itemized result SHALL contain retail price, transport, alcohol excise, and container duty, each with reliability status and timestamp. It SHALL additionally contain an import-VAT line when the offer's seller country differs from the destination: the VAT amount, the rate version id, the base breakdown, and a reliability status. The line SHALL be absent for domestic offers, and absence SHALL mean zero contribution to the total, not a displayed zero. `totalCents` SHALL include the import-VAT amount exactly when the line is present. The response and the persisted calculation record SHALL also carry the optional `alkoBenchmark` object as before: absent when no Alko reference offer exists, excluded from `totalCents` and the itemized array, display-only. Records created before this change lack any VAT line, and consumers SHALL treat absence as normal.

#### Scenario: Foreign seller carries import VAT

- **WHEN** a calculation runs for an alks.fi offer (seller country DE) into FI
- **THEN** the result contains an import-VAT line with amount, rate version, and base breakdown, and the total includes it

#### Scenario: Domestic offer unchanged

- **WHEN** a calculation runs for an Alko offer
- **THEN** no VAT line exists, the total equals the pre-change engine's output for the same inputs, and the response renders normally

#### Scenario: Pre-change record stays readable

- **WHEN** a calculation record created before this change is fetched
- **THEN** it has no VAT line, and consumers render it without error or placeholder
