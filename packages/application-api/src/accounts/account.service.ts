/**
 * AccountService — minimal account management.
 *
 * Phase 1: in-memory simulation. Accounts are created on first access
 * with default FREE tier and empty baskets/history.
 *
 * ## Usage
 *
 * ```typescript
 * const account = await accountService.getAccount(userId);
 * const baskets = await accountService.getSavedBaskets(userId);
 * ```
 *
 * ## Upgrade path
 *
 * Replace the in-memory Map with a database-backed repository when
 * persistence is required.
 *
 * @module AccountService
 */

import { Injectable, Logger } from '@nestjs/common';
import type { Account, Basket } from './account.types';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  /** Phase 1: in-memory account store. */
  private readonly accounts = new Map<string, Account>();

  /**
   * Retrieve the account for the given user.
   *
   * Creates a default FREE-tier account on first access.
   *
   * @param userId — unique user identifier
   */
  async getAccount(userId: string): Promise<Account> {
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
   * Always returns the current live array from the stored account.
   */
  async getSavedBaskets(userId: string): Promise<Basket[]> {
    const account = await this.getAccount(userId);
    return account.savedBaskets;
  }

  /**
   * Save a basket for the given user.
   *
   * Phase 1: in-memory only. The basket is appended to the user's
   * saved baskets list.
   */
  async saveBasket(userId: string, basket: Basket): Promise<void> {
    const account = await this.getAccount(userId);
    // In-place mutation is safe here because we own the reference
    account.savedBaskets.push(basket);
    this.logger.debug(`Basket "${basket.id}" saved for userId="${userId}"`);
  }

  /**
   * Create a default FREE-tier account.
   */
  private createDefaultAccount(userId: string): Account {
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
    };
  }
}