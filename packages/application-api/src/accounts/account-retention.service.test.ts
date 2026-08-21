/**
 * AccountRetentionService tests.
 *
 * Verifies retention-policy enforcement: purge expired accounts,
 * purge calculation history, anonymize inactive accounts.
 *
 * ## Persistence boundary
 *
 * These tests construct `AccountService` without repository arguments,
 * so the in-memory Map fallback is used. This is intentional:
 *
 * - **Unit tests** (here): verify retention logic — date comparisons,
 *   anonymization rules, purge targeting. Fast, deterministic, no DB.
 * - **Integration tests** (separate): verify that baskets and history
 *   survive process restart via PostgreSQL. Those tests require a
 *   running database and are not in this file.
 *
 * Both layers must pass. The unit layer proves the algorithm is correct;
 * the integration layer proves data survives restarts. See
 * `ARCHITECTURE.md` § "Persistence boundary" for the contract.
 *
 * @module AccountRetentionServiceTest
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AccountService } from './account.service';
import { AccountRetentionService, RETENTION_CONFIG } from './account-retention.service';
import type { Account } from './account.types';

describe('AccountRetentionService', () => {
  let accountService: AccountService;
  let retentionService: AccountRetentionService;

  beforeEach(() => {
    accountService = new AccountService();
    retentionService = new AccountRetentionService(accountService);
  });

  // -------------------------------------------------------------------
  // purgeExpiredAccounts
  // -------------------------------------------------------------------

  it('purges accounts inactive longer than 12 months', async () => {
    // Create an account that was last active 13 months ago
    const oldUserId = 'old-user';
    const account = await accountService.getAccount(oldUserId);
    (account as Account & { lastActiveAt: Date }).lastActiveAt = new Date(
      Date.now() - 13 * 30 * 24 * 60 * 60 * 1000,
    );

    // Create a recently active account (should NOT be purged)
    const recentUserId = 'recent-user';
    await accountService.getAccount(recentUserId);

    const result = await retentionService.purgeExpiredAccounts();

    expect(result.deletedCount).toBe(1);
    expect(result.deletedUserIds).toContain(oldUserId);
    expect(result.deletedUserIds).not.toContain(recentUserId);

    // Verify the old account is actually gone — check BEFORE calling getAccount()
    // (getAccount re-creates on demand in Phase 1).
    const userIdsAfter = await accountService.getAllUserIds();
    expect(userIdsAfter).not.toContain(oldUserId);
    // recent-user was created by getAccount above — should still exist
    expect(userIdsAfter).toContain(recentUserId);
  });

  it('returns empty result when no accounts are expired', async () => {
    await accountService.getAccount('fresh-user');
    const result = await retentionService.purgeExpiredAccounts();
    expect(result.deletedCount).toBe(0);
    expect(result.deletedUserIds).toEqual([]);
  });

  // -------------------------------------------------------------------
  // purgeCalculationHistory
  // -------------------------------------------------------------------

  it('clears calculation history for the given user', async () => {
    const userId = 'hist-user';
    const account = await accountService.getAccount(userId);
    (account as Account & { calculationHistory: number[] }).calculationHistory = [1, 2, 3];

    await retentionService.purgeCalculationHistory(userId);

    const updated = await accountService.getAccount(userId);
    expect(updated.calculationHistory).toEqual([]);
  });

  it('does not affect other users when purging calculation history', async () => {
    const userA = 'user-a';
    const userB = 'user-b';
    const accountA = await accountService.getAccount(userA);
    const accountB = await accountService.getAccount(userB);
    (accountA as Account & { calculationHistory: number[] }).calculationHistory = [1];
    (accountB as Account & { calculationHistory: number[] }).calculationHistory = [2];

    await retentionService.purgeCalculationHistory(userA);

    const updatedA = await accountService.getAccount(userA);
    const updatedB = await accountService.getAccount(userB);
    expect(updatedA.calculationHistory).toEqual([]);
    expect(updatedB.calculationHistory).toEqual([2]);
  });

  // -------------------------------------------------------------------
  // anonymizeInactiveAccounts
  // -------------------------------------------------------------------

  it('anonymizes accounts inactive between 6 and 12 months', async () => {
    // Account inactive 8 months ago (within anonymize window)
    const anonUser = 'anon-me';
    const account = await accountService.getAccount(anonUser);
    (account as Account & { lastActiveAt: Date }).lastActiveAt = new Date(
      Date.now() - 8 * 30 * 24 * 60 * 60 * 1000,
    );

    // Account inactive 13 months ago (should be purged first, not anonymized)
    const deleteUser = 'delete-me';
    const account2 = await accountService.getAccount(deleteUser);
    (account2 as Account & { lastActiveAt: Date }).lastActiveAt = new Date(
      Date.now() - 13 * 30 * 24 * 60 * 60 * 1000,
    );

    // Fresh account (should not be touched)
    const freshUser = 'fresh-me';
    await accountService.getAccount(freshUser);

    const result = await retentionService.anonymizeInactiveAccounts();

    expect(result.anonymizedCount).toBe(1);
    expect(result.anonymizedUserIds).toContain(anonUser);
    expect(result.anonymizedUserIds).not.toContain(deleteUser);
    expect(result.anonymizedUserIds).not.toContain(freshUser);

    // Verify the anonymized account's email was replaced
    const updated = await accountService.getAccount(`anon-${anonUser}`);
    expect(updated.email).toContain('@deleted.local');
    expect(updated.email).not.toContain('@placeholder.local');
  });

  it('returns empty result when no accounts need anonymization', async () => {
    await accountService.getAccount('active-user');
    const result = await retentionService.anonymizeInactiveAccounts();
    expect(result.anonymizedCount).toBe(0);
  });

  // -------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------

  it('exports retention configuration with expected values', () => {
    // Verify the constants are set to the documented values
    // 12 months in ms
    expect(RETENTION_CONFIG.accountInactivityDeleteMs).toBe(12 * 30 * 24 * 60 * 60 * 1000);
    // 6 months in ms
    expect(RETENTION_CONFIG.accountInactivityAnonymizeMs).toBe(6 * 30 * 24 * 60 * 60 * 1000);
    // 24 months in ms
    expect(RETENTION_CONFIG.calculationHistoryRetentionMs).toBe(24 * 30 * 24 * 60 * 60 * 1000);
    // 12 months in ms
    expect(RETENTION_CONFIG.analyticsRetentionMs).toBe(12 * 30 * 24 * 60 * 60 * 1000);
  });
});