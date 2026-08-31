/**
 * Session resolution against D1 — the Workers authentication lookup behind
 * the session-auth middleware (task 3.2, change migrate-to-cloudflare).
 *
 * Ports the read path of `SessionTokenService` (application-api, task 2.1):
 * the presented opaque token is SHA-256 hashed and looked up by its hash
 * via the real D1 session repository (task 2.5); the account row is then
 * fetched by the session's account id. Identity is never taken from
 * client-supplied headers — the token is the only credential.
 *
 * Hashing uses WebCrypto (Workers-native) instead of `node:crypto` — no
 * `nodejs_compat` dependency — producing the identical lowercase hex
 * digest `SessionTokenService.hashToken` persists.
 *
 * @module session-resolver
 */

import { D1SessionRepository } from '../../../../packages/data-platform/src/repositories/d1/session.repository';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import { isAccountVerified } from '../../../../packages/application-api/src/accounts/email-verification';
import type { AuthenticatedAccount } from './authenticated-account';

/** Known tier values as stored on the account row (guard parity). */
const KNOWN_TIERS = new Set(['FREE', 'PREMIUM', 'PROFESSIONAL']);

/** SHA-256 hex digest — the only form persisted or looked up. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** The account columns the authentication path reads. */
interface AccountRow {
  readonly id: number;
  readonly user_id: string;
  readonly email: string;
  readonly tier: string;
}

/** The columns mirror DrizzleAccountRepository.findById's select. */
const ACCOUNT_BY_ID_SQL = `
  SELECT id, user_id, email, tier FROM accounts WHERE id = ? LIMIT 1`;

/**
 * Resolve the authenticated account from a presented token, or null when
 * the token is unknown, expired, or revoked — indistinguishable by design;
 * a guessed token never grants anything.
 */
export async function resolveAccountByToken(
  d1: D1DatabaseLike,
  token: string,
): Promise<AuthenticatedAccount | null> {
  const sessions = new D1SessionRepository(d1);
  const session = await sessions.findActiveByTokenHash(await hashToken(token));
  if (session === null) {
    return null;
  }

  // The FK guarantees the account exists; a missing row still resolves to
  // null (unauthenticated) rather than throwing into the guard path.
  const row = await d1
    .prepare(ACCOUNT_BY_ID_SQL)
    .bind(session.accountId)
    .first<AccountRow>();
  if (row === null) {
    return null;
  }

  return {
    accountId: row.id,
    userId: row.user_id,
    tier: KNOWN_TIERS.has(row.tier) ? (row.tier as AuthenticatedAccount['tier']) : 'FREE',
    verified: isAccountVerified(row.email),
  };
}
