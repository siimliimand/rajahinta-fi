/**
 * Drizzle SavedBasketRepository — concrete implementation of the abstract
 * SavedBasketRepository class backed by the saved_baskets table.
 *
 * Provides CRUD for saved baskets, supporting lookup by basket id,
 * by account id, and by external user id (via join through accounts).
 *
 * @module DrizzleSavedBasketRepository
 */
import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';
import { SavedBasketRepository } from '../abstracts';
import { savedBaskets, accounts } from '../schema';

@Injectable()
export class DrizzleSavedBasketRepository extends SavedBasketRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {
    super();
  }

  /** @inheritdoc */
  async create(
    record: typeof savedBaskets.$inferInsert,
  ): Promise<typeof savedBaskets.$inferSelect> {
    const [row] = await this.db
      .insert(savedBaskets)
      .values(record)
      .returning();
    return row;
  }

  /** @inheritdoc */
  async findById(
    id: number,
  ): Promise<typeof savedBaskets.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(savedBaskets)
      .where(eq(savedBaskets.id, id))
      .limit(1);
    return row ?? null;
  }

  /** @inheritdoc */
  async findByAccountId(
    accountId: number,
  ): Promise<typeof savedBaskets.$inferSelect[]> {
    return this.db
      .select()
      .from(savedBaskets)
      .where(eq(savedBaskets.accountId, accountId));
  }

  /** @inheritdoc */
  async findByUserId(
    userId: string,
  ): Promise<typeof savedBaskets.$inferSelect[]> {
    const rows = await this.db
      .select({ id: savedBaskets.id, accountId: savedBaskets.accountId, name: savedBaskets.name, createdAt: savedBaskets.createdAt, items: savedBaskets.items })
      .from(savedBaskets)
      .innerJoin(accounts, eq(savedBaskets.accountId, accounts.id))
      .where(eq(accounts.userId, userId));
    return rows;
  }

  /** @inheritdoc */
  async delete(id: number): Promise<void> {
    await this.db
      .delete(savedBaskets)
      .where(eq(savedBaskets.id, id));
  }
}