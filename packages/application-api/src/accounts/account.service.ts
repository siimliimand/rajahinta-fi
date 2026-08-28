/**
 * AccountService — minimal account management.
 *
 * Phase 1: supports both database-backed and in-memory operation.
 * When {@link AccountRepository}, {@link SavedBasketRepository}, and
 * {@link SavedScenarioRepository} are injected via NestJS DI, all reads and
 * writes go through the Drizzle repositories. When not injected (e.g. in
 * unit tests), a fallback in-memory Map is used.
 *
 * ## Usage
 *
 * ```typescript
 * const account = await accountService.getAccount(userId);
 * const baskets = await accountService.getSavedBaskets(userId);
 * ```
 *
 * @module AccountService
 */

import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { AuditService } from '@rajahinta/core-domain';
import type { Account, Basket, BasketItem, SavedScenario } from './account.types';
import type { CalculationExportRecord } from './data-export.types';
import {
  AccountRepository,
  CalculationRecordRepository,
  SavedBasketRepository,
  SavedScenarioRepository,
  accounts,
  savedBaskets,
  savedScenarios,
  type SavedScenarioInputs,
  type SavedScenarioRecord,
} from '@rajahinta/data-platform';
import type { VerifiedEmailStore } from './verified-email.store';

/** Postgres unique-constraint violation (SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string }).code === '23505';
}

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  /** Fallback in-memory account store when repositories are not injected. */
  private readonly accounts = new Map<string, Account>();

  /** Fallback in-memory scenario store (per external userId) — test-only. */
  private readonly scenarios = new Map<string, SavedScenario[]>();

  /**
   * Find-or-create the account row for {@code userId}, safe against
   * concurrent callers racing the INSERT: on a unique violation the row
   * already exists, so re-read it instead of failing the request.
   */
  private async ensureAccountRow(
    userId: string,
  ): Promise<NonNullable<Awaited<ReturnType<AccountRepository['findByUserId']>>>> {
    const existing = await this.accountRepository!.findByUserId(userId);
    if (existing) {
      return existing;
    }

    this.logger.debug(`Creating default account for userId="${userId}"`);
    try {
      return await this.accountRepository!.create({
        userId,
        email: `${userId}@placeholder.local`,
        tier: 'FREE',
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const raced = await this.accountRepository!.findByUserId(userId);
        if (raced) {
          return raced;
        }
      }
      throw err;
    }
  }

  /** Monotonic id source for in-memory fallback scenarios. */
  private scenarioIdSeq = 0;

  constructor(
    @Optional() private readonly accountRepository?: AccountRepository,
    @Optional() private readonly savedBasketRepository?: SavedBasketRepository,
    @Optional() private readonly auditService?: AuditService,
    // Appended last so positional constructions in existing tests keep
    // their (accountRepository, savedBasketRepository, auditService) shape.
    @Optional() private readonly savedScenarioRepository?: SavedScenarioRepository,
    @Optional() private readonly verifiedEmailStore?: VerifiedEmailStore,
    // Calculation-record persistence for the account history read/write
    // paths (reported e2e defect: the DB path was a no-op and history +
    // export always returned empty). Optional for the in-memory fallback.
    @Optional()
    private readonly calculationRecordRepository?: CalculationRecordRepository,
  ) {
    // Fail-fast: outside test environments, repositories must be injected
    // to prevent silent data loss via the in-memory fallback.
    const isTestEnv =
      process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
    if (!isTestEnv) {
      const missing: string[] = [];
      if (!this.accountRepository) missing.push('AccountRepository');
      if (!this.savedBasketRepository) missing.push('SavedBasketRepository');
      if (!this.savedScenarioRepository) missing.push('SavedScenarioRepository');
      if (missing.length > 0) {
        throw new Error(
          `AccountService requires repository injection outside test environments. ` +
          `Missing: ${missing.join(', ')}. ` +
          `The in-memory fallback is test-only and would result in data loss ` +
          `if used in production (restart volatility, no retention enforcement, ` +
          `no GDPR export/erasure).`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Mapping helpers
  // ---------------------------------------------------------------------------

  /**
   * Map a DB account row to the application-layer Account type.
   * Saved baskets and calculation history are not stored on the row;
   * they are loaded separately.
   */
  private rowToAccount(
    row: typeof accounts.$inferSelect,
  ): Account {
    return {
      userId: row.userId,
      email: row.email,
      tier: row.tier as 'FREE' | 'PREMIUM',
      savedBaskets: [],
      calculationHistory: [],
      subscription: {
        userId: row.userId,
        plan: row.tier as 'FREE' | 'PREMIUM',
        active: true,
      },
      createdAt: row.createdAt,
      lastActiveAt: row.lastActiveAt,
    };
  }

  /**
   * Map a DB saved-basket row to the application-layer Basket type.
   */
  private rowToBasket(
    row: typeof savedBaskets.$inferSelect,
  ): Basket {
    return {
      id: String(row.id),
      name: row.name,
      createdAt: row.createdAt,
      items: row.items as unknown as BasketItem[],
    };
  }

  /**
   * Map a DB saved-scenario row to the application-layer SavedScenario type.
   */
  private rowToScenario(row: SavedScenarioRecord): SavedScenario {
    return {
      id: row.id,
      name: row.name,
      inputs: row.inputs as unknown as SavedScenarioInputs,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Retrieve the account for the given user.
   *
   * Creates a default FREE-tier account on first access.
   *
   * @param userId — unique user identifier
   */
  async getAccount(userId: string): Promise<Account> {
    // Database path
    if (this.accountRepository) {
      const row = await this.ensureAccountRow(userId);
      return this.rowToAccount(row);
    }

    // In-memory fallback
    let account = this.accounts.get(userId);

    if (!account) {
      this.logger.debug(`Creating default account for userId="${userId}"`);
      account = this.createDefaultAccount(userId);
      this.accounts.set(userId, account);
    }

    return account;
  }

  /**
   * Ensure an account row exists for a SERVER-GENERATED anonymous identity
   * and return the raw row — session issuance links the token to the row's
   * numeric id (task 2.2). The userId must originate from the session
   * controller's randomUUID(), never from client input. Throws when no
   * account repository is bound: sessions are a persisted construct and the
   * in-memory fallback cannot mint them.
   */
  async ensureAccountForSession(
    userId: string,
  ): Promise<NonNullable<Awaited<ReturnType<AccountRepository['findByUserId']>>>> {
    if (!this.accountRepository) {
      throw new Error(
        'Session issuance requires the account repository (in-memory fallback cannot link sessions)',
      );
    }
    return this.ensureAccountRow(userId);
  }

  /**
   * Return the saved baskets for the given user.
   */
  async getSavedBaskets(userId: string): Promise<Basket[]> {
    // Database path
    if (this.savedBasketRepository) {
      const rows = await this.savedBasketRepository.findByUserId(userId);
      return rows.map((r) => this.rowToBasket(r));
    }

    // In-memory fallback
    const account = await this.getAccount(userId);
    return account.savedBaskets;
  }

  /**
   * Save a basket for the given user.
   */
  async saveBasket(userId: string, basket: Basket): Promise<void> {
    // Database path
    if (this.accountRepository && this.savedBasketRepository) {
      const row = await this.ensureAccountRow(userId);
      await this.savedBasketRepository.create({
        accountId: row.id,
        name: basket.name,
        items: basket.items as unknown as typeof savedBaskets.$inferInsert['items'],
      });
      this.logger.debug(`Basket "${basket.id}" saved for userId="${userId}"`);
      return;
    }

    // In-memory fallback
    const account = await this.getAccount(userId);
    account.savedBaskets.push(basket);
    this.logger.debug(`Basket "${basket.id}" saved for userId="${userId}"`);
  }

  // ---------------------------------------------------------------------------
  // Saved scenarios (Phase 2 — advanced features)
  // ---------------------------------------------------------------------------

  /**
   * Return the saved scenarios for the given user, newest activity first
   * (repository order).
   */
  async getScenarios(userId: string): Promise<SavedScenario[]> {
    // Database path
    if (this.savedScenarioRepository) {
      const rows = await this.savedScenarioRepository.findByUserId(userId);
      return rows.map((r) => this.rowToScenario(r));
    }

    // In-memory fallback
    return [...(this.scenarios.get(userId) ?? [])];
  }

  /**
   * Insert or replace the scenario named {@code name} for the user —
   * the (account, name) pair is the identity, inputs and updatedAt are
   * refreshed. Returns the persisted scenario.
   */
  async saveScenario(
    userId: string,
    name: string,
    inputs: SavedScenarioInputs,
  ): Promise<SavedScenario> {
    // Database path
    if (this.accountRepository && this.savedScenarioRepository) {
      const row = await this.ensureAccountRow(userId);
      const saved = await this.savedScenarioRepository.upsert({
        accountId: row.id,
        name,
        inputs: inputs as unknown as typeof savedScenarios.$inferInsert['inputs'],
      });
      this.logger.debug(`Scenario "${name}" saved for userId="${userId}"`);
      return this.rowToScenario(saved);
    }

    // In-memory fallback
    const list = this.scenarios.get(userId) ?? [];
    const now = new Date();
    const existingIndex = list.findIndex((s) => s.name === name);
    if (existingIndex !== -1) {
      const updated: SavedScenario = {
        ...list[existingIndex]!,
        inputs,
        updatedAt: now,
      };
      list[existingIndex] = updated;
      this.scenarios.set(userId, list);
      return updated;
    }
    const scenario: SavedScenario = {
      id: ++this.scenarioIdSeq,
      name,
      inputs,
      createdAt: now,
      updatedAt: now,
    };
    list.push(scenario);
    this.scenarios.set(userId, list);
    this.logger.debug(`Scenario "${name}" saved for userId="${userId}"`);
    return scenario;
  }

  /**
   * Delete a scenario for the given user.
   *
   * Account-scoped semantics: a scenario id that belongs to another account
   * is indistinguishable from a missing one and yields a NotFoundException —
   * never a cross-account delete.
   */
  async deleteScenario(userId: string, scenarioId: number): Promise<void> {
    // Database path
    if (this.accountRepository && this.savedScenarioRepository) {
      const accountRow = await this.accountRepository.findByUserId(userId);
      const owned = accountRow
        ? await this.savedScenarioRepository.findByAccountId(accountRow.id)
        : [];
      if (!accountRow || !owned.some((s) => s.id === scenarioId)) {
        throw new NotFoundException({
          statusCode: 404,
          message: `Scenario "${scenarioId}" not found`,
          error: 'ScenarioNotFound',
        });
      }
      await this.savedScenarioRepository.delete(accountRow.id, scenarioId);
      this.logger.debug(`Scenario "${scenarioId}" deleted for userId="${userId}"`);
      return;
    }

    // In-memory fallback
    const list = this.scenarios.get(userId) ?? [];
    const index = list.findIndex((s) => s.id === scenarioId);
    if (index === -1) {
      throw new NotFoundException({
        statusCode: 404,
        message: `Scenario "${scenarioId}" not found`,
        error: 'ScenarioNotFound',
      });
    }
    list.splice(index, 1);
    this.logger.debug(`Scenario "${scenarioId}" deleted for userId="${userId}"`);
  }

  /**
   * Create a default FREE-tier account.
   */
  private createDefaultAccount(userId: string): Account {
    const now = new Date();
    return {
      userId,
      email: `${userId}@placeholder.local`,
      tier: 'FREE',
      savedBaskets: [],
      calculationHistory: [],
      subscription: {
        userId,
        plan: 'FREE',
        active: true,
      },
      createdAt: now,
      lastActiveAt: now,
    };
  }

  /**
   * Return all account user IDs known to this service.
   *
   * Used by {@link AccountRetentionService} for retention-policy scans.
   */
  async getAllUserIds(): Promise<string[]> {
    if (this.accountRepository) {
      return this.accountRepository.findAllUserIds();
    }

    // In-memory fallback
    return Array.from(this.accounts.keys());
  }

  /**
   * Record user activity, updating the `lastActiveAt` timestamp.
   *
   * Called for every authenticated request to keep the retention clock
   * accurate.
   */
  async recordActivity(userId: string): Promise<void> {
    if (this.accountRepository) {
      await this.accountRepository.updateLastActive(userId);
      return;
    }

    // In-memory fallback
    const account = await this.getAccount(userId);
    (account as Account & { lastActiveAt: Date }).lastActiveAt = new Date();
  }

  /**
   * Remove an account from the store.
   *
   * Database path: deleting the account row cascades to saved scenarios at
   * the database level (saved_scenarios.account_id FK ON DELETE CASCADE),
   * so erasure cannot leave orphaned scenarios behind.
   */
  async deleteAccount(userId: string): Promise<void> {
    if (this.accountRepository) {
      await this.accountRepository.delete(userId);
      this.logger.debug(`Account "${userId}" deleted`);
      return;
    }

    // In-memory fallback — scenarios live in a separate map keyed by the
    // (now retired) userId, so they need an explicit delete to mirror the
    // DB-level cascade.
    this.accounts.delete(userId);
    this.scenarios.delete(userId);
    this.logger.debug(`Account "${userId}" deleted`);
  }

  /**
   * Append a calculation record ID to the user's calculation history.
   *
   * Database path: claims the calculation record for the account by
   * stamping `session_id` with the account's userId (the stable external
   * identity of the anonymous session account) — first claim wins, so a
   * cache-hit record id replayed to another session never re-assigns
   * ownership. The stamped rows survive anonymous-record retention and
   * surface in {@link getCalculationHistory} and the GDPR export.
   *
   * In-memory fallback (test-only): appends to the account's ID list.
   *
   * @param userId — unique user identifier
   * @param recordId — the calculation record ID to append
   */
  async addCalculationToHistory(
    userId: string,
    recordId: number,
  ): Promise<void> {
    // Database path
    if (this.calculationRecordRepository) {
      const linked =
        await this.calculationRecordRepository.linkSession(recordId, userId);
      if (!linked) {
        // Unknown record, or already owned by another session (e.g. an
        // idempotency cache hit) — the POST stays idempotent and
        // non-critical; ownership is never reassigned.
        this.logger.debug(
          `Calculation record ${recordId} not (re)linked for userId="${userId}" — absent or already claimed`,
        );
      }
      return;
    }

    // In-memory fallback
    const account = await this.getAccount(userId);
    account.calculationHistory.push(recordId);
    this.logger.debug(
      `Calculation record ${recordId} appended for userId="${userId}"`,
    );
  }

  /**
   * Return the user's calculation-history record IDs, oldest first.
   *
   * Database path: the IDs of the calculation records claimed by the
   * account (`session_id = userId`), chronological. In-memory fallback:
   * the account's appended ID list.
   */
  async getCalculationHistory(userId: string): Promise<number[]> {
    if (this.calculationRecordRepository) {
      const records =
        await this.calculationRecordRepository.findBySession(userId);
      return records.map((r) => r.id);
    }

    const account = await this.getAccount(userId);
    return account.calculationHistory;
  }

  /**
   * Return the user's calculation history as GDPR-export records.
   *
   * Database path: minimal projections of the claimed calculation records
   * (identity, timestamp, total, quantity, product name) — no breakdown
   * or input data beyond what the export renders. In-memory fallback:
   * synthesized stubs from the account's ID list (test-only).
   */
  async getCalculationHistoryForExport(
    userId: string,
  ): Promise<CalculationExportRecord[]> {
    if (this.calculationRecordRepository) {
      const entries =
        await this.calculationRecordRepository.findHistoryEntriesBySession(
          userId,
        );
      return entries.map((entry) => ({
        calculationId: entry.calculationId,
        timestamp: entry.calculatedAt,
        totalCents: entry.totalCents,
        productName: entry.productName,
        quantity: entry.quantity,
      }));
    }

    const account = await this.getAccount(userId);
    return account.calculationHistory.map((id, index) => ({
      calculationId: id,
      // In-memory fallback: synthetic timestamp (test-only path).
      timestamp: new Date(Date.now() - index * 86_400_000),
      totalCents: 0,
      productName: `calculation-${id}`,
      quantity: 1,
    }));
  }

  /**
   * Anonymize an account — irreversibly replace identifying fields while
   * retaining the non-personal account skeleton (tier, timestamps).
   *
   * In DB mode: delegates to {@link AccountRepository.anonymize} which
   * performs a transactional UPDATE (irreversible pseudonymization) +
   * cascade delete of saved baskets and saved scenarios, then records an
   * audit event.
   *
   * In-memory (test-only fallback): replaces userId and email with
   * anonymized values in the local Map and drops the user's scenarios.
   */
  async anonymizeAccount(userId: string): Promise<void> {
    if (this.accountRepository) {
      await this.accountRepository.anonymize(userId);
      this.logger.debug(`Account "${userId}" anonymized via repository`);

      // Record audit event when AuditService is available. Lifecycle-level
      // event (matching the existing account-data convention — no per-CRUD
      // events); the reason records that the cascade covered scenarios.
      if (this.auditService) {
        await this.auditService.logChange({
          entityType: 'account',
          entityId: userId,
          action: 'deleted',
          author: 'system',
          reason: 'GDPR anonymization requested; saved baskets and saved scenarios deleted',
        });
        this.logger.debug(`Audit event recorded for anonymization of "${userId}"`);
      }

      return;
    }

    // In-memory fallback (test-only — see constructor fail-fast)
    const account = await this.getAccount(userId);
    const mutable = account as Account & { email: string; userId: string };
    const anonId = `anon-${userId}`;
    mutable.email = `anonymized-${userId}@deleted.local`;
    mutable.userId = anonId;
    this.accounts.delete(userId);
    this.accounts.set(anonId, account);
    // Scenarios are keyed by the retired userId — drop them so the
    // fallback mirrors the repository cascade (no orphaned scenario data).
    this.scenarios.delete(userId);
    this.logger.debug(`Account "${userId}" anonymized -> "${anonId}"`);
  }

  /**
   * Upgrade an anonymous account to a verified one by persisting the
   * verified email on the account row (task 2.4, design D5). The same
   * session keeps authenticating the account — sessions link to the row,
   * not to the email — and from this point the account's data is protected
   * by identity guarantees instead of disposable.
   *
   * Groundwork: real email delivery/provider round-trip is out of scope;
   * callers are expected to have validated the address format.
   */
  async verifyEmail(userId: string, email: string): Promise<void> {
    // In-memory fallback (test-only — see constructor fail-fast)
    if (!this.verifiedEmailStore && !this.accountRepository) {
      const account = await this.getAccount(userId);
      (account as Account & { email: string }).email = email;
      this.logger.debug(`Email verified for userId="${userId}" (in-memory fallback)`);
      return;
    }

    if (!this.verifiedEmailStore) {
      // Repository-bound but no verification store — explicit failure beats
      // a silent no-op that would claim verification it did not persist.
      throw new Error(
        'AccountService.verifyEmail requires a VerifiedEmailStore binding',
      );
    }

    await this.verifiedEmailStore.setVerifiedEmail(userId, email);
    this.logger.debug(`Email verified for userId="${userId}"`);

    if (this.auditService) {
      await this.auditService.logChange({
        entityType: 'account',
        entityId: userId,
        action: 'updated',
        author: 'system',
        reason: 'Email verification: anonymous account upgraded to verified (task 2.4, D5)',
      });
    }
  }
}