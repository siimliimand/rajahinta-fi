/**
 * SessionTokenService — server-issued opaque session tokens (task 2.1,
 * change technical-assessment-remediation; design D3).
 *
 * Mints opaque 256-bit tokens, persists only their SHA-256 hash, and
 * resolves accounts exclusively from a valid presented token — identity
 * is never taken from client-supplied headers. The raw token is
 * returned exactly once at issue/rotate time; the auth guard that sets
 * the httpOnly cookie is task 2.2.
 *
 * @module SessionTokenService
 */

import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  AccountRepository,
  SessionRepository,
  type SessionRecord,
} from '@rajahinta/data-platform';

/** Session lifetime in hours (30 days by default). */
const SESSION_TTL_HOURS_ENV = 'SESSION_TTL_HOURS';
const DEFAULT_SESSION_TTL_HOURS = 24 * 30;

/** A newly minted session — the token value is shown exactly once. */
export interface IssuedSession {
  readonly token: string;
  readonly session: SessionRecord;
}

@Injectable()
export class SessionTokenService {
  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly accountRepository: AccountRepository,
  ) {}

  /**
   * Issue a new session for an account. The token exists in cleartext
   * only in this return value; storage keeps the hash.
   */
  async issueSession(accountId: number): Promise<IssuedSession> {
    const token = this.mintToken();
    const session = await this.sessionRepository.create({
      tokenHash: SessionTokenService.hashToken(token),
      accountId,
      expiresAt: this.defaultExpiry(),
    });
    return { token, session };
  }

  /**
   * Derive the account from a presented token — the only
   * authentication path. Unknown, expired, or revoked tokens resolve
   * to null; callers treat that as unauthenticated.
   */
  async resolveAccountByToken(
    token: string,
  ): Promise<Awaited<ReturnType<AccountRepository['findById']>>> {
    const session = await this.sessionRepository.findActiveByTokenHash(
      SessionTokenService.hashToken(token),
    );
    if (!session) {
      return null;
    }
    // The FK guarantees the account exists; the read keeps this path
    // independent of any account cache.
    return this.accountRepository.findById(session.accountId);
  }

  /**
   * Rotate a session: a new token is issued and the old one
   * invalidated atomically by the repository. Null when the presented
   * token has no active session — a rotated or unknown token never
   * mints a successor.
   */
  async rotateSessionToken(token: string): Promise<IssuedSession | null> {
    const newToken = this.mintToken();
    const session = await this.sessionRepository.rotate(
      SessionTokenService.hashToken(token),
      SessionTokenService.hashToken(newToken),
      this.defaultExpiry(),
    );
    return session ? { token: newToken, session } : null;
  }

  /** Invalidate the active session a token authenticates, if any. */
  async revokeSession(token: string): Promise<boolean> {
    return this.sessionRepository.revokeByTokenHash(
      SessionTokenService.hashToken(token),
    );
  }

  /** Opaque 256-bit token, base64url — no structure to leak or guess. */
  private mintToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private defaultExpiry(): Date {
    return new Date(Date.now() + this.configuredTtlHours() * 3_600_000);
  }

  private configuredTtlHours(): number {
    const raw = process.env[SESSION_TTL_HOURS_ENV];
    if (raw === undefined || raw.trim() === '') {
      return DEFAULT_SESSION_TTL_HOURS;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return DEFAULT_SESSION_TTL_HOURS;
    }
    return parsed;
  }

  /** SHA-256 hex digest — the only form persisted or looked up. */
  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
