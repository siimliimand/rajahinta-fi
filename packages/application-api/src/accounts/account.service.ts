/**
 * AccountService — minimal account management.
 *
 * Phase 1: supports both database-backed and in-memory operation.
 * When {@link AccountRepository} and {@link SavedBasketRepository} are
 * injected via NestJS DI, all reads and writes go through the Drizzle
 * repositories. When not injected (e.g. in unit tests), a fallback
 * in-memory Map is used.
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

import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Account, Basket, BasketItem } from './account.types';
import { AccountRepository, SavedBasketRepository, accounts, savedBaskets } from '@rajahinta/data-platform';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  /** Fallback in-memory account store when repositories are not injected. */
  private readonly accounts = new Map<string, Account>();

  constructor(
    @Optional() private readonly accountRepository?: AccountRepository,
    @Optional() private readonly savedBasketRepository?: SavedBasketRepository,
  ) {}

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
      const row = await this.accountRepository.findByUserId(userId);
      if (row) {
        return this.rowToAccount(row);
      }

      this.logger.debug(`Creating default account for userId="${userId}"`);
      const created = await this.accountRepository.create({
        userId,
        email: `${userId}@placeholder.local`,
        tier: 'FREE',
      });
      return this.rowToAccount(created);
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
      let row = await this.accountRepository.findByUserId(userId);
      if (!row) {
        row = await this.accountRepository.create({
          userId,
          email: `${userId}@placeholder.local`,
          tier: 'FREE',
        });
      }
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
   * Phase 1: when a database repository is present, cascading deletion
   * of saved baskets and calculation records is a future concern.
   */
  async deleteAccount(userId: string): Promise<void> {
    if (this.accountRepository) {
      await this.accountRepository.delete(userId);
      this.logger.debug(`Account "${userId}" deleted`);
      return;
    }

    // In-memory fallback
    this.accounts.delete(userId);
    this.logger.debug(`Account "${userId}" deleted`);
  }

  /**
   * Append a calculation record ID to the user's calculation history.
   *
   * Phase 1: in-memory only. When repositories are present this is a
   * no-op — calculation record linking is handled via the
   * calculationRecords table FK relationship.
   *
   * @param userId — unique user identifier
   * @param recordId — the calculation record ID to append
   */
  async addCalculationToHistory(
    userId: string,
    recordId: number,
  ): Promise<void> {
    // Database path — calculation record linking is handled via the
    // calculationRecords table; no separate append needed.
    if (this.accountRepository) {
      this.logger.debug(
        `Calculation record ${recordId} linked via table FK for userId="${userId}" (no-op in DB path)`,
      );
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
   * Anonymize an account — replace identifying fields while retaining
   * non-personal data (saved baskets, calculation history).
   *
   * Phase 1: in-memory only. A database implementation would use an
   * UPDATE query to replace email and userId fields.
   */
  async anonymizeAccount(userId: string): Promise<void> {
    if (this.accountRepository) {
      this.logger.warn(
        `anonymizeAccount called for userId="${userId}" in DB mode — ` +
          'not yet implemented. Use AccountRepository methods directly.',
      );
      return;
    }

    // In-memory fallback
    const account = await this.getAccount(userId);
    const mutable = account as Account & { email: string; userId: string };
    const anonId = `anon-${userId}`;
    mutable.email = `anonymized-${userId}@deleted.local`;
    mutable.userId = anonId;
    this.accounts.delete(userId);
    this.accounts.set(anonId, account);
    this.logger.debug(`Account "${userId}" anonymized -> "${anonId}"`);
  }
}