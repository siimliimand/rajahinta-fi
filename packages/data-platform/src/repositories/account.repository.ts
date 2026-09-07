/**
 * Drizzle AccountRepository — concrete implementation of the abstract
 * AccountRepository class backed by the accounts table.
 *
 * Provides CRUD for the accounts table, looked up by the external
 * user identifier (userId).
 *
 * The credential-flow writes (setPasswordHash, setVerifiedEmail) are
 * loud rejections here: the legacy pg harness carries no credential
 * columns — the production credential flow lives once, in the API
 * Worker's D1AccountRepository (design D9, change email-password-auth).
 *
 * @module DrizzleAccountRepository
 */
import { Injectable, Inject } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';
import { AccountRepository, type AccountCredentialRecord } from '../abstracts';
import { accounts, savedBaskets, savedScenarios } from '../schema';

@Injectable()
export class DrizzleAccountRepository extends AccountRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {
    super();
  }

  /** @inheritdoc */
  async create(
    record: typeof accounts.$inferInsert,
  ): Promise<typeof accounts.$inferSelect> {
    const [row] = await this.db
      .insert(accounts)
      .values(record)
      .returning();
    return row;
  }

  /** @inheritdoc */
  async findById(
    id: number,
  ): Promise<typeof accounts.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(accounts)
      .where(eq(accounts.id, id))
      .limit(1);
    return row ?? null;
  }

  /** @inheritdoc */
  async findByUserId(
    userId: string,
  ): Promise<typeof accounts.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, userId))
      .limit(1);
    return row ?? null;
  }

  /** @inheritdoc */
  async findByEmail(email: string): Promise<AccountCredentialRecord | null> {
    const [row] = await this.db
      .select()
      .from(accounts)
      // Case-insensitive resolution, matching the lower(email) lookup
      // convention (the pg harness carries no such index; the D1
      // production table enforces uniqueness on this expression).
      .where(sql`lower(${accounts.email}) = ${email.toLowerCase()}`)
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      email: row.email,
      // The pg harness schema has no credential columns — a null hash
      // and a null verification instant are the truthful projection
      // (login against them fails safe at the application layer).
      passwordHash: null,
      emailVerifiedAt: null,
      tier: row.tier,
      createdAt: row.createdAt,
      lastActiveAt: row.lastActiveAt,
    };
  }

  /** @inheritdoc */
  async updateLastActive(userId: string): Promise<void> {
    await this.db
      .update(accounts)
      .set({ lastActiveAt: new Date() })
      .where(eq(accounts.userId, userId));
  }

  /** @inheritdoc */
  async delete(userId: string): Promise<void> {
    await this.db
      .delete(accounts)
      .where(eq(accounts.userId, userId));
  }

  /** @inheritdoc */
  async findAllUserIds(): Promise<string[]> {
    const rows = await this.db
      .select({ userId: accounts.userId })
      .from(accounts);
    return rows.map((r) => r.userId);
  }

  /** @inheritdoc */
  async setVerifiedEmail(
    _userId: string,
    _verifiedAt: Date,
  ): Promise<void> {
    return Promise.reject(
      new Error(
        'setVerifiedEmail is not supported by the legacy pg harness ' +
          'repository: the accounts verification state exists only in the ' +
          'D1 schema (design D9, change email-password-auth)',
      ),
    );
  }

  /** @inheritdoc */
  async setPasswordHash(
    _userId: string,
    _passwordHash: string,
  ): Promise<void> {
    return Promise.reject(
      new Error(
        'setPasswordHash is not supported by the legacy pg harness ' +
          'repository: the credential flow lives only in the API Worker ' +
          '(design D9, change email-password-auth)',
      ),
    );
  }

  /** @inheritdoc */
  async anonymize(userId: string): Promise<void> {
    const account = await this.findByUserId(userId);
    if (!account) {
      throw new Error(`Cannot anonymize: account not found for userId="${userId}"`);
    }

    // Irreversible pseudonyms — fresh random UUID, NOT derivable from original.
    const anonUserId = `anon_${randomUUID()}`;
    const anonEmail = `anonymized+${randomUUID()}@deleted.invalid`;

    await this.db.transaction(async (tx) => {
      // Cascade: delete saved baskets for this account. Scenarios are
      // deleted here too (not via the savedScenarios FK cascade) because
      // the account row survives anonymization — the FK only fires on
      // account-row deletion. Kept in the same transaction as the
      // identifier overwrite so erasure is atomic.
      await tx
        .delete(savedBaskets)
        .where(eq(savedBaskets.accountId, account.id));

      await tx
        .delete(savedScenarios)
        .where(eq(savedScenarios.accountId, account.id));

      // Irreversibly overwrite identifiers; keep skeleton row (tier, timestamps).
      await tx
        .update(accounts)
        .set({ userId: anonUserId, email: anonEmail })
        .where(eq(accounts.userId, userId));
    });
  }
}
