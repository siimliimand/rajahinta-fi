## ADDED Requirements

### Requirement: Alcohol excise calculation

The system SHALL calculate alcohol excise duty from product category, alcohol percentage, and volume, using official Finnish Tax Administration rate tables as the primary source rather than independently derived figures.

#### Scenario: Category-specific rate

- **WHEN** a product's category and ABV map to an official excise rate table
- **THEN** the excise SHALL equal the official rate applied to the product's volume

### Requirement: Container duty calculation

The system SHALL calculate beverage-container duty as a distinct calculation from alcohol excise, applying the general rate (€0.51/litre) unless an exemption applies.

#### Scenario: Deposit-return exemption

- **WHEN** packaging participates in the Finnish deposit-return system
- **THEN** the container duty SHALL be exempted
- **WHEN** deposit-system status cannot be determined
- **THEN** the duty calculation SHALL be flagged ESTIMATED, never silently assumed either way

### Requirement: Versioned rate datasets

Rates SHALL never be edited in place. Each rate entry SHALL store tax type, product category, rate value, effective start and end dates, exemption conditions, formula reference, official source citation, and verification date.

#### Scenario: Historical resolution

- **WHEN** a calculation is dated to a period covered by a prior rate version
- **THEN** the calculation SHALL resolve against the version effective on that date

### Requirement: Manual rate-review gate

A recurring job SHALL check for newly published official rate changes and SHALL create a task for manual/legal confirmation before any new dataset version goes live. Rates SHALL never be auto-published.

#### Scenario: New official rate detected

- **WHEN** the review job detects a published rate change
- **THEN** a review task SHALL be created, and the change SHALL NOT enter production until a human confirms it