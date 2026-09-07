/**
 * D1 account store — the account persistence the account/session routes
 * consume (task 3.7), re-hosted against the `accounts`, `saved_baskets`,
 * and `saved_scenarios` tables of the translated D1 schema, extended by
 * the credential flow (tasks 2.2/2.3, change email-password-auth): the
 * email IS the username, so this adapter owns the lowercase-normalized
 * email lookup, the registered-account INSERT against the lower(email)
 * unique index, the password/verification-state writes, and the
 * revoke-all-sessions sweep the password reset performs.
 *
 * packages/** is out of scope for the route ports — so the credential
 * writes mirror D1AccountRepository (task 1.1) statement-for-statement
 * worker-side, the same way this adapter already mirrored the Drizzle
 * repository's basket/scenario semantics: race-safe registered-account
 * INSERT (unique-index rejection), upsert-by-name scenarios
 * (identity = account + name), first-claim-wins history linking.
 *
 * Accounts are created ONLY by registration — no anonymous/placeholder
 * identity is minted anywhere (change email-password-auth);
 * basket/scenario writes receive the account id the sessionAuth-guarded
 * route resolved, and a missing row fails closed at the route (401),
 * never as a created row.
 *
 * @module AccountStore
 */

import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';

/** Account row projection for the API surface. */
export interface AccountRow {
  readonly id: number;
  readonly userId: string;
  readonly email: string;
  /** Verification STATE (email_verified_at) — null = unverified. */
  readonly emailVerifiedAt: Date | null;
  readonly tier: string;
  readonly createdAt: Date;
  readonly lastActiveAt: Date;
}

/** The account row plus the stored credential — the login-path read. */
export interface AccountCredentialRow extends AccountRow {
  /** Stored PBKDF2 envelope; null/empty = no usable credential (fail-safe 401). */
  readonly passwordHash: string | null;
}

/**
 * Registration hit the lower(email) unique index — the address is already
 * registered. The route maps this to the 409 conflict envelope.
 */
export class EmailAlreadyRegisteredError extends Error {
  constructor(readonly email: string) {
    super(`Email already registered: ${email}`);
    this.name = 'EmailAlreadyRegisteredError';
  }
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

const ACCOUNT_COLUMNS = `id, user_id, email, email_verified_at, tier, created_at, last_active_at`;

/** The credential read adds only the stored hash (never leaves the data layer raw-parsed). */
const CREDENTIAL_COLUMNS = `${ACCOUNT_COLUMNS}, password_hash`;

interface AccountDbRow {
  id: number;
  user_id: string;
  email: string;
  email_verified_at: string | null;
  tier: string;
  created_at: string;
  last_active_at: string;
}

type CredentialDbRow = AccountDbRow & { password_hash: string | null };

function toAccount(row: AccountDbRow): AccountRow {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    emailVerifiedAt: row.email_verified_at === null ? null : new Date(row.email_verified_at),
    tier: row.tier,
    createdAt: new Date(row.created_at),
    lastActiveAt: new Date(row.last_active_at),
  };
}

function toCredential(row: CredentialDbRow): AccountCredentialRow {
  return { ...toAccount(row), passwordHash: row.password_hash };
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

  /** Find an account row by its primary key (serial id) — the email-token join. */
  async findById(id: number): Promise<AccountRow | null> {
    const row = await this.d1
      .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ? LIMIT 1`)
      .bind(id)
      .first<AccountDbRow>();
    return row ? toAccount(row) : null;
  }

  /** Find an account row by external userId, or null. */
  async findByUserId(userId: string): Promise<AccountRow | null> {
    const row = await this.d1
      .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE user_id = ? LIMIT 1`)
      .bind(userId)
      .first<AccountDbRow>();
    return row ? toAccount(row) : null;
  }

  /**
   * The credential read (login): resolve the account by email. The
   * address is normalized to lowercase here and on write, so the lookup
   * is index-served by the lower(email) unique index and case variants
   * resolve to one identity (D1AccountRepository.findByEmail parity).
   */
  async findCredentialByEmail(email: string): Promise<AccountCredentialRow | null> {
    const row = await this.d1
      .prepare(`SELECT ${CREDENTIAL_COLUMNS} FROM accounts WHERE lower(email) = ? LIMIT 1`)
      .bind(email.toLowerCase())
      .first<CredentialDbRow>();
    return row ? toCredential(row) : null;
  }

  /**
   * Create a registered account: server-generated userId, the email
   * (already validated by the route) stored lowercase-canonical, and the
   * pre-hashed PBKDF2 envelope. Uniqueness is the lower(email) unique
   * index enforced in SQL — a losing race surfaces as
   * {@link EmailAlreadyRegisteredError} rather than a raw constraint error.
   */
  async createRegisteredAccount(input: {
    email: string;
    passwordHash: string;
  }): Promise<AccountCredentialRow> {
    const email = input.email.toLowerCase();
    const userId = crypto.randomUUID();
    try {
      await this.d1
        .prepare(
          `INSERT INTO accounts (user_id, email, password_hash, tier)
           VALUES (?, ?, ?, 'FREE')`,
        )
        .bind(userId, email, input.passwordHash)
        .run();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new EmailAlreadyRegisteredError(email);
      }
      throw err;
    }
    const row = await this.findCredentialByEmail(email);
    if (!row) {
      throw new Error(`Account row for email="${email}" disappeared mid-create`);
    }
    return row;
  }

  /**
   * Store the PBKDF2 envelope produced by hashPassword (registration and
   * reset share this write). Throws when the account vanished — a silent
   * no-op would strand the credential.
   */
  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    const result = await this.d1
      .prepare(`UPDATE accounts SET password_hash = ? WHERE user_id = ?`)
      .bind(passwordHash, userId)
      .run();
    if (((result.meta as { changes?: number } | undefined)?.changes ?? 0) === 0) {
      throw new Error(`Cannot set password hash: account not found for userId="${userId}"`);
    }
  }

  /**
   * Stamp the email-verification instant — the write the emailed
   * single-use token flow performs after consuming a `verify_email`
   * token (email_verified_at IS NOT NULL is the verification state; the
   * address itself is set at registration). Throws when the account is
   * gone: a silent no-op would lose the verification.
   */
  async setVerifiedEmail(userId: string, verifiedAt: Date): Promise<void> {
    const result = await this.d1
      .prepare(`UPDATE accounts SET email_verified_at = ? WHERE user_id = ?`)
      .bind(verifiedAt.toISOString(), userId)
      .run();
    if (((result.meta as { changes?: number } | undefined)?.changes ?? 0) === 0) {
      throw new Error(
        `Cannot set verified email: account not found for userId="${userId}"`,
      );
    }
  }

  /**
   * Revoke every active session of the account (password-reset hygiene,
   * design D2: a completed reset logs out ALL devices). The active
   * predicate mirrors the session repository — already-revoked and
   * expired rows are untouched. Returns the number of sessions revoked.
   */
  async revokeAllSessionsForAccount(accountId: number): Promise<number> {
    const result = await this.d1
      .prepare(
        `UPDATE sessions SET revoked_at = ?
          WHERE account_id = ? AND revoked_at IS NULL AND expires_at > ?`,
      )
      .bind(new Date().toISOString(), accountId, new Date().toISOString())
      .run();
    return ((result.meta as { changes?: number } | undefined)?.changes ?? 0);
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

  /**
   * Insert a saved basket for the account. `accountId` comes from the
   * sessionAuth-guarded route's resolved account row — this write never
   * mints an account row.
   */
  async createBasket(
    accountId: number,
    basket: { name: string; items: unknown },
  ): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO saved_baskets (account_id, name, items) VALUES (?, ?, ?)`,
      )
      .bind(accountId, basket.name, JSON.stringify(basket.items))
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
   * `accountId` comes from the sessionAuth-guarded route's resolved
   * account row — no account is created here.
   */
  async upsertScenario(
    accountId: number,
    name: string,
    inputs: unknown,
  ): Promise<ScenarioRow> {
    const row = await this.d1
      .prepare(
        `INSERT INTO saved_scenarios (account_id, name, inputs) VALUES (?, ?, ?)
          ON CONFLICT (account_id, name) DO UPDATE SET
            inputs = excluded.inputs,
            updated_at = excluded.updated_at
          RETURNING id, name, inputs, created_at, updated_at`,
      )
      .bind(accountId, name, JSON.stringify(inputs))
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
