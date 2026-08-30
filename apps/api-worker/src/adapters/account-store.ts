/**
 * D1 account store — the account persistence the account/session routes
 * consume (task 3.7), re-hosted against the `accounts`, `saved_baskets`,
 * and `saved_scenarios` tables of the translated D1 schema (task 2.1).
 *
 * The data-platform package carries no D1 account repository (only the pg
 * Drizzle set), and packages/** is out of scope for the route ports — so
 * this adapter lives worker-side and mirrors the Drizzle repository's
 * documented semantics row-for-row: placeholder email on anonymous
 * creation, find-or-create race handling, upsert-by-name scenarios
 * (identity = account + name), first-claim-wins history linking, and the
 * verified-email UPDATE that replaces the always-throw
 * UnboundVerifiedEmailStore (task 2.4 / FIX-E; the write the abstract
 * AccountRepository exposes as setVerifiedEmail).
 *
 * @module AccountStore
 */

import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';

/** Placeholder domain used for anonymous account rows (email-verification parity). */
export const PLACEHOLDER_EMAIL_SUFFIX = '@placeholder.local';

/** Account row projection for the API surface. */
export interface AccountRow {
  readonly id: number;
  readonly userId: string;
  readonly email: string;
  readonly tier: string;
  readonly createdAt: Date;
  readonly lastActiveAt: Date;
}

/** Saved-basket row projection (Basket parity — id is the stringified row id). */
export interface BasketRow {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Date;
  readonly items: unknown;
}

/** Saved-scenario row projection (SavedScenario parity). */
export interface ScenarioRow {
  readonly id: number;
  readonly name: string;
  readonly inputs: unknown;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Minimal history/export entry (CalculationHistoryEntry parity). */
export interface HistoryEntry {
  readonly calculationId: number;
  readonly calculatedAt: Date;
  readonly totalCents: number;
  readonly quantity: number;
  readonly productName: string;
}

const ACCOUNT_COLUMNS = `id, user_id, email, tier, created_at, last_active_at`;

function toAccount(row: {
  id: number;
  user_id: string;
  email: string;
  tier: string;
  created_at: string;
  last_active_at: string;
}): AccountRow {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    tier: row.tier,
    createdAt: new Date(row.created_at),
    lastActiveAt: new Date(row.last_active_at),
  };
}

/** SQLSTATE unique-constraint parity on SQLite (constraint failed message). */
function isUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('UNIQUE constraint failed');
}

export class D1AccountStore {
  constructor(private readonly d1: D1DatabaseLike) {}

  // -----------------------------------------------------------------------
  // Accounts
  // -----------------------------------------------------------------------

  /** Find an account row by external userId, or null. */
  async findByUserId(userId: string): Promise<AccountRow | null> {
    const row = await this.d1
      .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE user_id = ? LIMIT 1`)
      .bind(userId)
      .first<{
        id: number;
        user_id: string;
        email: string;
        tier: string;
        created_at: string;
        last_active_at: string;
      }>();
    return row ? toAccount(row) : null;
  }

  /**
   * Find-or-create the account row for `userId`, safe against concurrent
   * callers racing the INSERT (ensureAccountRow parity): on a unique
   * violation the row already exists — re-read it instead of failing.
   */
  async ensureAccount(userId: string): Promise<AccountRow> {
    const existing = await this.findByUserId(userId);
    if (existing) return existing;

    try {
      await this.d1
        .prepare(
          `INSERT INTO accounts (user_id, email, tier) VALUES (?, ?, 'FREE')`,
        )
        .bind(userId, `${userId}${PLACEHOLDER_EMAIL_SUFFIX}`)
        .run();
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
    const raced = await this.findByUserId(userId);
    if (!raced) {
      throw new Error(`Account row for userId="${userId}" disappeared mid-create`);
    }
    return raced;
  }

  /**
   * Persist a verified email on the account row — the anonymous-upgrade
   * write that replaces the placeholder address (task 2.4 / FIX-E). Throws
   * when no account exists: a silent no-op would lose the verification.
   */
  async setVerifiedEmail(userId: string, email: string): Promise<void> {
    const result = await this.d1
      .prepare(`UPDATE accounts SET email = ? WHERE user_id = ?`)
      .bind(email, userId)
      .run();
    if (((result.meta as { changes?: number } | undefined)?.changes ?? 0) === 0) {
      throw new Error(
        `Cannot set verified email: account not found for userId="${userId}"`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Saved baskets
  // -----------------------------------------------------------------------

  /** The account's saved baskets, insertion order (repository parity). */
  async findBaskets(userId: string): Promise<BasketRow[]> {
    const rows = (
      await this.d1
        .prepare(
          `SELECT b.id, b.name, b.created_at, b.items
             FROM saved_baskets b
             JOIN accounts a ON a.id = b.account_id
            WHERE a.user_id = ?
            ORDER BY b.id ASC`,
        )
        .bind(userId)
        .all<{ id: number; name: string; created_at: string; items: string }>()
    ).results;
    return rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      createdAt: new Date(row.created_at),
      items: JSON.parse(row.items) as unknown,
    }));
  }

  /** Insert a saved basket for the account. */
  async createBasket(
    userId: string,
    basket: { name: string; items: unknown },
  ): Promise<void> {
    const account = await this.ensureAccount(userId);
    await this.d1
      .prepare(
        `INSERT INTO saved_baskets (account_id, name, items) VALUES (?, ?, ?)`,
      )
      .bind(account.id, basket.name, JSON.stringify(basket.items))
      .run();
  }

  /** Delete a saved basket by id, scoped to the account. True when deleted. */
  async deleteBasket(userId: string, basketId: string): Promise<boolean> {
    const result = await this.d1
      .prepare(
        `DELETE FROM saved_baskets
          WHERE id = ?
            AND account_id = (SELECT id FROM accounts WHERE user_id = ?)`,
      )
      .bind(Number.parseInt(basketId, 10), userId)
      .run();
    return ((result.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
  }

  // -----------------------------------------------------------------------
  // Saved scenarios
  // -----------------------------------------------------------------------

  /** The account's saved scenarios, newest activity first (repository order). */
  async findScenarios(userId: string): Promise<ScenarioRow[]> {
    const rows = (
      await this.d1
        .prepare(
          `SELECT s.id, s.name, s.inputs, s.created_at, s.updated_at
             FROM saved_scenarios s
             JOIN accounts a ON a.id = s.account_id
            WHERE a.user_id = ?
            ORDER BY s.updated_at DESC, s.id DESC`,
        )
        .bind(userId)
        .all<{
          id: number;
          name: string;
          inputs: string;
          created_at: string;
          updated_at: string;
        }>()
    ).results;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      inputs: JSON.parse(row.inputs) as unknown,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  /**
   * Upsert-by-name: the (account, name) pair is the identity; inputs and
   * updatedAt refresh on replace. Returns the persisted scenario.
   */
  async upsertScenario(
    userId: string,
    name: string,
    inputs: unknown,
  ): Promise<ScenarioRow> {
    const account = await this.ensureAccount(userId);
    const row = await this.d1
      .prepare(
        `INSERT INTO saved_scenarios (account_id, name, inputs) VALUES (?, ?, ?)
          ON CONFLICT (account_id, name) DO UPDATE SET
            inputs = excluded.inputs,
            updated_at = excluded.updated_at
          RETURNING id, name, inputs, created_at, updated_at`,
      )
      .bind(account.id, name, JSON.stringify(inputs))
      .first<{
        id: number;
        name: string;
        inputs: string;
        created_at: string;
        updated_at: string;
      }>();
    if (!row) {
      throw new Error('saved_scenarios upsert returned no row');
    }
    return {
      id: row.id,
      name: row.name,
      inputs: JSON.parse(row.inputs) as unknown,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Delete scenario by id, scoped to the account. Account-scoped
   * semantics: a foreign or absent id is indistinguishable — false, never
   * a cross-account delete.
   */
  async deleteScenario(userId: string, scenarioId: number): Promise<boolean> {
    const result = await this.d1
      .prepare(
        `DELETE FROM saved_scenarios
          WHERE id = ?
            AND account_id = (SELECT id FROM accounts WHERE user_id = ?)`,
      )
      .bind(scenarioId, userId)
      .run();
    return ((result.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
  }

  // -----------------------------------------------------------------------
  // Calculation history
  // -----------------------------------------------------------------------

  /**
   * Claim a calculation record for the account by stamping session_id —
   * first claim wins, so a cache-hit record id replayed to another session
   * never re-assigns ownership (linkSession parity).
   */
  async linkCalculation(recordId: number, userId: string): Promise<boolean> {
    const result = await this.d1
      .prepare(
        `UPDATE calculation_records SET session_id = ?
          WHERE id = ? AND (session_id IS NULL OR session_id = ?)`,
      )
      .bind(userId, recordId, userId)
      .run();
    return ((result.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
  }

  /** IDs of the calculation records claimed by the account, chronological. */
  async findHistoryIds(userId: string): Promise<number[]> {
    const rows = (
      await this.d1
        .prepare(
          `SELECT id FROM calculation_records
            WHERE session_id = ? ORDER BY calculated_at ASC, id ASC`,
        )
        .bind(userId)
        .all<{ id: number }>()
    ).results;
    return rows.map((row) => row.id);
  }

  /** Minimal export projection of the claimed records, chronological. */
  async findHistoryEntries(userId: string): Promise<HistoryEntry[]> {
    const rows = (
      await this.d1
        .prepare(
          `SELECT r.id, r.calculated_at, r.total_cents, r.quantity,
                  p.name AS product_name
             FROM calculation_records r
             JOIN product_master p ON p.id = r.product_master_id
            WHERE r.session_id = ?
            ORDER BY r.calculated_at ASC, r.id ASC`,
        )
        .bind(userId)
        .all<{
          id: number;
          calculated_at: string;
          total_cents: number;
          quantity: number;
          product_name: string;
        }>()
    ).results;
    return rows.map((row) => ({
      calculationId: row.id,
      calculatedAt: new Date(row.calculated_at),
      totalCents: row.total_cents,
      quantity: row.quantity,
      productName: row.product_name,
    }));
  }
}

/** Fresh UUIDv4 for server-generated anonymous identities (Workers-global). */
export function newAnonymousUserId(): string {
  return crypto.randomUUID();
}
