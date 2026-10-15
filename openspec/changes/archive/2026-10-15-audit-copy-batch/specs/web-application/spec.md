# web-application Specification

## ADDED Requirements

### Requirement: Tool-limit disclosure

Each enforced tool limit — the 30-item basket, the 10-item comparison, the 20-product scenario, and the 7-day group-order session lifetime — SHALL be disclosed at the point of constraint: a proximity indication before the limit is reached, and an at-limit message explaining the constraint with the applicable alternative affordance (group order for baskets, scenario sharing for scenario products). The disclosure SHALL NOT state a reason the platform does not have.

#### Scenario: Proximity warning before the limit

- **WHEN** the basket holds 25 of its 30 items
- **THEN** the basket UI shows the remaining capacity before the next add fails

#### Scenario: At-limit message explains and offers an alternative

- **WHEN** the user attempts to exceed an enforced limit
- **THEN** the UI explains the limit and shows the applicable alternative affordance

### Requirement: Accuracy statistic placeholder honesty

While no user-reported outcomes exist, the methodology accuracy section SHALL render the publication-threshold copy (the statistic is published once a minimum number of outcomes is reported) in place of a loading indicator. The section anchor SHALL remain stable so existing cross-links resolve both before and after the statistic publishes.

#### Scenario: Zero outcomes render threshold copy, not a spinner

- **WHEN** no outcomes are reported
- **THEN** the accuracy section shows the threshold copy and no indefinite loading indicator

#### Scenario: Anchor preserved across states

- **WHEN** the first outcomes arrive and the statistic renders
- **THEN** the section keeps the same anchor identifier the placeholder used
