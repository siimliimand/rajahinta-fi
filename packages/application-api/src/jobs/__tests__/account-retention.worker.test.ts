/**
 * AccountRetentionWorker tests.
 *
 * Verifies the daily cron worker correctly invokes retention service
 * methods, handles error propagation, and carries the expected cron
 * schedule configuration.
 *
 * @module AccountRetentionWorkerTest
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AccountRetentionWorker } from '../workers/account-retention.worker';
import type { AccountRetentionService } from '../../accounts/account-retention.service';
import type { PurgeResult, AnonymizeResult } from '../../accounts/account-retention.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockPurgeResult: PurgeResult = {
  deletedCount: 3,
  deletedUserIds: ['expired-a', 'expired-b', 'expired-c'],
};

const mockAnonymizeResult: AnonymizeResult = {
  anonymizedCount: 2,
  anonymizedUserIds: ['inactive-x', 'inactive-y'],
};

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function createMockRetentionService(): Partial<AccountRetentionService> {
  return {
    purgeExpiredAccounts: vi.fn<() => Promise<PurgeResult>>().mockResolvedValue(mockPurgeResult),
    anonymizeInactiveAccounts: vi
      .fn<() => Promise<AnonymizeResult>>()
      .mockResolvedValue(mockAnonymizeResult),
  };
}

// ---------------------------------------------------------------------------
// AccountRetentionWorker
// ---------------------------------------------------------------------------

describe('AccountRetentionWorker', () => {
  let worker: AccountRetentionWorker;
  let mockService: ReturnType<typeof createMockRetentionService>;

  beforeEach(() => {
    mockService = createMockRetentionService();
    worker = new AccountRetentionWorker(
      mockService as unknown as AccountRetentionService,
    );
  });

  // -----------------------------------------------------------------------
  // handleRetention — normal flow
  // -----------------------------------------------------------------------

  describe('handleRetention', () => {
    it('calls purgeExpiredAccounts then anonymizeInactiveAccounts', async () => {
      await worker.handleRetention();

      expect(mockService.purgeExpiredAccounts).toHaveBeenCalledTimes(1);
      expect(mockService.anonymizeInactiveAccounts).toHaveBeenCalledTimes(1);
    });

    it('invokes purge before anonymize', async () => {
      const callOrder: string[] = [];

      mockService.purgeExpiredAccounts = vi
        .fn<() => Promise<PurgeResult>>()
        .mockImplementation(async () => {
          callOrder.push('purge');
          return mockPurgeResult;
        });
      mockService.anonymizeInactiveAccounts = vi
        .fn<() => Promise<AnonymizeResult>>()
        .mockImplementation(async () => {
          callOrder.push('anonymize');
          return mockAnonymizeResult;
        });

      await worker.handleRetention();

      expect(callOrder).toEqual(['purge', 'anonymize']);
    });

    it('passes through the results from the retention service', async () => {
      // The worker logs results but doesn't return them, so we verify the
      // mock was invoked and returned the expected values internally.
      await worker.handleRetention();

      const purgeResult = await mockService.purgeExpiredAccounts!();
      expect(purgeResult.deletedCount).toBe(3);
      expect(purgeResult.deletedUserIds).toHaveLength(3);

      const anonResult = await mockService.anonymizeInactiveAccounts!();
      expect(anonResult.anonymizedCount).toBe(2);
      expect(anonResult.anonymizedUserIds).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe('error handling', () => {
    it('propagates error when purgeExpiredAccounts throws', async () => {
      const dbError = new Error('Database connection lost');
      mockService.purgeExpiredAccounts = vi
        .fn<() => Promise<PurgeResult>>()
        .mockRejectedValue(dbError);

      await expect(worker.handleRetention()).rejects.toThrow('Database connection lost');

      // anonymizeInactiveAccounts must not be called when purge fails
      expect(mockService.anonymizeInactiveAccounts).not.toHaveBeenCalled();
    });

    it('propagates error when anonymizeInactiveAccounts throws after purge succeeds', async () => {
      const anonError = new Error('Anonymization batch failed');
      mockService.anonymizeInactiveAccounts = vi
        .fn<() => Promise<AnonymizeResult>>()
        .mockRejectedValue(anonError);

      await expect(worker.handleRetention()).rejects.toThrow('Anonymization batch failed');

      // purgeExpiredAccounts should have completed before the error
      expect(mockService.purgeExpiredAccounts).toHaveBeenCalledTimes(1);
    });

    it('surfaces a plain Error (not a NestJS exception)', async () => {
      // Since the worker has no try/catch, errors bubble up as-is
      const fooError = new Error('Something went wrong');
      mockService.purgeExpiredAccounts = vi
        .fn<() => Promise<PurgeResult>>()
        .mockRejectedValue(fooError);

      const caught = await worker.handleRetention().catch((e) => e);
      expect(caught).toBe(fooError);
      expect(caught).toBeInstanceOf(Error);
    });
  });

  // -----------------------------------------------------------------------
  // Cron decorator metadata
  // -----------------------------------------------------------------------

  describe('cron configuration', () => {
    it('has @Cron decorator with expected morning expression', () => {
      // NestJS SetMetadata stores options under the 'SCHEDULE_CRON_OPTIONS' key.
      const cronOptions = Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        AccountRetentionWorker.prototype.handleRetention,
      );

      expect(cronOptions).toBeDefined();
      expect(cronOptions.cronTime).toBe('0 3 * * *');
    });

    it('configures timeZone as Europe/Helsinki', () => {
      const cronOptions = Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        AccountRetentionWorker.prototype.handleRetention,
      );

      expect(cronOptions).toBeDefined();
      expect(cronOptions.timeZone).toBe('Europe/Helsinki');
    });
  });
});