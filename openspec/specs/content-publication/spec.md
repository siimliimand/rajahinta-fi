# content-publication Specification

## Purpose

Rate changes are worth announcing, and a human decides what is published. When an operator confirms a new official rate dataset version, draft blog posts are created automatically in Finnish and English — what changed, the effective date, the estimated impact on a typical basket — and stay drafts until an operator publishes them. Alongside the blog runs a double opt-in newsletter whose consent is stored separately from price-alert consent, delivered through the email worker with an intent log so a retried send cannot duplicate an email.

## Requirements

### Requirement: Draft creation at the manual rate gate

When an operator confirms a new official rate dataset version, the system SHALL create draft blog posts (Finnish and English) summarizing what changed, the effective date, and the estimated impact on a typical basket, linked to the confirmed rate dataset version. Draft creation SHALL be fail-open: a failure SHALL NOT block the rate confirmation.

#### Scenario: Confirmation creates drafts

- **WHEN** a rate dataset version is manually confirmed
- **THEN** DRAFT posts for both locales SHALL exist, linked to the confirmed version, awaiting human publication

#### Scenario: Draft failure does not block confirmation

- **WHEN** draft creation fails
- **THEN** the rate confirmation SHALL still complete and the failure SHALL be logged

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

### Requirement: Double opt-in newsletter separate from alert consent

Newsletter subscription SHALL require an explicit confirmation step delivered by email before the subscriber is considered active, and SHALL be stored independently of price-alert consent. Every newsletter email SHALL carry a one-click unsubscribe link, and unsubscribes SHALL take effect immediately.

#### Scenario: Subscription activates on confirmation

- **WHEN** a visitor submits an email address and confirms via the emailed token
- **THEN** the subscriber SHALL become active and receive subsequent newsletter sends

#### Scenario: Unconfirmed never mailed

- **WHEN** an email address is submitted but never confirmed
- **THEN** no newsletter SHALL be sent to it

#### Scenario: Immediate unsubscribe

- **WHEN** an active subscriber follows the unsubscribe link
- **THEN** the subscription SHALL end immediately and no further newsletter SHALL be sent

### Requirement: Newsletter delivery through the email worker with an intent log

Newsletter sends SHALL write a notification intent row before dispatch and mark the outcome after, through the existing email worker send path, so a retried send cannot duplicate an email already marked delivered.

#### Scenario: Crash-safe send

- **WHEN** a newsletter send retries after a mid-dispatch failure
- **THEN** subscribers already marked delivered SHALL be skipped and SHALL NOT receive a duplicate email

### Requirement: Zero-publication visibility gating

When zero posts are published for the requested locale, the public blog index route SHALL render `notFound()` (a real 404) instead of an empty-state page, and the site footer SHALL omit the blog link. Visibility SHALL be decided at request time from publication counts; a failure resolving the counts SHALL default to hidden (the honest direction). Publishing the first post SHALL restore the index page and the footer link on a subsequent request with no feature flag and no deploy. The gating is visibility-only: no post, draft, or publication-lifecycle behavior changes.

#### Scenario: Zero published posts render 404

- **WHEN** the blog index is requested for a locale with zero published posts
- **THEN** the response is a 404, and no "no posts yet" empty shell is served to crawlers

#### Scenario: Footer link hidden while empty, restored on first publication

- **WHEN** zero posts are published, the footer omits the blog link; **WHEN** the first post is published, a subsequent request renders the index and the footer link without a deploy or flag

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
