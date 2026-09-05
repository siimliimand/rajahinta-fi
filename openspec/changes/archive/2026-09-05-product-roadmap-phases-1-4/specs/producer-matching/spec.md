# producer-matching Specification

## ADDED Requirements

### Requirement: Evidence-based sibling product lookup

For a given Alko product, the system SHALL return sibling products sold in foreign shops by exact lookup on normalized producer keys in the `producerLinks` table. Every returned link SHALL include its evidence: producer key, manufacturer, source URL, and review metadata.

#### Scenario: Evidence returned with every link

- **WHEN** a product has curated producer links
- **THEN** the API SHALL return each sibling with the complete evidence fields

#### Scenario: No links

- **WHEN** a product has no curated links
- **THEN** the API SHALL return an empty result, not a similarity-based substitute

### Requirement: No similarity scoring

The dupe module SHALL NOT implement or expose flavor-profile, taste, or any other subjective similarity scoring. Matching is factual only: producer code, vineyard, or manufacturer. No scoring code path SHALL exist in the module.

#### Scenario: Source-level isolation

- **WHEN** the dupe module source is inspected
- **THEN** no similarity, embedding, or taste-profile matching mechanism SHALL be present

### Requirement: Curated governance

Producer links are created and updated only through the audited operator console or the validated import script, with reviewer and review date recorded. The API SHALL be gated behind `enable_producer_dupe_finder`.

#### Scenario: Console edit audited

- **WHEN** an operator creates or modifies a producer link
- **THEN** the action SHALL be recorded in the append-only audit trail

#### Scenario: Flag off

- **WHEN** `enable_producer_dupe_finder` is off
- **THEN** the dupes endpoint SHALL return the feature-disabled error and the product page SHALL NOT render the panel
