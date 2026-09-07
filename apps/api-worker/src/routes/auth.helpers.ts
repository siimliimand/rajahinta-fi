/**
 * Credential-flow route helpers (tasks 2.2/2.3, change email-password-auth)
 * — the session mechanics the register/login routes reuse verbatim from
 * the deleted anonymous-issuance handler (cookie name/flags, opaque token
 * minting, TTL resolution, D1 session create), plus the security-audit
 * appender the auth routes share (design D6).
 *
 * Everything here runs on WebCrypto + the Worker-global `crypto`, so the
 * module behaves identically in `wrangler dev`, production, and the Vitest
 * node pool.
 *
 * @module AuthHelpers
 */

import type { Context } from 'hono';
import type { AppEnv } from '../env';
import type { AuditEntry } from '@rajahinta/core-domain';
import { D1AuditEventRepository } from '../../../../packages/data-platform/src/repositories/d1/audit-event.repository';
import { D1SessionRepository } from '../../../../packages/data-platform/src/repositories/d1/session.repository';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import { createLogger } from '../logger';

/** Cookie carrying the opaque session token (httpOnly, SameSite=Lax). */
export const SESSION_COOKIE_NAME = 'rajahinta_session';

/** Session lifetime in hours (30 days by default — SessionTokenService parity). */
const DEFAULT_SESSION_TTL_HOURS = 24 * 30;

/**
 * Cookie builder parity — with one Workers-specific correction (task 5.2):
 * `Secure` is UNCONDITIONAL. Every deployed Workers origin is https-only
 * (workers.dev and custom-domain routes force TLS), so the old
 * NODE_ENV-gated flag would never fire. No `Domain` attribute — host-only
 * cookie (see the deleted anonymous-issuance handler's rationale, which
 * this builder preserves verbatim).
 */
export function buildSessionCookie(token: string, expiresAt: Date | string): string {
  const expires = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  const maxAgeSeconds = Math.max(0, Math.floor((expires.getTime() - Date.now()) / 1000));
  return (
    `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; ` +
    `Max-Age=${maxAgeSeconds}; Expires=${expires.toUTCString()}`
  );
}

/** Clear-cookie parity (logout) — same unconditional `Secure`. */
export function buildSessionCookieClear(): string {
  return (
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; ` +
    `Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
  );
}

/** The configured session TTL — env read with the service's fallbacks. */
export function sessionTtlMs(env: AppEnv['Bindings']): number {
  const raw = (env as { SESSION_TTL_HOURS?: string }).SESSION_TTL_HOURS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_SESSION_TTL_HOURS * 3_600_000;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_SESSION_TTL_HOURS * 3_600_000;
  return parsed * 3_600_000;
}

/** Opaque 256-bit token, base64url — no structure to leak or guess. */
export function opaqueToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SHA-256 hex digest of a token (session-resolver parity — D3 token hashing). */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Structurally valid 100k-iteration PBKDF2 envelope for the login path's
 * constant-work verify: when the account (or its stored credential) is
 * missing, verifyPassword runs against this burn target so unknown-email
 * and wrong-password attempts cost the SAME derivation — the 401 response
 * is uniform AND so is the CPU profile (no account-existence timing
 * oracle). The value is a fixed, non-secret hash of a non-credential
 * string; verification against it always returns false.
 *
 * 100 000 (not the original 600 000): the workerd runtime rejects PBKDF2
 * above 100k iterations at request time, and this envelope is DERIVED on
 * the same runtime — it must stay derivable. See password.ts.
 */
export const LOGIN_TIMING_PARITY_ENVELOPE =
  'pbkdf2-sha256$100000$cmFqYWhpbnRhLWR1bW15LXNhbHQtMDE$CNh68q0BFoSuIab2fnIOADx3BhcLN25QHc4wCuEVwUk';

/** The outcome of one session issuance: the raw token + its expiry. */
export interface IssuedSession {
  /** Raw opaque token — set as the session cookie, NEVER echoed in a body. */
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * Issue a session for an EXISTING account row — the mechanics of the
 * deleted anonymous-issuance handler (opaque mint → SHA-256 hash →
 * sessions INSERT), re-driven by register/login instead of a generated
 * identity. The raw token exists only in the returned record; the caller
 * turns it into a Set-Cookie header.
 */
export async function issueSession(
  d1: D1DatabaseLike,
  accountId: number,
  ttlMs: number,
): Promise<IssuedSession> {
  const token = opaqueToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  const sessions = new D1SessionRepository(d1);
  await sessions.create({
    tokenHash: await hashToken(token),
    accountId,
    expiresAt,
  });
  return { token, expiresAt };
}

// ---------------------------------------------------------------------------
// Security audit (design D6)
// ---------------------------------------------------------------------------

/**
 * The security-event action vocabulary. `audit_events.action` carries a
 * CHECK constraint with the four change-tracking actions
 * ('created'|'updated'|'deleted'|'confirmed'), so a security event records
 * the OPERATION it attempted in `action` and its OUTCOME in `reason` —
 * the mapping is documented per call site below. Extending the CHECK is a
 * schema migration, deliberately out of scope here.
 */
export type SecurityAuditAction = 'created' | 'updated';

/** Fields of one auth security event (design D6). */
export interface SecurityAuditEvent {
  readonly entityType: 'account' | 'account_session';
  /** The account userId when resolved, else 'unknown' (no enumeration). */
  readonly entityId: string;
  /** The userId when resolved, else 'anonymous' (design D6: actor = userId). */
  readonly author: string;
  readonly action: SecurityAuditAction;
  /** Outcome + cause; never carries passwords or raw tokens. */
  readonly reason: string;
  /** Non-secret context only (e.g. { email }) — never credentials. */
  readonly newValue?: unknown;
}

/**
 * Append one auth security event via D1AuditEventRepository. Passwords and
 * raw tokens must never be passed in; the audit write is best-effort — an
 * audit failure is logged and swallowed so it can never turn a uniform
 * login 401 into a 500 (an observable difference between failure modes).
 */
export async function recordSecurityEvent(
  d1: D1DatabaseLike,
  event: SecurityAuditEvent,
): Promise<void> {
  const entry: AuditEntry = {
    id: crypto.randomUUID(),
    entityType: event.entityType,
    entityId: event.entityId,
    action: event.action,
    author: event.author,
    reason: event.reason,
    timestamp: new Date().toISOString(),
    ...(event.newValue !== undefined ? { newValue: event.newValue } : {}),
  };
  try {
    await new D1AuditEventRepository(d1).save(entry);
  } catch (err) {
    // Structured log only — the request's response contract is untouched.
    createLogger(undefined).error({
      message: 'security audit append failed',
      route: 'auth',
      entityId: event.entityId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Request-body plumbing
// ---------------------------------------------------------------------------

/**
 * Conservative syntactic email check for register/login (register/login
 * are the identity surface, so the rule lives with the credential
 * helpers). Mirrors apps/email-worker/src/validation.ts — duplicated on
 * purpose: the application-api module this rule used to live in is being
 * removed with the placeholder-era model (task 4.1), and one function is
 * not worth a cross-package dependency.
 */
export function isValidEmailFormat(email: string): boolean {
  const MAX_EMAIL_LENGTH = 320; // RFC 5321 practical maximum
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return false;
  if (/\s/.test(email)) return false;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return false;
  const [local, domain] = [email.slice(0, at), email.slice(at + 1)];
  if (local.length === 0 || domain.length === 0) return false;
  if (!domain.includes('.')) return false;
  return true;
}

/**
 * Parse a JSON object body or throw the route file's 400 envelope. Returns
 * an empty object for a missing/invalid body so field validation decides
 * the response (the established pattern in accounts.routes.ts).
 */
export async function readJsonBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    const raw: unknown = await c.req.json();
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return {};
    }
    return raw as Record<string, unknown>;
  } catch {
    return {};
  }
}
