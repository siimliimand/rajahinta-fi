/**
 * D1 email-token store — the worker-side persistence seam for the emailed
 * single-use tokens (task 2.3, change email-password-auth, design D3),
 * wrapping the task-1.1 D1EmailTokenRepository. Hashing is the only
 * crypto here: the raw 256-bit base64url token is minted, handed to the
 * caller for the email link, and immediately reduced to its SHA-256 hex
 * digest at rest — the sessions-table convention.
 *
 * Consumption and expiry semantics live in the repository's single
 * UPDATE (`used_at IS NULL AND expires_at > now` in the same statement),
 * so a replayed, expired, or wrong-purpose token redeems nothing: the
 * purpose is part of every lookup key, which is what makes cross-purpose
 * token confusion a non-event.
 *
 * @module EmailTokenStore
 */

import {
  D1EmailTokenRepository,
} from '../../../../packages/data-platform/src/repositories/d1/email-token.repository';
import type {
  EmailTokenPurpose,
  EmailTokenRecord,
} from '../../../../packages/data-platform/src/abstracts';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import { hashToken, opaqueToken } from '../routes/auth.helpers';

/** One issued token: the raw value (for the email link) + its expiry. */
export interface IssuedEmailToken {
  /** Raw 256-bit base64url token — exists ONLY in the emailed link. */
  readonly token: string;
  readonly expiresAt: Date;
}

export class D1EmailTokenStore {
  private readonly repo: D1EmailTokenRepository;

  constructor(d1: D1DatabaseLike) {
    this.repo = new D1EmailTokenRepository(d1);
  }

  /**
   * Mint a raw token for the account/purpose and persist ONLY its hash
   * with the caller's expiry (24 h verify / 1 h reset is caller policy).
   */
  async issue(
    accountId: number,
    purpose: EmailTokenPurpose,
    expiresAt: Date,
  ): Promise<IssuedEmailToken> {
    const token = opaqueToken();
    await this.repo.create({
      accountId,
      tokenHash: await hashToken(token),
      purpose,
      expiresAt,
    });
    return { token, expiresAt };
  }

  /**
   * The active (unconsumed, unexpired) token row for a raw token +
   * purpose pair, or null. Read-before-consume is how the flow learns
   * the accountId; the consume remains the atomic gate.
   */
  async findActive(rawToken: string, purpose: EmailTokenPurpose): Promise<EmailTokenRecord | null> {
    return this.repo.findActiveByTokenHashAndPurpose(await hashToken(rawToken), purpose);
  }

  /**
   * Atomic single-use consumption: false when the token is unknown,
   * replayed, expired, or minted for a different purpose — replay loses
   * by construction.
   */
  async consume(rawToken: string, purpose: EmailTokenPurpose): Promise<boolean> {
    return this.repo.consume(await hashToken(rawToken), purpose);
  }

  /**
   * Retire every outstanding same-purpose token of the account — the
   * sweep a confirmed verification / completed reset runs (design D3).
   */
  async invalidateAllForAccount(accountId: number, purpose: EmailTokenPurpose): Promise<number> {
    return this.repo.invalidateAllForAccount(accountId, purpose);
  }
}
