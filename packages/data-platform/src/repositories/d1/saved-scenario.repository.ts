/**
 * D1 SavedScenarioRepository — the Cloudflare-side implementation of the
 * abstract {@link SavedScenarioRepository} contract (task 2.5, change
 * migrate-to-cloudflare). Account-scoped saved scenarios: listing by
 * account id or by external user id (join through accounts), upsert by
 * name on the (account_id, name) unique constraint, and account-scoped
 * delete. Signatures and result shapes match the pg
 * DrizzleSavedScenarioRepository exactly; ISO-8601 TEXT instants
 * convert to Date and the inputs JSON round-trips through TEXT at the
 * repository boundary (design D2).
 *
 * Upsert-by-name semantics preserved: the conflict arm replaces ONLY
 * inputs and updatedAt (stamped with the current instant, pg's
 * `updatedAt: new Date()`), never id, accountId, name, or createdAt.
 *
 * @module D1SavedScenarioRepository
 */
import { Injectable } from '@nestjs/common';
import { SavedScenarioRepository, type SavedScenarioRecord } from '../../abstracts';
import { savedScenarios } from '../../schema';
import type { D1DatabaseLike } from '../../d1/executor';

/** Raw D1 saved_scenarios row. */
interface D1SavedScenarioRow {
  readonly id: number;
  readonly account_id: number;
  readonly name: string;
  readonly inputs: string;
  readonly created_at: string;
  readonly updated_at: string;
}

function toContractScenario(row: D1SavedScenarioRow): SavedScenarioRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    inputs: JSON.parse(row.inputs) as unknown,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

const SCENARIO_COLUMNS = `
  id, account_id, name, inputs, created_at, updated_at`;

const FIND_BY_ACCOUNT_SQL = `
  SELECT ${SCENARIO_COLUMNS} FROM saved_scenarios WHERE account_id = ?`;

/** Flat projection — the pg repository's innerJoin shape, not nested. */
const FIND_BY_USER_SQL = `
  SELECT s.id, s.account_id, s.name, s.inputs, s.created_at, s.updated_at
    FROM saved_scenarios s
   INNER JOIN accounts a ON s.account_id = a.id
   WHERE a.user_id = ?`;

const UPSERT_SQL = `
  INSERT INTO saved_scenarios (account_id, name, inputs, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (account_id, name) DO UPDATE SET
    inputs = excluded.inputs,
    updated_at = excluded.updated_at
  RETURNING ${SCENARIO_COLUMNS}`;

const DELETE_SQL = `
  DELETE FROM saved_scenarios WHERE id = ? AND account_id = ?`;

@Injectable()
export class D1SavedScenarioRepository extends SavedScenarioRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async findByAccountId(accountId: number): Promise<SavedScenarioRecord[]> {
    const rows = (
      await this.d1
        .prepare(FIND_BY_ACCOUNT_SQL)
        .bind(accountId)
        .all<D1SavedScenarioRow>()
    ).results;
    return rows.map(toContractScenario);
  }

  /** @inheritdoc */
  async findByUserId(userId: string): Promise<SavedScenarioRecord[]> {
    const rows = (
      await this.d1.prepare(FIND_BY_USER_SQL).bind(userId).all<D1SavedScenarioRow>()
    ).results;
    return rows.map(toContractScenario);
  }

  /** @inheritdoc */
  async upsert(
    record: typeof savedScenarios.$inferInsert,
  ): Promise<SavedScenarioRecord> {
    const now = new Date().toISOString();
    const row = await this.d1
      .prepare(UPSERT_SQL)
      .bind(
        record.accountId,
        record.name,
        JSON.stringify(record.inputs),
        record.createdAt?.toISOString() ?? now,
        // Fresh instant on the conflict arm — pg SET new Date().
        record.updatedAt?.toISOString() ?? now,
      )
      .first<D1SavedScenarioRow>();
    if (!row) {
      throw new Error('saved_scenarios upsert .. RETURNING returned no row');
    }
    return toContractScenario(row);
  }

  /** @inheritdoc */
  async delete(accountId: number, id: number): Promise<void> {
    // Account scope alongside the pk: a scenario id belonging to another
    // account matches no row instead of deleting cross-account.
    await this.d1.prepare(DELETE_SQL).bind(id, accountId).run();
  }
}
