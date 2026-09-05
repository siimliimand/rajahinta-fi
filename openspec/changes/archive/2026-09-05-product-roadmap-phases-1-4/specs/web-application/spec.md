# web-application Specification

## ADDED Requirements

### Requirement: New flag-gated pages

The frontend SHALL provide pages for price-alert management (account area), the event calculator, the trip feasibility calculator, curated lists, the excise what-if simulator, and the group order session. Each page SHALL render only when its feature flag is on, with flag states inlined in the initial HTML payload so gated UI never appears late, and SHALL follow the design system (semantic tokens, status badges from the canonical status module, tabular numerals for euro amounts).

#### Scenario: Gated page hidden when flag off

- **WHEN** a feature flag is off and a user opens the corresponding page route
- **THEN** the page SHALL render the feature-unavailable state instead of the feature UI

#### Scenario: Finnish-first localization

- **WHEN** any new page renders
- **THEN** all strings SHALL come from the next-intl catalogs with Finnish as the default locale and English as the secondary

### Requirement: Product page extensions

Product pages SHALL embed the price-history chart (reusing the existing history components and series API), the producer dupe panel when curated links exist, and a set-alert action when the alerts flag is on. Each extension SHALL respect its own feature flag.

#### Scenario: History chart on product page

- **WHEN** a product page loads with the historical intelligence flag on
- **THEN** the price-history chart SHALL render from the materialized series with reliability metadata

### Requirement: Structural disclaimers on all new result surfaces

The event calculator, trip calculator, what-if simulator, and packing suggestion SHALL render their respective disclaimers as structural parts of the result presentation, sourced from the result objects, not as decorative footer text.

#### Scenario: Disclaimer rendered from result

- **WHEN** any new calculation result renders
- **THEN** its disclaimer text SHALL come from the result object and SHALL be visually prominent
