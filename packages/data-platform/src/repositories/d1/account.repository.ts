/**
 * D1 AccountRepository — the Cloudflare-side implementation of the
 * abstract {@link AccountRepository} contract backed by the `accounts`
 * table (task 1.1, change email-password-auth). The email address is
 * the username: the repository normalizes it to lowercase on write and
 * lookup so case variants resolve to one identity against the
 * lower(email) unique index (design D7) — mirroring the producer-links
 * normalize-on-write-and-lookup precedent.
 *
 * Signatures and result shapes match the pg DrizzleAccountRepository;
 * ISO-8601 TEXT instants convert to Date at the repository boundary
 * (design D2). Password and verification state are written only through
 * their dedicated methods — hashing and verification are application
 * layer concerns, this layer stores the results.
 *
 * @module D1AccountRepository
 */
import { Injectable } from '@nestjs/common';
import {
  AccountRepository,
  type AccountCredentialRecord,
} from '../../abstracts';
import { accounts } from '../../schema';
import type { D1DatabaseLike } from '../../d1/executor';

/** Raw D1 accounts row — the full storage shape. */
interface D1AccountRow {
  readonly id: number;
  readonly user_id: string;
  readonly email: string;
  readonly password_hash: string | null;
  readonly email_verified_at: string | null;
  readonly tier: string;
  readonly created_at: string;
  readonly last_active_at: string;
}

function toContractAccount(row: D1AccountRow): typeof accounts.$inferSelect {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    tier: row.tier,
    createdAt: new Date(row.created_at),
    lastActiveAt: new Date(row.last_active_at),
  };
}

function toCredentialRecord(row: D1AccountRow): AccountCredentialRecord {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    passwordHash: row.password_hash,
    emailVerifiedAt:
      row.email_verified_at === null ? null : new Date(row.email_verified_at),
    tier: row.tier,
    createdAt: new Date(row.created_at),
    lastActiveAt: new Date(row.last_active_at),
  };
}

/** Full storage column list — passwordHash/emailVerifiedAt ride along as
 *  nullable columns; reads expose only what the contract declares. */
const ACCOUNT_COLUMNS = `
  id, user_id, email, password_hash, email_verified_at, tier, created_at,
  last_active_at`;

const INSERT_SQL = `
  INSERT INTO accounts (user_id, email, tier)
  VALUES (?, ?, ?)
  RETURNING ${ACCOUNT_COLUMNS}`;

/** The lower(email) form matches the unique index — the lookup is index-served. */
const FIND_BY_EMAIL_SQL = `
  SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE lower(email) = ? LIMIT 1`;

@Injectable()
export class D1AccountRepository extends AccountRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async create(
    record: typeof accounts.$inferInsert,
  ): Promise<typeof accounts.$inferSelect> {
    // Email is the username — stored lowercase (the unique index is on
    // lower(email); storing the normalized form keeps rows canonical).
    const row = await this.d1
      .prepare(INSERT_SQL)
      .bind(record.userId, record.email.toLowerCase(), record.tier ?? 'FREE')
      .first<D1AccountRow>();
    if (!row) {
      throw new Error('accounts INSERT .. RETURNING returned no row');
    }
    return toContractAccount(row);
  }

  /** @inheritdoc */
  async findById(id: number): Promise<typeof accounts.$inferSelect | null> {
    const row = await this.d1
      .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ? LIMIT 1`)
      .bind(id)
      .first<D1AccountRow>();
    return row ? toContractAccount(row) : null;
  }

  /** @inheritdoc */
  async findByUserId(
    userId: string,
  ): Promise<typeof accounts.$inferSelect | null> {
    const row = await this.d1
      .prepare(
        `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE user_id = ? LIMIT 1`,
      )
      .bind(userId)
      .first<D1AccountRow>();
    return row ? toContractAccount(row) : null;
  }

  /** @inheritdoc */
  async findByEmail(email: string): Promise<AccountCredentialRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_EMAIL_SQL)
      .bind(email.toLowerCase())
      .first<D1AccountRow>();
    return row ? toCredentialRecord(row) : null;
  }

  /** @inheritdoc */
  async updateLastActive(userId: string): Promise<void> {
    await this.d1
      .prepare(`UPDATE accounts SET last_active_at = ? WHERE user_id = ?`)
      .bind(new Date().toISOString(), userId)
      .run();
  }

  /** @inheritdoc */
  async delete(userId: string): Promise<void> {
    await this.d1
      .prepare(`DELETE FROM accounts WHERE user_id = ?`)
      .bind(userId)
      .run();
  }

  /** @inheritdoc */
  async findAllUserIds(): Promise<string[]> {
    const result = await this.d1
      .prepare(`SELECT user_id FROM accounts`)
      .all<{ user_id: string }>();
    return result.results.map((r) => r.user_id);
  }

  /** @inheritdoc */
  async setVerifiedEmail(userId: string, verifiedAt: Date): Promise<void> {
    const result = await this.d1
      .prepare(
        `UPDATE accounts SET email_verified_at = ? WHERE user_id = ?`,
      )
      .bind(verifiedAt.toISOString(), userId)
      .run();
    if (Number(result.meta.changes ?? 0) === 0) {
      throw new Error(
        `Cannot set verified email: account not found for userId="${userId}"`,
      );
    }
  }

  /** @inheritdoc */
  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    const result = await this.d1
      .prepare(`UPDATE accounts SET password_hash = ? WHERE user_id = ?`)
      .bind(passwordHash, userId)
      .run();
    if (Number(result.meta.changes ?? 0) === 0) {
      throw new Error(
        `Cannot set password hash: account not found for userId="${userId}"`,
      );
    }
  }

  /** @inheritdoc */
  async anonymize(userId: string): Promise<void> {
    const account = await this.findByUserId(userId);
    if (!account) {
      throw new Error(
        `Cannot anonymize: account not found for userId="${userId}"`,
      );
    }

    // Irreversible pseudonyms — fresh random UUID, NOT derivable from
    // original (Workers-global WebCrypto, no node:crypto dependency).
    const anonUserId = `anon_${crypto.randomUUID()}`;
    const anonEmail = `anonymized+${crypto.randomUUID()}@deleted.invalid`;

    // No interactive transactions in D1 — the erasure is one batch()
    // (all-or-nothing), the same translation the session rotation uses.
    await this.d1.batch([
      // Baskets and scenarios die with the identifiers (the account row
      // survives anonymization, so FK cascades never fire for them).
      this.d1
        .prepare(`DELETE FROM saved_baskets WHERE account_id = ?`)
        .bind(account.id),
      this.d1
        .prepare(`DELETE FROM saved_scenarios WHERE account_id = ?`)
        .bind(account.id),
      // Irreversibly overwrite identifiers AND retire credentials — an
      // anonymized skeleton keeps no password verifier and no
      // verification state (data minimization on the erasure path).
      this.d1
        .prepare(
          `UPDATE accounts
              SET user_id = ?, email = ?, password_hash = NULL, email_verified_at = NULL
            WHERE user_id = ?`,
        )
        .bind(anonUserId, anonEmail, userId),
    ]);
  }
}
