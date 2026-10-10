# account-preferences Specification

## ADDED Requirements

### Requirement: Account-scoped preference storage

The system SHALL store onboarding preferences account-scoped as one row per
account: a nullable purchase channel (`TRAVEL` | `DELIVERY` | `BOTH`; null =
unanswered), a list of category tags each of which SHALL be a
`PRODUCT_CATEGORIES` value, a `digestEnabled` consent flag defaulting to
false, and a nullable `onboardedAt` timestamp. Deleting an account SHALL
cascade-delete its preference row (GDPR erasure). The row SHALL contain no
brand, price-ceiling, or free-text taste data (data minimization).

#### Scenario: First read before any quiz is the unanswered shape

- **WHEN** an account that never completed onboarding reads its preferences
- **THEN** the answer carries null channel, an empty tag list, `digestEnabled`
  false, and null `onboardedAt`

#### Scenario: Category tags are validated against the shared constant

- **WHEN** a write names a tag outside `PRODUCT_CATEGORIES`
- **THEN** the write is rejected with a contract-level 400 and nothing is
  stored

#### Scenario: Account deletion erases preferences

- **WHEN** an account is deleted
- **THEN** its preference row is deleted by cascade without a separate erase step

### Requirement: Preference write semantics

The API SHALL support partial update: a write MAY set any subset of channel,
category tags, and digest consent, and unspecified fields SHALL retain their
values. An empty category-tag list SHALL be valid and SHALL mean "follows no
category". A reset (DELETE) SHALL restore the unanswered shape without
deleting the row's existence requirements for other features.

#### Scenario: Partial update keeps unspecified fields

- **WHEN** an account with channel `TRAVEL` writes only `{ digestEnabled: true }`
- **THEN** the stored row keeps channel `TRAVEL` and stores the digest consent

#### Scenario: Reset restores the unanswered shape

- **WHEN** an account resets its preferences
- **THEN** channel is null, tags are empty, `digestEnabled` is false, and
  `onboardedAt` is null

### Requirement: Preferences API contract

`GET`, `PUT`, and `DELETE /api/v1/account/preferences` SHALL require an
authenticated account over the same middleware chain as the other
`/api/v1/account/*` surfaces. Unauthenticated access SHALL answer 401.
Contract violations SHALL answer 400; the responses SHALL carry channel,
category tags, digest consent, and `onboardedAt`.

#### Scenario: Signed-out read is rejected

- **WHEN** an unauthenticated request reads preferences
- **THEN** the API answers 401 and stores nothing

#### Scenario: Invalid channel value is rejected

- **WHEN** a write names a channel outside the allowed enum
- **THEN** the API answers 400 and stores nothing

### Requirement: Onboarding interstitial

The system SHALL offer a post-registration interstitial at `/onboarding`
where an account MAY set its purchase channel (single choice of `TRAVEL`,
`DELIVERY`, `BOTH`), MAY select zero or more category tags, and MAY opt in to
the preference digest with an unticked-by-default checkbox. A visible Skip
action SHALL always be available; skipping SHALL mark `onboardedAt` without
storing any preference value. Completing the interstitial (save or skip)
SHALL route to the account home. Signed-out visitors SHALL be redirected to
login. The interstitial SHALL double as the preferences editor for returning
accounts.

#### Scenario: Skip stores nothing but marks onboarding done

- **WHEN** an account taps Skip on the interstitial
- **THEN** `onboardedAt` is set, channel stays null, tags stay empty, and the
  account lands on the account home

#### Scenario: Save stores answers and routes onward

- **WHEN** an account selects channel `BOTH`, two category tags, leaves the
  digest checkbox unticked, and saves
- **THEN** the stored row reflects exactly those values, `digestEnabled`
  stays false, `onboardedAt` is set, and the account lands on the account home

#### Scenario: Signed-out visitor is redirected

- **WHEN** a signed-out visitor opens `/onboarding`
- **THEN** they are redirected to the login surface

### Requirement: Registration routes through onboarding

Registration completion SHALL route to `/onboarding`. Login SHALL keep its
existing destination (the account home). An account that already completed
onboarding MAY revisit `/onboarding` as the preferences editor without the
visit re-triggering any nudge state.

#### Scenario: New registration lands on the interstitial

- **WHEN** a new account completes registration
- **THEN** the browser is routed to `/onboarding`, not the account home

#### Scenario: Login destination is unchanged

- **WHEN** an existing account signs in
- **THEN** the browser is routed to the account home as before

### Requirement: Account-hub nudge is single and dismissible

While an account's `onboardedAt` is null, the account home SHALL show one
nudge card linking to `/onboarding`, with a dismiss action that marks
`onboardedAt`. Once `onboardedAt` is set — by completion or dismissal — the
nudge SHALL NOT reappear; the card becomes a preferences summary with an edit
link. The nudge SHALL NOT block navigation or appear on any other surface.

#### Scenario: Dismissal is permanent

- **WHEN** an account dismisses the nudge without answering
- **THEN** `onboardedAt` is set and the nudge does not reappear on later visits
