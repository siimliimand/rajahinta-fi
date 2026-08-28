/**
 * Drizzle AccountRepository — concrete implementation of the abstract
 * AccountRepository class backed by the accounts table.
 *
 * Provides CRUD for the accounts table, looked up by the external
 * user identifier (userId).
 *
 * @module DrizzleAccountRepository
 */
import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';
import { AccountRepository } from '../abstracts';
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
  async setVerifiedEmail(userId: string, email: string): Promise<void> {
    const [row] = await this.db
      .update(accounts)
      .set({ email })
      .where(eq(accounts.userId, userId))
      .returning({ id: accounts.id });
    if (!row) {
      throw new Error(
        `Cannot set verified email: account not found for userId="${userId}"`,
      );
    }
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