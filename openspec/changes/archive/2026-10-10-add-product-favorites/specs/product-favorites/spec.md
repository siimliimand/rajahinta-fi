# product-favorites Specification

## ADDED Requirements

### Requirement: Account-scoped favorite capture

The system SHALL store favorites account-scoped, one row per (account,
product); a duplicate create SHALL answer contract-level 409. Creating a
favorite beyond 100 rows per account SHALL be rejected with a
contract-level 400 naming the cap. A create naming an unknown product SHALL
answer 404. On create, the row SHALL capture `savedPriceCents` best-effort
from the product's latest fresh daily price summary; a missing or stale
summary SHALL store null and SHALL NOT fail the create. Deleting an account
SHALL cascade-delete its favorites (GDPR erasure).

#### Scenario: Create captures the saved price

- **WHEN** an account favorites a product whose latest daily summary is within the freshness window
- **THEN** the row is stored with `savedPriceCents` equal to that summary's `priceCloseCents`

#### Scenario: Missing summary still favorites

- **WHEN** an account favorites a product with no daily summary within the freshness window
- **THEN** the row is stored with null `savedPriceCents` and the create succeeds

#### Scenario: Duplicate favorite is a 409

- **WHEN** an account creates a favorite for a product it already favorites
- **THEN** the API answers 409 and stores nothing

#### Scenario: Over-cap favorite is a 400

- **WHEN** an account with 100 favorites creates a 101st
- **THEN** the API answers 400 naming the cap and stores nothing

### Requirement: Favorites read model

The favorites list SHALL return each row with the product's latest fresh
daily-summary price (the same 7-day summary-freshness lookback semantics as
alert evaluation), a delta computed at read time as current price minus
`savedPriceCents` only when both values exist, and the saved-at timestamp.
A stale or missing summary SHALL yield a row without a current price, not
an error. The list path SHALL perform no alert evaluation and emit no
notification.

#### Scenario: Fresh summary yields current price and delta

- **WHEN** the list is read and a row's product has a fresh summary and a non-null saved price
- **THEN** the row carries the current price and the delta since saving

#### Scenario: Stale summary omits the current price

- **WHEN** a row's product has no summary within the freshness window
- **THEN** the row carries no current price and no delta, and the list still returns the row

### Requirement: Favorite removal

Delete SHALL be account-scoped and idempotent-hostile: removing an
existing favorite removes the row; naming a product the account does not
favorite SHALL answer 404. An account SHALL NOT be able to remove another
account's favorite.

#### Scenario: Owner removes a favorite

- **WHEN** an account deletes one of its favorites by product id
- **THEN** the row is removed and a subsequent list omits it

#### Scenario: Foreign or missing favorite is a 404

- **WHEN** an account deletes a product id it does not favorite
- **THEN** the API answers 404 and no row is removed

### Requirement: Sign-in gating through the login modal

A signed-out favorite tap SHALL open a login modal instead of navigating
away from the page. A successful sign-in through the modal SHALL complete
the pending favorite from held state without further user action. The
modal's failure states SHALL mirror the login page's handling (uniform
401 for unknown email or wrong password, 429 for the AUTH rate limit).
Register and forgot-password affordances in the modal SHALL navigate to
their existing pages.

#### Scenario: Signed-out tap opens the modal

- **WHEN** a signed-out visitor taps the favorite heart on a product page
- **THEN** the login modal opens and no navigation occurs

#### Scenario: Successful login completes the favorite

- **WHEN** the visitor signs in through the modal after a heart tap
- **THEN** the modal closes and the pending favorite is created, with the heart shown active

#### Scenario: Failed login stays in the modal

- **WHEN** sign-in through the modal fails with 401 or 429
- **THEN** the modal shows the same failure message as the login page and stays open

### Requirement: Dialog accessibility

The login modal SHALL render an overlay dialog with `role="dialog"` and
`aria-modal="true"`, move focus into the dialog on open, trap Tab focus
while open, restore focus to the triggering element on close, and close on
Escape.

#### Scenario: Focus is trapped and restored

- **WHEN** the modal opens from a heart tap and the user presses Escape after tabbing within it
- **THEN** Tab cycles inside the dialog while open, Escape closes it, and focus returns to the heart
