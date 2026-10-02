# content-publication Specification

## ADDED Requirements

### Requirement: Zero-publication visibility gating

When zero posts are published for the requested locale, the public blog index route SHALL render `notFound()` (a real 404) instead of an empty-state page, and the site footer SHALL omit the blog link. Visibility SHALL be decided at request time from publication counts; a failure resolving the counts SHALL default to hidden (the honest direction). Publishing the first post SHALL restore the index page and the footer link on a subsequent request with no feature flag and no deploy. The gating is visibility-only: no post, draft, or publication-lifecycle behavior changes.

#### Scenario: Zero published posts render 404

- **WHEN** the blog index is requested for a locale with zero published posts
- **THEN** the response is a 404, and no "no posts yet" empty shell is served to crawlers

#### Scenario: Footer link hidden while empty, restored on first publication

- **WHEN** zero posts are published, the footer omits the blog link; **WHEN** the first post is published, a subsequent request renders the index and the footer link without a deploy or flag
