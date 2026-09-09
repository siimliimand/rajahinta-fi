# content-publication Specification

## MODIFIED Requirements

### Requirement: Human publication only

Only an operator action SHALL move a post from DRAFT to PUBLISHED. The public blog endpoints SHALL return PUBLISHED posts only. Post bodies SHALL pass the content-policy lint before publication. Posts SHALL carry a kind (RATE_CHANGE default, GUIDE); the ops console SHALL additionally create and edit GUIDE-kind drafts as evergreen editorial content, and public listing endpoints SHALL filter by kind so the blog index returns RATE_CHANGE posts only and the guides index returns GUIDE posts only.

#### Scenario: Drafts invisible publicly

- **WHEN** the public blog endpoints are queried
- **THEN** DRAFT posts SHALL NOT appear in any response

#### Scenario: Operator publishes

- **WHEN** an operator publishes a post
- **THEN** it SHALL appear in the blog index or the guides index according to its kind, on its slug page, and the action SHALL be audited

#### Scenario: Operator creates a guide draft

- **WHEN** an operator creates a GUIDE-kind draft through the ops console
- **THEN** the draft SHALL exist with kind GUIDE, invisible publicly until published through the same human path

#### Scenario: Kind-filtered listings

- **WHEN** either public index is queried
- **THEN** it SHALL contain only PUBLISHED posts of its own kind, never a mix
