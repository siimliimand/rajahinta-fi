# Spec Delta: session-authentication

## MODIFIED Requirements

### Requirement: Email and password authentication

The system SHALL authenticate users with their email address (serving as the username) and a password. Passwords SHALL be stored only as PBKDF2-SHA256 hashes with a per-user random salt and iterations of at least OWASP's current recommendation, and verification SHALL use a constant-time comparison. The password policy SHALL be a floor of 8 characters plus rejection of passwords appearing in the maintained common-password blocklist; length SHALL NOT compensate for a blocklisted password, and the policy SHALL NOT depend on any external breach-service availability. The policy SHALL apply identically at registration and at password reset. Accounts created under an earlier, stricter policy SHALL NOT be required to change an existing password. Login SHALL respond identically for an unknown email and a wrong password. Register and login SHALL be rate-limited.

#### Scenario: Successful registration

- **WHEN** a visitor submits a valid, previously unused email address and a policy-compliant password to the registration endpoint
- **THEN** the system SHALL create an account with that lowercased email, hash the password, issue a session, and return the session cookie

#### Scenario: Floor is eight

- **WHEN** a registration or reset submits a non-blocklisted password of exactly 8 characters
- **THEN** the password SHALL be accepted as policy-compliant

#### Scenario: Common password rejected

- **WHEN** a registration or reset submits a password that appears in the common-password blocklist, at any length
- **THEN** the submission SHALL be rejected with a policy message that does not disclose the blocklist contents

#### Scenario: Duplicate email rejected

- **WHEN** a registration arrives for an email that already exists
- **THEN** the request SHALL be rejected without disclosing whether the address exists beyond that rejection

#### Scenario: Wrong credentials indistinguishable

- **WHEN** a login arrives with an unknown email, or a known email with the wrong password
- **THEN** the two responses SHALL be identical in status and body

#### Scenario: Password never stored in clear

- **WHEN** an account row is inspected
- **THEN** it SHALL contain only the self-describing PBKDF2 hash record, never the plaintext password

### Requirement: Password reset

The system SHALL offer self-service password reset: a request for any email SHALL return a uniform acknowledgement, mail a single-use hashed reset token only when the account exists, and confirming a valid token SHALL validate the new password against the same policy as registration (floor of 8 characters plus the common-password blocklist), rehash the new password, and revoke all of that account's active sessions.

#### Scenario: Reset request does not enumerate

- **WHEN** a reset request names an email that has no account
- **THEN** the response SHALL be identical to the response for a known address and no email SHALL be sent

#### Scenario: Reset enforces the password policy

- **WHEN** a reset confirmation submits a blocklisted or sub-floor password
- **THEN** the reset SHALL be rejected with the same policy message the registration form uses, and the account's stored hash SHALL be unchanged

#### Scenario: Reset invalidates sessions

- **WHEN** a password reset completes for an account with active sessions
- **THEN** every existing session token of that account SHALL stop authenticating and the user SHALL sign in again
