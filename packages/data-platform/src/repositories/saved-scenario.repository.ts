/**
 * Drizzle SavedScenarioRepository — concrete implementation of the abstract
 * SavedScenarioRepository class backed by the saved_scenarios table.
 *
 * Provides account-scoped access for saved scenarios: listing by account id
 * or by external user id (via join through accounts), upsert-by-name on the
 * (account_id, name) unique constraint, and account-scoped delete.
 *
 * @module DrizzleSavedScenarioRepository
 */
import { Injectable, Inject } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';
import { SavedScenarioRepository, type SavedScenarioRecord } from '../abstracts';
import { savedScenarios, accounts } from '../schema';

@Injectable()
export class DrizzleSavedScenarioRepository extends SavedScenarioRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {
    super();
  }

  /** @inheritdoc */
  async findByAccountId(
    accountId: number,
  ): Promise<SavedScenarioRecord[]> {
    return this.db
      .select()
      .from(savedScenarios)
      .where(eq(savedScenarios.accountId, accountId));
  }

  /** @inheritdoc */
  async findByUserId(
    userId: string,
  ): Promise<SavedScenarioRecord[]> {
    // Explicit column projection: a bare .select() over an innerJoin
    // would nest { saved_scenarios: ..., accounts: ... } — projecting
    // the scenario columns directly keeps the raw-record return shape.
    const rows = await this.db
      .select({
        id: savedScenarios.id,
        accountId: savedScenarios.accountId,
        name: savedScenarios.name,
        inputs: savedScenarios.inputs,
        createdAt: savedScenarios.createdAt,
        updatedAt: savedScenarios.updatedAt,
      })
      .from(savedScenarios)
      .innerJoin(accounts, eq(savedScenarios.accountId, accounts.id))
      .where(eq(accounts.userId, userId));
    return rows;
  }

  /** @inheritdoc */
  async upsert(
    record: typeof savedScenarios.$inferInsert,
  ): Promise<SavedScenarioRecord> {
    const [row] = await this.db
      .insert(savedScenarios)
      .values(record)
      .onConflictDoUpdate({
        // Composite unique constraint saved_scenarios_account_id_name_unique
        // — re-saving under an existing name replaces the inputs instead
        // of duplicating the row.
        target: [savedScenarios.accountId, savedScenarios.name],
        set: {
          inputs: record.inputs,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  /** @inheritdoc */
  async delete(accountId: number, id: number): Promise<void> {
    // Account scope alongside the pk: a scenario id belonging to another
    // account matches no row instead of deleting cross-account.
    await this.db
      .delete(savedScenarios)
      .where(
        and(
          eq(savedScenarios.id, id),
          eq(savedScenarios.accountId, accountId),
        ),
      );
  }
}
