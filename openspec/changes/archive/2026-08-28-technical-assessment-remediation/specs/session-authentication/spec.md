# session-authentication Specification Delta

## ADDED Requirements

### Requirement: Server-issued session tokens

Session tokens SHALL be issued server-side as opaque values, stored hashed at rest, and presented via an httpOnly cookie. The backend SHALL derive the account exclusively from a valid presented token. Client-supplied identity headers SHALL NOT be accepted as authentication under any circumstances.

#### Scenario: Token derives identity

- **WHEN** a request presents a valid session token
- **THEN** the backend SHALL resolve the associated account from the token record without trusting any client-supplied identity claim

#### Scenario: Client header rejected

- **WHEN** a request presents an `x-user-id` header, with or without a token
- **THEN** the header SHALL be ignored for authentication and SHALL NOT grant access to any account

#### Scenario: Guessed token denied

- **WHEN** a request presents a token value that does not match a stored hash
- **THEN** the request SHALL be unauthenticated and denied account-scoped access

### Requirement: Token rotation

The system SHALL support rotating a session token on demand: issuing a new token, invalidating the old one atomically, and returning the new token to the client. A rotated token SHALL NOT remain valid after rotation completes.

#### Scenario: Rotation invalidates old token

- **WHEN** a session token is rotated
- **THEN** subsequent requests presenting the previous token SHALL be denied and the new token SHALL authenticate the same account

### Requirement: Email verification groundwork

The session model SHALL support upgrading an anonymous account to a verified account using the existing verified-email column, with verification state persisted on the account. Until an account is verified, its data SHALL be treated as disposable and clearly not protected by identity guarantees.

#### Scenario: Anonymous upgrade

- **WHEN** an anonymous session completes email verification
- **THEN** the account record SHALL reflect the verified email and the same session SHALL continue to authenticate it

### Requirement: GDPR lifecycle under tokens

GDPR export, erasure, and retention behaviour SHALL operate unchanged under token authentication: an authenticated account SHALL be able to export and delete exactly its own data, and no more.

#### Scenario: Cross-account access denied

- **WHEN** an authenticated session attempts to read, modify, or delete resources belonging to a different account
- **THEN** the API SHALL deny the request
