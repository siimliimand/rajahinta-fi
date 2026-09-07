# Proposal: email-password-auth

## Why

The technical assessment's first standing limitation is that there is **no real authentication**: the API mints an anonymous account (server-generated UUID, placeholder email) on first account-touch, sessions attach to that throwaway identity, and all account data is officially *"disposable until verification completes"*. The account surface — saved baskets, calculation history, scenarios, price alerts, group orders, data export — therefore scaffolds an identity model the system does not actually have: every "account" is a disposable phantom, ownership guarantees are void by documentation, and the email-verification "groundwork" upgrades nothing because there is no user behind the placeholder.

This change removes anonymous account logic entirely and replaces it with user-based authentication where **the username is the email address**. Account-scoped features survive, now attached to real registered users. The existing durable session machinery (opaque tokens hashed at rest, httpOnly cookie, atomic rotation, revocation) is kept — only issuance changes from "mint anonymous on first touch" to "issue on successful register/login".

Product decisions confirmed by the operator:

- **Verification after login**: registration yields a working account immediately (marked unverified); an emailed verification link flips `email_verified_at`. The verification email rides the existing email-worker `/internal/email/send` contract already used by the freshness and price-alert crons.
- **Self-service password reset is included**, reusing the same email-token machinery.
- **Existing anonymous account rows are discarded** in the migration — that is the documented disposable semantics, and there are no real identities to lose.

## What Changes

- **Removed**: `POST /api/v1/account/session` anonymous issuance; the frontend 401 → auto-mint bootstrap (`issueSessionOnce`); placeholder-email identity (`PLACEHOLDER_EMAIL_SUFFIX`, `isPlaceholderEmail`, derived verification state); the self-asserted `POST /api/v1/account/verify-email` upgrade endpoint; all anonymous account rows in D1 (migration).
- **Added**: email + password registration and login (`POST /api/v1/account/register`, `POST /api/v1/account/login`), a cheap identity read (`GET /api/v1/account/me`), real email-ownership verification (request/confirm with single-use hashed tokens), self-service password reset (request/confirm; reset revokes all sessions), an `AUTH` rate-limit profile, and security events (register, login, verify, reset) appended to the durable `audit_events` trail.
- **Password hashing**: PBKDF2-SHA256 via WebCrypto (native in Workers, no WASM), 600 000 iterations, 16-byte per-user salt, constant-time comparison; NIST-style policy (min 12 chars, max 128, no composition rules).
- **Schema**: `accounts` gains `password_hash` (NOT NULL for new rows) and `email_verified_at`, with a unique index on lowercased email; new `email_tokens` table (SHA-256-hashed single-use tokens, purpose + expiry); anonymous rows purged.
- **Frontend**: new `/login`, `/register`, `/account/verify`, `/account/forgot`, `/account/reset` pages; header becomes auth-aware; account-scoped 401s now redirect to `/login` instead of minting a session; anonymous-session bootstrap deleted; i18n (fi/en) for all new surfaces.
- **Legacy NestJS harness** (`apps/backend` + `packages/application-api`): anonymous issuance and placeholder-email semantics removed; session-validation parity kept for the legacy pg suites; the full credential flow is implemented once, in the production API Worker, and the divergence is documented.
- **Specs/docs**: `session-authentication` rewritten around credentials + tokens + verification + reset; account requirements in `accounts-age-gate` updated (no anonymous/disposable semantics; production persistence is D1); ARCHITECTURE.md, README, TECHNICAL-ASSESSMENT, USER-GUIDE, and the cutover runbook restate the honest limitation set: credentials auth exists, no OIDC, age gate remains documented self-attestation.

## Impact

- **Affected specs**: `session-authentication` (rewritten requirements), `accounts-age-gate` (account requirements updated), `application-api` (account surface wording only if the module listing drifts).
- **Affected code**:
  - `packages/data-platform` (schema, D1 migration, account/session/email-token repositories)
  - `apps/api-worker` (auth routes, password port, token flows, guard table, limiter profile, retention/entitlement mapping, tests)
  - `apps/frontend` (auth pages, header, api client, types, i18n, tests)
  - `packages/application-api` + `apps/backend` (legacy harness cleanup only)
- **Out of scope**: OIDC/social login; email deliverability provisioning (sender-domain setup stays a runbook item); age-gate changes (remains documented self-attestation); durable operator-console stores (unchanged follow-up).
- **Data impact**: migration deletes existing anonymous account rows (documented disposable; pre-launch). Saved baskets, scenarios, calculation history, price alerts, and group orders keep their tables and FKs and simply attach to real accounts going forward.
