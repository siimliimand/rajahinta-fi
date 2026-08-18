## ADDED Requirements

### Requirement: Written legal opinion

Before launch, a written Finnish legal opinion SHALL be obtained covering Alcohol Act marketing rules, price-list provisions, hyperlinks to foreign alcohol retailers, comparative advertising, search-engine indexing, subscription monetization, email notifications, personalization, rankings, strong vs. mild alcoholic beverages, user-generated content, and age-gating.

#### Scenario: Opinion received

- **WHEN** the legal opinion is received and reviewed
- **THEN** it SHALL be recorded as a launch condition

### Requirement: Tax source confirmation

The official Finnish Tax Administration source SHALL be mapped to every tax rule before launch.

#### Scenario: Source audit

- **WHEN** tax rules are audited pre-launch
- **THEN** every rule SHALL reference its official source

### Requirement: Classification validation

The distance-selling / distance-buying logic SHALL be validated with Finnish tax counsel before launch.

#### Scenario: Classification sign-off

- **WHEN** tax counsel validates the classification logic
- **THEN** the validation SHALL be recorded as a launch condition

### Requirement: Launch conditions confirmed

All critical launch conditions (legal, tax, data, GDPR) SHALL be confirmed complete before the launch-gating flag is toggled.

#### Scenario: Launch flag blocked

- **WHEN** any critical launch condition is unconfirmed
- **THEN** the launch-gating flag SHALL remain off