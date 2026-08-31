/**
 * D1 SessionRepository — the Cloudflare-side implementation of the
 * abstract {@link SessionRepository} contract backed by the `sessions`
 * table (task 2.5, change migrate-to-cloudflare). Handles token hashes
 * only — SHA-256 digests at rest (D3); minting raw tokens is the
 * application layer's SessionTokenService job. Signatures and result
 * shapes match the pg DrizzleSessionRepository exactly; ISO-8601 TEXT
 * instants convert to Date at the repository boundary (design D2).
 *
 * ## Atomic rotation without interactive transactions
 *
 * pg ran the rotate pair (insert successor, revoke predecessor) inside
 * `db.transaction`. Workers' D1 has no interactive transaction; the
 * translation is the binding's `batch()` — sequential statements in one
 * implicit transaction. The successor insert is an INSERT .. SELECT off
 * the active predecessor row (single statement, no cross-statement
 * value passing); the predecessor revoke is constrained by the same
 * active predicate, so a dead or unknown token inserts nothing, revokes
 * nothing, and rotate returns null — a rotated or unknown token never
 * mints a new one. Two racing rotations of one token serialize through
 * D1's single-writer execution and produce exactly one successor.
 *
 * @module D1SessionRepository
 */
import { Injectable } from '@nestjs/common';
import { SessionRepository, type SessionRecord } from '../../abstracts';
// The abstract contracts are typed against the canonical schema tables;
// importing the table for $inferInsert keeps the signatures identical
// (pure schema definitions — no driver dependency, same as product-search).
import { sessions } from '../../schema';
import type { D1DatabaseLike } from '../../d1/executor';

/** Raw D1 sessions row. */
interface D1SessionRow {
  readonly id: number;
  readonly token_hash: string;
  readonly account_id: number;
  readonly rotated_from_id: number | null;
  readonly created_at: string;
  readonly expires_at: string;
  readonly revoked_at: string | null;
}

function toContractSession(row: D1SessionRow): SessionRecord {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    accountId: row.account_id,
    rotatedFromId: row.rotated_from_id,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at),
  };
}

const SESSION_COLUMNS = `
  id, token_hash, account_id, rotated_from_id, created_at, expires_at,
  revoked_at`;

const INSERT_SQL = `
  INSERT INTO sessions (token_hash, account_id, rotated_from_id, created_at, expires_at, revoked_at)
  VALUES (?, ?, ?, ?, ?, ?)
  RETURNING ${SESSION_COLUMNS}`;

/** Unrevoked and unexpired — the only state that authenticates. */
const ACTIVE_PREDICATE = `revoked_at IS NULL AND expires_at > ?`;

const FIND_ACTIVE_BY_HASH_SQL = `
  SELECT ${SESSION_COLUMNS} FROM sessions
   WHERE token_hash = ? AND ${ACTIVE_PREDICATE}
   LIMIT 1`;

/**
 * Successor insert: copies the account identity and id of the ACTIVE
 * predecessor row in one statement — no-op (zero rows) when the
 * presented hash has no active session.
 */
const INSERT_SUCCESSOR_SQL = `
  INSERT INTO sessions (token_hash, account_id, rotated_from_id, created_at, expires_at)
  SELECT ?, account_id, id, ?, ? FROM sessions
   WHERE token_hash = ? AND ${ACTIVE_PREDICATE}`;

/** Predecessor revoke — same active predicate, so the winner's own
 *  successor (different hash) is never touched. */
const REVOKE_PRESENTED_SQL = `
  UPDATE sessions SET revoked_at = ?
   WHERE token_hash = ? AND ${ACTIVE_PREDICATE}`;

const REVOKE_BY_HASH_SQL = `
  UPDATE sessions SET revoked_at = ?
   WHERE token_hash = ? AND ${ACTIVE_PREDICATE}`;

const DELETE_EXPIRED_SQL = `
  DELETE FROM sessions WHERE expires_at < ?`;

@Injectable()
export class D1SessionRepository extends SessionRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async create(record: typeof sessions.$inferInsert): Promise<SessionRecord> {
    const now = new Date().toISOString();
    const row = await this.d1
      .prepare(INSERT_SQL)
      .bind(
        record.tokenHash,
        record.accountId,
        record.rotatedFromId ?? null,
        record.createdAt?.toISOString() ?? now,
        record.expiresAt.toISOString(),
        record.revokedAt?.toISOString() ?? null,
      )
      .first<D1SessionRow>();
    if (!row) {
      throw new Error('sessions INSERT .. RETURNING returned no row');
    }
    return toContractSession(row);
  }

  /** @inheritdoc */
  async findActiveByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const row = await this.d1
      .prepare(FIND_ACTIVE_BY_HASH_SQL)
      .bind(tokenHash, new Date().toISOString())
      .first<D1SessionRow>();
    return row ? toContractSession(row) : null;
  }

  /** @inheritdoc */
  async rotate(
    tokenHash: string,
    newTokenHash: string,
    expiresAt: Date,
  ): Promise<SessionRecord | null> {
    const now = new Date().toISOString();

    // Successor first, then revoke the predecessor — both inside the
    // batch transaction, so the switch is all-or-nothing.
    await this.d1.batch([
      this.d1
        .prepare(INSERT_SUCCESSOR_SQL)
        .bind(newTokenHash, now, expiresAt.toISOString(), tokenHash, now),
      this.d1
        .prepare(REVOKE_PRESENTED_SQL)
        .bind(now, tokenHash, now),
    ]);

    // The successor is now the only row carrying the new hash (unique);
    // null means the presented hash had no active session — nothing was
    // minted.
    const row = await this.d1
      .prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE token_hash = ?`)
      .bind(newTokenHash)
      .first<D1SessionRow>();
    return row ? toContractSession(row) : null;
  }

  /** @inheritdoc */
  async revokeByTokenHash(tokenHash: string): Promise<boolean> {
    const result = await this.d1
      .prepare(REVOKE_BY_HASH_SQL)
      .bind(new Date().toISOString(), tokenHash, new Date().toISOString())
      .run();
    return Number(result.meta.changes ?? 0) > 0;
  }

  /** @inheritdoc */
  async deleteExpiredBefore(cutoff: Date): Promise<number> {
    const result = await this.d1
      .prepare(DELETE_EXPIRED_SQL)
      .bind(cutoff.toISOString())
      .run();
    return Number(result.meta.changes ?? 0);
  }
}
