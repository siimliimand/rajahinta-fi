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
import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';
import { AccountRepository } from '../abstracts';
import { accounts } from '../schema';

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
}