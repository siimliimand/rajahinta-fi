# guides-hub Specification

## ADDED Requirements

### Requirement: Zero-publication visibility gating

When zero guides are published for the requested locale, the public guides index route SHALL render `notFound()` (a real 404) instead of an empty-state page, and the site footer SHALL omit the guides link. Visibility SHALL be decided at request time from publication counts; a failure resolving the counts SHALL default to hidden. Publishing the first guide SHALL restore the index page and the footer link on a subsequent request with no feature flag and no deploy. Guide-detail routes for unpublished slugs keep their existing not-found behavior.

#### Scenario: Zero published guides render 404

- **WHEN** the guides index is requested for a locale with zero published guides
- **THEN** the response is a 404, and no "no guides yet" empty shell is served to crawlers

#### Scenario: Footer link hidden while empty, restored on first publication

- **WHEN** zero guides are published, the footer omits the guides link; **WHEN** the first guide is published, a subsequent request renders the index and the footer link without a deploy or flag
