# Design: email-password-auth

## Context

The production stack is Cloudflare Workers: a Hono API Worker (`apps/api-worker`) over D1 (Drizzle), an email Worker on the `send_email` binding, and an OpenNext frontend. Durable session infrastructure already exists end-to-end — opaque 256-bit tokens, SHA-256 hashes at rest, httpOnly `rajahinta_session` cookie, atomic rotation, revocation — and the API Worker already calls the email Worker's secret-protected `/internal/email/send` contract for freshness and price-alert mail. The only part of the identity model that is fake is the *subject*: accounts are minted as random UUIDs with `@placeholder.local` emails, first-touch, client-side. This change swaps the subject for a real registered user; everything downstream of a resolved account keeps working unchanged.

## Goals / Non-Goals

**Goals**
- Username === email credential authentication (register, login, logout) in the production API Worker.
- Real email-ownership verification and self-service password reset via single-use emailed tokens.
- Delete every anonymous-account path (server mint, client bootstrap, placeholder semantics, self-asserted upgrade).
- Keep the account-scoped feature set (baskets, history, scenarios, alerts, group orders, export) attached to real accounts.
- Honest docs/specs: the remaining limitations are "credentials auth, no OIDC" and "age gate is self-attestation".

**Non-Goals**
- OIDC/social login or any third-party identity provider.
- Email deliverability provisioning (sender-domain setup remains a runbook item, as it already is for alert mail).
- Migrating anonymous rows into user accounts (they are documented disposable; pre-launch there is nothing to preserve).
- Changes to the age gate, entitlement tiers, or the operator console.

## Decisions

### D1. Credentials and hashing — PBKDF2-SHA256 via WebCrypto

- The Worker runtime has no native bcrypt/argon2; WebCrypto PBKDF2 is native, audited, and fast enough at OWASP-recommended parameters: **600 000 iterations, SHA-256, 16-byte random per-user salt**.
- Stored format: `pbkdf2-sha256$600000$<salt-b64url>$<hash-b64url>` in `accounts.password_hash` — self-describing, so iteration counts can rise without a rehash migration.
- Verification uses a constant-time comparison (XOR fold, same pattern as the email Worker's `secretsMatch`).
- Policy: min 12 chars, max 128, no composition rules (NIST 800-63B); email normalized to lowercase before uniqueness checks.
- New port `apps/api-worker/src/auth/password.ts` with known-answer unit tests; pure WebCrypto so it runs in `wrangler dev` and Vitest node unchanged.

### D2. Endpoint shape — stay under `/api/v1/account`

The guard middleware table, cookie plumbing, and frontend `ACCOUNT_SCOPE_PREFIX` logic already key off `/api/v1/account/`. New routes join that surface rather than inventing `/api/v1/auth`:

| Route | Guard | Behaviour |
|---|---|---|
| `POST /api/v1/account/register` | rate-limit `AUTH` | validate + create account + issue session + send verification mail; mail failure logs but never blocks registration (resend exists) |
| `POST /api/v1/account/login` | rate-limit `AUTH` | uniform 401 for unknown email and wrong password (no enumeration); issues session |
| `GET /api/v1/account/me` | sessionAuth | `{ userId, email, verified }` — cheap identity read for the frontend |
| `POST /api/v1/account/verify-email/request` | sessionAuth | re-send verification token to the account's email |
| `POST /api/v1/account/verify-email/confirm` | public (token is the capability) | `{ token }` → sets `email_verified_at`, single-use |
| `POST /api/v1/account/password/reset-request` | rate-limit `AUTH` | `{ email }` → always 202; sends reset mail only when the account exists |
| `POST /api/v1/account/password/reset` | public (token is the capability) | `{ token, newPassword }` → rehash, revoke **all** sessions of the account |
| `POST /api/v1/account/session/rotate`, `DELETE /api/v1/account/session` | unchanged | rotation and logout keep current semantics |
| `POST /api/v1/account/session` (anonymous issue) | **deleted** | replaced by register/login |
| `POST /api/v1/account/verify-email` (self-asserted) | **deleted** | replaced by the token flow |

The old `SessionResponse.verified` flag now derives from `email_verified_at IS NOT NULL`.

### D3. Email tokens — one table, hashed, single-use

New D1 table `email_tokens`: `id`, `accountId` (FK), `tokenHash` (SHA-256 hex, same hashing as sessions), `purpose` (`verify_email` | `password_reset`), `expiresAt`, `usedAt` (null until consumed), `createdAt`. Raw 256-bit base64url tokens appear only in email links and request bodies; lookups are by hash. Expiry: 24 h verification, 1 h reset. Consumption sets `usedAt` in the same statement that checks expiry (`usedAt IS NULL AND expiresAt > now`), so replay loses. A confirmed verification or completed reset marks all outstanding same-purpose tokens for that account used.

### D4. Mail delivery — reuse the email-worker contract

Verification and reset mail go through the existing secret-protected `/internal/email/send` fetch contract (same as the freshness/price-alert crons): plain-text + HTML bodies, FI default, links pointing at the frontend pages (`/account/verify?token=…`, `/account/reset?token=…`). Dispatch failures on registration/resend are logged and surfaced as a "verification email pending" state, never a failed registration.

### D5. Rate limiting — new `AUTH` profile

The limiter's profile registry gains `AUTH` (tighter than `DEFAULT`, e.g. 10 requests / 5 min / IP) applied to `register`, `login`, and `password/reset-request`. No separate lockout mechanism — the shared sliding-window limiter is the brute-force defence, consistent with the rest of the API.

### D6. Security events → durable audit trail

Register, login (success and failure), verification, and reset events append to the existing append-only `audit_events` table via `D1AuditEventRepository` — never log the password or raw tokens; the actor is the `userId`.

### D7. Schema migration — purge anonymous, add real identity

One D1 migration:
1. `DELETE FROM accounts WHERE email LIKE '%@placeholder.local'` (sessions/baskets/etc. cascade or are purged by FK).
2. `ALTER TABLE accounts ADD COLUMN password_hash TEXT` then backfill `''` → guard requires non-empty at the application layer for login (no pre-launch real rows exist); `ADD COLUMN email_verified_at TEXT` (nullable; null = unverified).
3. `CREATE UNIQUE INDEX accounts_email_lower_idx ON accounts(lower(email))` — uniqueness enforced in SQL, not just application code.
4. `CREATE TABLE email_tokens` per D3.

Drizzle-generated migration in `packages/data-platform/drizzle/` (the committed `wrangler d1 migrations` source), schema.ts updated to match.

### D8. Frontend — auth pages replace auto-mint

- New pages: `/login`, `/register`, `/account/verify` (lands from the email link, calls confirm, shows result), `/account/forgot`, `/account/reset`.
- `api.ts`: delete `issueSession` / `issueSessionOnce` / anonymous 401 retry; account-scoped `ApiFetchError(401)` is surfaced to a route-level redirect to `/login`; `ensureSession` now calls `GET /account/me`.
- `SiteHeader`: signed-out shows "Kirjaudu"/"Rekisteröidy"; signed-in shows the account link + logout (existing `DELETE session`).
- Types: `SessionStatus` → `{ userId, email, verified }`. i18n: fi + en catalogs for every new string (content-vocabulary lint applies).

### D9. Legacy NestJS harness — cleanup, not parity

`apps/backend` serves no traffic (test-harness substrate since the cutover). It loses the anonymous issuance endpoint and placeholder-email semantics so the removed model cannot resurrect in code, and keeps session-validation parity for the legacy pg suites. The credential flow is implemented once, in the API Worker; ARCHITECTURE.md documents the deliberate divergence so nobody "restores symmetry" by porting auth into the harness.

### D10. Retention, entitlements, features — unchanged subjects only

The retention sweep keeps both branches (anonymous calculation-record pruning and session age-cap) — sessions still exist, now bound to real logins. Account-retention (inactivity purge/anonymize) continues to apply to real accounts. Entitlements still resolve tier from the account record (`FREE` default). Price alerts, saved baskets/scenarios, history, export, and group-order create keep their session guards unchanged.

## Risks / Trade-offs

- **No breach-list screening** (offline constraint) — mitigated by min-length policy and rate limiting; noted in USER-GUIDE.
- **Registration without verified email** means typosquatted addresses receive nothing until verification — acceptable for MVP; the unverified badge and resend flow keep state honest.
- **Reset-revokes-all-sessions** can surprise shared-device users — standard security hygiene; documented in the reset UI copy.
- **`password_hash` backfill `''`** relies on the purge leaving no real rows; the login path rejects empty hashes, so a stray row fails safe (401), never crashes.

## Migration Plan

1. Ship schema migration (purge + columns + table) with the API release — the purge is safe pre-launch by the documented disposable semantics.
2. Deploy API Worker (anonymous issuance removed, new routes live) and frontend (auth pages, bootstrap removed) in the same promotion; between the two, account-scoped UI shows 401 → login, which is the correct steady-state behaviour.
3. Runbook: verify `EMAIL_SEND_SECRET` / email-worker base URL vars exist in staging + production (already required by alert mail) and that `EMAIL_FROM` is a verified sender.

## Open Questions

None — product decisions confirmed by the operator (verify-after-login, reset included, anonymous rows discarded).
