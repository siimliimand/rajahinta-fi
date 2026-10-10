# preference-digest Specification

## ADDED Requirements

### Requirement: Consent-gated eligibility

The digest SHALL be sent only to accounts that satisfy ALL of: `digestEnabled`
consent true, a non-null `emailVerifiedAt`, at least one category tag, and
`onboardedAt` set. Accounts not satisfying every condition SHALL never
receive a digest. Digest consent SHALL be editable by the account at any time
and SHALL default to false.

#### Scenario: Unconsented account is never processed

- **WHEN** the digest sweep runs over an account with `digestEnabled` false
- **THEN** no intent row is written and no email is dispatched for that account

#### Scenario: Unverified address is skipped even with consent

- **WHEN** the sweep reaches an account with consent true but null
  `emailVerifiedAt`
- **THEN** no intent row is written and no email is dispatched

### Requirement: Weekly cadence with calendar-week idempotency

The digest SHALL run on a scheduled weekly cadence and SHALL send at most one
digest per account per calendar week, keyed by the ISO week string. A sweep
that re-runs within the same week SHALL skip accounts already holding a
pending-or-delivered intent row for that week. Delivery SHALL follow the
intent-log pipeline: the intent row (pending) SHALL exist before any send
attempt, and the outcome transition (pending → delivered | failed) SHALL be
applied at most once.

#### Scenario: Crashed sweep does not double-send

- **WHEN** a sweep crashed after dispatch but before outcome marking, and the
  sweep re-runs in the same week
- **THEN** the account is skipped because its intent row for that week exists

#### Scenario: Second run in the same week skips delivered accounts

- **WHEN** the sweep runs twice in one calendar week
- **THEN** each eligible account appears in exactly one dispatched digest

### Requirement: Factual content from materialized summaries only

Digest content SHALL be computed exclusively from materialized daily price
summary buckets within the 7-day freshness window — never from the raw
observation log. For each followed category with at least one fresh bucket,
the digest SHALL state factual facts: the category's minimum shelf price and
the notable new low within the window, each citing its product and merchant.
A followed category with no fresh bucket SHALL be omitted from the digest,
not reported as zero or stale. A digest with no reportable categories SHALL
not be sent at all and SHALL write no intent row.

#### Scenario: Category minimum is a cited fact

- **WHEN** a followed category's fresh window contains offers
- **THEN** the digest states the category's minimum shelf price with its
  product and merchant, and no superlative or promotional framing

#### Scenario: Stale category is omitted

- **WHEN** a followed category has no daily bucket inside the freshness window
- **THEN** that category is absent from the digest and the absence is not an error

#### Scenario: Nothing to report means no email

- **WHEN** none of an account's followed categories has a fresh bucket
- **THEN** no intent row is written and no email is sent

### Requirement: Deterministic, preference-filtered ordering

Digest items SHALL be ordered deterministically — by category ascending, then
by price ascending — with no other signal in the comparator. Preferences
SHALL scope which categories appear (a filter) and SHALL NOT influence order,
selection within a category beyond the stated factual rules, or any ranking
surface. The digest computation SHALL read no ranking, benchmark, or
commercial-signal input.

#### Scenario: Ordering is a pure function of the facts

- **WHEN** a digest is computed twice over the same underlying summaries
- **THEN** both computations produce item-for-item identical output

#### Scenario: Preferences filter but never reorder

- **WHEN** two accounts with different category tags read the same underlying
  summaries
- **THEN** each digest contains only its own tags' categories, and shared
  categories appear in the same order and with the same facts in both

### Requirement: Content-policy compliance

Digest copy SHALL pass the shared content-policy vocabulary check
(`checkContent()`): no promotional adjectives, no urgency framing, no
commercial interference. This SHALL be enforced by a cross-package compliance
test in CI, in the same layer as the existing neutrality suites.

#### Scenario: Digest copy survives the vocabulary check

- **WHEN** the compliance suite renders digest copy over fixture facts
- **THEN** `isCompliant()` returns true for every rendered fragment

### Requirement: Erasure and kill switch

Deleting an account SHALL cascade-delete its digest intent rows (GDPR
erasure). The digest sweep SHALL be disabled in any environment where the
`PREFERENCE_DIGEST_ENABLED` wrangler variable is unset or false, and the
disabled state SHALL write nothing.

#### Scenario: Disabled environment writes nothing

- **WHEN** the sweep runs with the enabling variable unset
- **THEN** the handler exits without reading eligibility and without writing
  any row
