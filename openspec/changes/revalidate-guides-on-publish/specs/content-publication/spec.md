# content-publication Delta

## ADDED Requirements

### Requirement: Publish-time frontend cache revalidation

A successful blog-post publish SHALL attempt an authenticated cache-
revalidation call to the frontend for the `guides` and `blog` tags off the
response path, and SHALL NOT fail the publish when the call fails, times
out, or is unconfigured. The attempt outcome (ok / skipped / error) SHALL
be appended to the audit trail as a `cache_revalidate` row on the
published post.

#### Scenario: Publish triggers revalidation

- **WHEN** an operator publishes a blog post and the revalidation secret is
  configured
- **THEN** a revalidation request for the `guides` and `blog` tags is issued
  off the response path and its outcome is audited

#### Scenario: Fail-open

- **WHEN** the revalidation call fails or times out
- **THEN** the publish response and status are unaffected and the failure is
  audited

#### Scenario: Unconfigured secret skips cleanly

- **WHEN** the revalidation secret is not configured
- **THEN** no outbound call is made, the publish succeeds, and the skip is
  audited
