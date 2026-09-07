/**
 * D1 EmailTokenRepository — the implementation of the abstract
 * {@link EmailTokenRepository} contract backed by the `email_tokens`
 * table (task 1.1, change email-password-auth, design D3). Handles
 * token hashes only — SHA-256 digests at rest, the sessions hashing
 * convention; minting raw 256-bit base64url tokens and hashing them is
 * the application layer's job. Expiry horizons are caller policy: this
 * layer stores and compares instants, it does not own them.
 *
 * ## Single-use consumption without interactive transactions
 *
 * Consumption is one UPDATE: `used_at` is stamped in the same statement
 * that checks `used_at IS NULL AND expires_at > now`, so a replayed,
 * expired, or wrong-purpose token matches zero rows and consume
 * returns false — replay loses by construction, exactly one caller
 * redeems a token. Two racing consumes of one token serialize through
 * D1's single-writer execution and produce exactly one winner.
 *
 * @module D1EmailTokenRepository
 */
import { Injectable } from '@nestjs/common';
import {
  EmailTokenRepository,
  type EmailTokenCreateInput,
  type EmailTokenPurpose,
  type EmailTokenRecord,
} from '../../abstracts';
import type { D1DatabaseLike } from '../../d1/executor';

/** Raw D1 email_tokens row. */
interface D1EmailTokenRow {
  readonly id: number;
  readonly account_id: number;
  readonly token_hash: string;
  readonly purpose: string;
  readonly expires_at: string;
  readonly used_at: string | null;
  readonly created_at: string;
}

function toContractToken(row: D1EmailTokenRow): EmailTokenRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    tokenHash: row.token_hash,
    purpose: row.purpose as EmailTokenPurpose,
    expiresAt: new Date(row.expires_at),
    usedAt: row.used_at === null ? null : new Date(row.used_at),
    createdAt: new Date(row.created_at),
  };
}

const TOKEN_COLUMNS = `
  id, account_id, token_hash, purpose, expires_at, used_at, created_at`;

const INSERT_SQL = `
  INSERT INTO email_tokens (account_id, token_hash, purpose, expires_at)
  VALUES (?, ?, ?, ?)
  RETURNING ${TOKEN_COLUMNS}`;

/** Unconsumed and unexpired — the only state that redeems. */
const ACTIVE_PREDICATE = `used_at IS NULL AND expires_at > ?`;

const FIND_ACTIVE_SQL = `
  SELECT ${TOKEN_COLUMNS} FROM email_tokens
   WHERE token_hash = ? AND purpose = ? AND ${ACTIVE_PREDICATE}
   LIMIT 1`;

/** The consume: the active check and the used_at stamp are one statement. */
const CONSUME_SQL = `
  UPDATE email_tokens SET used_at = ?
   WHERE token_hash = ? AND purpose = ? AND ${ACTIVE_PREDICATE}`;

const INVALIDATE_FOR_ACCOUNT_SQL = `
  UPDATE email_tokens SET used_at = ?
   WHERE account_id = ? AND purpose = ? AND used_at IS NULL`;

@Injectable()
export class D1EmailTokenRepository extends EmailTokenRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async create(record: EmailTokenCreateInput): Promise<EmailTokenRecord> {
    const row = await this.d1
      .prepare(INSERT_SQL)
      .bind(
        record.accountId,
        record.tokenHash,
        record.purpose,
        record.expiresAt.toISOString(),
      )
      .first<D1EmailTokenRow>();
    if (!row) {
      throw new Error('email_tokens INSERT .. RETURNING returned no row');
    }
    return toContractToken(row);
  }

  /** @inheritdoc */
  async findActiveByTokenHashAndPurpose(
    tokenHash: string,
    purpose: EmailTokenPurpose,
  ): Promise<EmailTokenRecord | null> {
    const row = await this.d1
      .prepare(FIND_ACTIVE_SQL)
      .bind(tokenHash, purpose, new Date().toISOString())
      .first<D1EmailTokenRow>();
    return row ? toContractToken(row) : null;
  }

  /** @inheritdoc */
  async consume(
    tokenHash: string,
    purpose: EmailTokenPurpose,
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const result = await this.d1
      .prepare(CONSUME_SQL)
      .bind(now, tokenHash, purpose, now)
      .run();
    return Number(result.meta.changes ?? 0) > 0;
  }

  /** @inheritdoc */
  async invalidateAllForAccount(
    accountId: number,
    purpose: EmailTokenPurpose,
  ): Promise<number> {
    const result = await this.d1
      .prepare(INVALIDATE_FOR_ACCOUNT_SQL)
      .bind(new Date().toISOString(), accountId, purpose)
      .run();
    return Number(result.meta.changes ?? 0);
  }
}
