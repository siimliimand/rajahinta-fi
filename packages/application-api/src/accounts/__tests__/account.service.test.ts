/**
 * AccountService unit tests.
 *
 * Covers:
 * - TASK 4.2: Fail-fast constructor guard (rejects missing repos outside test env)
 * - TASK 4.1: anonymizeAccount in DB mode (delegates to repository, records audit)
 * - TASK 4.1: anonymizeAccount in-memory path unchanged
 *
 * ## Integration gap
 *
 * These tests use mocked AccountRepository. A true integration test against
 * real PostgreSQL (via testcontainers) is tracked in task 4.3. No such harness
 * currently exists in this package (no testcontainers / pg in vitest config).
 *
 * @module AccountServiceTest
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { AccountService } from '../account.service';
import { AuditService } from '@rajahinta/core-domain';
import type { AccountRepository, SavedBasketRepository } from '@rajahinta/data-platform';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Enable the fail-fast (non-test) mode by clearing the VITEST env var. */
function simulateProductionEnv(): void {
  // vitest sets VITEST=true automatically; override for this test scope.
  vi.stubEnv('VITEST', 'false');
  vi.stubEnv('NODE_ENV', 'production');
}

function restoreEnv(): void {
  vi.unstubAllEnvs();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AccountService', () => {
  afterEach(() => {
    restoreEnv();
  });

  // -----------------------------------------------------------------------
  // TASK 4.2 — Fail-fast constructor guard
  // -----------------------------------------------------------------------

  describe('constructor (fail-fast) — Task 4.2', () => {
    it('throws when both repositories are missing outside test env', () => {
      simulateProductionEnv();
      expect(() => new AccountService()).toThrow(/AccountRepository/);
    });

    it('throws when only AccountRepository is missing outside test env', () => {
      simulateProductionEnv();
      const mockBasketRepo = {} as unknown as SavedBasketRepository;
      expect(() => new AccountService(undefined, mockBasketRepo)).toThrow(
        'AccountRepository',
      );
    });

    it('throws when only SavedBasketRepository is missing outside test env', () => {
      simulateProductionEnv();
      const mockAccountRepo = {} as unknown as AccountRepository;
      expect(() => new AccountService(mockAccountRepo, undefined)).toThrow(
        'SavedBasketRepository',
      );
    });

    it('accepts missing repos in test environment (VITEST=true)', () => {
      // VITEST is true by default under vitest
      expect(() => new AccountService()).not.toThrow();
    });

    it('accepts missing repos when NODE_ENV=test', () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('VITEST', 'false');
      expect(() => new AccountService()).not.toThrow();
    });

    it('accepts all repos in production (no missing error)', () => {
      simulateProductionEnv();
      const mockAccountRepo = { anonymize: vi.fn() } as unknown as AccountRepository;
      const mockBasketRepo = {} as unknown as SavedBasketRepository;
      expect(() => new AccountService(mockAccountRepo, mockBasketRepo)).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // TASK 4.1 — anonymizeAccount in DB mode
  // -----------------------------------------------------------------------

  describe('anonymizeAccount (DB mode) — Task 4.1', () => {
    it('delegates to accountRepository.anonymize with the correct userId', async () => {
      const anonymize = vi.fn().mockResolvedValue(undefined);
      const mockAccountRepo = { anonymize } as unknown as AccountRepository;
      const mockBasketRepo = {} as unknown as SavedBasketRepository;
      const service = new AccountService(mockAccountRepo, mockBasketRepo);

      await service.anonymizeAccount('user-123');

      expect(anonymize).toHaveBeenCalledTimes(1);
      expect(anonymize).toHaveBeenCalledWith('user-123');
    });

    it('records an audit event via AuditService when available', async () => {
      const anonymize = vi.fn().mockResolvedValue(undefined);
      const logChange = vi.fn().mockResolvedValue(undefined);
      const mockAccountRepo = { anonymize } as unknown as AccountRepository;
      const mockBasketRepo = {} as unknown as SavedBasketRepository;
      const mockAuditService = { logChange } as unknown as AuditService;
      const service = new AccountService(mockAccountRepo, mockBasketRepo, mockAuditService);

      await service.anonymizeAccount('user-123');

      expect(logChange).toHaveBeenCalledTimes(1);
      expect(logChange).toHaveBeenCalledWith({
        entityType: 'account',
        entityId: 'user-123',
        action: 'deleted',
        author: 'system',
        reason: 'GDPR anonymization requested',
      });
    });

    it('skips audit silently when AuditService is not injected', async () => {
      const anonymize = vi.fn().mockResolvedValue(undefined);
      const mockAccountRepo = { anonymize } as unknown as AccountRepository;
      const mockBasketRepo = {} as unknown as SavedBasketRepository;
      const service = new AccountService(mockAccountRepo, mockBasketRepo);

      await expect(service.anonymizeAccount('user-123')).resolves.toBeUndefined();
      expect(anonymize).toHaveBeenCalledWith('user-123');
    });

    it('propagates errors from accountRepository.anonymize', async () => {
      const anonymize = vi.fn().mockRejectedValue(new Error('Account not found'));
      const mockAccountRepo = { anonymize } as unknown as AccountRepository;
      const mockBasketRepo = {} as unknown as SavedBasketRepository;
      const service = new AccountService(mockAccountRepo, mockBasketRepo);

      await expect(service.anonymizeAccount('ghost-user')).rejects.toThrow(
        'Account not found',
      );
    });
  });

  // -----------------------------------------------------------------------
  // TASK 4.1 — anonymizeAccount in-memory path (unchanged)
  // -----------------------------------------------------------------------

  describe('anonymizeAccount (in-memory path unchanged)', () => {
    it('replaces userId with anon- prefix and email with @deleted.local', async () => {
      const service = new AccountService();
      const userId = 'user-to-anon';

      await service.getAccount(userId);
      await service.anonymizeAccount(userId);

      const userIds = await service.getAllUserIds();
      // Original userId should be gone
      expect(userIds).not.toContain(userId);
      // An anonymized ID should exist (starts with 'anon-')
      const anonId = userIds.find((id) => id.startsWith('anon-'));
      expect(anonId).toBeDefined();

      const account = await service.getAccount(anonId!);
      expect(account.email).toContain('@deleted.local');
      // The original placeholder email ('@placeholder.local') must be gone
      expect(account.email).not.toContain('@placeholder.local');
    });

    it('does not throw when anonymizing a non-existent user (auto-creates then anonymizes)', async () => {
      const service = new AccountService();
      // getAccount auto-creates — so even a ghost user works in-memory mode
      await expect(service.anonymizeAccount('ghost-inmem')).resolves.toBeUndefined();
    });
  });
});