# transaction-classification Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.
## Requirements
### Requirement: Three-way classification

The Transaction Classification Module SHALL output one of three classifications — Distance Selling, Distance Buying, or Traveller Import (excluded from calculation) — together with a confidence level and a human-readable evidence summary.

#### Scenario: Direct delivery signal

- **WHEN** a merchant offers direct delivery to Finland
- **THEN** the module SHALL classify the transaction as likely Distance Selling with the delivery offer recorded as evidence

### Requirement: Versioned rule sets

Classification rules SHALL be stored as versioned, dated rule sets, mirroring the tax-rule versioning approach, so legislative changes can be applied without rewriting history.

#### Scenario: Legislative change

- **WHEN** classification rules change (e.g., a joint-liability provision change)
- **THEN** a new rule-set version SHALL take effect from its effective date, while prior calculations SHALL remain reproducible against the earlier version

### Requirement: Evidence-based output

The module SHALL never emit a bare legal conclusion about a merchant. Output SHALL be phrased as an observed pattern (e.g., "likely distance selling, based on: retailer offers direct delivery to Finland") paired with supporting evidence.

#### Scenario: No legal conclusion

- **WHEN** the module produces a classification
- **THEN** the result SHALL contain an evidence summary and SHALL NOT assert a merchant's legal status
