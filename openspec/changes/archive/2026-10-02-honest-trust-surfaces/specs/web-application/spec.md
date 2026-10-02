# web-application Specification

## ADDED Requirements

### Requirement: Product card unit price and single-seller framing

Product listing cards SHALL render the €/g chip when the listing embed is computed — value, status label, and per-offer provenance per the metric's presentation rules — and SHALL omit the chip entirely when the embed is unavailable (no placeholder, no zero). Cards SHALL NOT display a bare single-seller count: when the seller count is 1, the seller-count line SHALL be replaced by the tracked-price framing; multi-seller cards SHALL keep "Myyjiä: {count}". The wording SHALL pass the content-policy lint and exist in fi/en parity.

#### Scenario: Computed embed shows the chip

- **WHEN** a listing item's `eurPerGram` embed has status computed
- **THEN** the card renders the value with its reliability label, never color-alone

#### Scenario: Single-seller cards stop advertising thinness

- **WHEN** a card's seller count is 1
- **THEN** the card shows the tracked-price framing instead of "Myyjiä: 1", and cards with 2+ sellers keep the count

### Requirement: Accuracy presentation coverage mode

The accuracy presentation (homepage trust-row and ranking page) SHALL render a labeled catalog-coverage mode when the user-reported outcome count is below the floor: the coverage block's true values (products tracked, offer observations, last sync) with copy that names them as catalog coverage — visually distinct from the user-reported accuracy presentation. The user-reported presentation SHALL return, without any code change, once the count is non-zero. Neither mode SHALL present a fabricated or unlabeled number.

#### Scenario: Zero outcomes render labeled coverage

- **WHEN** the accuracy response reports count 0 with a coverage block
- **THEN** the row renders the coverage values labeled as catalog coverage, never as user-reported accuracy

#### Scenario: First outcome restores the user-reported presentation

- **WHEN** the accuracy response reports a non-zero count
- **THEN** the row renders the user-reported statistic as before, with no code or configuration change

### Requirement: Post-calculation outcome prompt

After a successful calculation, the result view SHALL render one dismissible prompt inviting the outcome report: authenticated users SHALL get a deep-link to the account outcome form with the calculation record preselected; anonymous users SHALL get the sign-in path. The prompt SHALL NOT block the result, SHALL NOT re-appear within the session after dismissal, and SHALL NOT send any data on its own. Copy SHALL pass the content-policy lint and exist in fi/en parity.

#### Scenario: Logged-in user gets the outcome deep-link

- **WHEN** an authenticated user's calculation completes
- **THEN** the prompt links to the outcome form with the record preselected

#### Scenario: Dismissal sticks

- **WHEN** the user dismisses the prompt
- **THEN** it does not re-render for the rest of the session, and the result view is otherwise unchanged
