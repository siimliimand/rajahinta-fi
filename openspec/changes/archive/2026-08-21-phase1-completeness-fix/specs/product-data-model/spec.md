# product-data-model — Delta Spec

## ADDED Requirements

### Requirement: Account and saved-basket persistence tables

The Drizzle schema SHALL include `accounts` and `savedBaskets` tables for persistent storage of account data, replacing the in-memory Map implementation used in Phase 1.

#### Scenario: Account created and persisted

- **WHEN** an account is created via AccountService
- **THEN** a row SHALL be inserted into the `accounts` table with a unique identifier and creation timestamp

#### Scenario: Basket saved and persisted

- **WHEN** a user saves a basket
- **THEN** a row SHALL be inserted into the `savedBaskets` table referencing the account ID and containing the product IDs and quantities

#### Scenario: Basket retrieved after restart

- **WHEN** the application restarts and a user queries their saved baskets
- **THEN** all previously saved baskets SHALL be returned from the database