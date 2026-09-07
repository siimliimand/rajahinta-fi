# session-authentication Specification

## Purpose
TBD - created by archiving change technical-assessment-remediation. Update Purpose after archive.
## Requirements
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

### Requirement: Email and password authentication

The system SHALL authenticate users with their email address (serving as the username) and a password. Passwords SHALL be stored only as PBKDF2-SHA256 hashes with a per-user random salt and iterations of at least OWASP's current recommendation, and verification SHALL use a constant-time comparison. Login SHALL respond identically for an unknown email and a wrong password. Register and login SHALL be rate-limited.

#### Scenario: Successful registration

- **WHEN** a visitor submits a valid, previously unused email address and a policy-compliant password to the registration endpoint
- **THEN** the system SHALL create an account with that lowercased email, hash the password, issue a session, and return the session cookie

#### Scenario: Duplicate email rejected

- **WHEN** a registration arrives for an email that already exists
- **THEN** the request SHALL be rejected without disclosing whether the address exists beyond that rejection

#### Scenario: Wrong credentials indistinguishable

- **WHEN** a login arrives with an unknown email, or a known email with the wrong password
- **THEN** the two responses SHALL be identical in status and body

#### Scenario: Password never stored in clear

- **WHEN** an account row is inspected
- **THEN** it SHALL contain only the self-describing PBKDF2 hash record, never the plaintext password

### Requirement: No anonymous account issuance

The system SHALL NOT mint accounts or sessions without an explicit credential act. Anonymous session issuance endpoints, placeholder-email identities, and client-triggered auto-mint on first account touch SHALL NOT exist.

#### Scenario: Session requires credentials

- **WHEN** a caller requests session issuance without registering or logging in
- **THEN** no anonymous account SHALL be created and no session SHALL be issued

#### Scenario: No placeholder identities

- **WHEN** an account row is created
- **THEN** its email SHALL be a real user-supplied address, and no placeholder-email domain SHALL exist in the codebase

### Requirement: Email ownership verification

The system SHALL let a signed-in user request a verification email containing a single-use, hashed, expiring token; confirming the token SHALL persist `email_verified_at` on the account. Verification mail failure SHALL NOT block registration, and a resend SHALL be available. An account works before verification but SHALL report its unverified state.

#### Scenario: Verification link flips state

- **WHEN** the user confirms a valid, unexpired, unused verification token
- **THEN** the account's `email_verified_at` SHALL be set and the token SHALL be marked used so it cannot be replayed

#### Scenario: Expired or replayed token rejected

- **WHEN** a verification token is expired or has already been consumed
- **THEN** confirmation SHALL fail without changing the account

### Requirement: Password reset

The system SHALL offer self-service password reset: a request for any email SHALL return a uniform acknowledgement, mail a single-use hashed reset token only when the account exists, and confirming a valid token SHALL rehash the new password and revoke all of that account's active sessions.

#### Scenario: Reset request does not enumerate

- **WHEN** a reset request names an email that has no account
- **THEN** the response SHALL be identical to the response for a known address and no email SHALL be sent

#### Scenario: Reset invalidates sessions

- **WHEN** a password reset completes for an account with active sessions
- **THEN** every existing session token of that account SHALL stop authenticating and the user SHALL sign in again

### Requirement: GDPR lifecycle under tokens

GDPR export, erasure, and retention behaviour SHALL operate unchanged under token authentication: an authenticated account SHALL be able to export and delete exactly its own data, and no more.

#### Scenario: Cross-account access denied

- **WHEN** an authenticated session attempts to read, modify, or delete resources belonging to a different account
- **THEN** the API SHALL deny the request
