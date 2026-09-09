# tax-duty-engine Specification

## ADDED Requirements

### Requirement: Import VAT calculation

The tax engine SHALL compute Finnish import VAT for goods bought from a seller established outside Finland, from a versioned rate dataset (24% before 2024-09-01, 25.5% from 2024-09-01) with effective-date resolution identical in kind to the excise datasets. The VAT base (retail price + transport + alcohol excise + container duty) SHALL be part of the versioned dataset, not inline code, so a legal-base correction is a dataset change. Every result SHALL carry the rate version id, the base breakdown, and a reliability status. Rates SHALL enter force only through the seeded dataset; nothing auto-publishes.

#### Scenario: Rate by effective date

- **WHEN** a calculation resolves import VAT for a transaction dated 2024-08-15 and another dated 2024-09-15
- **THEN** the first resolves 24% from the older dataset version and the second resolves 25.5% from the newer one

#### Scenario: Base breakdown is traceable

- **WHEN** import VAT is computed
- **THEN** the result names each base component with its amount and the rate version that produced the tax

#### Scenario: Dataset change is versioned

- **WHEN** a future rate or base change is seeded
- **THEN** past calculations still resolve against the version effective on their date
